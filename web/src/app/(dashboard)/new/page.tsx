"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { GitBranch, Container, Database, Clock, Server, Globe } from "lucide-react";

const deploymentOptions = [
  {
    title: "GitHub Deployment",
    desc: "Deploy directly from a GitHub repository",
    icon: GitBranch,
    href: "/projects?action=import",
    color: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  },
  {
    title: "Docker Project",
    desc: "Deploy using a Dockerfile from your repo",
    icon: Container,
    href: "/projects?action=import",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
];

const infraOptions = [
  {
    title: "PostgreSQL Database",
    desc: "Managed database with backups and auto-scaling",
    icon: Database,
    href: "/projects",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  {
    title: "Cronjob",
    desc: "Schedule automated tasks and HTTP pings",
    icon: Clock,
    href: "#",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    soon: true,
  },
  {
    title: "Custom Domain",
    desc: "Connect your own domain with automatic TLS",
    icon: Globe,
    href: "/domains",
    color: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  },
  {
    title: "SSH Server (BYOC)",
    desc: "Deploy to your own server via SSH",
    icon: Server,
    href: "#",
    color: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    soon: true,
  },
];

export default function NewResourcePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Create New Resource</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose from available deployment and infrastructure options</p>
      </div>

      {/* Deployment */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
            <Container className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Deployment</h2>
            <p className="text-[11px] text-muted-foreground">Ship your code to production</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {deploymentOptions.map((opt) => (
            <Link key={opt.title} href={opt.href}>
              <Card className="h-full transition-all hover:border-foreground/20 hover:shadow-lg hover:shadow-black/5 cursor-pointer group">
                <CardContent className="p-5">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${opt.color} mb-3 transition-transform group-hover:scale-110`}>
                    <opt.icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold">{opt.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{opt.desc}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Infrastructure */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
            <Server className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Infrastructure</h2>
            <p className="text-[11px] text-muted-foreground">Add services and resources to your stack</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {infraOptions.map((opt) => (
            <Link key={opt.title} href={opt.href} className={opt.soon ? "pointer-events-none" : ""}>
              <Card className={`h-full transition-all cursor-pointer group ${opt.soon ? "opacity-50" : "hover:border-foreground/20 hover:shadow-lg hover:shadow-black/5"}`}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${opt.color} transition-transform group-hover:scale-110`}>
                      <opt.icon className="h-5 w-5" />
                    </div>
                    {opt.soon && <span className="text-[9px] font-medium text-muted-foreground border border-border/60 rounded px-1.5 py-0.5">Coming soon</span>}
                  </div>
                  <h3 className="text-sm font-semibold">{opt.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{opt.desc}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
