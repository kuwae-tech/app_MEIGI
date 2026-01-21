import fs from 'fs/promises';
import path from 'path';
import { build } from '@hunlongyu/electron-icon-builder';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const buildDir = path.join(root, 'build');
const outPng = path.join(buildDir, 'icon.png');

await fs.mkdir(buildDir, { recursive: true });

const svg = await fs.readFile(svgPath, 'utf8');
const resvg = new Resvg(svg, {
  fitTo: {
    mode: 'width',
    value: 1024,
  },
});
const pngData = resvg.render().asPng();
await fs.writeFile(outPng, pngData);

await build({
  input: outPng,
  output: buildDir,
  flatten: true,
});

console.log('[APP] icons generated');
