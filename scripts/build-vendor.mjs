import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VENDOR_DIR = path.join(ROOT, "renderer", "vendor");
const XSLX_BUNDLE = path.join(VENDOR_DIR, "xlsx.full.min.js");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function main() {
  ensureDir(VENDOR_DIR);

  // sync-xlsx.mjs が先に走っている前提だが、念のため存在チェックだけして分かりやすく落とす
  if (!exists(XSLX_BUNDLE)) {
    console.error("[build-vendor] FATAL: xlsx vendor bundle missing:", XSLX_BUNDLE);
    console.error("[build-vendor] Run: node scripts/sync-xlsx.mjs");
    process.exit(1);
  }

  // ここに将来 vendor を増やす場合も “存在確認→生成/コピー” を追加していく
  console.log("[build-vendor] OK: vendor prepared:", VENDOR_DIR);
}

main();
