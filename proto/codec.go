package proto

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

const maxMessageSize = 1 << 20 // 1 MB

// WriteMsg writes a typed message to the writer with a 4-byte length prefix.
func WriteMsg(w io.Writer, msgType string, payload interface{}) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	env := Envelope{
		Type:    msgType,
		Payload: json.RawMessage(payloadBytes),
	}

	envBytes, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal envelope: %w", err)
	}

	if len(envBytes) > maxMessageSize {
		return fmt.Errorf("message too large: %d bytes (max %d)", len(envBytes), maxMessageSize)
	}

	// Single Write call: length prefix + payload merged into one buffer so that
	// concurrent goroutines writing to the same smux stream (e.g. multiple HTTP
	// requests all calling RequestProxy at once) don't interleave the two parts
	// and corrupt the framing.
	buf := make([]byte, 4+len(envBytes))
	binary.BigEndian.PutUint32(buf, uint32(len(envBytes)))
	copy(buf[4:], envBytes)
	if _, err := w.Write(buf); err != nil {
		return fmt.Errorf("write length: %w", err)
	}

	return nil
}

// ReadMsg reads a length-prefixed message from the reader and returns the envelope.
func ReadMsg(r io.Reader) (*Envelope, error) {
	// Read 4-byte length prefix
	lenBuf := make([]byte, 4)
	if _, err := io.ReadFull(r, lenBuf); err != nil {
		return nil, fmt.Errorf("read length: %w", err)
	}

	length := binary.BigEndian.Uint32(lenBuf)
	if length > uint32(maxMessageSize) {
		return nil, fmt.Errorf("message too large: %d bytes (max %d)", length, maxMessageSize)
	}

	// Read the message body
	msgBuf := make([]byte, length)
	if _, err := io.ReadFull(r, msgBuf); err != nil {
		return nil, fmt.Errorf("read message: %w", err)
	}

	var env Envelope
	if err := json.Unmarshal(msgBuf, &env); err != nil {
		return nil, fmt.Errorf("unmarshal envelope: %w", err)
	}

	return &env, nil
}

// UnpackPayload unmarshals the envelope payload into the target struct.
func UnpackPayload(env *Envelope, target interface{}) error {
	return json.Unmarshal(env.Payload, target)
}

// ReadTypedMsg reads a message and unmarshals the payload, verifying the expected type.
func ReadTypedMsg(r io.Reader, expectedType string, target interface{}) error {
	env, err := ReadMsg(r)
	if err != nil {
		return err
	}

	if env.Type == TypeError {
		var errMsg Error
		if err := UnpackPayload(env, &errMsg); err != nil {
			return fmt.Errorf("server error (could not decode)")
		}
		return fmt.Errorf("server error: %s", errMsg.Message)
	}

	if env.Type != expectedType {
		return fmt.Errorf("expected message type %q, got %q", expectedType, env.Type)
	}

	if target != nil {
		return UnpackPayload(env, target)
	}
	return nil
}
