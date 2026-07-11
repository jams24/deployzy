"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Upload,
  Loader2,
  GripVertical,
  Globe,
  EyeOff,
  Save,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

type SectionType = "h2" | "h3" | "p" | "ul" | "ol" | "code" | "callout" | "cta";

interface Section {
  type: SectionType;
  content?: string;
  items?: string[];
  language?: string;
  calloutType?: "info" | "warning" | "tip";
  ctaText?: string;
  ctaHref?: string;
}

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  content: Section[];
  cover_image: string | null;
  category: string;
  tags: string[];
  author: string;
  read_time: string;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const SECTION_LABELS: Record<SectionType, string> = {
  h2: "H2 Heading",
  h3: "H3 Heading",
  p: "Paragraph",
  ul: "Bullet List",
  ol: "Numbered List",
  code: "Code Block",
  callout: "Callout",
  cta: "Call to Action",
};

function defaultSection(type: SectionType): Section {
  if (type === "ul" || type === "ol") return { type, items: [""] };
  if (type === "code") return { type, language: "bash", content: "" };
  if (type === "callout") return { type, calloutType: "info", content: "" };
  if (type === "cta") return { type, ctaText: "Get started free", ctaHref: "/sign-up" };
  return { type, content: "" };
}

function headers() {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : "";
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders() {
  return { ...headers(), "Content-Type": "application/json" };
}

// ── Block editor components ───────────────────────────────────────────────────

function SectionEditor({
  section,
  index,
  total,
  onChange,
  onDelete,
  onMove,
}: {
  section: Section;
  index: number;
  total: number;
  onChange: (s: Section) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const ta = "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring";

  const renderBody = () => {
    switch (section.type) {
      case "h2":
      case "h3":
      case "p":
        return (
          <textarea
            className={ta}
            rows={section.type === "p" ? 4 : 2}
            value={section.content || ""}
            placeholder={section.type === "h2" ? "Section heading..." : section.type === "h3" ? "Sub-heading..." : "Paragraph text..."}
            onChange={(e) => onChange({ ...section, content: e.target.value })}
          />
        );
      case "ul":
      case "ol":
        return (
          <div className="space-y-1">
            {(section.items || []).map((item, i) => (
              <div key={i} className="flex gap-2 items-center">
                <span className="text-muted-foreground text-xs shrink-0 w-4 text-right">
                  {section.type === "ol" ? `${i + 1}.` : "•"}
                </span>
                <Input
                  value={item}
                  placeholder={`Item ${i + 1}`}
                  className="h-7 text-xs"
                  onChange={(e) => {
                    const items = [...(section.items || [])];
                    items[i] = e.target.value;
                    onChange({ ...section, items });
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground"
                  onClick={() => {
                    const items = (section.items || []).filter((_, j) => j !== i);
                    onChange({ ...section, items });
                  }}
                  disabled={(section.items || []).length <= 1}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs mt-1"
              onClick={() => onChange({ ...section, items: [...(section.items || []), ""] })}
            >
              <Plus className="h-3 w-3 mr-1" /> Add item
            </Button>
          </div>
        );
      case "code":
        return (
          <div className="space-y-2">
            <Input
              value={section.language || "bash"}
              placeholder="language (bash, js, python…)"
              className="h-7 text-xs font-mono w-32"
              onChange={(e) => onChange({ ...section, language: e.target.value })}
            />
            <textarea
              className={`${ta} font-mono text-xs`}
              rows={8}
              value={section.content || ""}
              placeholder="// code here"
              onChange={(e) => onChange({ ...section, content: e.target.value })}
            />
          </div>
        );
      case "callout":
        return (
          <div className="space-y-2">
            <select
              value={section.calloutType || "info"}
              onChange={(e) => onChange({ ...section, calloutType: e.target.value as "info" | "warning" | "tip" })}
              className="h-7 rounded border border-input bg-background px-2 text-xs"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="tip">Tip</option>
            </select>
            <textarea
              className={ta}
              rows={3}
              value={section.content || ""}
              placeholder="Callout text..."
              onChange={(e) => onChange({ ...section, content: e.target.value })}
            />
          </div>
        );
      case "cta":
        return (
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={section.ctaText || ""}
              placeholder="Button label"
              className="h-8 text-xs"
              onChange={(e) => onChange({ ...section, ctaText: e.target.value })}
            />
            <Input
              value={section.ctaHref || ""}
              placeholder="URL (e.g. /sign-up)"
              className="h-8 text-xs font-mono"
              onChange={(e) => onChange({ ...section, ctaHref: e.target.value })}
            />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab" />
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {SECTION_LABELS[section.type]}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onMove(-1)} disabled={index === 0}>
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onMove(1)} disabled={index === total - 1}>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="p-3">{renderBody()}</div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function BlogPostEditorPage() {
  const params = useParams();
  const router = useRouter();
  const isNew = params.id === "new";

  const [post, setPost] = useState<Partial<BlogPost>>({
    title: "",
    slug: "",
    description: "",
    excerpt: "",
    content: [],
    cover_image: null,
    category: "General",
    tags: [],
    author: "Deployzy Team",
    read_time: "5 min read",
    status: "draft",
  });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const coverRef = useRef<HTMLInputElement>(null);

  const slugify = (title: string) =>
    title.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  useEffect(() => {
    if (isNew) return;
    fetch(`${API}/api/v1/admin/blog/posts/${params.id}`, { headers: headers() })
      .then((r) => r.json())
      .then((data) => {
        if (data.content && typeof data.content === "string") {
          try { data.content = JSON.parse(data.content); } catch { data.content = []; }
        }
        if (!Array.isArray(data.content)) data.content = [];
        setPost(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isNew, params.id]);

  const updateField = useCallback(<K extends keyof BlogPost>(k: K, v: BlogPost[K]) => {
    setPost((prev) => {
      const next: Partial<BlogPost> = { ...prev, [k]: v };
      if (k === "title" && (!prev.slug || prev.slug === slugify(prev.title || ""))) {
        next.slug = slugify(v as string);
      }
      return next;
    });
  }, []);

  const addSection = (type: SectionType) => {
    setPost((prev) => ({
      ...prev,
      content: [...(prev.content || []), defaultSection(type)],
    }));
  };

  const updateSection = (i: number, s: Section) => {
    setPost((prev) => {
      const content = [...(prev.content || [])];
      content[i] = s;
      return { ...prev, content };
    });
  };

  const deleteSection = (i: number) => {
    setPost((prev) => {
      const content = [...(prev.content || [])];
      content.splice(i, 1);
      return { ...prev, content };
    });
  };

  const moveSection = (i: number, dir: -1 | 1) => {
    setPost((prev) => {
      const content = [...(prev.content || [])];
      const j = i + dir;
      if (j < 0 || j >= content.length) return prev;
      [content[i], content[j]] = [content[j], content[i]];
      return { ...prev, content };
    });
  };

  async function uploadCoverImage(file: File) {
    setUploadingCover(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`${API}/api/v1/admin/blog/upload`, {
        method: "POST",
        headers: headers(),
        body: fd,
      });
      if (res.ok) {
        const data = await res.json();
        updateField("cover_image", data.url);
      }
    } catch {}
    setUploadingCover(false);
  }

  async function save() {
    setSaving(true);
    setSaveMsg("");
    try {
      const body = JSON.stringify({
        ...post,
        content: post.content || [],
        tags: post.tags || [],
      });
      const url = isNew
        ? `${API}/api/v1/admin/blog/posts`
        : `${API}/api/v1/admin/blog/posts/${params.id}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, { method, headers: jsonHeaders(), body });
      if (res.ok) {
        const saved = await res.json();
        setSaveMsg("Saved");
        if (isNew) {
          router.replace(`/admin/blog/${saved.id}`);
        } else {
          setPost((prev) => ({ ...prev, ...saved }));
        }
      } else {
        const e = await res.json().catch(() => ({}));
        setSaveMsg(`Error: ${e.error || "save failed"}`);
      }
    } catch (err) {
      setSaveMsg("Save failed");
    }
    setSaving(false);
    setTimeout(() => setSaveMsg(""), 3000);
  }

  async function togglePublish() {
    if (!post.id) { await save(); return; }
    setPublishing(true);
    const action = post.status === "published" ? "unpublish" : "publish";
    try {
      const res = await fetch(`${API}/api/v1/admin/blog/posts/${post.id}/${action}`, {
        method: "POST",
        headers: headers(),
      });
      if (res.ok) {
        setPost((prev) => ({
          ...prev,
          status: action === "publish" ? "published" : "draft",
        }));
        setSaveMsg(action === "publish" ? "Published!" : "Unpublished");
        setTimeout(() => setSaveMsg(""), 3000);
      }
    } catch {}
    setPublishing(false);
  }

  function addTag() {
    const t = tagInput.trim();
    if (!t || (post.tags || []).includes(t)) return;
    updateField("tags", [...(post.tags || []), t]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    updateField("tags", (post.tags || []).filter((t) => t !== tag));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const content = post.content || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" nativeButton={false} render={<Link href="/admin/blog" />}>
            <ArrowLeft className="h-4 w-4" />
            Posts
          </Button>
          <Badge
            variant="outline"
            className={
              post.status === "published"
                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-500 border-amber-500/20"
            }
          >
            {post.status || "draft"}
          </Badge>
          {saveMsg && (
            <span className={`text-xs ${saveMsg.startsWith("Error") ? "text-destructive" : "text-emerald-500"}`}>
              {saveMsg}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            onClick={save}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
          <Button
            size="sm"
            className="gap-1.5 h-8"
            onClick={togglePublish}
            disabled={publishing || saving}
          >
            {publishing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : post.status === "published" ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Globe className="h-3.5 w-3.5" />
            )}
            {post.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Left — content editor */}
        <div className="space-y-5">
          {/* Title */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input
              value={post.title || ""}
              placeholder="Post title"
              className="mt-1 text-lg font-bold h-12"
              onChange={(e) => updateField("title", e.target.value)}
            />
          </div>

          {/* Slug */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Slug</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono shrink-0">/blog/</span>
              <Input
                value={post.slug || ""}
                placeholder="my-post-slug"
                className="h-8 text-xs font-mono"
                onChange={(e) => updateField("slug", e.target.value)}
              />
            </div>
          </div>

          {/* Excerpt */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Excerpt</label>
            <textarea
              className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              rows={2}
              value={post.excerpt || ""}
              placeholder="Short preview text shown in blog listing..."
              onChange={(e) => updateField("excerpt", e.target.value)}
            />
          </div>

          {/* Cover image */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Cover Image</label>
            <div className="mt-1 space-y-2">
              {post.cover_image ? (
                <div className="relative group">
                  <img
                    src={post.cover_image.startsWith("/api") ? `${API}${post.cover_image}` : post.cover_image}
                    alt="Cover"
                    className="w-full h-40 object-cover rounded-lg border border-border"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs bg-background"
                      onClick={() => coverRef.current?.click()}
                    >
                      Replace
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs bg-background text-destructive"
                      onClick={() => updateField("cover_image", null)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => coverRef.current?.click()}
                  className="w-full h-28 rounded-lg border-2 border-dashed border-border hover:border-ring transition-colors flex flex-col items-center justify-center gap-2 text-muted-foreground"
                  disabled={uploadingCover}
                >
                  {uploadingCover ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <ImageIcon className="h-6 w-6" />
                      <span className="text-xs">Click to upload cover image</span>
                      <span className="text-[10px]">JPG, PNG, WebP, GIF — max 10 MB</span>
                    </>
                  )}
                </button>
              )}
              <input
                ref={coverRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadCoverImage(f);
                  e.target.value = "";
                }}
              />
              <div className="flex gap-2 items-center">
                <span className="text-[10px] text-muted-foreground">Or paste a URL:</span>
                <Input
                  value={post.cover_image || ""}
                  placeholder="https://..."
                  className="h-7 text-xs"
                  onChange={(e) => updateField("cover_image", e.target.value || null)}
                />
              </div>
            </div>
          </div>

          {/* Block editor */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-medium text-muted-foreground">Content Blocks</label>
              <span className="text-[10px] text-muted-foreground">{content.length} blocks</span>
            </div>

            {content.length === 0 && (
              <div className="rounded-lg border-2 border-dashed border-border p-8 text-center text-muted-foreground text-sm mb-3">
                No blocks yet. Add your first block below.
              </div>
            )}

            <div className="space-y-2">
              {content.map((section, i) => (
                <SectionEditor
                  key={i}
                  section={section}
                  index={i}
                  total={content.length}
                  onChange={(s) => updateSection(i, s)}
                  onDelete={() => deleteSection(i)}
                  onMove={(dir) => moveSection(i, dir)}
                />
              ))}
            </div>

            {/* Add block menu */}
            <div className="mt-3 p-3 rounded-lg border border-border/40 bg-muted/20">
              <p className="text-[11px] font-medium text-muted-foreground mb-2">Add block</p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(SECTION_LABELS) as SectionType[]).map((type) => (
                  <Button
                    key={type}
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => addSection(type)}
                  >
                    {SECTION_LABELS[type]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right — SEO + metadata panel */}
        <div className="space-y-4">
          {/* Meta */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Post Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Category</label>
                <Input
                  value={post.category || ""}
                  placeholder="General"
                  className="mt-1 h-8 text-xs"
                  onChange={(e) => updateField("category", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Author</label>
                <Input
                  value={post.author || ""}
                  placeholder="Deployzy Team"
                  className="mt-1 h-8 text-xs"
                  onChange={(e) => updateField("author", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Read Time</label>
                <Input
                  value={post.read_time || ""}
                  placeholder="5 min read"
                  className="mt-1 h-8 text-xs"
                  onChange={(e) => updateField("read_time", e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Tags</label>
                <div className="mt-1 flex gap-1">
                  <Input
                    value={tagInput}
                    placeholder="Add tag"
                    className="h-7 text-xs"
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                  />
                  <Button variant="outline" size="sm" className="h-7 px-2 shrink-0" onClick={addTag}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                {(post.tags || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(post.tags || []).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => removeTag(tag)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        {tag} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* SEO */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">SEO</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  Meta Description
                  <span className="ml-1 font-normal text-muted-foreground/60">
                    ({(post.description || "").length}/160)
                  </span>
                </label>
                <textarea
                  className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  rows={3}
                  value={post.description || ""}
                  placeholder="Appears in Google search results..."
                  maxLength={160}
                  onChange={(e) => updateField("description", e.target.value)}
                />
              </div>

              {/* SERP preview */}
              {(post.title || post.description) && (
                <div className="rounded-lg border border-border/40 p-3 space-y-1 bg-muted/10">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Google preview</p>
                  <p className="text-[13px] font-medium text-blue-500 line-clamp-1">
                    {post.title || "Post title"} | Deployzy
                  </p>
                  <p className="text-[11px] text-muted-foreground font-mono">
                    deployzy.com › blog › {post.slug || "slug"}
                  </p>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">
                    {post.description || "Meta description will appear here."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick tips */}
          <Card className="border-border/40 bg-muted/10">
            <CardContent className="pt-4 space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground">SEO tips</p>
              <ul className="space-y-1 text-[11px] text-muted-foreground list-disc list-inside">
                <li>Title: 50–60 characters</li>
                <li>Meta description: 130–160 characters</li>
                <li>Start slug with target keyword</li>
                <li>Use H2 for major sections, H3 for sub-points</li>
                <li>Add at least one CTA block</li>
                <li>Include 3–5 relevant tags</li>
              </ul>
            </CardContent>
          </Card>

          {/* Post info */}
          {post.created_at && (
            <div className="text-[10px] text-muted-foreground space-y-0.5 px-1">
              <div>Created: {new Date(post.created_at).toLocaleString()}</div>
              {post.updated_at && <div>Updated: {new Date(post.updated_at).toLocaleString()}</div>}
              {post.published_at && <div>Published: {new Date(post.published_at).toLocaleString()}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
