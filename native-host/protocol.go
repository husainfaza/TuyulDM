package main

import (
	"encoding/binary"
	"io"
)

// ReadMessage reads a native message from stdin (4-byte length prefix)
func ReadMessage(r io.Reader) ([]byte, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	msg := make([]byte, length)
	_, err := io.ReadFull(r, msg)
	return msg, err
}

// WriteMessage writes a native message to stdout (4-byte length prefix)
func WriteMessage(w io.Writer, msg []byte) error {
	var length = uint32(len(msg))
	if err := binary.Write(w, binary.LittleEndian, length); err != nil {
		return err
	}
	_, err := w.Write(msg)
	return err
}
