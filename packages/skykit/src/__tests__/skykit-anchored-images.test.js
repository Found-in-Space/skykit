import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createSkykitViewer,
} from '../index.js';

const MANIFEST = {
  format: 'found-in-space/anchored-image-manifest@1',
  id: 'test-culture',
  images: [
    {
      id: 'alpha-art',
      groupId: 'alpha',
      label: 'Alpha',
      image: {
        src: 'alpha.png',
        width: 100,
        height: 100,
        anchors: [
          { pixel: { x: 0, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 0 } },
          { pixel: { x: 100, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0.2, z: 0 } },
          { pixel: { x: 0, y: 100 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 0.2 } },
        ],
      },
    },
    {
      id: 'beta-art',
      groupId: 'beta',
      label: 'Beta',
      image: {
        src: 'beta.png',
        width: 100,
        height: 100,
        anchors: [
          { pixel: { x: 0, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 0, y: 1, z: 0 } },
          { pixel: { x: 100, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 0.2, y: 1, z: 0 } },
          { pixel: { x: 0, y: 100 }, target: { kind: 'direction', frame: 'icrs', x: 0, y: 1, z: 0.2 } },
        ],
      },
    },
  ],
};

function createRenderer() {
  return {
    domElement: { nodeName: 'CANVAS' },
    setSize() {},
    setPixelRatio() {},
    render() {},
    dispose() {},
  };
}

function createTextureLoader(requests) {
  return {
    load(url, onLoad) {
      requests.push(url);
      onLoad(new THREE.Texture());
    },
  };
}

test('anchored image catalog resolves generic entries, lookups, targets, and look poses', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const list = catalog.list();

  assert.deepEqual(list.map((entry) => entry.label), ['Alpha', 'Beta']);
  assert.equal(catalog.get('alpha-art')?.key, 'alpha');
  assert.equal(catalog.get('alpha')?.id, 'alpha-art');
  assert.equal(catalog.get('Alpha')?.groupId, 'alpha');

  const observerPc = { x: 10, y: 20, z: 30 };
  const entry = catalog.get('alpha');
  const targetPc = catalog.resolveTargetPc('alpha', { observerPc, distancePc: 50 });
  assert.ok(entry);
  assert.ok(targetPc);
  assert.ok(Math.abs(targetPc.x - (observerPc.x + entry.centroidIcrs.x * 50)) < 1e-9);
  assert.ok(Math.abs(targetPc.y - (observerPc.y + entry.centroidIcrs.y * 50)) < 1e-9);

  const lookAt = catalog.resolveLookAt('alpha', { observerPc, distancePc: 50 });
  assert.deepEqual(lookAt?.targetPc, targetPc);
  assert.deepEqual(lookAt?.upIcrs, entry.imageUpIcrs);
  assert.ok(lookAt?.orientationIcrs);
});

test('anchored image catalog scores active images with bounds-cone fading', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const centered = catalog.resolveActive({ x: 1, y: 0, z: 0 }, { maxImages: 1, fadeDeg: 8 });
  const fading = catalog.resolveActive({ x: 1, y: 0.35, z: 0 }, { maxImages: 2, fadeDeg: 20 });

  assert.equal(centered.length, 1);
  assert.equal(centered[0].key, 'alpha');
  assert.equal(centered[0].weight, 1);
  assert.equal(fading[0].key, 'alpha');
  assert.ok(fading[0].weight > 0);
  assert.ok(fading[0].weight < 1);
});

test('anchored image sky plugin preloads all mode and mounts fixed-at-infinity art under the observer root', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const requests = [];
  const plugin = createAnchoredImageSkyPlugin({
    id: 'test-art',
    catalog,
    mode: 'all',
    loading: 'lazy',
    selection: ['alpha', 'beta'],
    textureLoader: createTextureLoader(requests),
    active: { enabled: true },
    inactiveOpacity: 0.1,
    activeOpacity: 0.5,
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: { directionIcrs: { x: 1, y: 0, z: 0 } },
    plugins: [plugin],
  });

  assert.deepEqual(requests, ['alpha.png', 'beta.png']);
  const root = viewer.roots.observerContentRoot.children.find((child) => child.name === 'test-art');
  assert.ok(root);
  assert.equal(root.children.length, 2);
  assert.equal(plugin.getSnapshot().cachedCount, 2);
  assert.deepEqual(plugin.getActive().map((entry) => entry.key), ['alpha']);

  await viewer.dispose();
});

test('anchored image sky plugin lazy-loads active view images and caches them', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const requests = [];
  const plugin = createAnchoredImageSkyPlugin({
    id: 'lazy-art',
    catalog,
    mode: 'view',
    loading: 'lazy',
    selection: ['alpha', 'beta'],
    textureLoader: createTextureLoader(requests),
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: { directionIcrs: { x: 1, y: 0, z: 0 } },
    plugins: [plugin],
  });
  await Promise.resolve();

  assert.deepEqual(requests, ['alpha.png']);
  viewer.requestViewState({ directionIcrs: { x: 0, y: 1, z: 0 } }, 'test-active-change');
  viewer.update(0);
  await Promise.resolve();
  assert.deepEqual(requests, ['alpha.png', 'beta.png']);

  viewer.update(0);
  await Promise.resolve();
  assert.deepEqual(requests, ['alpha.png', 'beta.png']);

  await viewer.dispose();
});
