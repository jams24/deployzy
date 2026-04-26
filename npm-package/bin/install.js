#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");

const VERSION = "1.0.14";
const GITHUB_REPO = "jams24/serverme";

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
  return platform === "windows" ? "serverme.exe" : "serverme";
}

async function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return download(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function install() {
  const { platform, arch } = getPlatform();
  const binaryName = getBinaryName(platform);
  const binDir = path.join(__dirname);
  const binaryPath = path.join(binDir, binaryName);

  // Skip if already installed
  if (fs.existsSync(binaryPath)) {
    try {
      execSync(`"${binaryPath}" version`, { stdio: "pipe" });
      console.log("serverme already installed");
      return;
    } catch {
      // Corrupted binary, re-download
    }
  }

  const ext = platform === "windows" ? "zip" : "tar.gz";
  const url = `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/serverme_${platform}_${arch}.${ext}`;

  console.log(`Downloading serverme v${VERSION} for ${platform}/${arch}...`);

  try {
    const data = await download(url);

    if (ext === "tar.gz") {
      // Extract tar.gz
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "serverme-"));
      const tarPath = path.join(tmpDir, "serverme.tar.gz");
      fs.writeFileSync(tarPath, data);

      try {
        execSync(`tar -xzf "${tarPath}" -C "${tmpDir}"`, { stdio: "pipe" });
        const extracted = path.join(tmpDir, "serverme");
        if (fs.existsSync(extracted)) {
          fs.copyFileSync(extracted, binaryPath);
          fs.chmodSync(binaryPath, 0o755);
        }
      } catch {
        // tar failed, try node-native gunzip
        console.log("Extracting with Node.js...");
        const gunzipped = zlib.gunzipSync(data);
        // Simple tar extraction — find the binary in the tar
        // Tar header: 512-byte blocks, filename at offset 0, size at offset 124
        let offset = 0;
        while (offset < gunzipped.length - 512) {
          const header = gunzipped.subarray(offset, offset + 512);
          const name = header.toString("utf8", 0, 100).replace(/\0/g, "");
          const sizeStr = header.toString("utf8", 124, 136).replace(/\0/g, "").trim();
          const size = parseInt(sizeStr, 8) || 0;

          if (name === "serverme" || name === "./serverme") {
            const fileData = gunzipped.subarray(offset + 512, offset + 512 + size);
            fs.writeFileSync(binaryPath, fileData);
            fs.chmodSync(binaryPath, 0o755);
            break;
          }

          offset += 512 + Math.ceil(size / 512) * 512;
        }
      }

      fs.rmSync(tmpDir, { recursive: true, force: true });
    } else {
      // ZIP (Windows) — just write the data, user needs to handle
      fs.writeFileSync(binaryPath, data);
    }

    if (fs.existsSync(binaryPath)) {
      console.log(`serverme v${VERSION} installed successfully`);
    } else {
      throw new Error("Binary not found after extraction");
    }
  } catch (err) {
    console.error(`Failed to download serverme: ${err.message}`);
    console.error("");
    console.error("You can install manually:");
    console.error(
      "  go install github.com/jams24/serverme/cli/cmd/serverme@latest"
    );
    console.error("  or visit: https://github.com/jams24/serverme/releases");
    process.exit(1);
  }
}

install();
