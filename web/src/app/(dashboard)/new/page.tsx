"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch, Database, Container, Layers, Search,
  ChevronRight, Loader2, Globe, Server,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

const options = [
  { id: "github", title: "GitHub Repository", desc: "Deploy from a GitHub repo", icon: GitBranch, color: "text-violet-400 bg-violet-500/10", category: "deploy" },
  { id: "database", title: "Database", desc: "PostgreSQL instance with connection URL", icon: Database, color: "text-emerald-400 bg-emerald-500/10", category: "infra" },
  { id: "template", title: "Template", desc: "Start from a pre-built template", icon: Layers, color: "text-amber-400 bg-amber-500/10", category: "deploy" },
  { id: "docker", title: "Docker Image", desc: "Deploy from Docker Hub image", icon: Container, color: "text-blue-400 bg-blue-500/10", category: "deploy" },
  { id: "domain", title: "Custom Domain", desc: "Connect your own domain", icon: Globe, color: "text-pink-400 bg-pink-500/10", category: "infra" },
  { id: "server", title: "SSH Server (BYOC)", desc: "Add your own server for deployments", icon: Server, color: "text-orange-400 bg-orange-500/10", category: "infra" },
];

const templates = [
  { name: "Next.js Starter", desc: "Full-stack React with App Router", repo: "https://github.com/serverme/template-nextjs.git", framework: "nextjs" },
  { name: "Express API", desc: "Node.js REST API server", repo: "https://github.com/serverme/template-express.git", framework: "node" },
  { name: "Flask API", desc: "Python lightweight web framework", repo: "https://github.com/serverme/template-flask.git", framework: "python" },
  { name: "Static Site", desc: "HTML/CSS/JS with nginx", repo: "https://github.com/serverme/template-static.git", framework: "static" },
];

export default function NewResourcePage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Database creation
  const [dbName, setDbName] = useState("");

  const headers = () => {
    const token = localStorage.getItem("sm_token");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  const filtered = options.filter(o =>
    !search || o.title.toLowerCase().includes(search.toLowerCase()) || o.desc.toLowerCase().includes(search.toLowerCase())
  );

  async function createDatabase() {
    if (!dbName) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/v1/services`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ name: dbName, type: "postgres" }),
      });
      if (res.ok) {
        router.push("/services");
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        alert(err.error || "Failed to create database");
      }
    } catch {}
    setCreating(false);
  }

  function handleSelect(id: string) {
    switch (id) {
      case "github": router.push("/projects?action=import"); break;
      case "database": setStep("database"); break;
      case "template": setStep("template"); break;
      case "docker": router.push("/projects?action=import"); break;
      case "domain": router.push("/domains"); break;
      case "server": router.push("/servers"); break;
    }
  }

  // Database creation step
  if (step === "database") {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <button onClick={() => setStep(null)} className="text-xs text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">&larr; Back</button>
        <h1 className="text-xl font-bold mb-1">Create Database</h1>
        <p className="text-sm text-muted-foreground mb-6">Deploy a managed PostgreSQL instance. Use the connection URL in any project.</p>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium">Database Name</label>
            <Input placeholder="my-database" value={dbName} onChange={(e) => setDbName(e.target.value)} className="h-10" />
          </div>

          <Card className="border-emerald-500/20">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium">PostgreSQL 16</p>
                <p className="text-[11px] text-muted-foreground">Managed instance on ServerMe infrastructure</p>
              </div>
              <Badge className="ml-auto text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Free</Badge>
            </CardContent>
          </Card>

          <Button className="w-full gap-2" onClick={createDatabase} disabled={creating || !dbName}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Create Database
          </Button>
        </div>
      </div>
    );
  }

  // Template selection step
  if (step === "template") {
    return (
      <div className="max-w-lg mx-auto mt-8">
        <button onClick={() => setStep(null)} className="text-xs text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1">&larr; Back</button>
        <h1 className="text-xl font-bold mb-1">Choose a Template</h1>
        <p className="text-sm text-muted-foreground mb-6">Start with a pre-configured project template.</p>

        <div className="space-y-2">
          {templates.map((t) => (
            <Card key={t.name} className="hover:border-foreground/20 transition-all cursor-pointer group" onClick={() => router.push(`/projects?action=import&template=${encodeURIComponent(t.repo)}&name=${encodeURIComponent(t.name)}`)}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 shrink-0 transition-transform group-hover:scale-110">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-[11px] text-muted-foreground">{t.desc}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground text-center">More templates coming soon</p>
      </div>
    );
  }

  // Main command palette
  return (
    <div className="max-w-lg mx-auto mt-8">
      <div className="rounded-xl border border-border/60 bg-card/50 overflow-hidden shadow-lg">
        {/* Search */}
        <div className="relative border-b border-border/40">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="What would you like to create?"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12 pl-11 border-0 rounded-none focus-visible:ring-0 text-sm"
            autoFocus
          />
        </div>

        {/* Options */}
        <div className="p-2">
          {filtered.filter(o => o.category === "deploy").length > 0 && (
            <>
              <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Deploy</p>
              {filtered.filter(o => o.category === "deploy").map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSelect(opt.id)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${opt.color} shrink-0 transition-transform group-hover:scale-110`}>
                      <opt.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </>
          )}

          {filtered.filter(o => o.category === "infra").length > 0 && (
            <>
              <div className="border-t border-border/30 my-1" />
              <p className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Infrastructure</p>
              {filtered.filter(o => o.category === "infra").map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSelect(opt.id)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-accent/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${opt.color} shrink-0 transition-transform group-hover:scale-110`}>
                      <opt.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{opt.title}</p>
                      <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </>
          )}

          {filtered.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">No matching options</p>
          )}
        </div>
      </div>
    </div>
  );
}
