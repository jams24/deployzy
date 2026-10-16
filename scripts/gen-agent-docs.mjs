// Regenerates the AI agent's embedded docs snapshot from the live docs source.
// The agent's search_docs tool reads server/internal/api/aiassets/docs.json;
// this keeps it in sync with web/src/lib/docs.ts (the site's documentation).
//
// Usage: node scripts/gen-agent-docs.mjs
// (requires the web deps; run from repo root)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "web/src/lib/docs.ts");
const out = join(root, "server/internal/api/aiassets/docs.json");

// The docs module is TS with no exported `docs` record, so parse it directly:
// pull `allPages` (slug/title/category) order + each page's content from the
// `docs` object literal. We do a light TS→data extraction rather than importing.
const ts = readFileSync(src, "utf8");

// 1) category per slug, in nav order, from the `categories` array.
const cats = [];
const catBlock = ts.slice(ts.indexOf("export const categories"), ts.indexOf("export const allPages"));
const catRe = /name:\s*"([^"]+)"[\s\S]*?pages:\s*\[([\s\S]*?)\]/g;
let m;
while ((m = catRe.exec(catBlock))) {
  const name = m[1];
  const slugRe = /slug:\s*"([^"]+)"\s*,\s*title:\s*"([^"]+)"/g;
  let sm;
  while ((sm = slugRe.exec(m[2]))) cats.push({ slug: sm[1], title: sm[2], category: name });
}

// 2) each page's description + content from the `docs` record. Content is a
// template literal `...`; we extract by matching the per-slug object.
const docsBlock = ts.slice(ts.indexOf("const docs: Record"));
const pages = [];
for (const { slug, title, category } of cats) {
  // find:  "slug": { ... } or  slug: {  (both key forms), then description + content: `...`
  const keyPat = new RegExp(`(?:"${slug}"|${slug.replace(/[/]/g, "\\/")})\\s*:\\s*\\{`, "");
  const start = docsBlock.search(keyPat);
  if (start === -1) { pages.push({ slug, title, category, description: "", content: "" }); continue; }
  const seg = docsBlock.slice(start, start + 20000);
  const desc = (seg.match(/description:\s*"((?:[^"\\]|\\.)*)"/) || [])[1] || "";
  // content: `...` — find the backtick-delimited template literal
  const ci = seg.indexOf("content:");
  let content = "";
  if (ci !== -1) {
    const bt = seg.indexOf("`", ci);
    if (bt !== -1) {
      let i = bt + 1, buf = "";
      while (i < seg.length) {
        const ch = seg[i];
        if (ch === "\\") { buf += seg[i] + seg[i + 1]; i += 2; continue; }
        if (ch === "`") break;
        buf += ch; i++;
      }
      // unescape the common TS escapes we use in content
      content = buf.replace(/\\`/g, "`").replace(/\\\$/g, "$").replace(/\\\\/g, "\\");
    }
  }
  pages.push({ slug, title, category, description: desc.replace(/\\"/g, '"'), content });
}

writeFileSync(out, JSON.stringify(pages, null, 0));
console.log(`wrote ${pages.length} pages → ${out}`);
const missing = pages.filter((p) => !p.content).map((p) => p.slug);
if (missing.length) console.log("⚠️ pages with empty content:", missing.join(", "));
