import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parsePerformanceDates } = require('../renderer/dateUtils.js');

const cases = [
  {
    input: '2026/03/20,21',
    expected: ['2026-03-20', '2026-03-21']
  },
  {
    input: '2026/03/20,3/21',
    expected: ['2026-03-20', '2026-03-21']
  },
  {
    input: '2026/12/30,31,1/2',
    expected: ['2026-12-30', '2026-12-31', '2027-01-02']
  },
  {
    input: '2026-12-30,2026-12-31,1/1',
    expected: ['2026-12-30', '2026-12-31', '2027-01-01']
  },
  {
    input: ' 2026/01/24 ',
    expected: ['2026-01-24']
  }
];

let failed = 0;
for (const entry of cases) {
  const result = parsePerformanceDates(entry.input);
  try {
    assert.deepEqual(result.isoDates, entry.expected);
    console.log(`OK: ${entry.input} -> ${JSON.stringify(result.isoDates)}`);
  } catch (error) {
    failed += 1;
    console.error(`NG: ${entry.input} -> ${JSON.stringify(result.isoDates)} expected ${JSON.stringify(entry.expected)}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('All date parse tests passed.');
}
