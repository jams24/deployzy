"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { api, type User } from "@/lib/api";
import { ReferralsSection } from "@/components/dashboard/referrals-section";
import { WebhooksSection } from "@/components/dashboard/webhooks-section";

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
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your account settings.
      </p>

      {/* Profile */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
          <Button>Save Changes</Button>
        </CardContent>
      </Card>

      {/* Plan */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Plan</CardTitle>
        </CardHeader>
        <CardContent>
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
            <Button variant="outline">Upgrade</Button>
          </div>
        </CardContent>
      </Card>

      {/* Referrals */}
      <ReferralsSection />

      {/* Webhooks */}
      <WebhooksSection />

      {/* Danger Zone */}
      <Card className="mt-6 border-destructive/30">
        <CardHeader>
          <CardTitle className="text-base text-destructive">
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!confirmDelete ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Delete Account</p>
                <p className="text-xs text-muted-foreground">
                  Permanently delete your account and all associated data.
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete Account
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-destructive/10 p-4">
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
        </CardContent>
      </Card>
    </div>
  );
}
