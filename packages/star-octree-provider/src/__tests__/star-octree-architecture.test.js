import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const GUARDED_FILES = [
  '../star-octree-demand-gate.js',
  '../star-octree-pipeline.js',
  '../star-octree-provider-session.js',
  '../star-octree-strategies.js',
];

const FORBIDDEN_PATTERNS = [
  /\bstrategy\s*\.\s*kind\b/,
  /\bstrategy\s*\?\.\s*kind\b/,
  /switch\s*\([^)]*\bstrategy\b[^)]*\)/,
  /\bkind\s*===\s*['"`](observer-shell|target-frustum|sphere-volume|path-volume|motion-lookahead|composite)['"`]/,
  /\bkind\s*!==\s*['"`](observer-shell|target-frustum|sphere-volume|path-volume|motion-lookahead|composite)['"`]/,
];

test('provider planning code does not dispatch on strategy names', async () => {
  for (const relativePath of GUARDED_FILES) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      assert.equal(
        pattern.test(source),
        false,
        `${relativePath} matches forbidden strategy dispatch pattern ${pattern}`,
      );
    }
  }
});
