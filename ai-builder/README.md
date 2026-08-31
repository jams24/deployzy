# Deployzy AI Builder

Turn a plain-English prompt into a **live, deployed** site — for non-technical users.
The reusable pattern proven here with the **Portfolio** generator; every other
generator (landing page, Telegram bot, blog, …) is a copy of this shape.

## The core idea: fill a schema, never write code

The AI does **not** generate application code. It fills a strict JSON schema that
maps to a scaffold *you* own and maintain. That's what makes it cheap, reliable,
and safe enough for non-technical users (and hard to abuse — the model can only
fill your templates, not emit an arbitrary phishing login page).

```
prompt ──▶ DeepSeek (constrained to schema/<generator>.schema.json)
        ──▶ content.json  (validated)
        ──▶ copy scaffold + inject content.json   [build.mjs]
        ──▶ deploy-ready folder (has a Dockerfile)
        ──▶ EXISTING Deployzy deploy engine builds + deploys
        ──▶ live subdomain + TLS  (+ managed DB via provisionServiceContainerOn if the scaffold needs one)
        ──▶ idle-sleep reclaims it when unused
```

Only the thin AI layer is new. Everything after `content.json` is the platform
you already built.

## Files

| Path | What it is |
|------|-----------|
| `scaffolds/portfolio/` | The deployable static site. Renders 100% from `content.json`. Has a `Dockerfile` (nginx). |
| `schema/portfolio.schema.json` | The **only** thing the AI fills. Doubles as the structured-output contract. |
| `generate.mjs` | prompt → DeepSeek (`response_format: json_object`) → validated `content.json`. Falls back to a deterministic **mock** when `DEEPSEEK_API_KEY` is unset, so the pipeline is testable offline. |
| `build.mjs` | Assembles a deploy-ready folder: copies the scaffold + injects generated `content.json`. |

## Try it

```bash
cd ai-builder
# offline (mock copy):
node build.mjs --generator portfolio \
  --prompt "portfolio for Ada, a fintech product designer in Lagos" \
  --out-dir ./out/ada-site

# real AI copy:
export DEEPSEEK_API_KEY=sk-...
node build.mjs --generator portfolio --prompt "..." --out-dir ./out/ada-site
```

`out/ada-site/` is then ready for the deploy engine (push to a per-user repo, or
upload as build context — same path as `deployzy deploy ./`).

## Cost (DeepSeek V3, ~$0.27/M in · ~$1.10/M out)
Per generation ≈ 3–5K input (docs cached) + 1–2K output ⇒ **well under $0.01**,
even with regenerations. The real cost is the *deployed container*, which is why
free-tier generated sites must idle-sleep aggressively.

## Adding a new generator
1. `scaffolds/<name>/` — a data-driven scaffold with a `Dockerfile`.
2. `schema/<name>.schema.json` — what the AI may fill.
3. That's it — `build.mjs --generator <name>` works. Point `generate.mjs`'s
   system prompt at the new schema (or make it schema-driven per generator).

## Guardrails before opening to the public
- **Capacity**: only one worker has room today; an AI builder is a deploy
  firehose. Gate free builds + rely on idle-sleep + plan limits.
- **Abuse**: scaffold-only generation already limits phishing. Add content
  moderation on generated copy, the tunnel/deploy interstitial, Google Safe
  Browsing on new hostnames, and per-account build rate limits **before** launch.
- **Roadmap order**: portfolio → landing → Telegram bot → blog → (ecommerce last,
  paid-only, because payments/auth are where AI code fails and users can't debug).
