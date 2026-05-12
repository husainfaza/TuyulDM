package main

import (
	"encoding/json"
	"fmt"
	"time"

	"go.etcd.io/bbolt"
)

type DownloadState struct {
	ID          string    `json:"id"`
	URL         string    `json:"url"`
	Filename    string    `json:"filename"`
	TotalSize   int64     `json:"total_size"`
	Status      string    `json:"status"`
	Progress    float64   `json:"progress"`
	Speed       string    `json:"speed"`
	Type        string    `json:"type"` // "file" or "video"
	Error       string    `json:"error,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	Segments    []Segment `json:"segments"`
}

type Segment struct {
	Index     int   `json:"index"`
	Start     int64 `json:"start"`
	End       int64 `json:"end"`
	Current   int64 `json:"current"`
	Completed bool  `json:"completed"`
}

type Storage struct {
	db *bbolt.DB
}

const bucketName = "Downloads"

func NewStorage(path string) (*Storage, error) {
	db, err := bbolt.Open(path, 0600, &bbolt.Options{Timeout: 1 * time.Second})
	if err != nil {
		return nil, err
	}

	err = db.Update(func(tx *bbolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(bucketName))
		return err
	})
	if err != nil {
		return nil, err
	}

	return &Storage{db: db}, nil
}

func (s *Storage) SaveDownload(d *DownloadState) error {
	return s.db.Update(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		data, err := json.Marshal(d)
		if err != nil {
			return err
		}
		return b.Put([]byte(d.ID), data)
	})
}

func (s *Storage) GetDownload(id string) (*DownloadState, error) {
	var d DownloadState
	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		v := b.Get([]byte(id))
		if v == nil {
			return fmt.Errorf("download not found")
		}
		return json.Unmarshal(v, &d)
	})
	return &d, err
}

func (s *Storage) ListDownloads() ([]DownloadState, error) {
	var list []DownloadState
	err := s.db.View(func(tx *bbolt.Tx) error {
		b := tx.Bucket([]byte(bucketName))
		return b.ForEach(func(k, v []byte) error {
			var d DownloadState
			if err := json.Unmarshal(v, &d); err == nil {
				list = append(list, d)
			}
			return nil
		})
	})
	return list, err
}
