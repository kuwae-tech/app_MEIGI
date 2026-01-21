import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = require.resolve('@supabase/supabase-js');
const outFile = path.join(root, 'renderer', 'vendor', 'supabase.bundle.js');

await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'supabase',
  target: ['es2018'],
  platform: 'browser',
  outfile: outFile
});

console.log('[APP] supabase bundle generated');
