/**
 * scripts/sync-xlsx.mjs
 *
 * Purpose:
 * - Resolve installed `xlsx` package path
 * - Find a suitable browser bundle (prefer dist/xlsx.full.min.js)
 * - Copy it to renderer/vendor/xlsx.full.min.js so renderer can load locally (no CDN)
 *
 * This file MUST be valid ESM (because .mjs). Avoid `await` in non-async contexts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const require = createRequire(import.meta.url);

function log(...args) {
  console.log("[sync-xlsx]", ...args);
}
function fatal(...args) {
  console.error("[sync-xlsx] FATAL:", ...args);
  process.exit(1);
}
function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function resolveXlsxPackageJson() {
  // Works in ESM via createRequire
  return require.resolve("xlsx/package.json");
}

function pickBundle(xlsxPkgJsonPath) {
  const xlsxDir = path.dirname(xlsxPkgJsonPath);

  // Candidate bundles (prefer full/minified)
  const candidates = [
    path.join(xlsxDir, "dist", "xlsx.full.min.js"),
    path.join(xlsxDir, "dist", "xlsx.full.min.mjs"),
    path.join(xlsxDir, "dist", "xlsx.full.js"),
    path.join(xlsxDir, "dist", "xlsx.min.js"),
    path.join(xlsxDir, "dist", "xlsx.js"),
    // Fallbacks (some installs may expose directly)
    path.join(xlsxDir, "xlsx.full.min.js"),
    path.join(xlsxDir, "xlsx.min.js"),
    path.join(xlsxDir, "xlsx.js"),
  ];

  for (const p of candidates) {
    if (exists(p)) return p;
  }

  // As a last resort, scan dist/ for something that looks like a bundle
  const distDir = path.join(xlsxDir, "dist");
  if (exists(distDir)) {
    try {
      const files = fs.readdirSync(distDir);
      const scored = files
        .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
        .map((f) => {
          const full = path.join(distDir, f);
          // Score: prefer "full" and "min"
          let score = 0;
          if (f.includes("full")) score += 10;
          if (f.includes("min")) score += 5;
          if (f.includes("xlsx")) score += 2;
          return { full, score, f };
        })
        .sort((a, b) => b.score - a.score);
      if (scored[0]?.full && exists(scored[0].full)) return scored[0].full;
    } catch {
      // ignore
    }
  }

  return null;
}

function main() {
  let pkgJson;
  try {
    pkgJson = resolveXlsxPackageJson();
  } catch (e) {
    fatal("Cannot resolve 'xlsx/package.json'. Is 'xlsx' installed?", e?.message || e);
  }

  log("xlsx package.json:", pkgJson);

  const bundle = pickBundle(pkgJson);
  if (!bundle) {
    fatal(
      "Could not find an xlsx bundle under node_modules/xlsx. " +
        "Expected something like dist/xlsx.full.min.js"
    );
  }

  const vendorDir = path.join(REPO_ROOT, "renderer", "vendor");
  const outPath = path.join(vendorDir, "xlsx.full.min.js");

  ensureDir(vendorDir);

  fs.copyFileSync(bundle, outPath);
  log("Copied bundle:");
  log("  from:", bundle);
  log("  to  :", outPath);

  // Extra debug: ensure file exists and has some size
  try {
    const st = fs.statSync(outPath);
    log("Output size:", st.size, "bytes");
  } catch {
    // ignore
  }

  console.log("[APP] xlsx bundle copied");
}

main();
