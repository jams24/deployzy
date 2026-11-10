// Category chip tones for the blog. Separate light/dark text so chips stay
// readable on the paper background as well as the dark one.
const TONES: Record<string, string> = {
  Comparisons: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Tutorials: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  Databases: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Tools: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  General: "border-border bg-muted text-muted-foreground",
};

export function categoryTone(category: string): string {
  return TONES[category] ?? TONES.General;
}

export function formatPostDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
