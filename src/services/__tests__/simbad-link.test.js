import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSimbadBasicSearch } from '../simbad-link.js';

test('buildSimbadBasicSearch prefers HIP over Gaia', () => {
  const r = buildSimbadBasicSearch({
    hip: '27989',
    gaia: '3131481481815810432',
  });
  const u = new URL(r.url);
  assert.equal(u.hostname, 'simbad.cds.unistra.fr');
  assert.ok(u.pathname.includes('sim-id'));
  assert.equal(u.searchParams.get('NbIdent'), '1');
  assert.equal(u.searchParams.get('Ident'), 'HIP 27989');
  assert.equal(u.searchParams.get('Radius.unit'), 'arcmin');
  assert.equal(r.label, 'HIP 27989');
});

test('buildSimbadBasicSearch ignores HD and still uses HIP', () => {
  const r = buildSimbadBasicSearch({
    hd: '39801',
    hip: '27989',
    gaia: '3131481481815810432',
  });
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('Ident'), 'HIP 27989');
  assert.equal(r.label, 'HIP 27989');
});

test('buildSimbadBasicSearch returns null when only HD is present', () => {
  assert.equal(buildSimbadBasicSearch({ hd: '39801' }), null);
});

test('buildSimbadBasicSearch uses Gaia when no HIP', () => {
  const r = buildSimbadBasicSearch({ gaia: '3131481481815810432' });
  const u = new URL(r.url);
  assert.ok(u.pathname.includes('sim-id'));
  assert.equal(u.searchParams.get('Ident'), 'Gaia DR3 3131481481815810432');
  assert.equal(r.label, 'Gaia DR3 3131481481815810432');
});

test('buildSimbadBasicSearch returns null without HIP or Gaia', () => {
  assert.equal(buildSimbadBasicSearch({}), null);
  assert.equal(buildSimbadBasicSearch(null), null);
});
