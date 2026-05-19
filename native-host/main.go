package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type Request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	ID     int             `json:"id"`
}

type Response struct {
	Status  string      `json:"status"`
	Message string      `json:"message"`
	Payload interface{} `json:"payload,omitempty"`
	ID      int         `json:"id"`
}

func main() {
	// Redirect logs to stderr
	fmt.Fprintln(os.Stderr, "TuyulDM Native Host Started")

	dataDir, err := DataDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Data dir error:", err)
		return
	}
	fmt.Fprintln(os.Stderr, "Data dir:", dataDir)

	storage, err := NewStorage(filepath.Join(dataDir, "tuyuldm.db"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Storage error:", err)
		return
	}
	engine := NewEngine(storage, func(state DownloadState) {
		msg := Response{
			Status:  "ok",
			Message: "download.progressUpdate",
			Payload: state,
			ID:      0, // Event messages can have ID 0
		}
		out, _ := json.Marshal(msg)
		WriteMessage(os.Stdout, out)
	})

	for {
		payload, err := ReadMessage(os.Stdin)
		if err != nil {
			if err != io.EOF {
				fmt.Fprintln(os.Stderr, "Read error:", err)
			}
			break
		}

		var req Request
		if err := json.Unmarshal(payload, &req); err != nil {
			fmt.Fprintln(os.Stderr, "Unmarshal error:", err)
			continue
		}

		var resp Response
		resp.ID = req.ID

		switch req.Method {
		case "ping":
			resp.Status = "ok"
			resp.Message = "pong"
		case "download.add":
			var params struct {
				URL      string `json:"url"`
				Filename string `json:"filename"`
				Segments int    `json:"segments"`
			}
			json.Unmarshal(req.Params, &params)
			state, err := engine.Add(params.URL, params.Filename, params.Segments)
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
				resp.Payload = state
				// Auto-start for now
				engine.Start(state.ID)
			}
		case "download.video":
			var params struct {
				URL      string `json:"url"`
				Filename string `json:"filename"`
				Type     string `json:"manifestType"`
			}
			json.Unmarshal(req.Params, &params)
			state, err := engine.AddVideo(params.URL, params.Filename)
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
				resp.Payload = state
				// Auto-start for now
				engine.Start(state.ID)
			}
		case "download.pause":
			var params struct {
				ID string `json:"id"`
			}
			json.Unmarshal(req.Params, &params)
			engine.Pause(params.ID)
			resp.Status = "ok"
		case "download.resume":
			var params struct {
				ID string `json:"id"`
			}
			json.Unmarshal(req.Params, &params)
			err := engine.Resume(params.ID)
			if err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				resp.Status = "ok"
			}
		case "download.list":
			list, _ := storage.ListDownloads()
			resp.Status = "ok"
			resp.Payload = list
		case "download.getProgress":
			var params struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(req.Params, &params); err != nil {
				resp.Status = "error"
				resp.Message = err.Error()
			} else {
				state, err := storage.GetDownload(params.ID)
				if err != nil {
					resp.Status = "error"
					resp.Message = err.Error()
				} else {
					resp.Status = "ok"
					resp.Payload = state
				}
			}
		default:
			resp.Status = "error"
			resp.Message = "Unknown method: " + req.Method
		}

		out, _ := json.Marshal(resp)
		if err := WriteMessage(os.Stdout, out); err != nil {
			fmt.Fprintln(os.Stderr, "Write error:", err)
			break
		}
	}
}
