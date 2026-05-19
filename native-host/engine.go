package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"
)

type Engine struct {
	storage    *Storage
	active     map[string]*ActiveDownload
	onProgress func(DownloadState)
	mu         sync.Mutex
}

type ActiveDownload struct {
	State  *DownloadState
	Ctx    context.Context
	Cancel context.CancelFunc
	mu     sync.Mutex
}

func NewEngine(s *Storage, onProgress func(DownloadState)) *Engine {
	return &Engine{
		storage:    s,
		active:     make(map[string]*ActiveDownload),
		onProgress: onProgress,
	}
}

func (e *Engine) Add(url string, filename string, segments int) (*DownloadState, error) {
	// 1. Get metadata
	resp, err := http.Head(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	size := resp.ContentLength
	acceptRanges := resp.Header.Get("Accept-Ranges") == "bytes"

	id := fmt.Sprintf("%d", os.Getpid()) + fmt.Sprintf("%d", time.Now().UnixNano())
	
	state := &DownloadState{
		ID:        id,
		URL:       url,
		Filename:  filename,
		TotalSize: size,
		Status:    "queued",
		Type:      "file",
		CreatedAt: time.Now(),
	}

	// 2. Fragment segments
	numSegments := segments
	if numSegments <= 0 {
		numSegments = 8
	}
	if !acceptRanges || size <= 0 {
		numSegments = 1
	}

	segmentSize := size / int64(numSegments)
	for i := 0; i < numSegments; i++ {
		start := int64(i) * segmentSize
		end := start + segmentSize - 1
		if i == numSegments-1 {
			end = size - 1
		}
		state.Segments = append(state.Segments, Segment{
			Index: i,
			Start: start,
			End:   end,
		})
	}

	if err := e.storage.SaveDownload(state); err != nil {
		return nil, err
	}

	return state, nil
}

func (e *Engine) AddVideo(url string, filename string) (*DownloadState, error) {
	id := fmt.Sprintf("%d", os.Getpid()) + fmt.Sprintf("%d", time.Now().UnixNano())
	
	state := &DownloadState{
		ID:        id,
		URL:       url,
		Filename:  filename,
		Type:      "video",
		Status:    "queued",
		CreatedAt: time.Now(),
	}

	if err := e.storage.SaveDownload(state); err != nil {
		return nil, err
	}

	return state, nil
}

func (e *Engine) Start(id string) error {
	state, err := e.storage.GetDownload(id)
	if err != nil {
		return err
	}

	e.mu.Lock()
	if _, ok := e.active[id]; ok {
		e.mu.Unlock()
		return fmt.Errorf("already active")
	}
	
	ctx, cancel := context.WithCancel(context.Background())
	active := &ActiveDownload{
		State:  state,
		Ctx:    ctx,
		Cancel: cancel,
	}
	e.active[id] = active
	e.mu.Unlock()

	state.Status = "downloading"
	e.storage.SaveDownload(state)

	if state.Type == "video" {
		go e.runVideoDownload(active)
	} else {
		go e.runDownload(active)
	}
	return nil
}

func (e *Engine) runDownload(a *ActiveDownload) {
	// Pre-allocate file
	f, err := os.OpenFile(a.State.Filename, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.Truncate(a.State.TotalSize)

	var wg sync.WaitGroup
	var lastError error

	for i := range a.State.Segments {
		if a.State.Segments[i].Completed {
			continue
		}
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			err := e.downloadSegment(a, idx)
			if err != nil && a.Ctx.Err() != context.Canceled && err != context.Canceled {
				a.mu.Lock()
				lastError = err
				a.State.Error = err.Error()
				a.mu.Unlock()
			}
		}(i)
	}

	// Progress reporter goroutine
	done := make(chan bool)
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		
		var lastBytes int64
		for {
			select {
			case <-ticker.C:
				var currentBytes int64
				a.mu.Lock()
				for _, s := range a.State.Segments {
					currentBytes += s.Current
				}
				
				diff := currentBytes - lastBytes
				lastBytes = currentBytes
				
				a.State.Progress = float64(currentBytes) / float64(a.State.TotalSize) * 100
				a.State.Speed = formatSpeed(diff * 2) 
				a.mu.Unlock()
				
				e.storage.SaveDownload(a.State)
				if e.onProgress != nil {
					e.onProgress(*a.State)
				}
			case <-done:
				return
			case <-a.Ctx.Done():
				return
			}
		}
	}()

	wg.Wait()
	close(done)
	
	e.mu.Lock()
	delete(e.active, a.State.ID)
	e.mu.Unlock()

	a.mu.Lock()
	// Check if all completed
	allDone := true
	for _, s := range a.State.Segments {
		if !s.Completed {
			allDone = false
			break
		}
	}

	if lastError != nil {
		a.State.Status = "error"
		a.State.Speed = "0 B/s"
	} else if allDone {
		a.State.Status = "finished"
		a.State.Progress = 100
		a.State.Speed = "0 B/s"
		a.State.Error = ""
	} else {
		a.State.Status = "paused"
		a.State.Speed = "0 B/s"
	}
	
	// Create a safe copy of the final state to pass to storage and callbacks
	finalState := *a.State
	a.mu.Unlock()

	e.storage.SaveDownload(&finalState)
	if e.onProgress != nil {
		e.onProgress(finalState)
	}
}

