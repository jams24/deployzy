# Deployzy (private monorepo)

Source for the hosted Deployzy platform at [deployzy.com](https://deployzy.com):
the Go API / tunnel server / deploy engine (`server/`), the Next.js dashboard and
marketing site (`web/`), and the client side (`cli/`, `proto/`, `npm-package/`,
`sdk-js/`, `sdk-python/`).

**This repository is private.** The client side is published to the public
mirror [jams24/deployzy-cli](https://github.com/jams24/deployzy-cli) on every
release by `scripts/sync-public.sh` (run from `.github/workflows/release.yml`).
Files that exist only in the public repo — its README, LICENSE, `go.work`,
`install.sh`, GoReleaser config and release workflow — live in `public/`.
Never put platform code, abuse-detection rules, or infra details under `public/`
or the client directories.

- Operating and deploying: [CLAUDE.md](CLAUDE.md), [RUNBOOK.md](RUNBOOK.md)
- Provisioning a new primary VPS: `deploy/install.sh` (clones this private repo,
  so it needs GitHub credentials on the box)
