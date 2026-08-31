"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Globe, CheckCircle2, AlertCircle, RefreshCw, Link2, Rocket, Waypoints } from "lucide-react";
import { api, type Domain } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Custom Domains — add, verify, bind. Flow unchanged; presentation rebuilt
// with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

interface Target {
  type: "tunnel" | "project";
  subdomain: string;
  label: string;
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 overflow-hidden ${className}`}>
      <div className="px-4 py-3 border-b border-border/60">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [instructions, setInstructions] = useState<{ name: string; target: string } | null>(null);
  const [bindingId, setBindingId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTarget, setSelectedTarget] = useState("");

  async function load() {
    try {
      setDomains(await api.listDomains());
    } catch {}
    setLoading(false);
  }

  async function loadTargets() {
    try {
      const tunnels = await api.listTunnels();
      const t: Target[] = tunnels.map((tun: { name: string; subdomain?: string; protocol: string; type?: string }) => {
        if (tun.type === "project") {
          const sub = tun.subdomain || tun.name || "";
          return { type: "project" as const, subdomain: sub, label: `Project: ${tun.name || sub}` };
        }
        const sub = tun.name || "";
        return { type: "tunnel" as const, subdomain: sub, label: `Tunnel: ${sub} (${tun.protocol})` };
      }).filter((t: Target) => t.subdomain);
      setTargets(t);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  async function addDomain() {
    if (!newDomain.trim()) return;
    try {
      const data = await api.createDomain(newDomain);
      setInstructions({ name: data.instructions.name, target: data.instructions.target });
      setNewDomain("");
      load();
    } catch {}
  }

  async function verify(id: string) {
    try {
      const result = await api.verifyDomain(id);
      if (result.verified) {
        load();
      } else {
        // The backend returns a specific hint — e.g. the very common case where
        // the CNAME is proxied through Cloudflare (orange cloud) and must be set
        // to DNS only. Show it instead of a generic message.
        alert(result.hint || "DNS verification failed. Make sure your CNAME record is set to DNS only (not proxied) and has propagated.");
      }
    } catch {}
  }

  async function remove(id: string) {
    try {
      await api.deleteDomain(id);
      load();
    } catch {}
  }

  async function startBinding(id: string) {
    setBindingId(id);
    setSelectedTarget("");
    await loadTargets();
  }

  async function bind(id: string) {
    if (!selectedTarget) return;
    const target = targets.find(t => `${t.type}:${t.subdomain}` === selectedTarget);
    if (!target) return;
    try {
      await api.bindDomain(id, target.type, target.subdomain);
      setBindingId(null);
      load();
    } catch {
      alert("Failed to bind domain. Make sure the domain is verified.");
    }
  }

  return (
    <div className="animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Custom Domains</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Bring your own domain for tunnels and deployed projects.
      </p>

      <Panel title="Add Domain" className="mt-6">
        <div className="flex gap-3">
          <Input
            placeholder="api.example.com"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDomain()}
          />
          <Button onClick={addDomain} className="btn-shine gap-2 shrink-0 rounded-lg">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        {instructions && (
          <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm space-y-3">
            <p className="font-medium text-blue-600 dark:text-blue-400">Add these DNS records:</p>
            <div className="rounded-lg bg-background border border-border/60 p-3 font-mono text-xs space-y-1">
              <p className="text-[10px] text-muted-foreground font-sans font-semibold uppercase tracking-[0.14em] mb-1">Required — points your domain to Deployzy</p>
              <span className="text-muted-foreground">Type:</span> CNAME<br />
              <span className="text-muted-foreground">Name:</span> {instructions.name}<br />
              <span className="text-muted-foreground">Target:</span> {instructions.target}
            </div>
            <div className="rounded-lg bg-background border border-border/60 p-3 font-mono text-xs space-y-1">
              <p className="text-[10px] text-muted-foreground font-sans font-semibold uppercase tracking-[0.14em] mb-1">Recommended — so www.yourdomain.com also works</p>
              <span className="text-muted-foreground">Type:</span> CNAME<br />
              <span className="text-muted-foreground">Name:</span> www<br />
              <span className="text-muted-foreground">Target:</span> {instructions.target}
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400">
              <p className="font-medium">Using Cloudflare? Set the record to <span className="font-semibold">DNS only</span> (grey cloud), not Proxied (orange cloud).</p>
              <p className="mt-1 opacity-90">A proxied record hides the CNAME behind Cloudflare&apos;s IPs, so verification can&apos;t see it and TLS won&apos;t issue. Click the orange cloud to turn it grey.</p>
            </div>
            <p className="text-xs text-muted-foreground">
              After adding the records, click Verify on your domain below. Then bind it to a tunnel or project. Visitors using www. will be automatically redirected.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Your Domains" className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Loading domains…</p>
        ) : domains.length === 0 ? (
          <div className="flex flex-col items-center py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Globe className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">No custom domains yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {domains.map((d) => (
              <div key={d.id} className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-3 transition-colors hover:border-foreground/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground shrink-0">
                      <Globe className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-medium truncate">{d.domain}</p>
                      <p className="text-[11px] text-muted-foreground">CNAME &rarr; {d.cname_target}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.verified ? (
                      <Badge className="gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                        <CheckCircle2 className="h-3 w-3" /> Verified
                      </Badge>
                    ) : (
                      <>
                        <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400 border-amber-500/40">
                          <AlertCircle className="h-3 w-3" /> Pending
                        </Badge>
                        <Button variant="outline" size="sm" onClick={() => verify(d.id)} className="gap-1 rounded-lg">
                          <RefreshCw className="h-3 w-3" /> Verify
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => remove(d.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Binding status */}
                {d.verified && bindingId === d.id ? (
                  <div className="flex items-center gap-2">
                    <select
                      className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs"
                      value={selectedTarget}
                      onChange={(e) => setSelectedTarget(e.target.value)}
                    >
                      <option value="">Select a target...</option>
                      {targets.map((t) => (
                        <option key={`${t.type}:${t.subdomain}`} value={`${t.type}:${t.subdomain}`}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" className="h-8 text-xs gap-1 rounded-lg" onClick={() => bind(d.id)} disabled={!selectedTarget}>
                      <Link2 className="h-3 w-3" /> Bind
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setBindingId(null)}>Cancel</Button>
                  </div>
                ) : d.verified && d.target_subdomain ? (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Routes to</span>
                    {d.target_type === "project" ? (
                      <Badge variant="outline" className="gap-1 text-[10px]"><Rocket className="h-2.5 w-2.5" /> {d.target_subdomain}.deployzy.app</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-[10px]"><Waypoints className="h-2.5 w-2.5" /> {d.target_subdomain}.deployzy.app</Badge>
                    )}
                    <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-muted-foreground ml-auto" onClick={() => startBinding(d.id)}>
                      Change
                    </Button>
                  </div>
                ) : d.verified ? (
                  <Button variant="outline" size="sm" className="gap-1 text-xs rounded-lg" onClick={() => startBinding(d.id)}>
                    <Link2 className="h-3 w-3" /> Bind to Tunnel or Project
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