func formatSpeed(bytesPerSec int64) string {
	const unit = 1024
	if bytesPerSec < unit {
		return fmt.Sprintf("%d B/s", bytesPerSec)
	}
	div, exp := int64(unit), 0
	for n := bytesPerSec / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB/s", float64(bytesPerSec)/float64(div), "KMGTPE"[exp])
}

func (e *Engine) downloadSegment(a *ActiveDownload, idx int) error {
	seg := &a.State.Segments[idx]
	
	req, _ := http.NewRequestWithContext(a.Ctx, "GET", a.State.URL, nil)
	rangeHeader := fmt.Sprintf("bytes=%d-%d", seg.Start+seg.Current, seg.End)
	req.Header.Set("Range", rangeHeader)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	f, _ := os.OpenFile(a.State.Filename, os.O_WRONLY, 0644)
	defer f.Close()
	f.Seek(seg.Start+seg.Current, 0)

	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			f.Write(buf[:n])
			a.mu.Lock()
			seg.Current += int64(n)
			a.mu.Unlock()
		}
		if err != nil {
			if err == io.EOF {
				a.mu.Lock()
				seg.Completed = true
				a.mu.Unlock()
				return nil
			}
			return err
		}
	}
}

func (e *Engine) Pause(id string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if a, ok := e.active[id]; ok {
		a.Cancel()
	}
}

func (e *Engine) Resume(id string) error {
	return e.Start(id)
}

func (e *Engine) runVideoDownload(a *ActiveDownload) {
	tempFilename := a.State.Filename + ".ts"
	cmd := exec.CommandContext(a.Ctx, "ffmpeg", "-y", "-i", a.State.URL, "-c", "copy", tempFilename)
	
	// Start progress reporter
	done := make(chan bool)
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				a.mu.Lock()
				a.State.Speed = "downloading"
				a.mu.Unlock()
				if e.onProgress != nil {
					e.onProgress(*a.State)
				}
			case <-done:
				return
			}
		}
	}()

	err := cmd.Run()
	close(done)

	if err == nil && a.Ctx.Err() == nil {
		err = e.muxVideoSegments(a, tempFilename, a.State.Filename)
		os.Remove(tempFilename)
	}

	e.mu.Lock()
	delete(e.active, a.State.ID)
	e.mu.Unlock()

	a.mu.Lock()
	if err != nil {
		if a.Ctx.Err() == context.Canceled || err == context.Canceled {
			a.State.Status = "paused"
		} else {
			a.State.Status = "error"
			a.State.Error = err.Error()
		}
		a.State.Speed = "0 B/s"
	} else {
		a.State.Status = "finished"
		a.State.Progress = 100
		a.State.Speed = "0 B/s"
		a.State.Error = ""
		
		// Update size
		if info, err := os.Stat(a.State.Filename); err == nil {
			a.State.TotalSize = info.Size()
		}
	}
	
	finalState := *a.State
	a.mu.Unlock()

	e.storage.SaveDownload(&finalState)
	if e.onProgress != nil {
		e.onProgress(finalState)
	}
}

func (e *Engine) muxVideoSegments(a *ActiveDownload, input string, output string) error {
	a.mu.Lock()
	a.State.Status = "muxing"
	a.State.Speed = "muxing"
	a.mu.Unlock()
	
	e.storage.SaveDownload(a.State)
	if e.onProgress != nil {
		e.onProgress(*a.State)
	}

	muxCmd := exec.CommandContext(a.Ctx, "ffmpeg", "-y", "-i", input, "-c", "copy", "-bsf:a", "aac_adtstoasc", output)
	return muxCmd.Run()
}

