"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Plus, Trash2, Eye, EyeOff, Copy, RefreshCw } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Service {
  id: string; name: string; type: string; status: string;
  db_name: string; db_user: string; db_password: string;
  host: string; port: number; connection_url: string; created_at: string;
}

export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPass, setShowPass] = useState<Record<string, boolean>>({});

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}` };
  };

  async function load() {
    try {
      const res = await fetch(`${API}/api/v1/services`, { headers: headers() });
      if (res.ok) setServices(await res.json());
    } catch {}
    setLoading(false);
  }

  async function remove(id: string) {
    if (!confirm("Delete this database? All data will be permanently lost.")) return;
    await fetch(`${API}/api/v1/services/${id}`, { method: "DELETE", headers: headers() });
    load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Services</h1>
          <p className="mt-1 text-sm text-muted-foreground">Standalone databases and infrastructure services.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
          <Button size="sm" className="gap-1" nativeButton={false} render={<Link href="/new" />}>
            <Plus className="h-3.5 w-3.5" /> New Service
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : services.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <Database className="h-10 w-10 text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold">No services yet</h3>
            <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">
              Deploy a standalone PostgreSQL database to use with your projects.
            </p>
            <Button className="mt-5 gap-2" nativeButton={false} render={<Link href="/new" />}>
              <Database className="h-4 w-4" /> Create Database
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{s.name}</span>
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{s.status}</Badge>
                        <Badge variant="outline" className="text-[10px]">PostgreSQL 16</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{s.db_name} · {s.host}:{s.port}</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Connection details */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><span className="text-muted-foreground">Database:</span> <span className="font-mono">{s.db_name}</span></div>
                  <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{s.db_user}</span></div>
                  <div><span className="text-muted-foreground">Host:</span> <span className="font-mono">{s.host}</span></div>
                  <div><span className="text-muted-foreground">Port:</span> <span className="font-mono">{s.port}</span></div>
                </div>

                {/* Connection URL */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground font-medium">Connection URL</span>
                    <span className="text-[10px] text-muted-foreground">Copy this into your project&apos;s DATABASE_URL</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 rounded-md border border-input bg-[#09090b] px-3 py-2 font-mono text-[11px] text-zinc-400 overflow-x-auto">
                      {showPass[s.id] ? s.connection_url : s.connection_url.replace(`:${s.db_password}@`, ":****@")}
                    </code>
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setShowPass(p => ({ ...p, [s.id]: !p[s.id] }))}>
                      {showPass[s.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => navigator.clipboard.writeText(s.connection_url)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
