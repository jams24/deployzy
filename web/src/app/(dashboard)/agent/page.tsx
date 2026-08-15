"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Loader2, Check, Wrench, Rocket, Bug, Database, BookOpen } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

type LiveStep = { tool: string; done: boolean };
type BuildLog = { line: string; level: string };
type Msg = {
  role: "user" | "assistant";
  text: string;
  steps?: LiveStep[];
  buildLogs?: BuildLog[];
  buildStatus?: { ok: boolean; url?: string; error?: string } | null;
  streaming?: boolean;
};

const suggestions = [
  { icon: Rocket, title: "Build & deploy an app", text: "Build me a TypeScript API with a /health and a /joke endpoint, then deploy it" },
  { icon: Bug, title: "Diagnose a failure", text: "Which of my projects are failing, and why?" },
  { icon: Database, title: "Manage infrastructure", text: "List my databases and which projects use them" },
  { icon: BookOpen, title: "Ask the docs", text: "How do I expose my localhost to the internet with Deployzy?" },
];

// Turn a tool name into a friendly label.
const toolLabel: Record<string, string> = {
  list_projects: "Listed your projects",
  get_deploy_logs: "Read deploy logs",
  account_status: "Checked account status",
  redeploy_project: "Redeployed a project",
  build_project: "Built & deployed a project",
  edit_project: "Edited a project",
  get_env: "Checked environment variables",
  set_env: "Set an environment variable",
  attach_database: "Attached a database",
  stop_project: "Stopped a project",
  list_databases: "Listed your databases",
  search_docs: "Searched the docs",
};

