"use client";

// Notifications — where Deployzy reaches you. Email (deploy failures and
// crashes, always on) and Telegram (linked through the bot, with per-alert
// switches). While a link code is open the page checks the connection itself.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Bell, Check, Copy, Loader2, Mail, RefreshCw, Send, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/use-me";
import { PageHeader } from "@/components/dashboard/kit";
import { SettingRow, SettingsSection, Switch } from "@/components/dashboard/settings-kit";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";
const TG = "#229ED9";

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
type PrefKey = Exclude<keyof TelegramStatus, "connected" | "username" | "first_name">;

interface LinkData { code: string; bot_url: string; bot_name: string }

const headers = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("sm_token") : ""}`,
  "Content-Type": "application/json",
});

const PREFS: { key: PrefKey; label: string; desc: string; adminOnly?: boolean }[] = [
  { key: "notify_tunnel_connect", label: "Tunnel connected", desc: "A tunnel comes online." },
  { key: "notify_tunnel_disconnect", label: "Tunnel disconnected", desc: "A tunnel goes offline." },
  { key: "notify_error_spike", label: "Error spikes", desc: "The error rate jumps above normal." },
  { key: "notify_traffic_summary", label: "Traffic summary", desc: "An hourly digest of requests." },
  { key: "notify_new_signup", label: "New signups", desc: "Someone creates an account.", adminOnly: true },
];

const COMMANDS = [
  { cmd: "/tunnels", desc: "List your active tunnels" },
  { cmd: "/stats", desc: "Quick traffic numbers" },
  { cmd: "/help", desc: "Every command" },
];

function ChannelIcon({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
      style={color ? { color, borderColor: `${color}33`, background: `${color}14` } : undefined}
    >
      {children}
    </span>
  );
}

export default function NotificationsPage() {
  const { me, isAdmin } = useSession();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/telegram/status`, { headers: headers() });
      if (res.ok) {
        const s: TelegramStatus = await res.json();
        setStatus(s);
        if (s.connected) setLinkData(null);
      }
    } catch {}
    setLoading(false);
  }, []);

  // Deferred so the mount effect doesn't synchronously trigger a setState.
  useEffect(() => {
    const t = setTimeout(() => loadStatus(), 0);
    return () => clearTimeout(t);
  }, [loadStatus]);

  // While a link code is out, check every 4s so the page flips to "connected"
  // on its own after the user taps Start in Telegram.
  useEffect(() => {
    if (!linkData) return;
    const t = setInterval(loadStatus, 4000);
    return () => clearInterval(t);
  }, [linkData, loadStatus]);

  async function generateLink() {
    setLinking(true); setErr("");
    try {
      const res = await fetch(`${API}/api/v1/telegram/link`, { method: "POST", headers: headers() });
      if (res.ok) setLinkData(await res.json());
      else setErr((await res.json().catch(() => ({}))).error || "Couldn't start linking");
    } catch { setErr("Network error"); }
    setLinking(false);
  }

  async function checkNow() {
    setChecking(true);
    await loadStatus();
    setChecking(false);
  }

  async function updatePref(key: PrefKey, value: boolean) {
    const before = status;
    setStatus((prev) => (prev ? { ...prev, [key]: value } : prev));
    try {
      const res = await fetch(`${API}/api/v1/telegram/preferences`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ [key.replace("notify_", "")]: value }),
      });
      if (!res.ok) setStatus(before);
    } catch { setStatus(before); }
  }

  async function disconnect() {
    try {
      await fetch(`${API}/api/v1/telegram`, { method: "DELETE", headers: headers() });
      setStatus({ connected: false });
      setLinkData(null);
      setConfirmUnlink(false);
    } catch {}
  }

  const connected = !!status?.connected;
  const prefs = PREFS.filter((p) => !p.adminOnly || isAdmin);
  const onCount = prefs.filter((p) => status?.[p.key]).length;

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        description="Where Deployzy tells you about failed deploys, crashes and your tunnels."
      />

      <div className="mt-6 grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4 sm:space-y-5">
          {/* Channels */}
          <SettingsSection icon={Bell} title="Channels" description="Each channel gets the alerts it supports.">
            <div className="divide-y divide-[var(--dz-hairline)]">
              {/* Email */}
              <div className="flex items-center gap-3 pb-4">
                <ChannelIcon><Mail className="h-4 w-4 text-foreground/70" /></ChannelIcon>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-[14.5px] font-medium">Email</p>
                    <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Always on
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                    Failed deploys and crashes go to {me?.email ? <span className="text-foreground">{me.email}</span> : "your account email"}.
                  </p>
                </div>
              </div>

              {/* Telegram */}
              <div className="pt-4">
                <div className="flex items-center gap-3">
                  <ChannelIcon color={TG}><Send className="h-4 w-4" /></ChannelIcon>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-medium">Telegram</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                      {loading ? "Checking…" : connected
                        ? <>Linked to <span className="text-foreground">{status?.first_name || "your account"}</span>{status?.username && <> · @{status.username}</>}</>
                        : "Tunnel alerts and quick stats in a chat."}
                    </p>
                  </div>
                  {!loading && (connected ? (
                    !confirmUnlink && (
                      <button type="button" onClick={() => setConfirmUnlink(true)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400">
                        <Unlink className="h-4 w-4" /><span className="hidden sm:inline">Disconnect</span>
                      </button>
                    )
                  ) : !linkData && (
                    <button type="button" onClick={generateLink} disabled={linking} className="pill pill-sm shrink-0 text-white disabled:opacity-60" style={{ background: TG }}>
                      {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Connect
                    </button>
                  ))}
                </div>

                {confirmUnlink && connected && (
                  <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-red-500/[0.06] p-3 sm:flex-row sm:items-center">
                    <p className="text-[13.5px] sm:mr-auto">Stop sending alerts to Telegram? You can link it again any time.</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setConfirmUnlink(false)} className="pill pill-line pill-sm flex-1 sm:flex-none">Cancel</button>
                      <button type="button" onClick={disconnect} className="pill pill-sm flex-1 bg-red-600 text-white hover:bg-red-700 sm:flex-none">Disconnect</button>
                    </div>
                  </div>
                )}

                {err && <p className="mt-3 text-[13.5px] text-red-600 dark:text-red-400">{err}</p>}

                {/* Linking steps */}
                {linkData && !connected && (
                  <ol className="mt-4 space-y-3 rounded-2xl border p-4" style={{ borderColor: `${TG}33`, background: `${TG}0a` }}>
                    <li className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ background: TG }}>1</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">Open the bot</p>
                        <a href={linkData.bot_url} target="_blank" rel="noopener" className="pill pill-sm mt-2 text-white" style={{ background: TG }}>
                          <Send className="h-4 w-4" /> Open @{linkData.bot_name} <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white" style={{ background: TG }}>2</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">Tap Start</p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">Or send this message to the bot yourself:</p>
                        <div className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--dz-hairline)] bg-background py-1.5 pl-3 pr-1.5">
                          <code className="min-w-0 flex-1 truncate font-mono text-[13px]">/start {linkData.code}</code>
                          <button
                            type="button"
                            aria-label="Copy start message"
                            onClick={() => { navigator.clipboard?.writeText(`/start ${linkData.code}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                          >
                            {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--dz-hairline)] bg-background">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium">Waiting for Telegram</p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">This page updates by itself. The code expires in 10 minutes.</p>
                        <button type="button" onClick={checkNow} disabled={checking} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50">
                          <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} /> Check now
                        </button>
                      </div>
                    </li>
                  </ol>
                )}
              </div>
            </div>
          </SettingsSection>

          {/* Telegram alerts */}
          <SettingsSection
            icon={Send}
            title="Telegram alerts"
            description={connected ? `${onCount} of ${prefs.length} on.` : "Connect Telegram above to choose alerts."}
          >
            <div className={cn("divide-y divide-[var(--dz-hairline)]", !connected && "opacity-55")}>
              {prefs.map((p) => (
                <SettingRow
                  key={p.key}
                  title={p.label}
                  description={p.desc}
                  control={<Switch checked={!!status?.[p.key]} disabled={!connected} onChange={(v) => updatePref(p.key, v)} label={p.label} />}
                />
              ))}
            </div>
          </SettingsSection>
        </div>

        {/* Bot commands */}
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <section className="dark overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#0b0c10] text-white">
            <div className="flex items-center gap-2.5 border-b border-white/[0.07] px-4 py-3 sm:px-5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${TG}26`, color: TG }}><Send className="h-3.5 w-3.5" /></span>
              <p className="text-[14px] font-medium">Bot commands</p>
            </div>
            <ul className="space-y-1 p-2.5">
              {COMMANDS.map((c) => (
                <li key={c.cmd} className="flex items-baseline gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.03]">
                  <code className="w-[4.5rem] shrink-0 font-mono text-[13px] font-semibold text-brand">{c.cmd}</code>
                  <span className="text-[13px] text-white/60">{c.desc}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-white/[0.07] px-4 py-3 text-[12.5px] text-white/45 sm:px-5">Send them to the bot once Telegram is linked.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
