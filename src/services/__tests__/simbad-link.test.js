import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSimbadBasicSearch } from '../simbad-link.js';

test('buildSimbadBasicSearch prefers HIP over Gaia', () => {
  const r = buildSimbadBasicSearch({ hip: '27989', gaia: '3131481481815810432' });
  assert.ok(r.url.includes('HIP'));
  assert.ok(r.url.includes('27989'));
  assert.equal(r.label, 'HIP 27989');
  assert.ok(!r.url.includes('3131481481815810432'));
});

test('buildSimbadBasicSearch uses Gaia when no HIP', () => {
  const r = buildSimbadBasicSearch({ gaia: '3131481481815810432' });
  assert.match(r.url, /Ident=/);
  assert.ok(decodeURIComponent(r.url).includes('Gaia DR3 3131481481815810432'));
  assert.equal(r.label, 'Gaia DR3 3131481481815810432');
});

test('buildSimbadBasicSearch returns null without HIP or Gaia', () => {
  assert.equal(buildSimbadBasicSearch({}), null);
  assert.equal(buildSimbadBasicSearch(null), null);
});
