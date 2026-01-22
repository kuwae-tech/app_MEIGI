// scripts/build-vendor.mjs
// Purpose: Ensure vendor assets exist for packaging/build.
// - Idempotent
// - Creates renderer/vendor
// - Ensures xlsx.full.min.js exists in renderer/vendor (copies from node_modules if needed)

import fs from "node:fs/promises";
import path from "node:path";

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyIfMissing(srcCandidates, dest) {
  if (await exists(dest)) return { ok: true, action: "skip", src: null };

  for (const src of srcCandidates) {
    if (await exists(src)) {
      await ensureDir(path.dirname(dest));
      await fs.copyFile(src, dest);
      return { ok: true, action: "copied", src };
    }
  }

  return { ok: false, action: "missing", src: null };
}

async function main() {
  const root = process.cwd();

  const vendorDir = path.join(root, "renderer", "vendor");
  await ensureDir(vendorDir);

  // Ensure xlsx bundle exists for renderer usage / packaging
  const xlsxDest = path.join(vendorDir, "xlsx.full.min.js");

  const xlsxCandidates = [
    path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.js"),
    path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.mjs"),
    path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.cjs"),
    path.join(root, "node_modules", "xlsx", "dist", "xlsx.full.min.js.map"),
    // fallbacks (some builds ship different names)
    path.join(root, "node_modules", "xlsx", "dist", "xlsx.min.js"),
    path.join(root, "node_modules", "xlsx", "xlsx.js"),
  ];

  const r = await copyIfMissing(xlsxCandidates, xlsxDest);

  if (!r.ok) {
    console.error("[build-vendor] FATAL: Could not find xlsx bundle to copy.");
    console.error("[build-vendor] Expected xlsx to be installed. Try:");
    console.error("  - Ensure package.json dependencies include \"xlsx\"");
    console.error("  - Re-generate package-lock.json and run npm ci");
    process.exit(1);
  }

  console.log(`[build-vendor] renderer/vendor ready: ${vendorDir}`);
  if (r.action === "copied") {
    console.log(`[build-vendor] xlsx bundle copied: ${r.src} -> ${xlsxDest}`);
  } else {
    console.log(`[build-vendor] xlsx bundle already present: ${xlsxDest}`);
  }
}

main().catch((e) => {
  console.error("[build-vendor] FATAL:", e?.stack || e);
  process.exit(1);
});
