"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Rocket, Globe, Waypoints, Plus, ArrowRight, Activity,
  Database, Clock,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Project {
  id: string; name: string; subdomain: string; framework: string; status: string;
}
interface Tunnel {
  url: string; protocol: string; name: string; type?: string;
}

export default function OverviewPage() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [domains, setDomains] = useState<{ id: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}` };
  };

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/v1/users/me`, { headers: headers() }).then(r => r.ok ? r.json() : null),
      fetch(`${API}/api/v1/projects`, { headers: headers() }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/v1/tunnels`, { headers: headers() }).then(r => r.ok ? r.json() : []),
      fetch(`${API}/api/v1/domains`, { headers: headers() }).then(r => r.ok ? r.json() : []),
    ]).then(([u, p, t, d]) => {
      setUser(u);
      setProjects(Array.isArray(p) ? p : []);
      setTunnels(Array.isArray(t) ? t : []);
      setDomains(Array.isArray(d) ? d : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  const runningProjects = projects.filter(p => p.status === "running");
  const activeTunnels = tunnels.filter(t => t.type === "tunnel");

  const stats = [
    { label: "Projects", value: projects.length, icon: Rocket, color: "text-violet-400 bg-violet-500/10" },
    { label: "Active Tunnels", value: activeTunnels.length, icon: Waypoints, color: "text-blue-400 bg-blue-500/10" },
    { label: "Domains", value: domains.length, icon: Globe, color: "text-emerald-400 bg-emerald-500/10" },
    { label: "Uptime", value: "99.9%", icon: Activity, color: "text-amber-400 bg-amber-500/10" },
  ];

  if (loading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading...</div>;

  return (
    <div>
      {/* Greeting */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting()}, {user?.name?.split(" ")[0] || "there"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">What are you shipping today?</p>
        </div>
        <Button className="gap-2" nativeButton={false} render={<Link href="/new" />}>
          <Plus className="h-4 w-4" /> New Resource
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {stats.map((s) => (
          <Card key={s.label} className="hover:border-foreground/10 transition-colors">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.color} shrink-0`}>
                <s.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-bold tracking-tight">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid gap-3 sm:grid-cols-3 mb-8">
        <Link href="/projects?action=import">
          <Card className="hover:border-foreground/20 transition-all hover:shadow-lg hover:shadow-black/5 cursor-pointer group h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 shrink-0 transition-transform group-hover:scale-110">
                <Rocket className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Deploy Project</p>
                <p className="text-[11px] text-muted-foreground">From GitHub repo</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/projects">
          <Card className="hover:border-foreground/20 transition-all hover:shadow-lg hover:shadow-black/5 cursor-pointer group h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0 transition-transform group-hover:scale-110">
                <Database className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Add Database</p>
                <p className="text-[11px] text-muted-foreground">PostgreSQL instance</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/domains">
          <Card className="hover:border-foreground/20 transition-all hover:shadow-lg hover:shadow-black/5 cursor-pointer group h-full">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-500/10 text-pink-400 shrink-0 transition-transform group-hover:scale-110">
                <Globe className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Add Domain</p>
                <p className="text-[11px] text-muted-foreground">Custom domain + TLS</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Running Services */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Running Services</h2>
        <Link href="/projects" className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {runningProjects.length === 0 && activeTunnels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
              <Rocket className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <h3 className="font-semibold">Ready to deploy?</h3>
            <p className="mt-1 text-sm text-muted-foreground text-center max-w-sm">Ship your first project to the cloud in minutes.</p>
            <Button className="mt-5 gap-2" nativeButton={false} render={<Link href="/new" />}>
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {runningProjects.map((p) => (
            <Link key={p.id} href="/projects">
              <Card className="hover:border-foreground/10 transition-colors cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <Rocket className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{p.name}</span>
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">running</Badge>
                        <Badge variant="outline" className="text-[9px]">{p.framework}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{p.subdomain}.serverme.site</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" /></span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
          {activeTunnels.map((t, i) => (
            <Link key={i} href="/tunnels">
              <Card className="hover:border-foreground/10 transition-colors cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 shrink-0">
                      <Waypoints className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{t.name || t.url}</span>
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">active</Badge>
                        <Badge variant="outline" className="text-[9px]">{t.protocol}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono">{t.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" /></span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
