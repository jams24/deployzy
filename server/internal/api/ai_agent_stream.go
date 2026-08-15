package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/serverme/serverme/server/internal/auth"
)

// handleAIAgentStream is the streaming (SSE) version of the agent. It emits:
//   event: step        {tool, args}            — a tool is about to run (live)
//   event: step_done   {tool, result_summary}  — tool finished
//   event: token       {text}                  — a chunk of the final answer
//   event: build_log   {line, level}           — a live deploy/build/fix log line
//   event: build_status{ok, url, error}        — terminal build result
//   event: done        {}
// so the chat can show tool activity + the agent's build/self-repair progress
// in-line, instead of the user having to open the project logs page.
func (s *Server) handleAIAgentStream(w http.ResponseWriter, r *http.Request) {
	u := auth.GetUser(r)
	if agentKey() == "" || s.deployer == nil {
		http.Error(w, "agent unavailable", http.StatusServiceUnavailable)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	emit := func(event string, data any) {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, jsonStr(data))
		flusher.Flush()
	}

	var req struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Messages) == 0 {
		emit("token", map[string]string{"text": "⚠️ bad request"})
		emit("done", map[string]any{})
		return
	}

	msgs := []map[string]any{{"role": "system", "content": agentSystem}}
	for _, m := range req.Messages {
		if m.Role == "user" || m.Role == "assistant" {
			msgs = append(msgs, map[string]any{"role": m.Role, "content": m.Content})
		}
	}

	ctx := r.Context()
	var activeSub string // a project a build/edit/redeploy tool touched

	for i := 0; i < agentMaxSteps; i++ {
		resp, err := s.deepseekAgentCall(ctx, msgs)
		if err != nil {
			emit("token", map[string]string{"text": "\n⚠️ the agent had a problem, please try again."})
			break
		}
		// Final answer — no more tools.
		if len(resp.ToolCalls) == 0 {
			streamText(resp.Content, emit)
			break
		}
		// Execute each tool call, emitting live step events.
		msgs = append(msgs, map[string]any{"role": "assistant", "content": resp.Content, "tool_calls": resp.ToolCallsRaw})
		for _, tc := range resp.ToolCalls {
			var args map[string]any
			json.Unmarshal([]byte(tc.Args), &args)
			emit("step", map[string]string{"tool": tc.Name, "args": tc.Args})
			result := s.runAgentTool(ctx, u, tc.Name, args)
			emit("step_done", map[string]string{"tool": tc.Name})
			msgs = append(msgs, map[string]any{"role": "tool", "tool_call_id": tc.ID, "content": result})

			// If this tool kicked off a deploy, remember the project so we can
			// stream its build + self-repair logs into the chat afterwards.
			if tc.Name == "build_project" || tc.Name == "edit_project" || tc.Name == "redeploy_project" {
				var rr map[string]any
				if json.Unmarshal([]byte(result), &rr) == nil {
					if p, ok := rr["project"].(string); ok && p != "" {
						activeSub = p
					}
				}
			}
		}
	}

	// Stream the build/fix logs live into the chat if a deploy was started.
	if activeSub != "" {
		if p := s.findUserProject(ctx, u.ID, activeSub); p != nil {
			s.streamBuildToChat(ctx, p.ID, emit)
		}
	}
	emit("done", map[string]any{})
}

// streamText chunks a completed answer out as token events so it types in like
// a streamed reply (DeepSeek's tool loop returns the final text whole; this
// gives the streaming feel without a second API call).
func streamText(text string, emit func(string, any)) {
	if text == "" {
		return
	}
	// stream by whitespace-preserving words
	var b strings.Builder
	for _, r := range text {
		b.WriteRune(r)
		if r == ' ' || r == '\n' {
			emit("token", map[string]string{"text": b.String()})
			b.Reset()
			time.Sleep(12 * time.Millisecond)
		}
	}
	if b.Len() > 0 {
		emit("token", map[string]string{"text": b.String()})
	}
}

// streamBuildToChat tails a project's deploy_logs and emits each new line as a
// build_log event until the project reaches a terminal status (running/failed/
// crashed) or it times out. This is what surfaces the agent's self-repair
// ("🤖 Build failed — AI is analysing…", "🤖 Applied a fix — redeploying…") in
// the chat, not just on the project page.
func (s *Server) streamBuildToChat(ctx context.Context, projectID string, emit func(string, any)) {
	emit("build_log", map[string]string{"line": "Starting deployment…", "level": "deploy"})
	// note narrates in the agent's own voice (rendered as assistant text), once each.
	narrated := map[string]bool{}
	note := func(id, text string) {
		if narrated[id] {
			return
		}
		narrated[id] = true
		emit("note", map[string]string{"text": text})
	}

	seen := map[string]bool{}
	deadline := time.Now().Add(4 * time.Minute)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return
		default:
		}
		logs, _ := s.db.GetDeployLogs(ctx, projectID, 80)
		// logs are newest-first; walk oldest-first and emit unseen lines
		for i := len(logs) - 1; i >= 0; i-- {
			l := logs[i]
			key := l.CreatedAt.String() + l.Message
			if seen[key] {
				continue
			}
			seen[key] = true
			emit("build_log", map[string]string{"line": l.Message, "level": l.Level})

			// Narrate key moments in the agent's voice as they happen.
			low := strings.ToLower(l.Message)
			switch {
			case strings.HasPrefix(l.Message, "🤖 Build failed") || (l.Level == "error" && strings.Contains(low, "build failed")):
				note("fixing", "\n\n⚠️ The build failed — I'm reading the error and fixing the code now…")
			case strings.HasPrefix(l.Message, "🤖 Applied a fix"):
				note("applied", "\n🔧 Applied a fix — redeploying…")
			}
		}
		if p, _ := s.db.GetProject(ctx, projectID); p != nil {
			switch p.Status {
			case "running":
				if narrated["fixing"] {
					note("fixed", "\n\n✅ Got it working and deployed it.")
				}
				emit("build_status", map[string]any{"ok": true,
					"url": fmt.Sprintf("https://%s.%s", p.Subdomain, s.deployer.AppDomain)})
				return
			case "failed", "crashed":
				errLine := ""
				for _, l := range logs {
					if l.Level == "error" {
						errLine = l.Message
						break
					}
				}
				note("gaveup", "\n\n❌ I tried but couldn't get it to build cleanly. The error is below — tell me how you'd like to change it and I'll try again.")
				emit("build_status", map[string]any{"ok": false, "error": errLine})
				return
			}
		}
		time.Sleep(1500 * time.Millisecond)
	}
	emit("build_status", map[string]any{"ok": false, "error": "timed out waiting for the build"})
}

