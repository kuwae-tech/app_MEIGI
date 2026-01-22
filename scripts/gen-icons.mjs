import fs from "node:fs";
import path from "node:path";

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const repoRoot = process.cwd();
const assetsDir = path.join(repoRoot, "assets");

const icoPath = path.join(assetsDir, "icon.ico");
const icnsPath = path.join(assetsDir, "icon.icns");

console.log(`[gen-icons] repoRoot=${repoRoot}`);
console.log(`[gen-icons] assetsDir=${assetsDir}`);
console.log(`[gen-icons] icon.ico=${exists(icoPath) ? "OK" : "MISSING"}`);
console.log(`[gen-icons] icon.icns=${exists(icnsPath) ? "OK" : "MISSING"}`);

if (!exists(assetsDir)) {
  console.error(`[gen-icons] ERROR: assets/ directory not found at: ${assetsDir}`);
  process.exit(1);
}

/**
 * 最終方針:
 * - CI安定化のため icon.png 生成系に依存しない。
 * - assets/icon.ico と assets/icon.icns を“正”として扱い、両方あれば生成をスキップして成功終了。
 */
if (exists(icoPath) && exists(icnsPath)) {
  console.log("[gen-icons] Both icon.ico and icon.icns exist. Skipping generation. ✅");
  process.exit(0);
}

const missing = [];
if (!exists(icoPath)) missing.push("assets/icon.ico");
if (!exists(icnsPath)) missing.push("assets/icon.icns");

console.error("[gen-icons] ERROR: Missing required icon file(s): " + missing.join(", "));
console.error("[gen-icons] Fix: add the missing file(s) to assets/ and re-run CI.");
process.exit(1);
