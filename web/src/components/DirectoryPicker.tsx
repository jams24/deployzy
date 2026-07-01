"use client";

import { useEffect, useState } from "react";
import { Folder, File as FileIcon, ChevronRight, X, Loader2, Home } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface Entry {
  name: string;
  path: string;
  type: string; // "dir" | "file"
}

interface DirectoryPickerProps {
  repo: string;            // github full_name, e.g. "jams24/cryptotime"
  branch: string;
  initialPath?: string;
  title?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

// DirectoryPicker is a right-side sheet that lets the user browse a GitHub repo's
// directory tree and pick a base directory. Mirrors the import form's dark UI.
// "Browse" drills into a directory; "Select" writes that directory's path back.
export function DirectoryPicker({ repo, branch, initialPath = "", title = "Select Base Directory", onSelect, onClose }: DirectoryPickerProps) {
  const [path, setPath] = useState(initialPath.replace(/^\/+|\/+$/g, ""));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : "";
    const qs = new URLSearchParams({ repo, branch: branch || "main", path });
    fetch(`${API}/api/v1/github/contents?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load this directory"))))
      .then((data: Entry[]) => {
        if (!cancelled) setEntries(Array.isArray(data) ? data : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, branch, path]);

  const crumbs = path ? path.split("/") : [];
  const dirs = entries.filter((e) => e.type === "dir");
  const files = entries.filter((e) => e.type !== "dir");

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-md h-full bg-[#0a0a0a] border-l border-white/10 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center mb-4"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-violet-500/15 flex items-center justify-center">
              <Folder className="h-4 w-4 text-violet-400" />
            </div>
            <h2 className="text-base font-semibold">{title}</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Choose the directory that contains your project files.</p>
        </div>

        {/* Breadcrumb */}
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-1 text-xs overflow-x-auto">
          <button
            type="button"
            onClick={() => setPath("")}
            className={`flex items-center gap-1 px-1.5 py-1 rounded hover:bg-white/5 ${path === "" ? "text-violet-400" : "text-muted-foreground"}`}
          >
            <Home className="h-3 w-3" /> root
          </button>
          {crumbs.map((c, i) => {
            const upto = crumbs.slice(0, i + 1).join("/");
            return (
              <span key={upto} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-zinc-700" />
                <button
                  type="button"
                  onClick={() => setPath(upto)}
                  className={`px-1.5 py-1 rounded hover:bg-white/5 ${i === crumbs.length - 1 ? "text-violet-400" : "text-muted-foreground"}`}
                >
                  {c}
                </button>
              </span>
            );
          })}
        </div>

        {/* Listing */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {!loading && error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md p-3">{error}</div>
          )}
          {!loading && !error && dirs.length === 0 && files.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-10">This directory is empty.</div>
          )}
          {!loading && !error && dirs.map((d) => (
            <div
              key={d.path}
              className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Folder className="h-4 w-4 text-violet-400 shrink-0" />
                <span className="text-sm truncate">{d.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(d.path)}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white"
                >
                  Select
                </button>
                <button
                  type="button"
                  onClick={() => setPath(d.path)}
                  className="text-xs font-medium px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10"
                >
                  Browse
                </button>
              </div>
            </div>
          ))}
          {!loading && !error && files.map((f) => (
            <div key={f.path} className="flex items-center gap-2 px-3 py-2 opacity-40">
              <FileIcon className="h-4 w-4 shrink-0" />
              <span className="text-sm truncate">{f.name}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-10 rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/5 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSelect(path)}
            className="flex-1 h-10 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium"
          >
            Use {path ? `/${path}` : "root"}
          </button>
        </div>
      </div>
    </div>
  );
}
