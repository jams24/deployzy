package deploy

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ansiRE matches ANSI CSI escape sequences (colors, cursor moves) that Docker's
// classic builder emits, so streamed build logs read cleanly in the dashboard.
var ansiRE = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

// streamCaptureMax caps how much of the combined output we retain in memory for
// the post-build error summary. The last N bytes are enough for extractBuildError
// and the failure tail; the full stream is delivered live regardless.
const streamCaptureMax = 64 * 1024

// streamWriter implements io.Writer. It is wired to a command's Stdout AND
// Stderr, so Write may be called concurrently from two goroutines — hence the
// mutex. It splits input into complete lines, forwards each (ANSI-stripped) to
// onLine, and retains a capped tail of the raw bytes for later inspection.
type streamWriter struct {
	mu      sync.Mutex
	partial []byte
	onLine  func(string)
	tail    []byte // capped ring of recent raw output
}

func newStreamWriter(onLine func(string)) *streamWriter {
	return &streamWriter{onLine: onLine}
}

func (w *streamWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	// Retain a capped tail of the raw bytes.
	w.tail = append(w.tail, p...)
	if len(w.tail) > streamCaptureMax {
		w.tail = w.tail[len(w.tail)-streamCaptureMax:]
	}

	w.partial = append(w.partial, p...)
	for {
		i := bytes.IndexByte(w.partial, '\n')
		if i < 0 {
			break
		}
		line := string(w.partial[:i])
		w.partial = w.partial[i+1:]
		w.emit(line)
	}
	return len(p), nil
}

// flush emits any buffered partial line (e.g. a final line with no trailing
// newline). Call once after the command exits.
func (w *streamWriter) flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.partial) > 0 {
		w.emit(string(w.partial))
		w.partial = nil
	}
}

// emit must be called with the lock held.
func (w *streamWriter) emit(line string) {
	line = strings.TrimRight(ansiRE.ReplaceAllString(line, ""), "\r")
	if w.onLine != nil {
		w.onLine(line)
	}
}

// captured returns the retained tail of the raw combined output.
func (w *streamWriter) captured() []byte {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make([]byte, len(w.tail))
	copy(out, w.tail)
	return out
}

// buildLogStreamer batches streamed build lines and flushes them to deploy_logs
// on a short interval, so the dashboard's Deploy Logs panel updates live without
// one DB insert per line. It caps total streamed lines to bound a runaway build.
type buildLogStreamer struct {
	e         *Engine
	projectID string

	mu       sync.Mutex
	buf      []string
	lines    int
	maxLines int

	stopCh chan struct{}
	doneCh chan struct{}
}

func (e *Engine) newBuildLogStreamer(projectID string) *buildLogStreamer {
	b := &buildLogStreamer{
		e:         e,
		projectID: projectID,
		maxLines:  5000,
		stopCh:    make(chan struct{}),
		doneCh:    make(chan struct{}),
	}
	go b.run()
	return b
}

func (b *buildLogStreamer) run() {
	t := time.NewTicker(800 * time.Millisecond)
	defer t.Stop()
	defer close(b.doneCh)
	for {
		select {
		case <-b.stopCh:
			b.flush()
			return
		case <-t.C:
			b.flush()
		}
	}
}

// line buffers one build-output line for the next flush. Safe for concurrent use.
func (b *buildLogStreamer) line(s string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.lines > b.maxLines {
		return
	}
	b.lines++
	if b.lines == b.maxLines {
		b.buf = append(b.buf, "... (build output truncated — showing progress only) ...")
		return
	}
	b.buf = append(b.buf, s)
}

func (b *buildLogStreamer) flush() {
	b.mu.Lock()
	if len(b.buf) == 0 {
		b.mu.Unlock()
		return
	}
	msg := strings.Join(b.buf, "\n")
	b.buf = b.buf[:0]
	b.mu.Unlock()
	// context.Background so a build-timeout cancellation can't drop the final
	// flush of already-produced output.
	b.e.logMsg(context.Background(), b.projectID, msg, "build")
}

// stop performs a final flush and waits for the flusher goroutine to exit.
func (b *buildLogStreamer) stop() {
	close(b.stopCh)
	<-b.doneCh
}
