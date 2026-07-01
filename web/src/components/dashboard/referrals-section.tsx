"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check, Users, Award, RefreshCw } from "lucide-react";
import { api, type ReferralStats } from "@/lib/api";

export function ReferralsSection() {
  const [data, setData] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  function load() {
    api.getReferrals().then(setData).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  function copy(text: string, which: "link" | "code") {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!data) return null;
  const toGo = Math.max(0, data.milestone - (data.paid % data.milestone));
  const pct = Math.min(100, ((data.paid % data.milestone) / data.milestone) * 100);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-base">Referral Program</CardTitle>
        <p className="text-sm text-muted-foreground">Share Deployzy and earn 1 free month of Pro for every {data.milestone} paid referrals.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {data.pro_until && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5">
            <Award className="h-4 w-4 text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-400">
              Referral reward active — you have <strong>Pro</strong> until {new Date(data.pro_until).toLocaleDateString()}.
            </p>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Referral link */}
          <div className="rounded-lg border border-border/40 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Your referral link</p>
              <p className="text-xs text-muted-foreground">Anyone who signs up through this link is tracked under your referrals.</p>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5">
              <code className="flex-1 truncate text-xs font-mono">{data.link}</code>
              <button onClick={() => copy(data.link, "link")} className="shrink-0 text-muted-foreground hover:text-foreground">
                {copied === "link" ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-border/40 px-2 py-1 text-xs font-mono">Code: {data.code}</span>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => copy(data.code, "code")}>
                {copied === "code" ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />} Copy code
              </Button>
            </div>
          </div>

          {/* Next reward */}
          <div className="rounded-lg border border-border/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-500/15 text-violet-400 shrink-0">
                <Award className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Next Pro reward</p>
                <p className="text-xs text-muted-foreground">{toGo} paid referral{toGo === 1 ? "" : "s"} to go</p>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                <span>{data.paid % data.milestone} paid</span>
                <span>{data.milestone} milestone</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[["Total", data.total], ["Paid", data.paid], ["Pro months", data.pro_months]].map(([label, val]) => (
                <div key={label as string} className="rounded-md border border-border/40 px-2 py-2 text-center">
                  <p className="text-lg font-semibold">{val as number}</p>
                  <p className="text-[10px] text-muted-foreground">{label as string}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* People referred */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">People you referred</p>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={load}><RefreshCw className="h-3 w-3" /> Refresh</Button>
          </div>
          {data.people.length === 0 ? (
            <div className="rounded-lg border border-border/40 flex flex-col items-center py-10 text-center">
              <Users className="h-7 w-7 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium">No referrals yet</p>
              <p className="text-xs text-muted-foreground">Share your link and new signups will appear here.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/40 divide-y divide-border/40 overflow-hidden">
              {data.people.map((p, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name || p.email}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(p.joined_at).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-[10px] rounded-full border px-2 py-0.5 capitalize ${p.paid ? "border-emerald-500/30 text-emerald-500 bg-emerald-500/10" : "border-border/40 text-muted-foreground"}`}>
                    {p.paid ? "paid · " + p.plan : p.plan}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
