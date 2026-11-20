"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightIcon, ArrowSquareOutIcon, ArrowsClockwiseIcon, CircleNotchIcon, GlobeSimpleIcon, LinkBreakIcon, LinkSimpleIcon,
  ListBulletsIcon, PlusIcon, TrashIcon, XIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { api, ApiError, type DnsRecord, type Domain } from "@/lib/api";
import { EmptyState, PageHeader } from "@/components/dashboard/kit";
import { RowMenu } from "@/components/dashboard/row-menu";
import { DnsRecords, recordsFor } from "@/components/domains/dns-records";
import { DomainStatus, checkedAgo, domainState } from "@/components/domains/domain-status";
import { upgradeHref } from "@/lib/upgrade";

// ─────────────────────────────────────────────────────────────────────────────
// Custom domains. Add a domain (optionally choosing the app it serves), create
// the DNS record shown, and it goes live by itself: the API re-checks pending
// domains every 2 minutes and this page refreshes while any are pending.
// ─────────────────────────────────────────────────────────────────────────────

interface Target {
  type: "tunnel" | "project";
  subdomain: string;
  name: string;
}

const APP_DOMAIN = "deployzy.app";
const targetKey = (t: { type: string; subdomain: string }) => `${t.type}:${t.subdomain}`;

async function fetchTargets(): Promise<Target[]> {
  try {
    const list = await api.listTunnels();
    return (list as unknown as { name: string; subdomain?: string; protocol: string; type?: string }[])
      .map((t) => t.type === "project"
        ? { type: "project" as const, subdomain: t.subdomain || t.name || "", name: t.name || t.subdomain || "" }
        : { type: "tunnel" as const, subdomain: t.name || "", name: `${t.name} (${t.protocol})` })
      .filter((t) => t.subdomain);
  } catch {
    return [];
  }
}

