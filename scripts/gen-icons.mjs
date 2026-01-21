import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

const root = process.cwd();

// 既存構成に合わせて「assets/icon.png」を入力にする（無ければエラーにする）
const inputPng = path.join(root, "assets", "icon.png");
if (!exists(inputPng)) {
  console.error(`[gen-icons] missing input: ${inputPng}`);
  console.error(`[gen-icons] Put your source icon at assets/icon.png`);
  process.exit(1);
}

const outDir = path.join(root, "assets");
const bin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-icon-builder.cmd" : "electron-icon-builder"
);

if (!exists(bin)) {
  console.error(`[gen-icons] electron-icon-builder not found: ${bin}`);
  console.error(`[gen-icons] Did you run npm install?`);
  process.exit(1);
}

// electron-icon-builder は output 配下に icons/ を作り、--flatten で icons/直下に ico/icns を置ける
// 例: assets/icons/icon.ico, assets/icons/icon.icns
const args = ["--input", inputPng, "--output", outDir, "--flatten"];

console.log(`[gen-icons] ${bin} ${args.join(" ")}`);
const r = spawnSync(bin, args, { stdio: "inherit" });

if (r.status !== 0) {
  process.exit(r.status ?? 1);
}

const outIco = path.join(outDir, "icons", "icon.ico");
const outIcns = path.join(outDir, "icons", "icon.icns");

if (!exists(outIco) || !exists(outIcns)) {
  console.error("[gen-icons] icon generation finished but outputs are missing:");
  console.error(`- ${outIco} : ${exists(outIco) ? "OK" : "MISSING"}`);
  console.error(`- ${outIcns} : ${exists(outIcns) ? "OK" : "MISSING"}`);
  process.exit(1);
}

console.log("[gen-icons] OK:", outIco, outIcns);
