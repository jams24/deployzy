"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { api, type User } from "@/lib/api";
import { ReferralsSection } from "@/components/dashboard/referrals-section";
import { WebhooksSection } from "@/components/dashboard/webhooks-section";

// ─────────────────────────────────────────────────────────────────────────────
// Settings — profile, plan, danger zone. Flow unchanged; presentation rebuilt
// with the Deployzy 2.0 card language (both themes).
// ─────────────────────────────────────────────────────────────────────────────

function Panel({ title, danger = false, children, className = "" }: { title: string; danger?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border overflow-hidden ${danger ? "border-destructive/30 bg-card/60 dark:bg-[#0c0d0f]/40" : "border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40"} ${className}`}>
      <div className="px-4 py-3 border-b border-border/60">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${danger ? "text-destructive" : "text-muted-foreground/70"}`}>{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  useEffect(() => {
    api.getMe().then((u) => {
      setUser(u);
      setName(u.name);
      setEmail(u.email);
    }).catch(() => {});
  }, []);

  return (
    <div className="animate-fade-in-up">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">Account</p>
      <h1 className="mt-1 text-[22px] sm:text-[26px] font-bold tracking-[-0.02em]">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your account settings.
      </p>

      {/* Profile */}
      <Panel title="Profile" className="mt-6">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={email} disabled />
            </div>
          </div>
          <Button className="btn-shine rounded-lg">Save Changes</Button>
        </div>
      </Panel>

      {/* Plan */}
      <Panel title="Plan" className="mt-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium capitalize">
                {user?.plan || "free"}
              </span>
              <Badge variant="outline">Current</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {user?.plan === "free"
                ? "1 tunnel, random subdomains, 20 req/s"
                : "Upgrade for more features"}
            </p>
          </div>
          <Button variant="outline" className="rounded-lg">Upgrade</Button>
        </div>
      </Panel>

      {/* Referrals */}
      <ReferralsSection />

      {/* Webhooks */}
      <WebhooksSection />

      {/* Danger Zone */}
      <Panel title="Danger Zone" danger className="mt-4">
        {!confirmDelete ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete Account</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permanently delete your account and all associated data.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} className="rounded-lg">
              Delete Account
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">This action cannot be undone.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                This will permanently delete your account, API keys, domains, team memberships, and all captured requests.
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                Type <strong className="text-foreground">delete my account</strong> to confirm:
              </p>
              <Input
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder="delete my account"
                className="max-w-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteText !== "delete my account"}
                onClick={async () => {
                  const token = localStorage.getItem("sm_token");
                  await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081"}/api/v1/users/me`, {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  api.logout();
                  router.push("/");
                }}
              >
                Permanently Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setConfirmDelete(false); setDeleteText(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
