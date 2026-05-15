import assert from 'node:assert/strict';
import test from 'node:test';

import {
  absoluteMagnitudeToHrY,
  createHrDiagramGeometryFromProduct,
  createHrDiagramRenderer,
  drawHrDiagramCanvas,
  HR_DIAGRAM_MODE_FRUSTUM,
  HR_DIAGRAM_MODE_MAGNITUDE,
  HR_DIAGRAM_MODE_VOLUME,
  normalizeHrDiagramMode,
  projectHrDiagramStars,
  projectHrPoint,
  temperatureToHrX,
} from '../index.js';
import {
  createHrDiagramEmbeddedSurfaceNode,
  createHrDiagramSurfaceSource,
} from '../touch-os.js';
import { createStarObjectBatchProduct } from '@found-in-space/star-products';

test('HR projection maps hot stars left and bright stars high', () => {
  const coolX = temperatureToHrX(3000, 400);
  const hotX = temperatureToHrX(30000, 400);
  const brightY = absoluteMagnitudeToHrY(-4, 300);
  const faintY = absoluteMagnitudeToHrY(12, 300);
  const point = projectHrPoint({
    rect: { x: 10, y: 20, w: 400, h: 300 },
    teffLog8: 120,
    magAbs: 4,
  });

  assert.ok(hotX < coolX);
  assert.ok(brightY < faintY);
  assert.ok(point?.x >= 10);
  assert.ok(point?.y >= 20);
});

test('projectHrDiagramStars filters magnitude and volume views', () => {
  const product = createProduct();
  const magnitude = projectHrDiagramStars({ x: 0, y: 0, w: 400, h: 300 }, {
    products: [product],
    mode: HR_DIAGRAM_MODE_MAGNITUDE,
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  });
  const volume = projectHrDiagramStars({ x: 0, y: 0, w: 400, h: 300 }, {
    products: [product],
    mode: HR_DIAGRAM_MODE_VOLUME,
    observerPc: { x: 0, y: 0, z: 0 },
    volumeRadiusPc: 15,
  });

  assert.equal(magnitude.starCount, 2);
  assert.equal(magnitude.visibleCount, 1);
  assert.equal(volume.visibleCount, 1);
  assert.equal(normalizeHrDiagramMode(0), HR_DIAGRAM_MODE_MAGNITUDE);
  assert.equal(normalizeHrDiagramMode(1), HR_DIAGRAM_MODE_VOLUME);
  assert.equal(normalizeHrDiagramMode(2), HR_DIAGRAM_MODE_FRUSTUM);
});

test('drawHrDiagramCanvas draws deterministic points into a 2D context', () => {
  const ctx = createFakeContext();
  const result = drawHrDiagramCanvas(ctx, { x: 0, y: 0, w: 400, h: 300 }, {
    products: [createProduct()],
    mode: HR_DIAGRAM_MODE_VOLUME,
    volumeRadiusPc: 100,
  });

  assert.equal(result.visibleCount, 2);
  assert.equal(ctx.operations.filter((op) => op.type === 'fillRect').length, 3);
});

test('WebGL product geometry reuses product arrays and uses normalized teff bytes', () => {
  const product = createProduct();
  const geometry = createHrDiagramGeometryFromProduct(product);

  assert.equal(geometry.getAttribute('position').array, product.coordinates.primary.components);
  assert.equal(geometry.getAttribute('teff_log8').array, product.attributes.teffLog8.values);
  assert.equal(geometry.getAttribute('teff_log8').normalized, true);
  assert.equal(geometry.drawRange.count, product.count);
});

test('WebGL renderer applies product lifecycle deltas without merged arrays', () => {
  const renderer = createHrDiagramRenderer({
    mode: HR_DIAGRAM_MODE_VOLUME,
    volumeRadiusPc: 25,
    highlightRegion: {
      teffMin: 7000,
      teffMax: 40000,
      magAbsMin: 10,
      magAbsMax: 18,
    },
  });
  const productA = createProduct('product-a');
  const productB = createProduct('product-b');

  renderer.apply({
    type: 'data/product-upsert',
    product: productA,
  });
  renderer.apply({
    type: 'data/product-upsert',
    product: productB,
  });

  assert.equal(renderer.getSnapshot().productCount, 2);
  assert.equal(renderer.scene.children.length, 2);
  assert.equal(renderer.material.uniforms.uMode.value, 1);
  assert.equal(renderer.material.uniforms.uHighlightEnabled.value, 1);

  renderer.setView({
    mode: HR_DIAGRAM_MODE_FRUSTUM,
    observerPc: { x: 1, y: 2, z: 3 },
    limitingMagnitude: 8,
  });
  assert.equal(renderer.material.uniforms.uMode.value, 2);
  assert.equal(renderer.material.uniforms.uObserverPc.value.x, 1);
  assert.equal(renderer.material.uniforms.uLimitingMagnitude.value, 8);

  renderer.apply({
    type: 'data/product-remove',
    productId: 'product-a',
  });
  assert.equal(renderer.getSnapshot().productCount, 1);
  assert.equal(renderer.scene.children.length, 1);

  renderer.dispose();
  assert.equal(renderer.getSnapshot().disposed, true);
});

test('touch-os adapter creates a composite embedded surface node', () => {
  const node = createHrDiagramEmbeddedSurfaceNode({
    componentId: 'hr',
    sourceId: 'hr.source',
  });

  assert.equal(node.id, 'hr');
  assert.equal(node.component.kind, 'embedded-surface');
  assert.equal(node.props.compositionMode, 'composite');
  assert.equal(node.props.interactive, false);
  assert.equal(node.props.acceptsForwardedInput, false);
  assert.equal(node.props.desiredSourceType, 'three-texture');
});

test('touch-os surface source publishes three-texture handles', () => {
  const source = createHrDiagramSurfaceSource({
    sourceId: 'hr.source',
    width: 128,
    height: 64,
  });
  const calls = [];
  const surfaces = {
    publish(sourceId, update) {
      calls.push({ type: 'publish', sourceId, update });
    },
    unpublish(sourceId) {
      calls.push({ type: 'unpublish', sourceId });
    },
  };

  source.setProducts([createProduct()]);
  source.publish(surfaces, 123);
  source.unpublish(surfaces);

  assert.equal(source.handle.kind, 'three-texture');
  assert.equal(source.getSnapshot().sourceId, 'hr.source');
  assert.equal(calls[0].update.sourceType, 'three-texture');
  assert.equal(calls[0].update.sourceWidth, 128);
  assert.equal(calls[0].update.lastFrameTimestamp, 123);
  assert.equal(calls[1].type, 'unpublish');

  source.dispose();
});

function createProduct(id = 'product-a') {
  const product = createStarObjectBatchProduct({
    providerId: 'provider',
    streamId: 'stream',
    productIndex: id === 'product-a' ? 1 : 2,
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
        count: 2,
        positionsPc: new Float32Array([
          10, 0, 0,
          20, 0, 0,
        ]),
        teffLog8: new Uint8Array([120, 200]),
        magAbs: new Float32Array([5, 12]),
      },
    }],
    attributes: ['position', 'teffLog8', 'magAbs'],
  });
  return {
    ...product,
    id,
  };
}

function createFakeContext() {
  return {
    operations: [],
    set fillStyle(value) {
      this.operations.push({ type: 'fillStyle', value });
    },
    fillRect(x, y, w, h) {
      this.operations.push({ type: 'fillRect', x, y, w, h });
    },
  };
}
