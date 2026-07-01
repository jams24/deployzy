#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

// Track this package's own version → downloads the matching vX.Y.Z release, so a
// version bump + tag automatically points the wrapper at the right binaries.
const VERSION = require("../package.json").version;
const GITHUB_REPO = "jams24/deployzy";

function getPlatform() {
  const platform = os.platform();
  const arch = os.arch();

  const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
  const archMap = { x64: "amd64", arm64: "arm64" };

  const goPlatform = platformMap[platform];
  const goArch = archMap[arch];

  if (!goPlatform || !goArch) {
    console.error(`Unsupported platform: ${platform}/${arch}`);
    process.exit(1);
  }

  return { platform: goPlatform, arch: goArch };
}

function getBinaryName(platform) {
  return platform === "windows" ? "deployzy.exe" : "deployzy";
}

// Single download attempt: follows redirects, times out a stalled connection.
function fetchBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "deployzy-cli-installer" } },
      (res) => {
        const { statusCode } = res;
        if (
          [301, 302, 303, 307, 308].includes(statusCode) &&
          res.headers.location
        ) {
          res.resume(); // drain
          if (redirects > 6) return reject(new Error("too many redirects"));
          return fetchBuffer(res.headers.location, redirects + 1).then(
            resolve,
            reject
          );
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode}: ${url}`));
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }
    );
    // Kill a stalled connection so the retry loop can take over.
    req.setTimeout(90000, () => req.destroy(new Error("download timed out")));
    req.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry the download a few times — transient network hiccups shouldn't break install.
async function downloadWithRetry(url, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetchBuffer(url);
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.log(
          `Download attempt ${i}/${attempts} failed (${err.message}); retrying...`
        );
        await sleep(1500 * i);
      }
    }
  }
  throw lastErr;
}

function extractUnix(data, binaryPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deployzy-"));
  const tarPath = path.join(tmpDir, "deployzy.tar.gz");
  fs.writeFileSync(tarPath, data);
  try {
    execSync(`tar -xzf "${tarPath}" -C "${tmpDir}"`, { stdio: "pipe" });
    const extracted = path.join(tmpDir, "deployzy");
    if (fs.existsSync(extracted)) {
      fs.copyFileSync(extracted, binaryPath);
      fs.chmodSync(binaryPath, 0o755);
    }
  } catch {
    // Fallback: node-native gunzip + minimal tar walk.
    const gunzipped = zlib.gunzipSync(data);
    let offset = 0;
    while (offset < gunzipped.length - 512) {
      const header = gunzipped.subarray(offset, offset + 512);
      const name = header.toString("utf8", 0, 100).replace(/\0/g, "");
      const sizeStr = header.toString("utf8", 124, 136).replace(/\0/g, "").trim();
      const size = parseInt(sizeStr, 8) || 0;
      if (name === "deployzy" || name === "./deployzy") {
        fs.writeFileSync(binaryPath, gunzipped.subarray(offset + 512, offset + 512 + size));
        fs.chmodSync(binaryPath, 0o755);
        break;
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function extractZip(data, binaryPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deployzy-"));
  const zipPath = path.join(tmpDir, "deployzy.zip");
  fs.writeFileSync(zipPath, data);
  try {
    // bsdtar (Windows 10+/macOS) extracts zip; fall back to PowerShell.
    try {
      execSync(`tar -xf "${zipPath}" -C "${tmpDir}"`, { stdio: "pipe" });
    } catch {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpDir}' -Force"`,
        { stdio: "pipe" }
      );
    }
    const extracted = path.join(tmpDir, "deployzy.exe");
    if (fs.existsSync(extracted)) fs.copyFileSync(extracted, binaryPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function install() {
  const { platform, arch } = getPlatform();
  const binaryName = getBinaryName(platform);
  const binaryPath = path.join(__dirname, binaryName);

  // Skip if a working binary is already present.
  if (fs.existsSync(binaryPath)) {
    try {
      execSync(`"${binaryPath}" version`, { stdio: "pipe" });
      console.log("deployzy already installed");
      return;
    } catch {
      // Corrupted binary — re-download.
    }
  }

  const ext = platform === "windows" ? "zip" : "tar.gz";
  const url = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/deployzy_${platform}_${arch}.${ext}`;

  console.log(`Downloading deployzy v${VERSION} for ${platform}/${arch}...`);

  try {
    const data = await downloadWithRetry(url);
    if (ext === "tar.gz") extractUnix(data, binaryPath);
    else extractZip(data, binaryPath);

    if (fs.existsSync(binaryPath)) {
      console.log(`deployzy v${VERSION} installed successfully`);
    } else {
      throw new Error("binary not found after extraction");
    }
  } catch (err) {
    console.error(`Failed to download deployzy: ${err.message}`);
    console.error("");
    console.error("You can install manually:");
    console.error("  go install github.com/jams24/deployzy/cli/cmd/deployzy@latest");
    console.error("  or download from: https://github.com/jams24/deployzy/releases");
    process.exit(1);
  }
}

install();
