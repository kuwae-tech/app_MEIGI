// main.js (CommonJS wrapper)
// - electron-builder が package.json の main=main.js を参照しても確実に存在するようにする
// - 実体は dist/main.js または src/main.js を優先して読み込む
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const candidates = [
  path.join(__dirname, "dist", "main.js"),
  path.join(__dirname, "src", "main.js"),
];

const target = candidates.find((p) => fs.existsSync(p));

if (!target) {
  // ここで落ちるなら「ビルドでdist/main.jsが生成されていない」か「src/main.jsが存在しない」
  // つまり、エントリの組み立てが壊れているので分かりやすく止める
  throw new Error(
    `[main.js] Could not find entry. Tried:\n- ${candidates.join("\n- ")}`
  );
}

// import() は CJS でも使える（ESM/CJSどちらの実体にも寄せられる）
(async () => {
  await import(pathToFileURL(target).href);
})().catch((e) => {
  console.error("[main.js] FATAL:", e);
  process.exit(1);
});
