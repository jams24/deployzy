"use client";

// Re-upload flow for "upload" projects: pick a folder → tar+gzip → push to the
// upload endpoint → deploy. useReupload() owns the hidden folder input and the
// error toast, so a menu item can trigger it too; ReuploadButton wraps it.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleNotchIcon, FolderOpenIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { makeTarGz, shouldIgnore, type TarFile } from "@/lib/tar";
import { API, headers } from "./project-shared";

export function useReupload(projectId: string, onDeployed?: () => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function start() {
    setErr(null);
    // Safari/Chrome only fire change reliably when the value is empty first.
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    // Snapshot the files IMMEDIATELY — do NOT clear the input first, that empties
    // the FileList and made the whole thing silently no-op.
    const arr = e.target.files ? Array.from(e.target.files) : [];
    if (arr.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      setPhase("Reading files…");
      const rels = arr.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      const firstSeg = rels[0]?.split("/")[0];
      const sameRoot = firstSeg && rels.every((r) => r.split("/")[0] === firstSeg);
      const kept: TarFile[] = [];
      let bytes = 0;
      for (let i = 0; i < arr.length; i++) {
        let rel = rels[i];
        if (sameRoot && rel.includes("/")) rel = rel.slice(firstSeg!.length + 1);
        if (!rel || shouldIgnore(rel)) continue;
        const data = new Uint8Array(await arr[i].arrayBuffer());
        kept.push({ path: rel, data }); bytes += data.length;
      }
      if (!kept.length) { setErr("That folder had no deployable files (everything was ignored)."); setBusy(false); setPhase(null); return; }
      if (bytes > 190 * 1024 * 1024) { setErr(`Too large (${(bytes / 1048576).toFixed(0)} MB after ignoring node_modules). Trim it and retry.`); setBusy(false); setPhase(null); return; }

      setPhase("Compressing…");
      const blob = await makeTarGz(kept);
      setPhase(`Uploading ${(blob.size / 1048576).toFixed(1)} MB…`);
      const token = localStorage.getItem("sm_token");
      const up = await fetch(`${API}/api/v1/projects/${projectId}/upload`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: blob,
      });
      if (!up.ok) { const d = await up.json().catch(() => ({})); setErr(d.error || `Upload failed (HTTP ${up.status})`); setBusy(false); setPhase(null); return; }
      setPhase("Deploying…");
      await fetch(`${API}/api/v1/projects/${projectId}/deploy`, { method: "POST", headers: headers() });
      setPhase(null);
      setBusy(false);
      onDeployed?.();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Re-upload failed");
      setBusy(false);
      setPhase(null);
    } finally {
      e.target.value = ""; // now safe to clear (files already snapshotted)
    }
  }

  const element = (
    <>
      <input
        ref={inputRef}
        type="file"
        // @ts-expect-error non-standard directory picker
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={onPick}
      />
      {/* Portalled: page wrappers keep a transform that would trap a fixed toast. */}
      {err && createPortal(
        <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-[14px] border border-red-500/30 bg-card px-4 py-3 text-sm shadow-[0_18px_50px_-20px_rgb(0_0_0/0.45)]">
          <div className="flex items-start gap-2.5">
            <XIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div className="flex-1">
              <div className="font-medium text-red-600 dark:text-red-400">Re-upload failed</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{err}</div>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setErr(null)} className="shrink-0 text-muted-foreground hover:text-foreground"><XIcon className="h-3.5 w-3.5" /></button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );

  return { start, busy, phase, element };
}

export function ReuploadButton({ projectId, onDeployed, className }: {
  projectId: string;
  /** Called once the upload has landed and the deploy has been triggered. */
  onDeployed?: () => void;
  className?: string;
}) {
  const { start, busy, phase, element } = useReupload(projectId, onDeployed);
  return (
    <>
      {element}
      <Button variant="outline" size="sm" className={`gap-1 h-8 text-xs ${className || ""}`} title="Re-upload & deploy" onClick={(e) => { e.stopPropagation(); start(); }} disabled={busy}>
        {busy ? <CircleNotchIcon className="h-3 w-3 animate-spin" /> : <FolderOpenIcon className="h-3 w-3" />}
        <span className="hidden sm:inline">{phase || "Re-upload"}</span>
      </Button>
    </>
  );
}
