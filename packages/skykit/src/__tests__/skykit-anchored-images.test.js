import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  createAnchoredImageCatalog,
  createAnchoredImageSkyPlugin,
  createManualAnchoredImageController,
  createSkykitViewer,
  createViewAnchoredImageController,
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

test('anchored image catalog resolves nearest and within-angle matches without opacity weights', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const nearest = catalog.resolveNearest({ x: 1, y: 0, z: 0 });
  const tooFar = catalog.resolveNearest({ x: 0, y: 1, z: 0 }, { selection: 'alpha', maxAngleDeg: 1 });
  const within = catalog.resolveWithinAngle({ x: 1, y: 0, z: 0 }, { maxAngleDeg: 1 });

  assert.equal(nearest?.key, 'alpha');
  assert.equal('weight' in nearest, false);
  assert.ok(nearest.viewDistanceRad >= 0);
  assert.equal(tooFar, null);
  assert.deepEqual(within.map((entry) => entry.key), ['alpha']);
});

test('anchored image controllers select manual entries and view-driven active entries', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const manual = createManualAnchoredImageController({ selection: 'alpha' });
  const input = {
    catalog,
    view: { observerPc: { x: 0, y: 0, z: 0 } },
    viewDirectionIcrs: { x: 1, y: 0, z: 0 },
    deltaSeconds: 0,
    elapsedSeconds: 0,
  };

  assert.deepEqual(manual.update(input).map((entry) => entry.key), ['alpha']);
  manual.setSelection?.('beta');
  assert.deepEqual(manual.update(input).map((entry) => entry.key), ['beta']);

  const nearest = createViewAnchoredImageController({ strategy: 'nearest', hysteresisSeconds: 0.2 });
  assert.deepEqual(nearest.update(input).map((entry) => entry.key), ['alpha']);
  assert.deepEqual(nearest.update({
    ...input,
    viewDirectionIcrs: { x: 0, y: 1, z: 0 },
    deltaSeconds: 0.1,
  }).map((entry) => entry.key), ['alpha']);
  assert.deepEqual(nearest.update({
    ...input,
    viewDirectionIcrs: { x: 0, y: 1, z: 0 },
    deltaSeconds: 0.1,
  }).map((entry) => entry.key), ['beta']);

  const within = createViewAnchoredImageController({ strategy: 'within-angle', maxAngleDeg: 1 });
  assert.deepEqual(within.update(input).map((entry) => entry.key), ['alpha']);
});

test('anchored image sky plugin preloads controller selection and mounts fixed-at-infinity art under the observer root', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const requests = [];
  const controller = createManualAnchoredImageController({ selection: ['alpha', 'beta'] });
  const plugin = createAnchoredImageSkyPlugin({
    id: 'test-art',
    catalog,
    controller,
    loading: 'preload',
    textureLoader: createTextureLoader(requests),
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
  assert.deepEqual(plugin.getActive().map((entry) => entry.key), ['alpha', 'beta']);

  await viewer.dispose();
});

test('anchored image sky plugin lazy-loads active controller entries and caches them', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const requests = [];
  const controller = createViewAnchoredImageController({ strategy: 'nearest', hysteresisSeconds: 0 });
  const plugin = createAnchoredImageSkyPlugin({
    id: 'lazy-art',
    catalog,
    controller,
    loading: 'lazy',
    textureLoader: createTextureLoader(requests),
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: { directionIcrs: { x: 1, y: 0, z: 0 } },
    plugins: [plugin],
  });
  await flushPromises();

  assert.deepEqual(requests, ['alpha.png']);
  viewer.requestViewState({ directionIcrs: { x: 0, y: 1, z: 0 } }, 'test-active-change');
  viewer.update(0);
  await flushPromises();
  assert.deepEqual(requests, ['alpha.png', 'beta.png']);

  viewer.update(0);
  await flushPromises();
  assert.deepEqual(requests, ['alpha.png', 'beta.png']);

  await viewer.dispose();
});

test('anchored image sky plugin fades opacity by seconds and keeps fading objects visible', async () => {
  const catalog = await createAnchoredImageCatalog({ manifest: MANIFEST });
  const requests = [];
  const controller = createManualAnchoredImageController({ selection: 'alpha' });
  const plugin = createAnchoredImageSkyPlugin({
    id: 'fade-art',
    catalog,
    controller,
    loading: 'lazy',
    textureLoader: createTextureLoader(requests),
    opacity: 0.24,
    fadeInSeconds: 0.4,
    fadeOutSeconds: 0.4,
  });
  const viewer = await createSkykitViewer({
    renderer: createRenderer(),
    view: { directionIcrs: { x: 1, y: 0, z: 0 } },
    plugins: [plugin],
  });
  await flushPromises();

  const root = viewer.roots.observerContentRoot.children.find((child) => child.name === 'fade-art');
  assert.ok(root);
  viewer.update(0.2);
  await flushPromises();
  assert.ok(Math.abs(readOpacity(root, 'alpha') - 0.12) < 1e-9);

  controller.setSelection?.('beta');
  viewer.update(0.1);
  await flushPromises();
  assert.ok(root.children.find((child) => child.userData.anchoredImageEntry?.key === 'alpha')?.visible);
  assert.ok(root.children.find((child) => child.userData.anchoredImageEntry?.key === 'beta')?.visible);
  assert.ok(Math.abs(readOpacity(root, 'alpha') - 0.06) < 1e-9);
  assert.ok(Math.abs(readOpacity(root, 'beta') - 0.06) < 1e-9);

  viewer.update(0.3);
  await flushPromises();
  assert.equal(root.children.find((child) => child.userData.anchoredImageEntry?.key === 'alpha')?.visible, false);
  assert.ok(Math.abs(readOpacity(root, 'beta') - 0.24) < 1e-9);

  await viewer.dispose();
});

function readOpacity(root, key) {
  const object = root.children.find((child) => child.userData.anchoredImageEntry?.key === key);
  assert.ok(object, `Expected object for ${key}`);
  const material = object.material;
  return Number(material?.uniforms?.opacity?.value ?? material?.opacity ?? 0);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
