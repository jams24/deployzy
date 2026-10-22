#!/usr/bin/env bash
#
# Mirror the open-source client side of Deployzy into the public repo
# jams24/deployzy-cli. The monorepo stays private and is the source of truth.
#
# What gets published (tracked files only, at REF):
#   cli/ proto/ npm-package/ sdk-js/ sdk-python/   — as-is
#   public/*                                      — copied to the repo root
#                                                   (README, LICENSE, go.work,
#                                                   install.sh, .goreleaser.yml,
#                                                   .github/workflows/release.yml)
#
# Usage:
#   scripts/sync-public.sh            # sync HEAD, no tag
#   scripts/sync-public.sh v1.2.0     # sync that tag and push the tag too;
#                                     # the tag starts the public release CI
#
# Env:
#   PUBLIC_REPO_URL   push URL (CI passes one with a token in it)
#   DRY_RUN=1         build the tree and show the diff, push nothing

set -euo pipefail

TAG="${1:-}"
REF="${TAG:-HEAD}"
URL="${PUBLIC_REPO_URL:-https://github.com/jams24/deployzy-cli.git}"
ROOT="$(git rev-parse --show-toplevel)"
PUBLIC_DIRS=(cli proto npm-package sdk-js sdk-python)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$WORK/repo"

git clone --quiet "$URL" "$OUT" 2>/dev/null || {
  echo "clone failed: $URL" >&2
  exit 1
}
git -C "$OUT" checkout -q -B main

# Start from an empty tree so files deleted upstream disappear here too.
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git -C "$ROOT" archive "$REF" "${PUBLIC_DIRS[@]}" | tar -x -C "$OUT"
git -C "$ROOT" archive "$REF" public | tar -x -C "$OUT" --strip-components=1

# Guard: nothing private may ride along. Fail closed.
# grep exits 0 = match, 1 = clean, 2 = error; an error must not read as clean.
set +e
leaks="$(grep -rIlE --exclude-dir=.git -e '-----BEGIN [A-Z ]*PRIVATE KEY|PGPASSWORD=|sk_live_|wk_live_' "$OUT")"
rc=$?
# Any IPv4 literal other than loopback / 0.0.0.0 (server IPs belong in private infra only).
ips="$(grep -rIohE --exclude-dir=.git -e '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' "$OUT")"
irc=$?
set -e
if (( irc > 1 )); then rc=$irc; fi
ips="$(printf '%s\n' "$ips" | grep -vE '^(127\.|0\.0\.0\.0$)' | grep -v '^$' || true)"
if [[ -n "$ips" ]]; then
  echo "refusing to publish — IP address literal(s): $(echo $ips | tr '\n' ' ')" >&2
  exit 1
fi
if (( rc > 1 )); then
  echo "refusing to publish — the leak scan itself failed (grep exit $rc)" >&2
  exit 1
fi
if (( rc == 0 )); then
  echo "refusing to publish — secret-looking content in:" >&2
  echo "$leaks" >&2
  exit 1
fi
for d in server web deploy secrets scripts ai-builder texis-bot; do
  if [[ -e "$OUT/$d" ]]; then
    echo "refusing to publish — private directory $d/ in the tree" >&2
    exit 1
  fi
done

SHA="$(git -C "$ROOT" rev-parse --short "$REF^{commit}")"
git -C "$OUT" add -A
if git -C "$OUT" diff --cached --quiet; then
  echo "no changes since the last sync"
else
  git -C "$OUT" -c user.name="Deployzy" -c user.email="support@deployzy.com" \
    commit -q -m "${TAG:-sync}: from deployzy@${SHA}"
fi

if [[ "${DRY_RUN:-}" == "1" ]]; then
  git -C "$OUT" show --stat --oneline HEAD | head -60
  echo "(dry run — nothing pushed)"
  exit 0
fi

git -C "$OUT" push -q origin main
if [[ -n "$TAG" ]]; then
  git -C "$OUT" tag "$TAG"
  git -C "$OUT" push -q origin "refs/tags/$TAG"
fi
echo "synced deployzy@${SHA} → ${URL%%\?*}${TAG:+ (tag $TAG)}" | sed -E 's#//[^@/]+@#//#'
