"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Globe, Plus, Trash2, Check, X, Crown } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Subdomains — reserve exclusive *.deployzy.app names. Flow unchanged;
// presentation rebuilt with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Subdomain {
  id: string;
  subdomain: string;
  created_at: string;
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

export default function SubdomainsPage() {
  const [subdomains, setSubdomains] = useState<Subdomain[]>([]);
  const [count, setCount] = useState(0);
  const [limit, setLimit] = useState(10);
  const [plan, setPlan] = useState("free");
  const [newSub, setNewSub] = useState("");
  const [checkResult, setCheckResult] = useState<{ available: boolean; reason: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(true);

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  async function load() {
    try {
      const res = await fetch(`${API}/api/v1/subdomains`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setSubdomains(data.subdomains || []);
        setCount(data.count);
        setLimit(data.limit);
        setPlan(data.plan);
      }
    } catch {}
    setLoading(false);
  }

  async function checkAvailability(sub: string) {
    if (!sub.trim()) {
      setCheckResult(null);
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`${API}/api/v1/subdomains/check?subdomain=${encodeURIComponent(sub)}`, {
        headers: headers(),
      });
      if (res.ok) setCheckResult(await res.json());
    } catch {}
    setChecking(false);
  }

  async function reserve() {
    if (!newSub.trim()) return;
    try {
      const res = await fetch(`${API}/api/v1/subdomains`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ subdomain: newSub.toLowerCase().replace(/[^a-z0-9-]/g, "") }),
      });
      if (res.ok) {
        setNewSub("");
        setCheckResult(null);
        load();
      } else {
        const err = await res.json();
        setCheckResult({ available: false, reason: err.error });
      }
    } catch {}
  }

  async function release(subdomain: string) {
    if (!confirm(`Release "${subdomain}"? Someone else could claim it.`)) return;
    try {
      await fetch(`${API}/api/v1/subdomains`, {
        method: "DELETE",
        headers: headers(),
        body: JSON.stringify({ subdomain }),
      });
      load();
    } catch {}
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => checkAvailability(newSub), 300);
    return () => clearTimeout(timer);
  }, [newSub]);

  return (
    <div className="animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Network</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Subdomains</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Reserve custom subdomains for your tunnels. Once reserved, only you can use them.
      </p>

      {/* Usage */}
      <Panel title="Usage" className="mt-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium tabular-nums">{count} / {limit} subdomains used</span>
          <Badge variant="outline" className="text-[10px] capitalize">{plan}</Badge>
          {plan === "free" && count >= limit && (
            <Badge className="gap-1 text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40">
              <Crown className="h-2.5 w-2.5" /> Upgrade for more
            </Badge>
          )}
        </div>
        <div className="mt-3 h-1.5 w-full max-w-xs rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${count >= limit ? "bg-red-500" : "bg-gradient-to-r from-emerald-500 to-emerald-400"}`}
            style={{ width: `${Math.min(100, (count / limit) * 100)}%` }}
          />
        </div>
      </Panel>

      {/* Reserve new */}
      <Panel title="Reserve a Subdomain" className="mt-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Input
              placeholder="myapp"
              value={newSub}
              onChange={(e) => setNewSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && reserve()}
              className="pr-32"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              .deployzy.com
            </span>
          </div>
          <Button
            onClick={reserve}
            disabled={!newSub || (checkResult !== null && !checkResult.available) || count >= limit}
            className="btn-shine gap-1 shrink-0 rounded-lg"
          >
            <Plus className="h-4 w-4" />
            Reserve
          </Button>
        </div>

        {/* Availability check */}
        {newSub && checkResult && (
          <div className={`mt-3 flex items-center gap-2 text-sm ${checkResult.available ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {checkResult.available ? (
              <>
                <Check className="h-4 w-4" />
                <span><strong>{newSub}.deployzy.app</strong> is available</span>
              </>
            ) : (
              <>
                <X className="h-4 w-4" />
                <span>{checkResult.reason}</span>
              </>
            )}
          </div>
        )}

        {checking && newSub && (
          <p className="mt-3 text-xs text-muted-foreground animate-pulse">Checking availability…</p>
        )}
      </Panel>

      {/* Reserved list */}
      <Panel title={`Your Subdomains (${count})`} className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Loading subdomains…</p>
        ) : subdomains.length === 0 ? (
          <div className="flex flex-col items-center py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Globe className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground text-center max-w-sm">
              No reserved subdomains yet. Reserve one above or use <code className="bg-muted px-1 rounded text-xs">--subdomain</code> in the CLI.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {subdomains.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 p-3 transition-colors hover:border-foreground/20">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground shrink-0">
                    <Globe className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-medium truncate">{s.subdomain}.deployzy.app</p>
                    <p className="text-[10px] text-muted-foreground">
                      Reserved {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => release(s.subdomain)}
                  className="text-destructive hover:text-destructive h-8 px-2 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Info */}
      <Panel title="How subdomains work" className="mt-4">
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          <li>Reserve a subdomain here or it&apos;s auto-reserved when you use <code className="bg-muted px-1 rounded">--subdomain myapp</code> in the CLI</li>
          <li>Reserved subdomains are exclusively yours — no one else can use them</li>
          <li>Random subdomains (without --subdomain flag) are not reserved and change each session</li>
          <li>Free: {limit} subdomains · Pro: 10 · Team: 50</li>
          <li>Release a subdomain to free up your quota (someone else could then claim it)</li>
        </ul>
      </Panel>
    </div>
  );
}
