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

const MANIFEST = {
  format: ANCHORED_IMAGE_MANIFEST_FORMAT,
  id: 'western',
  label: 'Western plates',
  images: [
    {
      id: 'orion-art',
      groupId: 'Ori',
      label: 'Orion',
      image: {
        src: 'illustrations/orion.webp',
        width: 100,
        height: 100,
        anchors: [
          { pixel: { x: 0, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 0 } },
          { pixel: { x: 100, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 1, z: 0 } },
          { pixel: { x: 0, y: 100 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 1 } },
        ],
      },
    },
    {
      id: 'vel-id',
      groupId: 'Vel',
      label: 'Vela',
      image: {
        src: '',
        width: 100,
        height: 100,
        anchors: [],
      },
    },
  ],
};

test('loadAnchoredImageManifest normalizes canonical manifests and resolves image URLs', async () => {
  const manifest = await loadAnchoredImageManifest({
    manifest: MANIFEST,
    manifestUrl: 'https://cdn.example.com/skyculture/dist/manifest.json',
  });

  assert.equal(manifest.id, 'western');
  assert.equal(manifest.format, ANCHORED_IMAGE_MANIFEST_FORMAT);
  assert.equal(manifest.label, 'Western plates');
  assert.equal(manifest.images.length, 2);
  assert.equal(manifest.images[0].id, 'orion-art');
  assert.equal(manifest.images[0].groupId, 'Ori');
  assert.equal(manifest.images[0].label, 'Orion');
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
  const manifest = normalizeAnchoredImageManifest(MANIFEST);
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

test('direction resolver supports generic lookup and target helpers', () => {
  const resolver = buildAnchoredImageDirectionResolver(MANIFEST);
  const resolved = resolver.resolve([1, 0.2, 0.2]);
  const list = resolver.listImages();
  const raDec = toRaDec([0, 1, 0]);
  const target = icrsDirectionToTargetPc([2, 0, 0], 50, { x: 1, y: 2, z: 3 });

  assert.equal(resolved?.groupId, 'Ori');
  assert.equal(resolver.getImage('orion-art')?.groupId, 'Ori');
  assert.equal(resolver.getImage('Orion')?.groupId, 'Ori');
  assert.equal(list.length, 2);
  assert.equal(list[0].hasArt, true);
  assert.equal(list[1].hasArt, false);
  assert.deepEqual(Object.keys(list[0]).sort(), [
    'attribution',
    'centroidIcrs',
    'cornersIcrs',
    'groupId',
    'hasArt',
    'id',
    'imageId',
    'imageUpIcrs',
    'label',
    'metadata',
  ]);
  assert.equal(raDec?.raDeg, 90);
  assert.deepEqual(target, { x: 51, y: 2, z: 3 });
});
