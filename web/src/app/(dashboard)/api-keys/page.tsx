"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div>
      <h1 className="text-2xl font-bold">API Keys</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage authentication keys for the CLI and SDKs.
      </p>

      {/* Create Key */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Create New Key</CardTitle>
        </CardHeader>
        <CardContent>
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
            <Button onClick={createKey} className="gap-2 shrink-0">
              <Plus className="h-4 w-4" />
              Create
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            <strong>Full</strong> = everything · <strong>Deploy</strong> = create/deploy/manage projects (safe for CI) · <strong>Read-only</strong> = list/inspect only.
          </p>

          {newKey && (
            <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
              <p className="text-sm font-medium text-green-500 mb-2">
                Key created! Copy it now — it won&apos;t be shown again.
              </p>
              <div className="flex items-center gap-2 rounded-md bg-background p-2 font-mono text-sm">
                <code className="flex-1 truncate">{newKey}</code>
                <Button variant="ghost" size="sm" onClick={() => copyKey(newKey)}>
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keys List */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Your Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center py-8">
              <Key className="h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
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
        </CardContent>
      </Card>
    </div>
  );
}
