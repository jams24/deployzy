"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Template, EnvVarSchema } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Plus, Pencil, Trash2, ArrowLeft, Search,
  Eye, EyeOff, ToggleLeft, ToggleRight, Star, Download,
  GripVertical, X,
} from "lucide-react";

const CATEGORIES = ["bots", "automation", "monitoring", "cms", "analytics", "security", "databases", "other"];

const ENV_TYPES = ["text", "secret", "select", "auto"] as const;

const EMPTY_TEMPLATE: Partial<Template> = {
  slug: "", name: "", tagline: "", description: "", category: "other",
  tags: [], icon: "📦", color: "#6366f1", source_repo: "", docker_image: "",
  env_vars: [], ports: [], min_memory_mb: 256, post_deploy: "",
  is_official: false, is_featured: false, is_active: true,
};

const EMPTY_ENV_VAR: EnvVarSchema = {
  key: "", label: "", description: "", required: false,
  type: "text", options: [], default: "", placeholder: "",
};

// ─── Env Var Row Editor ───────────────────────────────────────────────────────
function EnvVarRow({
  ev,
  idx,
  onChange,
  onRemove,
}: {
  ev: EnvVarSchema;
  idx: number;
  onChange: (idx: number, updated: EnvVarSchema) => void;
  onRemove: (idx: number) => void;
}) {
  const set = (field: keyof EnvVarSchema, val: unknown) =>
    onChange(idx, { ...ev, [field]: val });

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
        <div className="flex-1 grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">KEY</Label>
            <Input
              className="h-7 font-mono text-xs"
              value={ev.key}
              onChange={(e) => set("key", e.target.value.toUpperCase())}
              placeholder="MY_ENV_VAR"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">LABEL</Label>
            <Input
              className="h-7 text-xs"
              value={ev.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Human label"
            />
          </div>
        </div>
        <button
          onClick={() => onRemove(idx)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Input
        className="h-7 text-xs"
        value={ev.description}
        onChange={(e) => set("description", e.target.value)}
        placeholder="Description shown to user"
      />

      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground mb-1 block">TYPE</Label>
          <select
            className="w-full h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            value={ev.type}
            onChange={(e) => set("type", e.target.value)}
          >
            {ENV_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground mb-1 block">DEFAULT</Label>
          <Input
            className="h-7 text-xs"
            value={ev.default}
            onChange={(e) => set("default", e.target.value)}
            placeholder="(optional)"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground mb-1 block">PLACEHOLDER</Label>
          <Input
            className="h-7 text-xs"
            value={ev.placeholder}
            onChange={(e) => set("placeholder", e.target.value)}
            placeholder="e.g. 1234:abc…"
          />
        </div>
      </div>

      {ev.type === "select" && (
        <div>
          <Label className="text-[10px] text-muted-foreground mb-1 block">OPTIONS (comma-separated)</Label>
          <Input
            className="h-7 text-xs"
            value={(ev.options ?? []).join(",")}
            onChange={(e) => set("options", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            placeholder="option1,option2,option3"
          />
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={ev.required}
          onChange={(e) => set("required", e.target.checked)}
          className="rounded"
        />
        <span className="text-xs text-muted-foreground">Required</span>
      </label>
    </div>
  );
}

// ─── Template Form Modal ──────────────────────────────────────────────────────
function TemplateFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial: Partial<Template>;
  onSave: (t: Partial<Template>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Template>>({ ...EMPTY_TEMPLATE, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEdit = !!initial.id;

  const set = (field: keyof Template, val: unknown) =>
    setForm((prev) => ({ ...prev, [field]: val }));

  function addEnvVar() {
    setForm((prev) => ({
      ...prev,
      env_vars: [...(prev.env_vars ?? []), { ...EMPTY_ENV_VAR }],
    }));
  }

  function updateEnvVar(idx: number, ev: EnvVarSchema) {
    setForm((prev) => {
      const arr = [...(prev.env_vars ?? [])];
      arr[idx] = ev;
      return { ...prev, env_vars: arr };
    });
  }

  function removeEnvVar(idx: number) {
    setForm((prev) => ({
      ...prev,
      env_vars: (prev.env_vars ?? []).filter((_, i) => i !== idx),
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const tagsStr = (form.tags ?? []).join(", ");
  const portsStr = (form.ports ?? []).join(", ");

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit Template" : "New Template"}</DialogTitle>
      </DialogHeader>

      <div className="space-y-5 mt-2">

        {/* Basics */}
        <section className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Basic info</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Name <span className="text-destructive">*</span></Label>
              <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Telegram Bot" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Slug <span className="text-destructive">*</span></Label>
              <Input
                className="font-mono text-xs"
                value={form.slug ?? ""}
                onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="telegram-bot-python"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Tagline</Label>
            <Input value={form.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} placeholder="Deploy a Python Telegram bot in 60 seconds" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Description</Label>
            <textarea
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              rows={3}
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Detailed description of what this template does…"
            />
          </div>
        </section>

        {/* Appearance */}
        <section className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Appearance</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Icon (emoji)</Label>
              <Input className="text-2xl text-center" value={form.icon ?? "📦"} onChange={(e) => set("icon", e.target.value)} maxLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label>Brand logo</Label>
              <Input
                placeholder="e.g. ghost, n8n, discord"
                value={form.logo_slug ?? ""}
                onChange={(e) => set("logo_slug", e.target.value.trim().toLowerCase())}
              />
              <p className="text-[10px] text-muted-foreground">
                Simple Icons slug (simpleicons.org). Renders the real brand mark
                instead of the emoji. Leave empty to show a lettermark.
              </p>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Brand color</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  className="h-9 w-12 rounded-md border border-border cursor-pointer bg-transparent p-0.5"
                  value={form.color ?? "#6366f1"}
                  onChange={(e) => set("color", e.target.value)}
                />
                <Input
                  className="font-mono text-xs flex-1"
                  value={form.color ?? "#6366f1"}
                  onChange={(e) => set("color", e.target.value)}
                  placeholder="#6366f1"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Category</Label>
              <select
                className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                value={form.category ?? "other"}
                onChange={(e) => set("category", e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Tags (comma-separated)</Label>
            <Input
              value={tagsStr}
              onChange={(e) =>
                set("tags", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
              }
              placeholder="python, telegram, bot, webhook"
            />
          </div>
        </section>

        {/* Source */}
        <section className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deploy source (one or the other)</p>
          <div>
            <Label className="text-xs mb-1.5 block">Git source repo URL</Label>
            <Input
              className="font-mono text-xs"
              value={form.source_repo ?? ""}
              onChange={(e) => set("source_repo", e.target.value || null)}
              placeholder="https://github.com/deployzy-templates/telegram-bot-python"
            />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Docker image</Label>
            <Input
              className="font-mono text-xs"
              value={form.docker_image ?? ""}
              onChange={(e) => set("docker_image", e.target.value || null)}
              placeholder="n8nio/n8n:latest"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Exposed ports (comma-separated)</Label>
              <Input
                className="font-mono text-xs"
                value={portsStr}
                onChange={(e) =>
                  set("ports", e.target.value.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n)))
                }
                placeholder="8080, 3000"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Min memory (MB)</Label>
              <Input
                type="number"
                value={form.min_memory_mb ?? 256}
                onChange={(e) => set("min_memory_mb", parseInt(e.target.value) || 256)}
              />
            </div>
          </div>
        </section>

        {/* Env vars */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Environment variables ({(form.env_vars ?? []).length})
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={addEnvVar}>
              <Plus className="h-3.5 w-3.5" /> Add variable
            </Button>
          </div>
          {(form.env_vars ?? []).map((ev, idx) => (
            <EnvVarRow
              key={idx}
              ev={ev}
              idx={idx}
              onChange={updateEnvVar}
              onRemove={removeEnvVar}
            />
          ))}
          {(form.env_vars ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4 rounded-lg border border-dashed border-border">
              No env vars defined — add one above
            </p>
          )}
        </section>

        {/* Post-deploy */}
        <section className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Post-deploy instructions</p>
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            rows={4}
            value={form.post_deploy ?? ""}
            onChange={(e) => set("post_deploy", e.target.value)}
            placeholder={"1. Set your webhook URL in Telegram BotFather\n2. Add the bot to a group…"}
          />
        </section>

        {/* Flags */}
        <section className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Flags</p>
          <div className="flex flex-wrap gap-4">
            {(
              [
                { field: "is_active", label: "Active (visible to users)" },
                { field: "is_official", label: "Official" },
                { field: "is_featured", label: "Featured" },
              ] as const
            ).map(({ field, label }) => (
              <label key={field} className="flex items-center gap-2 cursor-pointer">
                <button
                  type="button"
                  onClick={() => set(field, !form[field])}
                  className={`w-9 h-5 rounded-full transition-colors relative ${form[field] ? "bg-primary" : "bg-muted-foreground/30"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${form[field] ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
                <span className="text-sm text-foreground">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {error && (
          <div className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button className="flex-1" onClick={handleSave} disabled={saving || !form.name || !form.slug}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create template"}
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </DialogContent>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [editing, setEditing]     = useState<Partial<Template> | null>(null);
  const [deleting, setDeleting]   = useState<Template | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.adminListTemplates();
      setTemplates(data ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(form: Partial<Template>) {
    if (form.id) {
      const updated = await api.adminUpdateTemplate(form.id, form);
      setTemplates((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    } else {
      const created = await api.adminCreateTemplate(form);
      setTemplates((prev) => [created, ...prev]);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await api.adminDeleteTemplate(deleting.id);
      setTemplates((prev) => prev.filter((t) => t.id !== deleting.id));
      setDeleting(null);
    } catch {
      // silent
    } finally {
      setDeleteLoading(false);
    }
  }

  async function toggleActive(t: Template) {
    const updated = await api.adminUpdateTemplate(t.id, { ...t, is_active: !t.is_active });
    setTemplates((prev) => prev.map((x) => x.id === updated.id ? updated : x));
  }

  const filtered = templates.filter((t) =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.toLowerCase().includes(search.toLowerCase()) ||
    t.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-8">
            <ArrowLeft className="h-3.5 w-3.5" /> Admin
          </Button>
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Templates</h1>
          <p className="text-xs text-muted-foreground">{templates.length} total</p>
        </div>
        <Button className="gap-1.5 h-8 text-sm" onClick={() => setEditing({ ...EMPTY_TEMPLATE })}>
          <Plus className="h-3.5 w-3.5" /> New template
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9 h-9"
          placeholder="Search by name, slug or category…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Template</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Category</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden md:table-cell">Source</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Stats</th>
              <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground">Status</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded bg-muted/40 animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  {search ? "No templates match your search" : "No templates yet — create one above"}
                </td>
              </tr>
            ) : filtered.map((t) => (
              <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                {/* Name */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-base shrink-0"
                      style={{ background: t.color + "20", border: `1px solid ${t.color}30` }}
                    >
                      {t.icon}
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-1.5">
                        {t.name}
                        {t.is_featured && (
                          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-500">FEATURED</span>
                        )}
                        {t.is_official && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">OFFICIAL</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{t.slug}</div>
                    </div>
                  </div>
                </td>

                {/* Category */}
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground capitalize">
                    {t.category}
                  </span>
                </td>

                {/* Source */}
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-[160px] block">
                    {t.docker_image
                      ? `🐳 ${t.docker_image}`
                      : t.source_repo
                      ? `⎇ ${t.source_repo.replace("https://github.com/", "")}`
                      : "—"}
                  </span>
                </td>

                {/* Stats */}
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Download className="h-3 w-3" />{t.deploy_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3" />{t.star_count}
                    </span>
                  </div>
                </td>

                {/* Active toggle */}
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => toggleActive(t)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors ${
                      t.is_active
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {t.is_active ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {t.is_active ? "Active" : "Hidden"}
                  </button>
                </td>

                {/* Actions */}
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditing(t)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleting(t)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit / Create Modal */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && (
          <TemplateFormModal
            initial={editing}
            onSave={handleSave}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mt-2">
            This will permanently delete <strong>{deleting?.name}</strong> and remove all stars.
            Existing projects deployed from this template are not affected.
          </p>
          <div className="flex gap-3 mt-4">
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleDelete}
              disabled={deleteLoading}
            >
              {deleteLoading ? "Deleting…" : "Delete"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
