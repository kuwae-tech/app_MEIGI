import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');
const dest = path.join(root, 'renderer', 'vendor', 'xlsx.full.min.js');

await fs.copyFile(source, dest);
console.log('[APP] xlsx bundle copied');
