#!/usr/bin/env sh
#
# ServerMe CLI Installer
#
# Usage:
#   curl -fsSL https://get.deployzy.com | sh
#   wget -qO- https://get.deployzy.com | sh
#
# Options:
#   SERVERME_VERSION=1.0.0  Install a specific version
#   SERVERME_DIR=/usr/local/bin  Install to a specific directory
#

set -e

VERSION="${SERVERME_VERSION:-latest}"
INSTALL_DIR="${SERVERME_DIR:-/usr/local/bin}"
GITHUB_REPO="serverme/serverme"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log() { printf "${GREEN}[serverme]${NC} %s\n" "$*"; }
err() { printf "${RED}[serverme]${NC} %s\n" "$*" >&2; }

# Detect OS
detect_os() {
  case "$(uname -s)" in
    Darwin*)  echo "darwin" ;;
    Linux*)   echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) err "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac
}

# Detect architecture
detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) err "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
}

# Detect download tool
detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    echo "curl"
  elif command -v wget >/dev/null 2>&1; then
    echo "wget"
  else
    err "Neither curl nor wget found. Please install one."
    exit 1
  fi
}

download() {
  url="$1"
  output="$2"
  case "$(detect_downloader)" in
    curl) curl -fsSL -o "$output" "$url" ;;
    wget) wget -qO "$output" "$url" ;;
  esac
}

main() {
  OS=$(detect_os)
  ARCH=$(detect_arch)
  DOWNLOADER=$(detect_downloader)

  printf "\n"
  printf "  ${BOLD}${CYAN}ServerMe CLI Installer${NC}\n"
  printf "  ${CYAN}─────────────────────────${NC}\n"
  printf "\n"
  printf "  OS:      %s\n" "$OS"
  printf "  Arch:    %s\n" "$ARCH"
  printf "  Version: %s\n" "$VERSION"
  printf "\n"

  # Resolve latest version
  if [ "$VERSION" = "latest" ]; then
    log "Checking latest version..."
    RELEASE_URL="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
    case "$DOWNLOADER" in
      curl) VERSION=$(curl -fsSL "$RELEASE_URL" 2>/dev/null | grep '"tag_name"' | sed 's/.*"v\(.*\)".*/\1/' || echo "") ;;
      wget) VERSION=$(wget -qO- "$RELEASE_URL" 2>/dev/null | grep '"tag_name"' | sed 's/.*"v\(.*\)".*/\1/' || echo "") ;;
    esac
    if [ -z "$VERSION" ]; then
      VERSION="1.0.0"
      log "Could not detect latest version, using v${VERSION}"
    fi
  fi

  # Download
  EXT="tar.gz"
  if [ "$OS" = "windows" ]; then
    EXT="zip"
  fi

  DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/serverme_${OS}_${ARCH}.${EXT}"
  TMPDIR=$(mktemp -d)
  ARCHIVE="${TMPDIR}/serverme.${EXT}"

  log "Downloading serverme v${VERSION}..."
  if ! download "$DOWNLOAD_URL" "$ARCHIVE" 2>/dev/null; then
    err "Download failed: $DOWNLOAD_URL"
    err ""
    err "The release may not exist yet. Try building from source:"
    err "  go install github.com/jams24/deployzy/cli/cmd/deployzy@latest"
    rm -rf "$TMPDIR"
    exit 1
  fi

  # Extract
  log "Extracting..."
  cd "$TMPDIR"
  if [ "$EXT" = "tar.gz" ]; then
    tar -xzf "$ARCHIVE" 2>/dev/null || {
      err "Extraction failed"
      rm -rf "$TMPDIR"
      exit 1
    }
  else
    unzip -q "$ARCHIVE" 2>/dev/null || {
      err "Extraction failed (install unzip)"
      rm -rf "$TMPDIR"
      exit 1
    }
  fi

  # Install
  BINARY="serverme"
  if [ "$OS" = "windows" ]; then
    BINARY="serverme.exe"
  fi

  if [ ! -f "$BINARY" ]; then
    err "Binary not found in archive"
    rm -rf "$TMPDIR"
    exit 1
  fi

  # Try to install to INSTALL_DIR, fall back to ~/.local/bin
  if [ -w "$INSTALL_DIR" ] || [ "$(id -u)" = "0" ]; then
    mkdir -p "$INSTALL_DIR"
    mv "$BINARY" "${INSTALL_DIR}/${BINARY}"
    chmod +x "${INSTALL_DIR}/${BINARY}"
    FINAL_PATH="${INSTALL_DIR}/${BINARY}"
  else
    LOCAL_BIN="$HOME/.local/bin"
    mkdir -p "$LOCAL_BIN"
    mv "$BINARY" "${LOCAL_BIN}/${BINARY}"
    chmod +x "${LOCAL_BIN}/${BINARY}"
    FINAL_PATH="${LOCAL_BIN}/${BINARY}"

    # Check if in PATH
    case ":$PATH:" in
      *":${LOCAL_BIN}:"*) ;;
      *)
        printf "\n"
        printf "  ${YELLOW}Add this to your shell profile:${NC}\n"
        printf "  export PATH=\"\$HOME/.local/bin:\$PATH\"\n"
        printf "\n"
        ;;
    esac
  fi

  rm -rf "$TMPDIR"

  # Verify
  if "$FINAL_PATH" version >/dev/null 2>&1; then
    INSTALLED_VERSION=$("$FINAL_PATH" version 2>&1 | head -1)
    printf "\n"
    printf "  ${GREEN}✓ ${BOLD}serverme installed successfully${NC}\n"
    printf "  ${GREEN}  ${INSTALLED_VERSION}${NC}\n"
    printf "  ${GREEN}  ${FINAL_PATH}${NC}\n"
  else
    log "Installed to ${FINAL_PATH}"
  fi

  printf "\n"
  printf "  ${BOLD}Quick start:${NC}\n"
  printf "\n"
  printf "    serverme authtoken YOUR_TOKEN\n"
  printf "    serverme http 3000\n"
  printf "\n"
  printf "  ${BOLD}Docs:${NC} https://deployzy.com/docs\n"
  printf "\n"
}

main
