import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const pngPath = path.join(root, 'assets', 'icon.png');
const outputDir = path.join(root, 'build');

const ensurePng = async () => {
  try {
    await fs.access(pngPath);
    return;
  } catch {
    const svg = await fs.readFile(svgPath);
    await sharp(svg)
      .resize(1024, 1024, { fit: 'contain' })
      .png()
      .toFile(pngPath);
  }
};

await ensurePng();
await fs.mkdir(outputDir, { recursive: true });

const bin = path.join(root, 'node_modules', '.bin', 'electron-icon-builder');
const result = spawnSync(bin, ['--input=assets/icon.png', '--output=build', '--flatten'], {
  cwd: root,
  stdio: 'inherit'
});

if (result.status !== 0) {
  throw new Error('electron-icon-builder failed');
}

console.log('[APP] icons generated');
