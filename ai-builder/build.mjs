#!/usr/bin/env node
/**
 * Assemble a deploy-ready project from a prompt.
 *   prompt -> generate content.json -> copy scaffold + inject content -> out dir
 * The resulting folder has a Dockerfile and is ready for the Deployzy deploy
 * engine (push to a per-user repo or upload as build context).
 *
 * Usage:
 *   node build.mjs --generator portfolio \
 *     --prompt "portfolio for Ada, a fintech product designer in Lagos" \
 *     --out-dir ./out/ada-site
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

const generator = arg("--generator", "portfolio");
const prompt = arg("--prompt", "A portfolio for a developer");
const outDir = path.resolve(arg("--out-dir", path.join(__dirname, "out/site")));

const scaffold = path.join(__dirname, "scaffolds", generator);
if (!fs.existsSync(scaffold)) { console.error(`unknown generator: ${generator}`); process.exit(1); }

// 1) copy scaffold -> outDir (skip content.json; we regenerate it)
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(scaffold)) {
  if (f === "content.json") continue;
  fs.cpSync(path.join(scaffold, f), path.join(outDir, f), { recursive: true });
}

// 2) generate content.json into outDir (uses DEEPSEEK_API_KEY if set, else mock)
execFileSync(process.execPath, [
  path.join(__dirname, "generate.mjs"),
  "--prompt", prompt,
  "--out", path.join(outDir, "content.json"),
], { stdio: "inherit", env: process.env });

console.error(`\n✓ deploy-ready project at: ${outDir}`);
console.error(`  files: ${fs.readdirSync(outDir).join(", ")}`);
console.error(`  next: push to a repo or upload as build context -> deploy engine builds the Dockerfile`);
