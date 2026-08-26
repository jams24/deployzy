"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bell, Send, Unlink, ExternalLink, Copy, Check } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications — Telegram alert connection + preferences. Flow unchanged;
// presentation rebuilt with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface TelegramStatus {
  connected: boolean;
  username?: string;
  first_name?: string;
  notify_tunnel_connect?: boolean;
  notify_tunnel_disconnect?: boolean;
  notify_error_spike?: boolean;
  notify_traffic_summary?: boolean;
  notify_new_signup?: boolean;
}

interface LinkData {
  code: string;
  bot_url: string;
  bot_name: string;
}

function Panel({ title, icon, children, className = "" }: { title: React.ReactNode; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function NotificationsPage() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  };

  async function loadStatus() {
    try {
      const res = await fetch(`${API}/api/v1/telegram/status`, { headers: headers() });
      if (res.ok) setStatus(await res.json());
    } catch {}
    setLoading(false);
  }

  async function generateLink() {
    try {
      const res = await fetch(`${API}/api/v1/telegram/link`, { method: "POST", headers: headers() });
      if (res.ok) setLinkData(await res.json());
    } catch {}
  }

  async function updatePref(key: string, value: boolean) {
    setStatus((prev) => prev ? { ...prev, [key]: value } : prev);
    try {
      await fetch(`${API}/api/v1/telegram/preferences`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ [key.replace("notify_", "")]: value }),
      });
    } catch {}
  }

  async function disconnect() {
    try {
      await fetch(`${API}/api/v1/telegram`, { method: "DELETE", headers: headers() });
      setStatus({ connected: false });
      setLinkData(null);
    } catch {}
  }

  useEffect(() => {
    loadStatus();
  }, []);

  const prefs = [
    { key: "notify_tunnel_connect", label: "Tunnel Connected", desc: "When a tunnel comes online" },
    { key: "notify_tunnel_disconnect", label: "Tunnel Disconnected", desc: "When a tunnel goes offline" },
    { key: "notify_error_spike", label: "Error Spikes", desc: "When error rate exceeds threshold" },
    { key: "notify_traffic_summary", label: "Traffic Summary", desc: "Hourly traffic digest" },
    { key: "notify_new_signup", label: "New Signups", desc: "When someone registers (self-hosted)" },
  ];

  return (
    <div className="animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Notifications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Get alerts in Telegram when something happens with your tunnels.
      </p>

      {/* Connection Card */}
      <Panel title="Telegram" icon={<Send className="h-3.5 w-3.5 text-[#229ED9]" />} className="mt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Loading…</p>
        ) : status?.connected ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#229ED9]/20 bg-[#229ED9]/10 text-[#229ED9]">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  {status.first_name || "Connected"}
                  {status.username && (
                    <span className="ml-1 text-muted-foreground">@{status.username}</span>
                  )}
                </p>
                <Badge variant="outline" className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/40">
                  Connected
                </Badge>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={disconnect} className="gap-1 rounded-lg text-destructive hover:text-destructive">
              <Unlink className="h-3.5 w-3.5" />
              Disconnect
            </Button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              Connect your Telegram to receive real-time tunnel alerts.
            </p>

            {linkData ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#229ED9]/20 bg-[#229ED9]/5 p-4">
                  <p className="text-sm font-medium mb-2">
                    Click the button below to open the bot in Telegram:
                  </p>
                  <a
                    href={linkData.bot_url}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-2 rounded-full bg-[#229ED9] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1E8BC3] transition-colors"
                  >
                    <Send className="h-4 w-4" />
                    Open @{linkData.bot_name}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Or send this to the bot manually: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">/start {linkData.code}</code>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`/start ${linkData.code}`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="ml-1 inline-flex items-center text-primary"
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Code expires in 10 minutes. After clicking Start in Telegram, come back here and refresh.
                </p>
                <Button variant="outline" size="sm" onClick={loadStatus} className="rounded-lg">
                  Refresh Status
                </Button>
              </div>
            ) : (
              <Button onClick={generateLink} className="btn-shine gap-2 rounded-full px-5">
                <Send className="h-4 w-4" />
                Connect Telegram
              </Button>
            )}
          </div>
        )}
      </Panel>

      {/* Preferences */}
      {status?.connected && (
        <Panel title="Alert Preferences" icon={<Bell className="h-3.5 w-3.5 text-muted-foreground" />} className="mt-4">
          <div className="divide-y divide-border/60 -my-2">
            {prefs.map((p) => (
              <div key={p.key} className="flex items-center justify-between py-3.5">
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.desc}</p>
                </div>
                <Switch
                  checked={!!(status as unknown as Record<string, unknown>)[p.key]}
                  onCheckedChange={(checked: boolean) => updatePref(p.key, checked)}
                />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Bot Commands */}
      <Panel title="Bot Commands" className="mt-4">
        <div className="space-y-2 font-mono text-sm">
          {[
            { cmd: "/tunnels", desc: "List your active tunnels" },
            { cmd: "/stats", desc: "Quick traffic statistics" },
            { cmd: "/help", desc: "Show available commands" },
          ].map((c) => (
            <div key={c.cmd} className="flex items-center gap-4 rounded-lg bg-muted/50 px-4 py-2.5">
              <code className="text-emerald-600 dark:text-emerald-400 font-bold">{c.cmd}</code>
              <span className="text-xs text-muted-foreground font-sans">{c.desc}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
