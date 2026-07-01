package inspect

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ReplayResult holds the result of replaying a captured request.
type ReplayResult struct {
	StatusCode      int               `json:"status_code"`
	ResponseHeaders map[string]string `json:"response_headers"`
	ResponseBody    []byte            `json:"response_body,omitempty"`
	Duration        time.Duration     `json:"duration_ms"`
	Error           string            `json:"error,omitempty"`
}

// Replay re-sends a captured request through the tunnel and captures the response.
func Replay(captured *CapturedRequest, proxyURL string) (*ReplayResult, error) {
	// Reconstruct the request URL
	reqURL := proxyURL + captured.Path
	if captured.Query != "" {
		reqURL += "?" + captured.Query
	}

	var body io.Reader
	if len(captured.RequestBody) > 0 {
		body = bytes.NewReader(captured.RequestBody)
	}

	req, err := http.NewRequest(captured.Method, reqURL, body)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Restore original headers
	for k, v := range captured.RequestHeaders {
		req.Header.Set(k, v)
	}

	// Mark as replayed
	req.Header.Set("X-Deployzy-Replay", "true")
	req.Header.Set("X-Deployzy-Original-ID", captured.ID)

	client := &http.Client{Timeout: 30 * time.Second}

	start := time.Now()
	resp, err := client.Do(req)
	duration := time.Since(start)

	if err != nil {
		return &ReplayResult{
			Duration: duration / time.Millisecond,
			Error:    err.Error(),
		}, nil
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, int64(maxBodyCapture)))

	respHeaders := make(map[string]string)
	for k, v := range resp.Header {
		if len(v) > 0 {
			respHeaders[k] = v[0]
		}
	}

	return &ReplayResult{
		StatusCode:      resp.StatusCode,
		ResponseHeaders: respHeaders,
		ResponseBody:    respBody,
		Duration:        duration / time.Millisecond,
	}, nil
}
