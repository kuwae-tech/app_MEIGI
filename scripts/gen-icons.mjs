import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const buildDir = path.join(root, 'build');
const pngPath = path.join(buildDir, 'icon.png');

await fs.mkdir(buildDir, { recursive: true });
const svg = await fs.readFile(svgPath, 'utf8');

const resvg = new Resvg(svg, {
  fitTo: {
    mode: 'width',
    value: 1024
  }
});
const pngBuffer = resvg.render().asPng();
await fs.writeFile(pngPath, pngBuffer);

const bin = path.join(root, 'node_modules', '.bin', 'eib');
const result = spawnSync(bin, ['-i', 'build/icon.png', '-o', 'build', '-f'], {
  cwd: root,
  stdio: 'inherit'
});

if (result.status !== 0) {
  throw new Error('eib failed');
}

console.log('[APP] icons generated');
