"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Loader2, ChevronRight, Wrench } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

type Step = { tool: string; args: string; result: string };
type Msg = { role: "user" | "assistant"; text: string; steps?: Step[] };

const suggestions = [
  "Why did my last deploy fail?",
  "Which of my projects are failing, and why?",
  "Is GitHub connected to my account?",
  "Build me a TypeScript API with a /health and /joke endpoint",
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
  h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-fuchsia-400 hover:underline">$1</a>');
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
  const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});
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

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const nextChat: Msg[] = [...chat, { role: "user", text: q }];
    setChat(nextChat);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/v1/ai/agent`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          messages: nextChat.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChat((c) => [...c, { role: "assistant", text: "⚠️ " + (data.error || "The agent had a problem. Please try again.") }]);
      } else {
        setChat((c) => [...c, { role: "assistant", text: data.reply || "(no response)", steps: data.steps || [] }]);
      }
    } catch {
      setChat((c) => [...c, { role: "assistant", text: "⚠️ Something went wrong — please try again." }]);
    }
    setBusy(false);
  }

  const empty = chat.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] max-w-3xl mx-auto w-full">
      {empty ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="h-11 w-11 rounded-2xl bg-fuchsia-500/15 text-fuchsia-400 grid place-items-center mb-5">
            <Sparkles className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold text-center">
            {name ? `Hi ${name}` : "Deployzy Agent"}
            <br />What would you like to do?
          </h1>
          <div className="mt-8 grid sm:grid-cols-2 gap-2 w-full max-w-xl">
            {suggestions.map((s) => (
              <button key={s} onClick={() => send(s)}
                className="text-left text-sm border border-border/60 rounded-xl px-4 py-3 hover:bg-accent/40 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
          {chat.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl bg-fuchsia-500/20 px-4 py-2.5 text-sm">{m.text}</div>
              ) : (
                <div className="space-y-2">
                  {m.steps && m.steps.length > 0 && (
                    <button onClick={() => setOpenSteps((o) => ({ ...o, [i]: !o[i] }))}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                      <ChevronRight className={`h-3.5 w-3.5 transition-transform ${openSteps[i] ? "rotate-90" : ""}`} />
                      <Wrench className="h-3.5 w-3.5" /> {m.steps.length} tool {m.steps.length === 1 ? "call" : "calls"}
                    </button>
                  )}
                  {m.steps && openSteps[i] && (
                    <div className="ml-5 space-y-1.5 border-l border-border/50 pl-3">
                      {m.steps.map((s, j) => (
                        <div key={j} className="text-xs">
                          <div className="text-foreground/80">{toolLabel[s.tool] || s.tool}</div>
                          <div className="font-mono text-[10px] text-muted-foreground truncate">{s.args !== "{}" ? s.args : ""}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMd(m.text) }} />
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          )}
        </div>
      )}

      <div className="px-4 pb-5 pt-2">
        <div className="rounded-2xl border border-border/60 bg-background/60 p-2 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            disabled={busy}
            placeholder="Ask the agent to check something, or build & deploy an app…"
            className="flex-1 bg-transparent px-2 py-2 text-sm resize-none focus:outline-none max-h-40"
          />
          <button onClick={() => send(input)} disabled={!input.trim() || busy}
            className="h-9 w-9 rounded-xl bg-fuchsia-500 text-white grid place-items-center disabled:opacity-40 shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-[10px] text-center text-muted-foreground mt-2">
          The agent can read your projects & logs and build/deploy apps. It can make mistakes — verify important actions.
        </p>
      </div>
    </div>
  );
}
