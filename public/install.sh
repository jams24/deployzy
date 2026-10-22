#!/usr/bin/env sh
#
# Deployzy CLI installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jams24/deployzy-cli/main/install.sh | sh
#
# Options:
#   DEPLOYZY_VERSION=1.2.0        Install a specific version (default: latest)
#   DEPLOYZY_DIR=/usr/local/bin   Install directory
#

set -e

VERSION="${DEPLOYZY_VERSION:-latest}"
INSTALL_DIR="${DEPLOYZY_DIR:-/usr/local/bin}"
GITHUB_REPO="jams24/deployzy-cli"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log() { printf "${GREEN}[deployzy]${NC} %s\n" "$*"; }
err() { printf "${RED}[deployzy]${NC} %s\n" "$*" >&2; }

detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "darwin" ;;
    Linux*)  echo "linux" ;;
    *) err "Unsupported OS: $(uname -s) — on Windows use: npm i -g deployzy"; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) err "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
}

fetch() { # fetch URL OUTPUT  (OUTPUT "-" = stdout)
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    err "Neither curl nor wget found. Please install one."
    exit 1
  fi
}

main() {
  OS=$(detect_os)
  ARCH=$(detect_arch)

  printf "\n  ${BOLD}${CYAN}Deployzy CLI installer${NC}\n\n"

  if [ "$VERSION" = "latest" ]; then
    VERSION=$(fetch "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" - 2>/dev/null \
      | grep '"tag_name"' | sed 's/.*"v\(.*\)".*/\1/' || true)
    if [ -z "$VERSION" ]; then
      err "Could not detect the latest version. Set DEPLOYZY_VERSION, or use: npm i -g deployzy"
      exit 1
    fi
  fi

  URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/deployzy_${OS}_${ARCH}.tar.gz"
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  log "Downloading deployzy v${VERSION} (${OS}/${ARCH})..."
  if ! fetch "$URL" "$TMP/deployzy.tar.gz"; then
    err "Download failed: $URL"
    exit 1
  fi
  tar -xzf "$TMP/deployzy.tar.gz" -C "$TMP"

  if [ -w "$INSTALL_DIR" ]; then
    mv "$TMP/deployzy" "$INSTALL_DIR/deployzy"
  else
    log "Installing to ${INSTALL_DIR} (needs sudo)..."
    sudo mv "$TMP/deployzy" "$INSTALL_DIR/deployzy"
  fi
  chmod +x "$INSTALL_DIR/deployzy"

  log "Installed: $("$INSTALL_DIR/deployzy" version 2>/dev/null || echo "$INSTALL_DIR/deployzy")"
  printf "\n  Get started:  ${BOLD}deployzy login${NC}  then  ${BOLD}deployzy http 3000${NC}\n\n"
}

main
