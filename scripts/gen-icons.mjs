import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import toIco from 'to-ico';
import pngToIcns from 'png-to-icns';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const svgPath = path.join(root, 'assets', 'icon.svg');
const outIco = path.join(root, 'assets', 'icon.ico');
const outIcns = path.join(root, 'assets', 'icon.icns');
const sizes = [16, 32, 64, 128, 256, 512];

const svg = await fs.readFile(svgPath);
const pngBuffers = [];

for (const size of sizes) {
  const buffer = await sharp(svg)
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer();
  pngBuffers.push(buffer);
}

const icoBuffer = await toIco(pngBuffers);
await fs.writeFile(outIco, icoBuffer);

const icnsBuffer = await pngToIcns(pngBuffers);
await fs.writeFile(outIcns, icnsBuffer);

console.log('[APP] icons generated');
