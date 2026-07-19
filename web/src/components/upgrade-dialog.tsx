"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const EVENT = "deployzy:plan-limit";

/**
 * Route an API error through the upgrade dialog when it's a plan-limit
 * error. Returns true if handled (caller should NOT alert), false otherwise.
 *
 * Usage in a page:
 *   const msg = err.error || "Failed to create project";
 *   if (!showPlanLimit(msg)) alert(msg);
 */
export function showPlanLimit(message: string): boolean {
  if (!/plan limit|upgrade|not available on your plan/i.test(message)) return false;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
  return true;
}

/**
 * Mounted once in the dashboard layout. Listens for plan-limit events from
 * anywhere in the app and shows a proper upgrade dialog instead of alert().
 */
export function UpgradeDialogHost() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handler = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail || "");
      setOpen(true);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  // "plan limit reached: service (1/1 on free plan) — upgrade to add more"
  // → pull out the human-readable core for the description.
  const pretty = message.replace(/^plan limit reached:\s*/i, "").replace(/ — upgrade.*$/i, "");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
            <Zap className="h-6 w-6 text-emerald-500" />
          </div>
          <DialogTitle className="text-center pt-2">You&apos;ve reached a plan limit</DialogTitle>
          <DialogDescription className="text-center">
            {pretty ? (
              <>You&apos;re at your cap for <span className="font-medium text-foreground">{pretty}</span>.</>
            ) : (
              "You've hit one of your current plan's limits."
            )}{" "}
            Upgrade to keep building — plans start at <span className="font-medium text-foreground">$5/mo</span>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button className="w-full gap-2" nativeButton={false} render={<Link href="/billing" />}>
            <Zap className="h-4 w-4" />
            View plans &amp; upgrade
          </Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setOpen(false)}>
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
