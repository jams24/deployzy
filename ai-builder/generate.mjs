#!/usr/bin/env node
/**
 * AI Builder — Portfolio generator (v1, reusable pattern).
 *
 * prompt (+ optional facts) -> DeepSeek (constrained to portfolio.schema.json)
 *   -> validated content.json  -> merged into the scaffold -> deployed by the
 *      existing Deployzy deploy engine.
 *
 * The model NEVER writes code. It only fills the JSON schema. That is what makes
 * this cheap, safe, and reliable enough for non-technical users.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=... node generate.mjs --prompt "portfolio for a Lagos-based
 *     product designer named Ada who loves fintech" --out ./out/content.json
 *
 * Without a key it falls back to a deterministic mock so the pipeline is testable.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- args ----
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const generator = getArg("--generator", "portfolio");
const prompt = getArg("--prompt", "A portfolio for a full-stack developer");
const outPath = getArg("--out", path.join(__dirname, `scaffolds/${generator}/content.json`));

const HINTS = {
  portfolio: "You generate content for a personal PORTFOLIO website.",
  landing: "You generate content for a modern PRODUCT / SaaS LANDING PAGE. Make the headline benefit-driven and the features concrete. Only include pricing/testimonials/faq/metrics if the product warrants them.",
};
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, `schema/${generator}.schema.json`), "utf8"));

const SYSTEM = `${HINTS[generator] || HINTS.portfolio} You output ONLY a
single JSON object that strictly matches this JSON Schema — no markdown, no prose,
no code fences. Fill every required field with real, specific, human-sounding copy
based on the user's request. Write in the first person for "about". Keep it warm,
confident, and concrete — never generic AI filler like "passionate about leveraging
synergies". Pick an accent hex color that suits the person's field. If the user did
not give real project links, omit the "url" field rather than inventing one.

JSON Schema:
${JSON.stringify(SCHEMA, null, 2)}`;

async function generateWithDeepSeek(userPrompt) {
  const key = process.env.DEEPSEEK_API_KEY;
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  return JSON.parse(content);
}

// Deterministic offline fallback so the pipeline runs with no API key.
function mock(userPrompt) {
  const name = (userPrompt.match(/named\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) || [])[1] || "Alex Rivera";
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return {
    meta: { title: `${name} — Portfolio`, description: `Portfolio of ${name}. ${userPrompt.slice(0, 100)}` },
    theme: { accent: "#34d399", mode: "dark" },
    hero: { name, role: "Available for work", tagline: `Turning ideas into things people actually use.`, avatar_initials: initials },
    about: `Hi, I'm ${name}. This portfolio was generated from your prompt as a placeholder — add a DEEPSEEK_API_KEY to get real, tailored copy. The rest of the pipeline (render + deploy) is fully working.`,
    skills: ["JavaScript", "React", "Node.js", "Design", "Product"],
    projects: [
      { name: "Project One", description: "A short description of a thing you built and why it mattered.", tags: ["Web", "MVP"] },
      { name: "Project Two", description: "Another highlight — the kind the AI will write properly with a key.", tags: ["API"] },
    ],
    experience: [{ role: "Builder", org: "Independent", period: "Now", detail: "Shipping side projects." }],
    socials: [{ label: "GitHub", url: "https://github.com" }],
    contact: { cta: "Let's talk.", sub: "Add your email in the schema.", email: "" },
  };
}

// Light validation (required top-level fields) — enough to fail fast without deps.
function validate(obj) {
  for (const req of SCHEMA.required) {
    if (!(req in obj)) throw new Error(`generated content missing required field: ${req}`);
  }
  return obj;
}

(async () => {
  let content;
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      content = validate(await generateWithDeepSeek(prompt));
      console.error("✓ generated via DeepSeek");
    } catch (e) {
      console.error("DeepSeek failed, using mock:", e.message);
      content = mock(prompt);
    }
  } else {
    console.error("no DEEPSEEK_API_KEY — using deterministic mock");
    content = mock(prompt);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(content, null, 2));
  console.error(`✓ wrote ${outPath}`);
})();
