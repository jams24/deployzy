"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Search,
  Loader2,
  FileText,
  Globe,
  Clock,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8081";

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  excerpt: string;
  category: string;
  tags: string[];
  author: string;
  read_time: string;
  status: "draft" | "published";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  cover_image: string | null;
}

function headers() {
  const token = typeof window !== "undefined" ? localStorage.getItem("sm_token") : "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function BlogAdminPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "published" | "draft">("all");
  const [deleteTarget, setDeleteTarget] = useState<BlogPost | null>(null);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function loadPosts() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/admin/blog/posts`, { headers: headers() });
      if (res.ok) setPosts(await res.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadPosts(); }, []);

  async function togglePublish(post: BlogPost) {
    setToggling(post.id);
    const action = post.status === "published" ? "unpublish" : "publish";
    try {
      await fetch(`${API}/api/v1/admin/blog/posts/${post.id}/${action}`, {
        method: "POST",
        headers: headers(),
      });
      await loadPosts();
    } catch {}
    setToggling(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteInput !== deleteTarget.title) return;
    setDeleting(true);
    try {
      await fetch(`${API}/api/v1/admin/blog/posts/${deleteTarget.id}`, {
        method: "DELETE",
        headers: headers(),
      });
      setDeleteTarget(null);
      setDeleteInput("");
      await loadPosts();
    } catch {}
    setDeleting(false);
  }

  const visible = posts.filter((p) => {
    const matchFilter = filter === "all" || p.status === filter;
    const matchSearch =
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    return matchFilter && matchSearch;
  });

  const totalPublished = posts.filter((p) => p.status === "published").length;
  const totalDraft = posts.filter((p) => p.status === "draft").length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Blog Posts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalPublished} published · {totalDraft} draft
          </p>
        </div>
        <Button size="sm" className="gap-2" nativeButton={false} render={<Link href="/admin/blog/new" />}>
          <Plus className="h-4 w-4" />
          New Post
        </Button>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total</span>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-xl font-bold">{posts.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Published</span>
              <Globe className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="mt-1 text-xl font-bold text-emerald-500">{totalPublished}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Drafts</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <p className="mt-1 text-xl font-bold text-amber-500">{totalDraft}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + search */}
      <div className="mt-6 flex flex-col sm:flex-row gap-2">
        <div className="flex gap-1">
          {(["all", "published", "draft"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              className="h-8 text-xs capitalize"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search title, category, tag..."
            className="pl-9 h-8 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Post list */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {posts.length === 0 ? "No posts yet. Create your first post." : "No posts match your filter."}
              </p>
              {posts.length === 0 && (
                <Button size="sm" className="mt-3 gap-2" nativeButton={false} render={<Link href="/admin/blog/new" />}>
                  <Plus className="h-4 w-4" />
                  Create Post
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {visible.map((post) => (
                <div key={post.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{post.title}</span>
                      <Badge
                        variant="outline"
                        className={
                          post.status === "published"
                            ? "text-[10px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : "text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20"
                        }
                      >
                        {post.status}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{post.category}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{post.excerpt || post.description}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                      <span className="font-mono">/blog/{post.slug}</span>
                      <span>{post.read_time}</span>
                      <span>{post.author}</span>
                      {post.published_at && (
                        <span>Published {new Date(post.published_at).toLocaleDateString()}</span>
                      )}
                      {!post.published_at && (
                        <span>Updated {new Date(post.updated_at).toLocaleDateString()}</span>
                      )}
                    </div>
                    {post.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {post.tags.slice(0, 5).map((tag) => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                        {post.tags.length > 5 && (
                          <span className="text-[9px] text-muted-foreground">+{post.tags.length - 5}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {post.status === "published" && (
                      <a
                        href={`/blog/${post.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                        title="View live"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      title={post.status === "published" ? "Unpublish" : "Publish"}
                      onClick={() => togglePublish(post)}
                      disabled={toggling === post.id}
                    >
                      {toggling === post.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : post.status === "published" ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      title="Edit"
                      nativeButton={false}
                      render={<Link href={`/admin/blog/${post.id}`} />}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      title="Delete"
                      onClick={() => { setDeleteTarget(post); setDeleteInput(""); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-background border border-border rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h2 className="text-base font-semibold">Delete post?</h2>
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="font-medium text-foreground">{deleteTarget.title}</span> and cannot be undone.
              Type the post title to confirm.
            </p>
            <Input
              placeholder={deleteTarget.title}
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              className="text-sm"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteInput !== deleteTarget.title || deleting}
                onClick={confirmDelete}
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
