"use client";

// ServiceCards renders the editable list of extra services (shared by the import
// form on /projects and the settings tab on /projects/[id]). The toggle lives at
// each call site.

import { Button } from "@/components/ui/button";
import { Folder, Plus, RefreshCw, X } from "lucide-react";
import { makeService, type ServiceCfg } from "./project-shared";

export function ServiceCards({ services, onChange, subdomain, repoConnected, onBrowse, detectStack }: {
  services: ServiceCfg[];
  onChange: (s: ServiceCfg[]) => void;
  subdomain: string;
  repoConnected: boolean;
  onBrowse: (index: number) => void;
  detectStack: (dir: string) => Promise<string>;
}) {
  const update = (i: number, patch: Partial<ServiceCfg>) =>
    onChange(services.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-4">
      {services.map((svc, i) => (
        <div key={i} className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3 relative">
          <button type="button" onClick={() => onChange(services.filter((_, j) => j !== i))} className="absolute right-3 top-3 h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-accent">
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Service Name</label>
              <input type="text" placeholder="service-1" value={svc.name} onChange={(e) => update(i, { name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Port</label>
              <input type="number" min="1" max="65535" value={svc.port || ""} onChange={(e) => update(i, { port: parseInt(e.target.value) || 0 })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Base Directory</label>
              <div className="relative">
                <input type="text" placeholder="apps/api" value={svc.root_dir} onChange={(e) => update(i, { root_dir: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted pl-2 pr-8 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                 <button type="button" title="Browse repository directories" disabled={!repoConnected} onClick={() => onBrowse(i)} className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-violet-500 hover:bg-accent disabled:opacity-40">
                  <Folder className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Detected Stack</label>
              <div className="relative">
                <input type="text" readOnly placeholder="auto" value={svc.framework} className="w-full h-8 rounded-md border border-input bg-muted pl-2 pr-8 font-mono text-xs text-muted-foreground focus:outline-none" />
                 <button type="button" title="Re-detect stack" disabled={!repoConnected} onClick={async () => update(i, { framework: await detectStack(svc.root_dir) })} className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-violet-500 hover:bg-accent disabled:opacity-40">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-border/60 bg-background px-3 py-2">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Public URL</p>
            <p className="text-xs font-mono text-foreground truncate">{(subdomain || "your-app")}{svc.name ? `-${svc.name}` : ""}.deployzy.app</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Install Command</label>
              <input type="text" placeholder="npm install" value={svc.install_cmd} onChange={(e) => update(i, { install_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Build Command</label>
              <input type="text" placeholder="npm run build" value={svc.build_cmd} onChange={(e) => update(i, { build_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Start Command</label>
              <input type="text" placeholder="npm run start" value={svc.start_cmd} onChange={(e) => update(i, { start_cmd: e.target.value })} className="w-full h-8 rounded-md border border-input bg-muted px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">Service Env Overrides</label>
            <textarea rows={2} placeholder={"DATABASE_URL=postgres://...\nSERVICE_MODE=api"} value={svc.env_text} onChange={(e) => update(i, { env_text: e.target.value })} className="w-full rounded-md border border-input bg-muted px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-y" />
            <p className="text-[10px] text-muted-foreground">These values only apply to this service. App/global envs are still shared.</p>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-2" disabled={services.length >= 5} onClick={() => onChange([...services, makeService(services.length)])}>
        <Plus className="h-4 w-4" /> Add Service
      </Button>
    </div>
  );
}
