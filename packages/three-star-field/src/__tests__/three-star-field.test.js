import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { createStarObjectBatchProduct } from '@found-in-space/star-products';
import {
  computeThreeStarFieldVisualRadiusPx,
  createDefaultThreeStarFieldMaterialProfile,
  createThreeStarField,
  createThreeStarFieldGeometryFromProduct,
  createVrThreeStarFieldMaterialProfile,
  DEFAULT_THREE_STAR_FIELD_VIEW,
  pickThreeStarFieldData,
} from '../index.js';

test('factory creates a Three group, default profile, empty snapshot, and clean dispose path', () => {
  const field = createThreeStarField({ id: 'stars' });

  assert.equal(field.object3d.name, 'stars');
  assert.ok(field.object3d instanceof THREE.Group);
  assert.deepEqual(field.getSnapshot(), {
    status: 'idle',
    productCount: 0,
    starCount: 0,
    renderObjectCount: 0,
    bytes: 0,
    disposed: false,
    view: DEFAULT_THREE_STAR_FIELD_VIEW,
    lastError: null,
    lastCurrentRevision: null,
  });

  field.dispose();
  assert.equal(field.getSnapshot().disposed, true);
  assert.equal(field.getSnapshot().status, 'disposed');
});

test('product upsert creates one geometry per product and reuses product arrays', () => {
  const field = createThreeStarField();
  const product = createProduct({ id: 'product-a' });

  field.apply({ type: 'data/product-upsert', product });

  const snapshot = field.getSnapshot();
  assert.equal(snapshot.productCount, 1);
  assert.equal(snapshot.starCount, 2);
  assert.equal(snapshot.renderObjectCount, 2);
  assert.equal(field.object3d.children.length, 2);

  const points = field.object3d.children.find((child) => child.name.endsWith(':points'));
  const halo = field.object3d.children.find((child) => child.name.endsWith(':halo'));
  assert.ok(points instanceof THREE.Points);
  assert.ok(halo instanceof THREE.Points);
  assert.equal(points.geometry, halo.geometry);
  assert.equal(points.geometry.getAttribute('position').array, product.coordinates.primary.components);
  assert.equal(points.geometry.getAttribute('teff_log8').array, product.attributes.teffLog8.values);
  assert.equal(points.geometry.getAttribute('magAbs').array, product.attributes.magAbs.values);
  assert.equal(points.geometry.getAttribute('teff_log8').normalized, true);

  field.dispose();
});

test('replacement upsert disposes and replaces the previous product geometry', () => {
  const field = createThreeStarField();
  const productA = createProduct({ id: 'same-product', productIndex: 1 });
  const productB = createProduct({ id: 'same-product', productIndex: 2 });

  field.apply({ type: 'data/product-upsert', product: productA });
  const oldGeometry = /** @type {THREE.Points} */ (field.object3d.children[0]).geometry;
  let disposed = false;
  oldGeometry.addEventListener('dispose', () => {
    disposed = true;
  });

  field.apply({ type: 'data/product-upsert', product: productB });

  assert.equal(disposed, true);
  assert.equal(field.getSnapshot().productCount, 1);
  assert.equal(field.object3d.children.length, 2);
  assert.notEqual(/** @type {THREE.Points} */ (field.object3d.children[0]).geometry, oldGeometry);

  field.dispose();
});

test('stale and remove deltas remove render objects and update counts', () => {
  const field = createThreeStarField();
  const productA = createProduct({ id: 'product-a', productIndex: 1 });
  const productB = createProduct({ id: 'product-b', productIndex: 2 });

  field.setProducts([productA, productB]);
  assert.equal(field.getSnapshot().productCount, 2);
  assert.equal(field.object3d.children.length, 4);

  field.apply({ type: 'data/product-stale', productId: 'product-a' });
  assert.equal(field.getSnapshot().productCount, 1);
  assert.equal(field.object3d.children.length, 2);

  field.apply({ type: 'data/product-remove', productId: 'product-b' });
  assert.equal(field.getSnapshot().productCount, 0);
  assert.equal(field.object3d.children.length, 0);

  field.dispose();
});

