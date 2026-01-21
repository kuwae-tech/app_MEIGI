import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import sharp from 'sharp';

const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
const require = createRequire(import.meta.url);
const svgPath = path.join(repoRoot, 'assets', 'icon.svg');
const buildDir = path.join(repoRoot, 'assets');
const inputPng = path.join(buildDir, 'icon.png');

const packageCandidates = [
  'electron-icon-builder/package.json',
  '@hunlongyu/electron-icon-builder/package.json',
];

let packagePath;
for (const candidate of packageCandidates) {
  try {
    packagePath = require.resolve(candidate);
    break;
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
  }
}

if (!packagePath) {
  throw new Error(
    'electron-icon-builder not found. Please install electron-icon-builder or @hunlongyu/electron-icon-builder.',
  );
}

const packageDir = path.dirname(packagePath);
const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const bin = packageJson?.bin;
let binEntry;

if (typeof bin === 'string') {
  binEntry = bin;
} else if (bin && typeof bin === 'object') {
  binEntry = bin.eib ?? Object.values(bin)[0];
}

if (!binEntry) {
  throw new Error(`Unable to resolve electron-icon-builder bin entry from ${packagePath}`);
}

const eibEntry = path.resolve(packageDir, binEntry);

console.log(`[icons] repoRoot=${repoRoot}`);
console.log(`[icons] eibEntry=${eibEntry}`);
console.log(`[icons] inputPng=${inputPng}`);
console.log(`[icons] outputDir=${buildDir}`);

await fs.mkdir(buildDir, { recursive: true });
await sharp(svgPath).resize(1024, 1024, { fit: 'contain' }).png().toFile(inputPng);

const args = [eibEntry, '--input', inputPng, '--output', buildDir, '--flatten'];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: repoRoot });

const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});

if (exitCode !== 0) {
  throw new Error(`electron-icon-builder exited with code ${exitCode}`);
}

console.log('[APP] icons generated');
