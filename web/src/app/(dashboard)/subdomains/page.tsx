"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Globe, Plus, Trash2, Check, X, Search, Crown } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Subdomain {
  id: string;
  subdomain: string;
  created_at: string;
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
    <div>
      <h1 className="text-xl sm:text-2xl font-bold">Subdomains</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Reserve custom subdomains for your tunnels. Once reserved, only you can use them.
      </p>

      {/* Usage */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{count} / {limit} subdomains used</span>
                <Badge variant="outline" className="text-[10px] capitalize">{plan}</Badge>
                {plan === "free" && count >= limit && (
                  <Badge className="gap-1 text-[10px] bg-yellow-500/20 text-yellow-500 border-yellow-500/50">
                    <Crown className="h-2.5 w-2.5" /> Upgrade for more
                  </Badge>
                )}
              </div>
              <div className="mt-2 h-2 w-full max-w-xs rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${count >= limit ? "bg-red-500" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, (count / limit) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reserve new */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Reserve a Subdomain</CardTitle>
        </CardHeader>
        <CardContent>
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
              className="gap-1 shrink-0"
            >
              <Plus className="h-4 w-4" />
              Reserve
            </Button>
          </div>

          {/* Availability check */}
          {newSub && checkResult && (
            <div className={`mt-3 flex items-center gap-2 text-sm ${checkResult.available ? "text-green-500" : "text-red-500"}`}>
              {checkResult.available ? (
                <>
                  <Check className="h-4 w-4" />
                  <span><strong>{newSub}.deployzy.com</strong> is available</span>
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
            <p className="mt-3 text-xs text-muted-foreground">Checking availability...</p>
          )}
        </CardContent>
      </Card>

      {/* Reserved list */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Your Subdomains ({count})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : subdomains.length === 0 ? (
            <div className="flex flex-col items-center py-8">
              <Globe className="h-8 w-8 text-muted-foreground/30" />
              <p className="mt-2 text-sm text-muted-foreground">
                No reserved subdomains yet. Reserve one above or use <code className="bg-muted px-1 rounded text-xs">--subdomain</code> in the CLI.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {subdomains.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3">
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-primary" />
                    <div>
                      <p className="font-mono text-sm font-medium">{s.subdomain}.deployzy.com</p>
                      <p className="text-[10px] text-muted-foreground">
                        Reserved {new Date(s.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => release(s.subdomain)}
                    className="text-destructive hover:text-destructive h-8 px-2"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <h3 className="text-sm font-medium mb-2">How subdomains work</h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>Reserve a subdomain here or it&apos;s auto-reserved when you use <code className="bg-muted px-1 rounded">--subdomain myapp</code> in the CLI</li>
            <li>Reserved subdomains are exclusively yours — no one else can use them</li>
            <li>Random subdomains (without --subdomain flag) are not reserved and change each session</li>
            <li>Free: {limit} subdomains · Pro: 10 · Team: 50</li>
            <li>Release a subdomain to free up your quota (someone else could then claim it)</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
