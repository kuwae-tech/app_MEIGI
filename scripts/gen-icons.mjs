import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';

const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
const svgPath = path.join(repoRoot, 'assets', 'icon.svg');
const buildDir = path.join(repoRoot, 'build');
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

const runEib = () =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['--no-install', 'eib', '--input', outPng, '--output', buildDir, '--flatten'],
      { stdio: 'inherit' }
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`eib failed with code ${code}`));
    });
  });

await runEib();

console.log('[APP] icons generated');
