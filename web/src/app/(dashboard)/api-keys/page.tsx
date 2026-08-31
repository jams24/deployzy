"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Copy, Check, Plus, Trash2, Key } from "lucide-react";
import { api, type ApiKey } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// API Keys — create/revoke keys for the CLI and SDKs. Flow unchanged;
// presentation rebuilt with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

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

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScope, setNewKeyScope] = useState("full");
  const [newKey, setNewKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setKeys(await api.listApiKeys());
    } catch {
      // not authenticated
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createKey() {
    if (!newKeyName.trim()) return;
    try {
      const data = await api.createApiKey(newKeyName, newKeyScope);
      setNewKey(data.api_key);
      setNewKeyName("");
      load();
    } catch {}
  }

  async function deleteKey(id: string) {
    try {
      await api.deleteApiKey(id);
      load();
    } catch {}
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">API Keys</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage authentication keys for the CLI and SDKs.
      </p>

      {/* Create Key */}
      <Panel title="Create New Key" className="mt-6">
        <div className="flex gap-3">
          <Input
            placeholder="Key name (e.g., laptop, ci-cd)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createKey()}
          />
          <select
            value={newKeyScope}
            onChange={(e) => setNewKeyScope(e.target.value)}
            className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
            title="Key scope"
          >
            <option value="full">Full access</option>
            <option value="deploy">Deploy (no account/key mgmt)</option>
            <option value="read">Read-only</option>
          </select>
          <Button onClick={createKey} className="btn-shine gap-2 shrink-0 rounded-lg">
            <Plus className="h-4 w-4" />
            Create
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          <strong>Full</strong> = everything · <strong>Deploy</strong> = create/deploy/manage projects (safe for CI) · <strong>Read-only</strong> = list/inspect only.
        </p>

        {newKey && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400 mb-2">
              Key created! Copy it now — it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2 rounded-lg bg-background border border-border/60 p-2 font-mono text-sm">
              <code className="flex-1 truncate">{newKey}</code>
              <Button variant="ghost" size="sm" onClick={() => copyKey(newKey)}>
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {/* Keys List */}
      <Panel title="Your Keys" className="mt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Loading keys…</p>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-card">
              <Key className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              No API keys yet
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {k.prefix}...
                  </TableCell>
                  <TableCell>
                    <span className="rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                      {k.scope || "full"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {k.last_used_at
                      ? new Date(k.last_used_at).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(k.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteKey(k.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
