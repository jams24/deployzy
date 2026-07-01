"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Send, Copy, Check, Webhook as WebhookIcon, Eye, EyeOff } from "lucide-react";
import { api, type Webhook } from "@/lib/api";

export function WebhooksSection() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  function load() { api.listWebhooks().then((h) => setHooks(h || [])).catch(() => {}); }
  useEffect(() => { load(); }, []);

  async function add() {
    setErr("");
    if (!/^https:\/\//.test(url.trim())) { setErr("Enter a valid https:// URL"); return; }
    setAdding(true);
    try {
      await api.createWebhook(url.trim());
      setUrl("");
      load();
    } catch {
      setErr("Failed to add webhook (must be a public https URL)");
    }
    setAdding(false);
  }

  async function toggle(h: Webhook) {
    await api.updateWebhook(h.id, !h.enabled);
    setHooks((prev) => prev.map((x) => (x.id === h.id ? { ...x, enabled: !x.enabled } : x)));
  }
  async function remove(id: string) { await api.deleteWebhook(id); load(); }
  async function test(id: string) {
    setTestResult((p) => ({ ...p, [id]: "..." }));
    try {
      const r = await api.testWebhook(id);
      setTestResult((p) => ({ ...p, [id]: r.delivered ? `✓ ${r.status}` : `✗ ${r.status || "failed"}` }));
    } catch {
      setTestResult((p) => ({ ...p, [id]: "✗ error" }));
    }
    setTimeout(() => setTestResult((p) => ({ ...p, [id]: "" })), 4000);
  }
  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Webhooks</CardTitle>
        <p className="text-sm text-muted-foreground">
          Get notified at your own endpoints on deploy events. Each request is signed with the webhook secret (HMAC-SHA256) in the <code className="text-xs">X-Deployzy-Signature</code> header.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="https://your-app.com/webhooks/deployzy" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button onClick={add} disabled={adding} className="gap-1 shrink-0"><Plus className="h-4 w-4" /> Add</Button>
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}

        {hooks.length === 0 ? (
          <div className="rounded-lg border border-border/40 flex flex-col items-center py-10 text-center">
            <WebhookIcon className="h-7 w-7 text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium">No webhooks yet</p>
            <p className="text-xs text-muted-foreground">Add an endpoint to receive deploy.succeeded / deploy.failed events.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border/40 divide-y divide-border/40 overflow-hidden">
            {hooks.map((h) => (
              <div key={h.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <code className="text-xs font-mono truncate flex-1">{h.url}</code>
                  <div className="flex items-center gap-2 shrink-0">
                    {testResult[h.id] && <span className="text-[11px] text-muted-foreground">{testResult[h.id]}</span>}
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => test(h.id)}><Send className="h-3 w-3" /> Test</Button>
                    {/* enable/disable toggle */}
                    <button type="button" role="switch" aria-checked={h.enabled} onClick={() => toggle(h)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${h.enabled ? "bg-emerald-600" : "bg-zinc-700"}`}>
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${h.enabled ? "left-[18px]" : "left-0.5"}`} />
                    </button>
                    <button onClick={() => remove(h.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className={h.enabled ? "text-emerald-500" : ""}>{h.enabled ? "Enabled" : "Disabled"}</span>
                  <span>·</span>
                  <span className="font-mono">{revealed[h.id] ? h.secret : h.secret.slice(0, 10) + "•••••"}</span>
                  <button onClick={() => setRevealed((p) => ({ ...p, [h.id]: !p[h.id] }))} className="hover:text-foreground">
                    {revealed[h.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button onClick={() => copy(h.secret, h.id)} className="hover:text-foreground">
                    {copied === h.id ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                  {h.last_status != null && <span>· last: {h.last_status}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