// Minimal, safe markdown → HTML (bold, code, links, line breaks).
function renderMd(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let h = esc(text);
  h = h.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-[0.85em] font-mono">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-emerald-500 hover:underline">$1</a>');
  h = h.replace(/^### (.*)$/gm, '<div class="font-semibold mt-2">$1</div>');
  h = h.replace(/^## (.*)$/gm, '<div class="font-semibold text-base mt-2">$1</div>');
  h = h.replace(/\n/g, "<br/>");
  return h;
}

export default function AgentPage() {
  const [chat, setChat] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const headers = () => ({
    Authorization: `Bearer ${localStorage.getItem("sm_token")}`,
    "Content-Type": "application/json",
  });

  useEffect(() => {
    fetch(`${API}/api/v1/users/me`, { headers: headers() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.email) setName((d.name || d.email.split("@")[0])); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, busy]);

  // Mutate the last (assistant) message in place as SSE events arrive.
  const patchLast = (fn: (m: Msg) => Msg) =>
    setChat((c) => {
      const copy = [...c];
      copy[copy.length - 1] = fn(copy[copy.length - 1]);
      return copy;
    });

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...chat, { role: "user" as const, text: q }];
    // append the user msg + an empty streaming assistant msg
    setChat([...history, { role: "assistant", text: "", steps: [], buildLogs: [], streaming: true }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/v1/ai/agent/stream`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.text })) }),
      });
      if (!res.ok || !res.body) {
        patchLast((m) => ({ ...m, text: "⚠️ The agent is unavailable right now. Please try again.", streaming: false }));
        setBusy(false); return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() || "";
        for (const ev of events) {
          const evLine = ev.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = ev.split("\n").find((l) => l.startsWith("data:"));
          if (!evLine || !dataLine) continue;
          const type = evLine.slice(6).trim();
          let data: any = {};
          try { data = JSON.parse(dataLine.slice(5).trim()); } catch {}
          if (type === "step") {
            patchLast((m) => ({ ...m, steps: [...(m.steps || []), { tool: data.tool, done: false }] }));
          } else if (type === "step_done") {
            patchLast((m) => ({ ...m, steps: (m.steps || []).map((s) => s.tool === data.tool && !s.done ? { ...s, done: true } : s) }));
          } else if (type === "token" || type === "note") {
            // token = streamed reply; note = agent narrating its build/fix in its own voice
            patchLast((m) => ({ ...m, text: m.text + (data.text || "") }));
          } else if (type === "build_log") {
            patchLast((m) => ({ ...m, buildLogs: [...(m.buildLogs || []), { line: data.line, level: data.level }] }));
          } else if (type === "build_status") {
            patchLast((m) => ({ ...m, buildStatus: { ok: !!data.ok, url: data.url, error: data.error } }));
          } else if (type === "done") {
            patchLast((m) => ({ ...m, streaming: false }));
          }
        }
      }
      patchLast((m) => ({ ...m, streaming: false }));
    } catch {
      patchLast((m) => ({ ...m, text: (chat.length ? "" : "") + "⚠️ Connection interrupted — please try again.", streaming: false }));
    }
    setBusy(false);
  }

  const empty = chat.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-w-3xl mx-auto w-full">
      {empty ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="relative mb-6">
            <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-2xl" />
            <div className="relative h-14 w-14 rounded-2xl bg-emerald-500 grid place-items-center shadow-lg shadow-emerald-500/25">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-center tracking-tight">
            {name ? `Hi ${name}` : "Deployzy Agent"}
          </h1>
          <p className="mt-2 text-lg text-muted-foreground text-center">What would you like to build or fix today?</p>
          <div className="mt-9 grid sm:grid-cols-2 gap-3 w-full max-w-2xl">
            {suggestions.map((s) => {
              const Icon = s.icon;
              return (
                <button key={s.title} onClick={() => send(s.text)}
                  className="group text-left rounded-2xl border border-border/60 p-4 hover:border-emerald-500/50 hover:bg-emerald-500/[0.05] transition-all">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="h-8 w-8 rounded-lg bg-muted/60 grid place-items-center text-emerald-500 group-hover:bg-emerald-500/15 transition-colors">
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="text-sm font-semibold">{s.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-[42px]">{s.text}</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
          {chat.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-500/15 border border-emerald-500/25 px-4 py-2.5 text-sm">{m.text}</div>
              ) : (
                <div className="space-y-2">
                  {/* live tool steps */}
                  {m.steps && m.steps.length > 0 && (
                    <div className="space-y-1">
                      {m.steps.map((s, j) => (
                        <div key={j} className="flex items-center gap-2 text-xs text-muted-foreground">
                          {s.done
                            ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                            : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          <Wrench className="h-3 w-3" /> {toolLabel[s.tool] || s.tool}{!s.done && "…"}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* streamed reply text */}
                  {m.text && (
                    <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMd(m.text) }} />
                  )}

                  {/* live build / self-repair logs, piped into the chat */}
                  {m.buildLogs && m.buildLogs.length > 0 && (
                    <div className="rounded-lg border border-white/[0.08] bg-[#0d1117] overflow-hidden mt-1">
                      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.08] bg-[#161b22] text-[10px] font-mono text-muted-foreground">
                        {m.buildStatus
                          ? (m.buildStatus.ok ? <><Check className="h-3 w-3 text-emerald-500" /> deployed</> : <span className="text-red-400">build failed</span>)
                          : <><span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> building & deploying…</>}
                      </div>
                      <div className="p-2 font-mono text-[11px] max-h-52 overflow-y-auto space-y-0.5">
                        {m.buildLogs.map((l, j) => (
                          <div key={j} className={l.level === "error" ? "text-[#f85149]" : l.level === "deploy" ? "text-[#3fb950]" : "text-[#d29922]"}>
                            {l.line}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* terminal build result */}
                  {m.buildStatus && (
                    m.buildStatus.ok ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-500">
                        <Check className="h-4 w-4" /> Live at{" "}
                        <a href={m.buildStatus.url} target="_blank" rel="noopener" className="text-emerald-500 hover:underline">{m.buildStatus.url}</a>
                      </div>
                    ) : (
                      <div className="text-sm text-red-400">⚠️ It failed to deploy. {m.buildStatus.error ? <span className="font-mono text-xs">{m.buildStatus.error}</span> : ""} — tell me a fix and I&apos;ll retry.</div>
                    )
                  )}

                  {m.streaming && !m.text && (!m.steps || m.steps.length === 0) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 pb-5 pt-2">
        {/* Modern composer: textarea on top, an action row beneath (like Brimble) */}
        <div className="rounded-2xl border border-border bg-card shadow-sm focus-within:border-emerald-500/50 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={2}
            disabled={busy}
            placeholder="Ask the agent to check something, or build & deploy an app…"
            className="w-full bg-transparent px-4 pt-3.5 pb-1 text-sm resize-none focus:outline-none max-h-48 placeholder:text-muted-foreground/60"
          />
          <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1">
                <Sparkles className="h-3 w-3 text-emerald-500" /> Deployzy Agent
              </span>
              <span className="hidden sm:inline text-muted-foreground/60">on DeepSeek</span>
            </div>
            <button onClick={() => send(input)} disabled={!input.trim() || busy}
              className="h-8 w-8 rounded-lg bg-emerald-500 text-white grid place-items-center disabled:opacity-25 shrink-0 transition-colors hover:bg-emerald-600">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-center text-muted-foreground/60 mt-2">
          The agent reads your projects & logs and can build, fix & deploy apps · verify important actions
        </p>
      </div>
    </div>
  );
}
