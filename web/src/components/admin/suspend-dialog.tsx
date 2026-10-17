"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SuspendRequest {
  title: string;          // e.g. "Suspend jane@x.com?"
  description: string;    // what will happen
  defaultReason: string;
  defaultNotify: boolean; // on for manual suspends, off for abuse
  confirmLabel?: string;
  showReason?: boolean;   // abuse-report suspends set the reason server-side
}

// Confirmation dialog for suspensions: an internal reason (shown to admins)
// and whether to email the user. Rendered in a portal so a transformed
// ancestor in the admin layout can't trap or clip it.
export function SuspendDialog({
  request, onCancel, onConfirm,
}: {
  request: SuspendRequest | null;
  onCancel: () => void;
  onConfirm: (reason: string, notify: boolean) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  // Reset only when a new request opens — the parent may pass a fresh
  // onCancel every render, which must not wipe what the admin typed.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!request) return;
    setReason(request.defaultReason);
    setNotify(request.defaultNotify);
    setBusy(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request]);

  if (!request || typeof document === "undefined") return null;

  const submit = async () => {
    setBusy(true);
    try { await onConfirm(reason.trim(), notify); } finally { setBusy(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="suspend-title"
        className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-amber-500/15 flex items-center justify-center">
            <Ban className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <h3 id="suspend-title" className="text-sm font-semibold break-words">{request.title}</h3>
            <p className="text-xs text-muted-foreground mt-1">{request.description}</p>
          </div>
        </div>

        {request.showReason !== false && (
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Internal reason (admins only — never sent to the user)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter" && !busy) submit(); }} />
          </div>
        )}

        <label className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2.5 cursor-pointer">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span className="text-xs">
            <span className="font-medium text-foreground flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Email the user</span>
            <span className="block text-muted-foreground">Sends a generic notice citing the Acceptable Use Policy, with support@deployzy.com for appeals. It never mentions how the account was detected.</span>
          </span>
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={submit} disabled={busy} className="gap-1.5">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {request.confirmLabel || "Suspend"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