test('representation-current and product-error update snapshot state without changing geometry', () => {
  const field = createThreeStarField();
  const product = createProduct({ id: 'product-a' });

  field.apply({ type: 'data/product-upsert', product });
  field.apply({
    type: 'data/representation-current',
    viewRevision: 4,
    demandRevision: 2,
  });
  assert.equal(field.getSnapshot().status, 'current');
  assert.deepEqual(field.getSnapshot().lastCurrentRevision, {
    viewRevision: 4,
    demandRevision: 2,
  });
  assert.equal(field.object3d.children.length, 2);

  field.apply({
    type: 'data/product-error',
    error: { message: 'stream failed', code: 'ERR_TEST' },
  });
  assert.equal(field.getSnapshot().status, 'failed');
  assert.equal(field.getSnapshot().lastError, 'stream failed');
  assert.equal(field.object3d.children.length, 2);

  field.dispose();
});

test('setProducts replaces all products without cumulative array rebuilding', () => {
  const field = createThreeStarField();
  const productA = createProduct({ id: 'product-a', productIndex: 1 });
  const productB = createProduct({ id: 'product-b', productIndex: 2 });
  const productC = createProduct({ id: 'product-c', productIndex: 3, count: 1 });

  field.setProducts([productA, productB]);
  assert.equal(field.getSnapshot().productCount, 2);
  assert.equal(field.getSnapshot().starCount, 4);

  field.setProducts([productC]);
  assert.equal(field.getSnapshot().productCount, 1);
  assert.equal(field.getSnapshot().starCount, 1);
  assert.equal(field.object3d.children.length, 2);

  field.dispose();
});

test('setView updates uniforms, render scale, and halo visibility', () => {
  const field = createThreeStarField();
  field.apply({ type: 'data/product-upsert', product: createProduct({ id: 'product-a' }) });

  field.setView({
    observerPosition: { x: 1, y: 2, z: 3 },
    limitingMagnitude: 8,
    coordinateUnitsPerParsec: 0.001,
    renderScale: 0.5,
    halo: false,
  });

  const points = /** @type {THREE.Points} */ (field.object3d.children[0]);
  const halo = /** @type {THREE.Points} */ (field.object3d.children[1]);
  const uniforms = /** @type {THREE.ShaderMaterial} */ (points.material).uniforms;

  assert.equal(field.object3d.scale.x, 0.5);
  assert.equal(uniforms.uObserverPosition.value.x, 1);
  assert.equal(uniforms.uObserverPosition.value.y, 2);
  assert.equal(uniforms.uObserverPosition.value.z, 3);
  assert.equal(uniforms.uMagLimit.value, 8);
  assert.equal(uniforms.uScale.value, 0.001);
  assert.equal(halo.visible, false);

  field.dispose();
});

test('missing magAbs and teffLog8 attributes use safe fallbacks', () => {
  const product = createProduct({
    id: 'position-only',
    attributes: ['position'],
  });
  const geometry = createThreeStarFieldGeometryFromProduct(product);

  assert.equal(geometry.getAttribute('position').array, product.coordinates.primary.components);
  assert.deepEqual(
    Array.from(/** @type {Uint8Array} */ (geometry.getAttribute('teff_log8').array)),
    [255, 255],
  );
  assert.deepEqual(
    Array.from(/** @type {Float32Array} */ (geometry.getAttribute('magAbs').array)),
    [99, 99],
  );
});

