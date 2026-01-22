import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listDirSafe(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function main() {
  const xlsxPkgJson = require.resolve("xlsx/package.json");
  const xlsxRoot = path.dirname(xlsxPkgJson);

  const destDir = path.join(process.cwd(), "renderer", "vendor");
  const destFile = path.join(destDir, "xlsx.full.min.js");

  await fs.mkdir(destDir, { recursive: true });

  const candidates = [
    path.join(xlsxRoot, "dist", "xlsx.full.min.js"),
    path.join(xlsxRoot, "dist", "xlsx.full.js"),
    path.join(xlsxRoot, "dist", "xlsx.core.min.js"),
    path.join(xlsxRoot, "dist", "xlsx.core.js"),
    path.join(xlsxRoot, "dist", "xlsx.mini.min.js"),
    path.join(xlsxRoot, "dist", "xlsx.mini.js"),
    path.join(xlsxRoot, "xlsx.full.min.js"),
    path.join(xlsxRoot, "xlsx.full.js"),
  ];

  let src = null;
  for (const c of candidates) {
    if (await exists(c)) {
      src = c;
      break;
    }
  }

  if (!src) {
    const distDir = path.join(xlsxRoot, "dist");
    if (await exists(distDir)) {
      const files = await listDirSafe(distDir);
      const jsFiles = files.filter((f) => f.toLowerCase().endsWith(".js"));

      const prefer = [
        "xlsx.full.min.js",
        "xlsx.full.js",
        "xlsx.core.min.js",
        "xlsx.core.js",
        "xlsx.mini.min.js",
        "xlsx.mini.js",
      ];

      for (const name of prefer) {
        const hit = jsFiles.find((f) => f.toLowerCase() === name);
        if (hit) {
          src = path.join(distDir, hit);
          break;
        }
      }

      if (!src) {
        const any = jsFiles.find((f) => f.toLowerCase().includes("xlsx"));
        if (any) src = path.join(distDir, any);
      }
    }
  }

  if (!src) {
    const distDir = path.join(xlsxRoot, "dist");
    const distFiles = await listDirSafe(distDir);
    const rootFiles = await listDirSafe(xlsxRoot);

    console.error("[sync-xlsx] ERROR: Could not find a distributable xlsx JS file to copy.");
    console.error(`[sync-xlsx] xlsxRoot: ${xlsxRoot}`);
    console.error(`[sync-xlsx] dist contents: ${distFiles.join(", ") || "(none)"}`);
    console.error(`[sync-xlsx] root contents: ${rootFiles.join(", ") || "(none)"}`);
    process.exit(1);
  }

  console.log(`[sync-xlsx] copy from: ${src}`);
  console.log(`[sync-xlsx] copy to  : ${destFile}`);

  await fs.copyFile(src, destFile);

  if (!fssync.existsSync(destFile)) {
    console.error("[sync-xlsx] ERROR: copy failed unexpectedly (dest missing).");
    process.exit(1);
  }

  console.log("[sync-xlsx] OK ✅");
}

main().catch((e) => {
  console.error("[sync-xlsx] FATAL:", e);
  process.exit(1);
});
