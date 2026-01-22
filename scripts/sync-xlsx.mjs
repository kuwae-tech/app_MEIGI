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

// node_modules/xlsx 配下のルートを、xlsxエントリから確実に推定する
function inferXlsxRootFromEntry(entryPath) {
  // entryPath はだいたい:
  //   .../node_modules/xlsx/xlsx.js
  //   .../node_modules/xlsx/dist/xlsx.full.min.js
  // など。そこから node_modules/xlsx を探して切り出す。
  const norm = entryPath.split(path.sep).join(path.sep);
  const marker = `${path.sep}node_modules${path.sep}xlsx${path.sep}`;
  const idx = norm.lastIndexOf(marker);
  if (idx >= 0) {
    return norm.slice(0, idx + marker.length - 1); // 末尾の path.sep を除去した形
  }
  // フォールバック：2階層上をルートっぽく見る
  return path.dirname(path.dirname(entryPath));
}

async function main() {
  let xlsxEntry;
  try {
    xlsxEntry = require.resolve("xlsx"); // ← package.json サブパスをやめる
  } catch (e) {
    console.error("[sync-xlsx] FATAL: require.resolve('xlsx') failed.");
    console.error(e);
    process.exit(1);
  }

  const xlsxRoot = inferXlsxRootFromEntry(xlsxEntry);

  const destDir = path.join(process.cwd(), "renderer", "vendor");
  const destFile = path.join(destDir, "xlsx.full.min.js");
  await fs.mkdir(destDir, { recursive: true });

  console.log(`[sync-xlsx] xlsx entry : ${xlsxEntry}`);
  console.log(`[sync-xlsx] xlsx root  : ${xlsxRoot}`);

  const candidates = [
    path.join(xlsxRoot, "dist", "xlsx.full.min.js"),
    path.join(xlsxRoot, "dist", "xlsx.full.js"),
    path.join(xlsxRoot, "dist", "xlsx.core.min.js"),
    path.join(xlsxRoot, "dist", "xlsx.core.js"),
    path.join(xlsxRoot, "dist", "xlsx.mini.min.js"),
    path.join(xlsxRoot, "dist", "xlsx.mini.js"),
    path.join(xlsxRoot, "xlsx.full.min.js"),
    path.join(xlsxRoot, "xlsx.full.js"),
    // もし entry 自体がdist配下なら、それも候補に入れる
    xlsxEntry,
  ];

  let src = null;
  for (const c of candidates) {
    if (await exists(c)) {
      src = c;
      break;
    }
  }

  // dist配下をスキャンしてフォールバック
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
    console.error(`[sync-xlsx] xlsxEntry: ${xlsxEntry}`);
    console.error(`[sync-xlsx] xlsxRoot : ${xlsxRoot}`);
    console.error(`[sync-xlsx] tried candidates:\n  - ${candidates.join("\n  - ")}`);
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
