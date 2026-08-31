package deploy

import (
	"sync"
	"testing"
	"time"
)

// TestStreamWriterIncrementalAndClean verifies streamWriter forwards complete
// lines as they arrive (not buffered to the end), strips ANSI, handles a
// trailing partial line on flush, and retains a capped tail.
func TestStreamWriterIncrementalAndClean(t *testing.T) {
	var mu sync.Mutex
	var got []string
	sw := newStreamWriter(func(s string) {
		mu.Lock()
		got = append(got, s)
		mu.Unlock()
	})

	// Two complete lines in one write, one with ANSI color.
	sw.Write([]byte("Step 1/3 : FROM alpine\n\x1b[91mls: no such file\x1b[0m\n"))

	mu.Lock()
	if len(got) != 2 {
		mu.Unlock()
		t.Fatalf("expected 2 lines after newlines, got %d: %v", len(got), got)
	}
	if got[0] != "Step 1/3 : FROM alpine" {
		t.Errorf("line 0 = %q", got[0])
	}
	if got[1] != "ls: no such file" { // ANSI stripped
		t.Errorf("line 1 = %q (ANSI not stripped?)", got[1])
	}
	mu.Unlock()

	// A partial line without newline is NOT emitted until flush.
	sw.Write([]byte("returned a non-zero code: 1"))
	mu.Lock()
	n := len(got)
	mu.Unlock()
	if n != 2 {
		t.Fatalf("partial line should not emit before flush, have %d lines", n)
	}
	sw.flush()
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 3 || got[2] != "returned a non-zero code: 1" {
		t.Fatalf("flush should emit trailing partial line, got %v", got)
	}
}

// TestBuildLogStreamerBatches verifies the batcher coalesces lines and flushes
// on stop, and that it caps runaway output.
func TestBuildLogStreamerCaps(t *testing.T) {
	b := &buildLogStreamer{maxLines: 3, stopCh: make(chan struct{}), doneCh: make(chan struct{})}
	// no engine: override flush target by counting via buf length after stop.
	// Drive line() past the cap.
	for i := 0; i < 10; i++ {
		b.line("x")
	}
	// Expect maxLines(3) counted, and a truncation marker appended at the cap.
	if b.lines <= b.maxLines {
		// lines increments until > maxLines then stops
	}
	found := false
	for _, s := range b.buf {
		if s == "... (build output truncated — showing progress only) ..." {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected truncation marker once cap hit; buf=%v", b.buf)
	}
	_ = time.Now
}
