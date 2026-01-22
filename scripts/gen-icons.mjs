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
const pngPath = path.join(assetsDir, "icon.png");

const hasAssetsDir = exists(assetsDir);
const hasIco = exists(icoPath);
const hasIcns = exists(icnsPath);

console.log(`[gen-icons] repoRoot=${repoRoot}`);
console.log(`[gen-icons] assetsDir=${assetsDir}`);
console.log(`[gen-icons] icon.ico=${hasIco ? "OK" : "MISSING"}`);
console.log(`[gen-icons] icon.icns=${hasIcns ? "OK" : "MISSING"}`);
console.log(`[gen-icons] icon.png=${exists(pngPath) ? "OK" : "MISSING"}`);

if (!hasAssetsDir) {
  console.error(`[gen-icons] ERROR: assets/ directory not found at: ${assetsDir}`);
  process.exit(1);
}

/**
 * CI安定化方針:
 * - 既に assets/icon.ico と assets/icon.icns をコミットしている運用を「正」とする。
 * - icon.png から生成する処理は再発要因になりやすいので、ここでは行わない。
 * - もし ico / icns のどちらかが無い場合は、明確なメッセージで失敗させる（ユーザーがファイルを用意可能）。
 */
if (hasIco && hasIcns) {
  console.log("[gen-icons] Both icon.ico and icon.icns exist. Skipping generation. ✅");
  process.exit(0);
}

const missing = [];
if (!hasIco) missing.push("assets/icon.ico");
if (!hasIcns) missing.push("assets/icon.icns");

console.error("[gen-icons] ERROR: Missing required icon file(s): " + missing.join(", "));
console.error("[gen-icons] Fix: add the missing file(s) to assets/ (recommended), then re-run CI.");
console.error("[gen-icons] Optional: you may also provide assets/icon.png (1024x1024) if you want to regenerate icons later, but CI will not require it.");
process.exit(1);
