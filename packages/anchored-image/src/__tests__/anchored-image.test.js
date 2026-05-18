import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ANCHORED_IMAGE_MANIFEST_FORMAT,
  ANCHORED_IMAGE_MANIFEST_SCHEMA_ID,
  buildAnchoredImageDirectionResolver,
  icrsDirectionToTargetPc,
  loadAnchoredImageManifest,
  normalizeAnchoredImageManifest,
  solveAnchoredImage,
  solveAnchoredImageMesh,
  toRaDec,
} from '../index.js';

const LEGACY_MANIFEST = {
  id: 'western',
  constellations: [
    {
      id: 'CON western Ori',
      iau: 'Ori',
      common_name: { english: 'Hunter', native: 'Orion' },
      image: {
        file: 'illustrations/orion.webp',
        size: [100, 100],
        anchors: [
          { pos: [0, 0], hip: 1, direction: [1, 0, 0] },
          { pos: [100, 0], hip: 2, direction: [1, 1, 0] },
          { pos: [0, 100], hip: 3, direction: [1, 0, 1] },
        ],
      },
    },
    {
      id: 'vel-id',
      iau: 'Vel',
      common_name: { english: 'Sails', native: 'Vela' },
    },
  ],
};

test('loadAnchoredImageManifest normalizes legacy constellation manifests and resolves image URLs', async () => {
  const manifest = await loadAnchoredImageManifest({
    manifest: LEGACY_MANIFEST,
    manifestUrl: 'https://cdn.example.com/skyculture/dist/manifest.json',
  });

  assert.equal(manifest.id, 'western');
  assert.equal(manifest.format, ANCHORED_IMAGE_MANIFEST_FORMAT);
  assert.equal(manifest.images.length, 2);
  assert.equal(manifest.images[0].id, 'CON western Ori');
  assert.equal(manifest.images[0].groupId, 'Ori');
  assert.equal(manifest.images[0].label, 'Hunter');
  assert.equal(
    manifest.images[0].image.src,
    'https://cdn.example.com/skyculture/dist/illustrations/orion.webp',
  );
  assert.equal(manifest.images[0].image.anchors[0].pixel.x, 0);
  assert.equal(manifest.images[0].image.anchors[0].target.kind, 'direction');
  assert.equal(manifest.images[1].image.anchors.length, 0);
});

test('exports a versioned canonical manifest schema', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../../schemas/anchored-image-manifest.v1.schema.json', import.meta.url), 'utf8'));

  assert.equal(schema.$id, ANCHORED_IMAGE_MANIFEST_SCHEMA_ID);
  assert.equal(schema.properties.format.const, ANCHORED_IMAGE_MANIFEST_FORMAT);
  assert.equal(schema.required.includes('format'), true);
  assert.equal(schema.required.includes('images'), true);
});

test('solveAnchoredImageMesh creates default quads and subdivided generic meshes', () => {
  const manifest = normalizeAnchoredImageManifest(LEGACY_MANIFEST);
  const image = manifest.images[0];
  const solved = solveAnchoredImage(image);
  const center = solved?.targetAt({ x: 50, y: 50 });
  const quad = solveAnchoredImageMesh(image);
  const subdivided = solveAnchoredImageMesh(image, { subdivisions: 2 });

  assert.equal(solved?.targetKind, 'direction');
  assert.equal(center?.kind, 'direction');
  assert.ok(center && Math.abs(Math.hypot(center.x, center.y, center.z) - 1) < 1e-9);
  assert.equal(quad?.vertices.length, 4);
  assert.deepEqual(quad?.triangles, [[0, 1, 2], [0, 2, 3]]);
  assert.equal(subdivided?.vertices.length, 9);
  assert.equal(subdivided?.triangles.length, 8);
});

test('position anchors solve to spatial targets without forcing a sphere', () => {
  const mesh = solveAnchoredImageMesh({
    id: 'nebula-plate',
    image: {
      src: 'nebula.png',
      width: 100,
      height: 100,
      anchors: [
        { pixel: { x: 0, y: 0 }, target: { kind: 'position', frame: 'icrs-pc', x: 10, y: 0, z: 0 } },
        { pixel: { x: 100, y: 0 }, target: { kind: 'position', frame: 'icrs-pc', x: 20, y: 0, z: 0 } },
        { pixel: { x: 0, y: 100 }, target: { kind: 'position', frame: 'icrs-pc', x: 10, y: 10, z: 0 } },
      ],
    },
  });

  assert.equal(mesh?.vertices[2].target.kind, 'position');
  assert.deepEqual(mesh?.vertices[2].target, {
    kind: 'position',
    frame: 'icrs-pc',
    x: 20,
    y: 10,
    z: 0,
  });
});

test('direction resolver supports legacy lookup and target helpers', () => {
  const resolver = buildAnchoredImageDirectionResolver(LEGACY_MANIFEST);
  const resolved = resolver.resolve([1, 0.2, 0.2]);
  const list = resolver.listImages();
  const raDec = toRaDec([0, 1, 0]);
  const target = icrsDirectionToTargetPc([2, 0, 0], 50, { x: 1, y: 2, z: 3 });

  assert.equal(resolved?.iau, 'Ori');
  assert.equal(resolver.getImage('Hunter')?.iau, 'Ori');
  assert.equal(resolver.getImage('Orion')?.iau, 'Ori');
  assert.equal(list.length, 2);
  assert.equal(list[0].hasArt, true);
  assert.equal(list[1].hasArt, false);
  assert.equal(raDec?.raDeg, 90);
  assert.deepEqual(target, { x: 51, y: 2, z: 3 });
});
