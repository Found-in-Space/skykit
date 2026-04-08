import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HA_PREVIEW_HEADER_BYTES,
  parseHaPreviewVolumeBuffer,
  resolveHaPreviewUrl,
} from './load-ha-preview-volume.js';

function makePreviewBuffer({ nx = 2, ny = 2, nz = 1, payload = null } = {}) {
  const voxels = payload ?? new Uint8Array(nx * ny * nz);
  const buf = new ArrayBuffer(HA_PREVIEW_HEADER_BYTES + voxels.byteLength);
  const dv = new DataView(buf);
  dv.setUint32(0, nx, true);
  dv.setUint32(4, ny, true);
  dv.setUint32(8, nz, true);
  dv.setFloat32(12, 1.0, true);
  dv.setFloat32(16, -1.5, true);
  dv.setFloat32(20, 1.5, true);
  dv.setFloat32(24, -2.5, true);
  dv.setFloat32(28, 2.5, true);
  dv.setFloat32(32, -3.5, true);
  dv.setFloat32(36, 3.5, true);
  new Uint8Array(buf, HA_PREVIEW_HEADER_BYTES).set(voxels);
  return buf;
}

test('parseHaPreviewVolumeBuffer reads the dense preview header and payload', () => {
  const payload = new Uint8Array([1, 2, 3, 4]);
  const parsed = parseHaPreviewVolumeBuffer(
    makePreviewBuffer({ nx: 2, ny: 2, nz: 1, payload }),
    { sourceUrl: '/preview.bin' },
  );

  assert.equal(parsed.nx, 2);
  assert.equal(parsed.ny, 2);
  assert.equal(parsed.nz, 1);
  assert.equal(parsed.scalarMax, 1);
  assert.equal(parsed.minX, -1.5);
  assert.equal(parsed.maxZ, 3.5);
  assert.equal(parsed.format, 'mccallum_ha_preview');
  assert.equal(parsed.frame, 'galactic');
  assert.deepEqual([...parsed.u8], [1, 2, 3, 4]);
});

test('parseHaPreviewVolumeBuffer rejects short files', () => {
  assert.throws(
    () => parseHaPreviewVolumeBuffer(new ArrayBuffer(4)),
    /File too small/,
  );
});

test('parseHaPreviewVolumeBuffer rejects HTML responses', () => {
  const buf = new TextEncoder().encode('<html></html>').buffer;
  assert.throws(
    () => parseHaPreviewVolumeBuffer(buf, { sourceUrl: '/preview.bin' }),
    /looks like HTML/,
  );
});

test('parseHaPreviewVolumeBuffer rejects mismatched file sizes', () => {
  const buf = makePreviewBuffer({ nx: 2, ny: 2, nz: 2, payload: new Uint8Array(8) });
  const truncated = buf.slice(0, buf.byteLength - 1);
  assert.throws(
    () => parseHaPreviewVolumeBuffer(truncated),
    /Unexpected H-alpha preview size/,
  );
});

test('resolveHaPreviewUrl supports haUrl query override', () => {
  assert.equal(
    resolveHaPreviewUrl('?haUrl=/custom/ha.bin'),
    '/custom/ha.bin',
  );
});
