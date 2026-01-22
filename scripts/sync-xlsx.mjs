import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VENDOR_DIR = path.join(ROOT, "renderer", "vendor");
const OUT = path.join(VENDOR_DIR, "xlsx.full.min.js");

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function tryResolveXlsx() {
  // require.resolve を使いたいが、mjs なので createRequire を使う
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  return require.resolve("xlsx");
}

async function main() {
  ensureDir(VENDOR_DIR);

  let xlsxEntry;
  try {
    xlsxEntry = await tryResolveXlsx();
  } catch (e) {
    console.error("[sync-xlsx] FATAL: require.resolve('xlsx') failed.");
    console.error(e);
    process.exit(1);
  }

  const xlsxDir = path.dirname(xlsxEntry); // .../node_modules/xlsx/
  const candidates = [
    path.join(xlsxDir, "dist", "xlsx.full.min.js"),
    path.join(xlsxDir, "dist", "xlsx.full.min.mjs"),
    path.join(xlsxDir, "dist", "xlsx.full.js"),
    path.join(xlsxDir, "dist", "xlsx.min.js"),
    path.join(xlsxDir, "xlsx.full.min.js"),
    path.join(xlsxDir, "xlsx.full.js"),
    path.join(xlsxDir, "xlsx.js"),
  ];

  const found = candidates.find(exists);
  if (!found) {
    console.error("[sync-xlsx] FATAL: Could not find any xlsx bundle candidate.");
    console.error("[sync-xlsx] Looked for:", candidates);
    process.exit(1);
  }

  fs.copyFileSync(found, OUT);
  console.log("[APP] xlsx bundle copied:", found, "->", OUT);
}

main().catch((e) => {
  console.error("[sync-xlsx] FATAL:", e);
  process.exit(1);
});
