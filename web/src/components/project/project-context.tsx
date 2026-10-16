"use client";

// ProjectProvider powers every /projects/[id]/* route. It owns the single
// source of truth for the project object (fetched from GET /projects/{id}),
// slow-polls it (15s, 3s while building), and exposes the mutation actions
// (deploy / stop / move / delete) shared by the header, overview and settings.
// Tabs read the project via useProject() — no per-tab refetching of the core
// record.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API, headers, type Project } from "./project-shared";

interface ProjectCtxValue {
  project: Project;
  /** Re-fetch the project record immediately. */
  refresh: () => Promise<void>;
  deploying: boolean;
  deleting: boolean;
  /** Trigger a deploy (optionally pinned to a commit) and go watch the logs. */
  deploy: (opts?: { commitSha?: string; stay?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  move: (workerServerId: string) => Promise<void>;
  /** Delete the project and go back to the list. Returns false if blocked. */
  remove: () => Promise<void>;
}

const ProjectCtx = createContext<ProjectCtxValue | null>(null);

export function useProject(): ProjectCtxValue {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error("useProject must be used inside <ProjectProvider>");
  return ctx;
}

export function ProjectProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deployTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}`, { headers: headers() });
      if (res.status === 404) { setNotFound(true); return; }
      if (res.ok) {
        const data = await res.json();
        if (data?.project) setProject(data.project);
      }
    } catch {}
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  // Slow unconditional poll — catches auto-deploys (GitHub webhook) and any
  // status changes the frontend didn't trigger itself.
  useEffect(() => {
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  // Fast poll (3 s) while building so the badge/buttons update quickly.
  useEffect(() => {
    if (project?.status !== "building") return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [project?.status, refresh]);

  useEffect(() => () => { if (deployTimer.current) clearTimeout(deployTimer.current); }, []);

  const deploy = useCallback(async (opts?: { commitSha?: string; stay?: boolean }) => {
    setDeploying(true);
    // Optimistic: flips the badge to "building" before the next poll.
    setProject((prev) => (prev ? { ...prev, status: "building" } : prev));
    await fetch(`${API}/api/v1/projects/${id}/deploy`, {
      method: "POST", headers: headers(),
      body: opts?.commitSha ? JSON.stringify({ commit_sha: opts.commitSha }) : undefined,
    });
    refresh();
    if (!opts?.stay) router.push(`/projects/${id}/logs`);
    deployTimer.current = setTimeout(() => setDeploying(false), 3000);
  }, [id, refresh, router]);

  const stop = useCallback(async () => {
    setProject((prev) => (prev ? { ...prev, status: "stopped" } : prev));
    await fetch(`${API}/api/v1/projects/${id}/stop`, { method: "POST", headers: headers() });
    refresh();
  }, [id, refresh]);

  const move = useCallback(async (workerServerId: string) => {
    setDeploying(true);
    const res = await fetch(`${API}/api/v1/projects/${id}/move`, {
      method: "POST", headers: headers(), body: JSON.stringify({ worker_server_id: workerServerId }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      alert(e.error || "Move failed");
      setDeploying(false);
      return;
    }
    refresh();
    deployTimer.current = setTimeout(() => setDeploying(false), 3000);
  }, [id, refresh]);

  const remove = useCallback(async () => {
    // Tearing down the container can take several seconds — keep the button
    // busy so it's clearly working instead of appearing frozen.
    setDeleting(true);
    try {
      const res = await fetch(`${API}/api/v1/projects/${id}`, { method: "DELETE", headers: headers() });
      // The delete succeeds even if container teardown couldn't be confirmed
      // (e.g. a BYOC server was unreachable) — surface that so the user knows
      // to check for an orphaned container.
      try {
        const data = await res.json();
        if (data?.warning) alert(data.warning);
      } catch {}
      router.push("/projects");
    } finally {
      setDeleting(false);
    }
  }, [id, router]);

  if (notFound) {
    return (
      <div className="animate-fade-in-up rounded-2xl border border-border/60 bg-card/60 dark:bg-[#0c0d0f]/40 p-10 text-center">
        <p className="text-sm text-muted-foreground">Project not found — it may have been deleted.</p>
        <button onClick={() => router.push("/projects")} className="mt-3 text-sm text-emerald-600 dark:text-emerald-400 hover:underline">
          ← Back to Projects
        </button>
      </div>
    );
  }

  if (!project) {
    return <p className="mt-8 text-sm text-muted-foreground animate-pulse">Loading project…</p>;
  }

  return (
    <ProjectCtx.Provider value={{ project, refresh, deploying, deleting, deploy, stop, move, remove }}>
      {children}
    </ProjectCtx.Provider>
  );
}
