"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, Globe, CheckCircle2, AlertCircle, RefreshCw, Link2, Rocket, Waypoints } from "lucide-react";
import { api, type Domain } from "@/lib/api";

interface Target {
  type: "tunnel" | "project";
  subdomain: string;
  label: string;
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
        alert("DNS verification failed. Make sure your CNAME record is set and propagated.");
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
    <div>
      <h1 className="text-xl sm:text-2xl font-bold">Custom Domains</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Bring your own domain for tunnels and deployed projects.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Add Domain</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="api.example.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDomain()}
            />
            <Button onClick={addDomain} className="gap-2 shrink-0">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </div>

          {instructions && (
            <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm space-y-3">
              <p className="font-medium text-blue-500">Add these DNS records:</p>
              <div className="rounded-md bg-background p-3 font-mono text-xs space-y-1">
                <p className="text-[10px] text-muted-foreground font-sans font-medium uppercase tracking-wider mb-1">Required — points your domain to Deployzy</p>
                <span className="text-muted-foreground">Type:</span> CNAME<br />
                <span className="text-muted-foreground">Name:</span> {instructions.name}<br />
                <span className="text-muted-foreground">Target:</span> {instructions.target}
              </div>
              <div className="rounded-md bg-background p-3 font-mono text-xs space-y-1">
                <p className="text-[10px] text-muted-foreground font-sans font-medium uppercase tracking-wider mb-1">Recommended — so www.yourdomain.com also works</p>
                <span className="text-muted-foreground">Type:</span> CNAME<br />
                <span className="text-muted-foreground">Name:</span> www<br />
                <span className="text-muted-foreground">Target:</span> {instructions.target}
              </div>
              <p className="text-xs text-muted-foreground">
                After adding the records, click Verify on your domain below. Then bind it to a tunnel or project. Visitors using www. will be automatically redirected.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Your Domains</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : domains.length === 0 ? (
            <div className="flex flex-col items-center py-8">
              <Globe className="h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">No custom domains yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {domains.map((d) => (
                <div key={d.id} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Globe className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-mono text-sm font-medium">{d.domain}</p>
                        <p className="text-xs text-muted-foreground">CNAME &rarr; {d.cname_target}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.verified ? (
                        <Badge className="gap-1 bg-green-500/10 text-green-500 border-green-500/20">
                          <CheckCircle2 className="h-3 w-3" /> Verified
                        </Badge>
                      ) : (
                        <>
                          <Badge variant="outline" className="gap-1 text-yellow-500 border-yellow-500/20">
                            <AlertCircle className="h-3 w-3" /> Pending
                          </Badge>
                          <Button variant="outline" size="sm" onClick={() => verify(d.id)} className="gap-1">
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
                      <Button size="sm" className="h-8 text-xs gap-1" onClick={() => bind(d.id)} disabled={!selectedTarget}>
                        <Link2 className="h-3 w-3" /> Bind
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setBindingId(null)}>Cancel</Button>
                    </div>
                  ) : d.verified && d.target_subdomain ? (
                    <div className="flex items-center gap-2 rounded-md bg-accent/30 px-3 py-2 text-xs">
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Routes to</span>
                      {d.target_type === "project" ? (
                        <Badge variant="outline" className="gap-1 text-[10px]"><Rocket className="h-2.5 w-2.5" /> {d.target_subdomain}.deployzy.com</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-[10px]"><Waypoints className="h-2.5 w-2.5" /> {d.target_subdomain}.deployzy.com</Badge>
                      )}
                      <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-muted-foreground ml-auto" onClick={() => startBinding(d.id)}>
                        Change
                      </Button>
                    </div>
                  ) : d.verified ? (
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => startBinding(d.id)}>
                      <Link2 className="h-3 w-3" /> Bind to Tunnel or Project
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
