// Minimal client-side USTAR tar writer + native gzip, so a user can upload a
// project folder from the browser to Deployzy's upload-deploy endpoint (which
// expects a gzip'd tar build context) — no npm dependency.

export interface TarFile {
  path: string; // relative path inside the archive
  data: Uint8Array;
}

// Folders/files we never ship in a build context (bloat + secrets).
const IGNORE = [
  "node_modules/", ".git/", ".next/", "dist/", "build/", ".turbo/", ".cache/",
  ".vercel/", ".DS_Store", "coverage/", ".idea/", ".vscode/", "vendor/",
  "__pycache__/", ".venv/", "venv/", ".env.local", "npm-debug.log",
];

export function shouldIgnore(path: string): boolean {
  const p = path.replace(/^\.\//, "");
  return IGNORE.some((ig) => (ig.endsWith("/") ? p.includes(ig) : p.endsWith(ig) || p.split("/").pop() === ig));
}

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, "0") + "\0";
}

// Build one 512-byte USTAR header for a regular file.
function header(name: string, size: number): Uint8Array {
  const buf = new Uint8Array(512);
  const enc = new TextEncoder();
  let prefix = "";
  let fname = name;
  if (fname.length > 100) {
    // Split into prefix (≤155) + name (≤100) at a path separator.
    const cut = fname.lastIndexOf("/", fname.length - 100 + (fname.length - 100));
    const idx = fname.length - 100;
    const sep = fname.indexOf("/", idx);
    if (sep > 0 && sep < 155) {
      prefix = fname.slice(0, sep);
      fname = fname.slice(sep + 1);
    } else if (cut > 0) {
      prefix = fname.slice(0, cut);
      fname = fname.slice(cut + 1);
    } else {
      fname = fname.slice(-100); // last resort: truncate
    }
  }
  const put = (str: string, off: number, len: number) => {
    const b = enc.encode(str);
    buf.set(b.slice(0, len), off);
  };
  put(fname, 0, 100);
  put(octal(0o644, 8), 100, 8);   // mode
  put(octal(0, 8), 108, 8);       // uid
  put(octal(0, 8), 116, 8);       // gid
  put(octal(size, 12), 124, 12);  // size
  put(octal(Math.floor(Date.now() / 1000), 12), 136, 12); // mtime
  put("        ", 148, 8);        // checksum placeholder (8 spaces)
  buf[156] = 0x30;                // typeflag '0' = regular file
  put("ustar\0", 257, 6);         // magic
  put("00", 263, 2);              // version
  put(prefix, 345, 155);          // prefix
  // checksum = sum of all header bytes (with checksum field as spaces)
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  put(octal(sum, 8), 148, 8);
  return buf;
}

function pad512(size: number): number {
  const rem = size % 512;
  return rem === 0 ? 0 : 512 - rem;
}

// Assemble the tar bytes.
export function makeTar(files: TarFile[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const f of files) {
    const name = f.path.replace(/^\.\//, "");
    const h = header(name, f.data.length);
    parts.push(h, f.data);
    total += 512 + f.data.length;
    const p = pad512(f.data.length);
    if (p) { parts.push(new Uint8Array(p)); total += p; }
  }
  // Two 512-byte zero blocks terminate the archive.
  parts.push(new Uint8Array(1024));
  total += 1024;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// Gzip via the browser's native CompressionStream, returning a Blob.
export async function makeTarGz(files: TarFile[]): Promise<Blob> {
  const tar = makeTar(files);
  if (typeof (globalThis as unknown as { CompressionStream?: unknown }).CompressionStream === "function") {
    const cs = new CompressionStream("gzip");
    const stream = new Blob([tar as BlobPart]).stream().pipeThrough(cs);
    return await new Response(stream).blob();
  }
  // Fallback: send the uncompressed tar (server also accepts a plain tar).
  return new Blob([tar as BlobPart], { type: "application/x-tar" });
}

// Detect the build framework from the uploaded files (mirrors the git path).
export function detectFrameworkFromFiles(paths: string[]): string {
  const has = (name: string) => paths.some((p) => p === name || p.endsWith("/" + name));
  const anyExt = (ext: string) => paths.some((p) => p.endsWith(ext));
  if (has("Dockerfile")) return "docker";
  if (has("next.config.js") || has("next.config.mjs") || has("next.config.ts")) return "node";
  if (has("package.json")) return "node";
  if (has("requirements.txt") || has("pyproject.toml") || anyExt(".py")) return "python";
  if (has("go.mod")) return "docker";
  if (has("index.html")) return "static";
  return "node";
}