// Mirrors the API's clean-up so the user sees what will be added.
function previewDomain(raw: string): string {
  let d = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split(/[/?#]/)[0].replace(/^.*@/, "").replace(/:\d+$/, "").replace(/^\.+|\.+$/g, "");
  if (d.startsWith("www.") && d.split(".").length >= 3) d = d.slice(4);
  return d;
}

function TargetSelect({ targets, value, onChange, optional }: {
  targets: Target[] | null; value: string; onChange: (v: string) => void; optional?: boolean;
}) {
  const projects = (targets ?? []).filter((t) => t.type === "project");
  const tunnels = (targets ?? []).filter((t) => t.type === "tunnel");
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={targets === null}
      aria-label="Connect to"
      className="h-10 w-full rounded-xl border border-[var(--dz-hairline)] bg-background px-3 text-[14px] outline-none transition-colors focus:border-foreground/30 disabled:opacity-60"
    >
      <option value="">{targets === null ? "Loading…" : optional ? "Choose later" : "Choose an app or tunnel"}</option>
      {projects.length > 0 && (
        <optgroup label="Apps">
          {projects.map((t) => <option key={targetKey(t)} value={targetKey(t)}>{t.name} · {t.subdomain}.{APP_DOMAIN}</option>)}
        </optgroup>
      )}
      {tunnels.length > 0 && (
        <optgroup label="Tunnels">
          {tunnels.map((t) => <option key={targetKey(t)} value={targetKey(t)}>{t.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}

// ── Add-domain sheet: name + optional target, then the DNS records to create ──
function AddDomainSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [raw, setRaw] = useState("");
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; upgrade?: boolean } | null>(null);
  const [done, setDone] = useState<{ domain: Domain; records: DnsRecord[]; note?: string } | null>(null);

  useEffect(() => { fetchTargets().then(setTargets); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const preview = previewDomain(raw);
  const changed = raw.trim() !== "" && preview !== raw.trim().toLowerCase();

  const add = async () => {
    if (!preview) return;
    setBusy(true); setErr(null);
    const t = targets?.find((x) => targetKey(x) === target);
    try {
      const res = await api.createDomain(raw, t ? { type: t.type, subdomain: t.subdomain } : undefined);
      setDone({ domain: res.domain, records: res.records?.length ? res.records : recordsFor(res.domain), note: res.note });
      onAdded();
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setErr({ text: e instanceof Error ? e.message : "Couldn't add the domain", upgrade: status === 402 });
    }
    setBusy(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4"
      style={{ animation: "dz-fade .2s ease both" }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="add-domain-title"
        className="w-full max-w-lg rounded-t-[26px] border border-[var(--dz-hairline)] bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl sm:rounded-[26px]"
        style={{ animation: "dz-pop .25s cubic-bezier(.2,.7,.2,1) both" }} onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-foreground/15 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 p-5 pb-4 sm:p-6 sm:pb-4">
          <div className="min-w-0">
            <p className="eyebrow">{done ? "Step 2 of 2" : "Step 1 of 2"}</p>
            <h2 id="add-domain-title" className="mt-1.5 truncate text-[20px] font-semibold tracking-[-0.03em]">
              {done ? `Point ${done.domain.domain} at Deployzy` : "Add a domain"}
            </h2>
            {!done && <p className="mt-1 text-[13.5px] text-muted-foreground">A domain or subdomain you own, like app.example.com.</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
            {done.note && <p className="text-[13px] text-muted-foreground">{done.note}</p>}
            <DnsRecords records={done.records} zone={done.domain.zone} />
            <button type="button" onClick={onClose} className="pill pill-ink w-full">Done</button>
          </div>
        ) : (
          <form className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <label className="block">
              <span className="text-[13px] font-medium text-muted-foreground">Domain</span>
              <input autoFocus value={raw} onChange={(e) => { setRaw(e.target.value); setErr(null); }}
                placeholder="app.example.com" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="mt-1.5 h-11 w-full rounded-xl border border-[var(--dz-hairline)] bg-background px-3.5 text-[15px] outline-none transition-colors focus:border-foreground/30" />
              {changed && preview && <span className="mt-1.5 block text-[12.5px] text-muted-foreground">We&rsquo;ll add <span className="font-medium text-foreground">{preview}</span>{raw.trim().toLowerCase().includes("www.") ? "; www redirects to it." : "."}</span>}
            </label>
            <label className="block">
              <span className="text-[13px] font-medium text-muted-foreground">Connect to <span className="font-normal">(optional)</span></span>
              <div className="mt-1.5"><TargetSelect targets={targets} value={target} onChange={setTarget} optional /></div>
            </label>
            {err && (
              <p role="alert" className="text-[13px] text-red-600 dark:text-red-400">
                {err.text}{" "}
                {err.upgrade && <Link href={upgradeHref()} className="font-medium text-foreground underline underline-offset-2">See plans</Link>}
              </p>
            )}
            <button type="submit" disabled={!preview || busy} className="pill pill-ink w-full disabled:opacity-50">
              {busy ? <CircleNotchIcon className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRightIcon className="h-4 w-4" /></>}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── One domain row ──
function DomainRow({ d, onChanged }: { d: Domain; onChanged: () => void }) {
  const state = domainState(d);
  const pending = !d.verified;
  const [showDns, setShowDns] = useState(pending);
  const [connecting, setConnecting] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [target, setTarget] = useState(d.target_subdomain ? targetKey({ type: d.target_type, subdomain: d.target_subdomain }) : "");
  const [checking, setChecking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setChecking(true); setMsg(null);
    try {
      const r = await api.verifyDomain(d.id);
      setMsg(r.verified ? { ok: true, text: "DNS verified. HTTPS is issued on the first visit." } : { ok: false, text: r.hint || "Not visible yet." });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Check failed" });
    }
    setChecking(false);
  };

  const openConnect = async () => {
    setConnecting(true);
    if (!targets) setTargets(await fetchTargets());
  };

  const connect = async () => {
    const t = targets?.find((x) => targetKey(x) === target);
    if (!t) return;
    setBusy(true); setMsg(null);
    try {
      await api.bindDomain(d.id, t.type, t.subdomain);
      setConnecting(false);
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't connect the domain" });
    }
    setBusy(false);
  };

  const disconnect = async () => {
    setMsg(null);
    try {
      await api.bindDomain(d.id, d.target_type || "project", "");
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't disconnect the domain" });
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteDomain(d.id);
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't remove the domain" });
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const targetHost = d.target_subdomain ? `${d.target_subdomain}.${APP_DOMAIN}` : "";

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {state === "live" ? (
              <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer"
                className="group inline-flex min-w-0 items-center gap-1 text-[14.5px] font-medium tracking-[-0.01em] hover:underline">
                <span className="truncate">{d.domain}</span>
                <ArrowSquareOutIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <span className="min-w-0 truncate text-[14.5px] font-medium tracking-[-0.01em]">{d.domain}</span>
            )}
            <DomainStatus domain={d} />
          </div>
          <p className="mt-1 truncate text-[13px] text-muted-foreground">
            {targetHost ? <>Serves <span className="text-foreground/80">{d.target_type === "tunnel" ? `tunnel ${d.target_subdomain}` : targetHost}</span></> : "Not connected to an app yet"}
            {pending && d.last_checked_at && <> · checked {checkedAgo(d.last_checked_at)}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pending ? (
            <button type="button" onClick={check} disabled={checking} className="pill pill-line pill-xs disabled:opacity-60">
              {checking ? <CircleNotchIcon className="h-3.5 w-3.5 animate-spin" /> : <ArrowsClockwiseIcon className="h-3.5 w-3.5" />} Check now
            </button>
          ) : !d.target_subdomain && !connecting ? (
            <button type="button" onClick={openConnect} className="pill pill-ink pill-xs"><LinkSimpleIcon className="h-3.5 w-3.5" /> Connect</button>
          ) : null}
          <RowMenu items={[
            { label: showDns ? "Hide DNS records" : "DNS records", icon: ListBulletsIcon, onSelect: () => setShowDns((v) => !v) },
            { label: d.target_subdomain ? "Change app" : "Connect to an app", icon: LinkSimpleIcon, onSelect: openConnect },
            !!d.target_subdomain && { label: "Disconnect", icon: LinkBreakIcon, onSelect: disconnect },
            { label: "Remove domain", icon: TrashIcon, danger: true, divider: true, onSelect: () => setConfirmRemove(true) },
          ]} />
        </div>
      </div>

      {pending && d.check_hint && state === "attention" && !msg && (
        <p className="mt-3 text-[13px] text-amber-700 dark:text-amber-400">{d.check_hint}</p>
      )}
      {msg && <p role="status" className={cn("mt-3 text-[13px]", msg.ok ? "text-[var(--dz-green-strong)] dark:text-brand" : "text-amber-700 dark:text-amber-400")}>{msg.text}</p>}

      {connecting && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1"><TargetSelect targets={targets} value={target} onChange={setTarget} /></div>
          <div className="flex gap-2">
            <button type="button" onClick={connect} disabled={!target || busy} className="pill pill-ink pill-sm disabled:opacity-50">
              {busy ? <CircleNotchIcon className="h-4 w-4 animate-spin" /> : "Connect"}
            </button>
            <button type="button" onClick={() => setConnecting(false)} className="pill pill-sm text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <div className="mt-3 flex flex-col gap-2 rounded-[14px] border border-red-500/25 bg-red-500/[0.04] px-3.5 py-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-[13px]">Remove <span className="font-medium">{d.domain}</span>? Visitors stop reaching your app on this domain.</p>
          <div className="flex gap-2">
            <button type="button" onClick={remove} disabled={busy} className="pill pill-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
              {busy ? <CircleNotchIcon className="h-4 w-4 animate-spin" /> : "Remove"}
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)} className="pill pill-sm text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">Keep</button>
          </div>
        </div>
      )}

      {showDns && <DnsRecords records={recordsFor(d)} zone={d.zone} className="mt-4" />}
    </li>
  );
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setDomains(await api.listDomains());
      setLoadErr("");
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Couldn't load domains");
      setDomains((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // While anything is waiting for DNS, pick up the background verifier's
  // results without a manual refresh (only while the tab is visible).
  const anyPending = !!domains?.some((d) => !d.verified);
  useEffect(() => {
    if (!anyPending) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 20000);
    return () => clearInterval(id);
  }, [anyPending, load]);

  const addButton = (
    <button type="button" onClick={() => setAdding(true)} className="pill pill-ink pill-sm">
      <PlusIcon className="h-4 w-4" /> Add domain
    </button>
  );

  return (
    <div className="animate-fade-in-up space-y-5">
      <PageHeader
        title="Domains"
        description="Serve your apps and tunnels on your own domain, with HTTPS set up for you."
        actions={domains && domains.length > 0 ? addButton : undefined}
      />

      {loadErr && <p role="alert" className="text-[13.5px] text-red-600 dark:text-red-400">{loadErr}</p>}

      {domains === null ? (
        <div className="surface divide-y divide-[var(--dz-hairline)] rounded-[20px]">
          {[0, 1].map((i) => (
            <div key={i} className="px-5 py-4">
              <div className="h-4 w-48 animate-pulse rounded bg-foreground/[0.06]" />
              <div className="mt-2 h-3 w-64 animate-pulse rounded bg-foreground/[0.04]" />
            </div>
          ))}
        </div>
      ) : domains.length === 0 ? (
        <EmptyState
          icon={GlobeSimpleIcon}
          title="Use your own domain"
          description={
            <span className="mt-1 block space-y-1 text-left">
              <span className="block"><span className="font-medium text-foreground">1.</span> Add a domain you own and pick the app it should serve.</span>
              <span className="block"><span className="font-medium text-foreground">2.</span> Create the one DNS record we show you.</span>
              <span className="block"><span className="font-medium text-foreground">3.</span> It goes live with HTTPS on its own, usually within minutes.</span>
            </span>
          }
          action={addButton}
        />
      ) : (
        <ul className="surface divide-y divide-[var(--dz-hairline)] overflow-hidden rounded-[20px]">
          {domains.map((d) => <DomainRow key={`${d.id}:${d.verified}:${d.target_subdomain}`} d={d} onChanged={load} />)}
        </ul>
      )}

      {adding && <AddDomainSheet onClose={() => setAdding(false)} onAdded={load} />}
    </div>
  );
}