test('CPU picking returns product object mapping and star metadata', () => {
  const field = createThreeStarField({
    coordinateUnitsPerParsec: 1,
    limitingMagnitude: 8,
  });
  const product = createProduct({ id: 'pick-product' });
  const ray = new THREE.Ray(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
  );

  field.apply({ type: 'data/product-upsert', product });
  const result = field.pick(ray, {
    fovRad: Math.PI / 3,
    viewportHeight: 800,
  });

  assert.equal(result?.productId, 'pick-product');
  assert.equal(result?.objectIndex, 0);
  assert.equal(result?.product, product);
  assert.equal(result?.objectRef?.ordinal, 0);
  assert.equal(result?.pickMeta?.nodeKey, 'node-a');
  assert.equal(result?.distancePc, 10);
  assert.equal(result?.apparentMagnitude, 5);
  assert.equal(result?.teffLog8, 120);
  assert.equal(result?.magAbs, 5);
  assert.ok(result.visualRadiusPx > 0);

  const direct = pickThreeStarFieldData(ray, {
    products: [product],
    view: { limitingMagnitude: 8 },
  });
  assert.equal(direct?.objectIndex, 0);

  field.dispose();
});

test('visual radius helper and default material profile are DOM-free', () => {
  const radius = computeThreeStarFieldVisualRadiusPx({
    apparentMagnitude: 3,
  });
  const hidden = computeThreeStarFieldVisualRadiusPx({
    apparentMagnitude: 12,
    limitingMagnitude: 6.5,
  });
  const profile = createDefaultThreeStarFieldMaterialProfile({
    limitingMagnitude: 7,
  });

  assert.ok(radius > 0);
  assert.equal(hidden, 0);
  assert.ok(profile.material instanceof THREE.ShaderMaterial);
  assert.ok(profile.haloMaterial instanceof THREE.ShaderMaterial);
  assert.equal(profile.material.uniforms.uMagLimit.value, 7);
  assert.ok(profile.material.uniforms.map.value instanceof THREE.Texture);
  profile.dispose?.();
});

test('VR material profile preserves the old XR shader path as a separate option', () => {
  const profile = createVrThreeStarFieldMaterialProfile({
    limitingMagnitude: 7.5,
    coordinateUnitsPerParsec: 1.2,
  });

  assert.ok(profile.material instanceof THREE.ShaderMaterial);
  assert.equal(profile.haloMaterial, null);
  assert.equal(profile.material.uniforms.uMagLimit.value, 7.5);
  assert.equal(profile.material.uniforms.uScale.value, 1.2);
  assert.equal(profile.material.uniforms.uExposure.value, 100_000);
  assert.ok(profile.material.uniforms.map.value instanceof THREE.Texture);
  profile.dispose?.();
});

test('dispose releases resources and mutation calls fail clearly', () => {
  const field = createThreeStarField();
  field.apply({ type: 'data/product-upsert', product: createProduct({ id: 'product-a' }) });

  field.dispose();

  assert.throws(
    () => field.apply({ type: 'data/product-remove', productId: 'product-a' }),
    /disposed/,
  );
  assert.throws(
    () => field.setView({ limitingMagnitude: 8 }),
    /disposed/,
  );
});

function createProduct(options = {}) {
  const count = options.count ?? 2;
  const positions = count === 1
    ? [12, 0, 0]
    : [
      10, 0, 0,
      20, 2, 0,
    ];
  const teff = count === 1 ? [160] : [120, 200];
  const magAbs = count === 1 ? [4] : [5, 12];
  const refs = Array.from({ length: count }, (_value, ordinal) => ({
    datasetId: 'dataset-a',
    nodeKey: 'node-a',
    ordinal,
  }));
  const product = createStarObjectBatchProduct({
    providerId: 'provider',
    streamId: 'stream',
    productIndex: options.productIndex ?? 1,
    entries: [{
      node: {
        nodeKey: 'node-a',
        centerX: 0,
        centerY: 0,
        centerZ: 0,
        halfSize: 1,
        level: 1,
        gridX: 0,
        gridY: 0,
        gridZ: 0,
      },
      decoded: {
        count,
        positionsPc: new Float32Array(positions),
        teffLog8: new Uint8Array(teff),
        magAbs: new Float32Array(magAbs),
        refs,
      },
    }],
    attributes: options.attributes ?? ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });

  return {
    ...product,
    ...(options.id ? { id: options.id } : {}),
  };
}
