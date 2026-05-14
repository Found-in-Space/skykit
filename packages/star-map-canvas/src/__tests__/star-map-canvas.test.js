import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanvasStarMap,
  createRaDecEquirectangularProjection,
  createStarMapProjection,
  drawStarMap,
} from '../index.js';
import {
  createStarObjectBatchProduct,
  createStarRepresentationStore,
} from '@found-in-space/star-products';

test('default equirectangular projection maps observer-relative ICRS directions', () => {
  const projection = createRaDecEquirectangularProjection();
  const context = {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
    width: 360,
    height: 180,
    rect: { x: 0, y: 0, w: 360, h: 180 },
  };

  assert.deepEqual(projection.project(createStar({ position: [1, 0, 0] }), context), {
    x: 0,
    y: 90,
  });
  assert.deepEqual(projection.project(createStar({ position: [0, 1, 0] }), context), {
    x: 90,
    y: 90,
  });
  assert.deepEqual(projection.project(createStar({ position: [0, 0, 1] }), context), {
    x: 0,
    y: 0,
  });
});

test('drawStarMap filters per-star by apparent magnitude and returns projected points', () => {
  const ctx = createFakeContext();
  const result = drawStarMap(ctx, { x: 0, y: 0, w: 360, h: 180 }, {
    stars: [
      createStar({ position: [10, 0, 0], magAbs: 5, teffLog8: 120 }),
      createStar({ objectIndex: 1, position: [10, 0, 0], magAbs: 12, teffLog8: 120 }),
    ],
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  });

  assert.equal(result.starCount, 2);
  assert.equal(result.visibleCount, 1);
  assert.equal(result.filteredCount, 1);
  assert.equal(result.points[0].productId, 'product-a');
  assert.equal(result.points[0].objectIndex, 0);
  assert.equal(ctx.operations.filter((op) => op.type === 'arc').length, 2);
});

test('drawStarMap supports custom projections', () => {
  const ctx = createFakeContext();
  const projection = createStarMapProjection((_star, context) => ({
    x: context.width * 0.25,
    y: context.height * 0.75,
    depth: 3,
    wrapKey: 'custom-wrap',
  }), { id: 'test-projection' });

  const result = drawStarMap(ctx, { x: 10, y: 20, w: 100, h: 80 }, {
    stars: [createStar()],
    projection,
  });

  assert.equal(result.points[0].x, 35);
  assert.equal(result.points[0].y, 80);
  assert.equal(result.points[0].depth, 3);
  assert.equal(result.points[0].wrapKey, 'custom-wrap');
});

test('createCanvasStarMap resizes for DPR and preserves pick metadata', () => {
  const { canvas, ctx } = createFakeCanvas({
    clientWidth: 200,
    clientHeight: 100,
  });
  const store = createStoreWithProduct();
  const map = createCanvasStarMap(canvas, {
    store,
    autoResize: false,
  });

  map.resize({ width: 200, height: 100, dpr: 2 });
  const result = map.render({
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
  });
  const point = result.points[0];
  const picked = map.pick({ x: point.x, y: point.y });

  assert.equal(canvas.width, 400);
  assert.equal(canvas.height, 200);
  assert.equal(ctx.transforms.at(-1).a, 2);
  assert.equal(result.dpr, 2);
  assert.equal(result.visibleCount, 1);
  assert.notEqual(picked, null);
  assert.equal(picked?.productId, 'stream-a:product:1');
  assert.equal(picked?.objectIndex, 0);
  assert.equal(picked?.objectRef?.nodeKey, 'node-a');
  assert.equal(picked?.pickMeta?.ordinal, 0);
});

test('empty stores render an empty result without failing', () => {
  const { canvas } = createFakeCanvas();
  const store = createStarRepresentationStore();
  const map = createCanvasStarMap(canvas, { store });
  const result = map.render();

  assert.equal(result.starCount, 0);
  assert.equal(result.visibleCount, 0);
  assert.deepEqual(result.points, []);
  assert.equal(map.pick({ x: 0, y: 0 }), null);
});

function createStoreWithProduct() {
  const store = createStarRepresentationStore();
  const product = createStarObjectBatchProduct({
    providerId: 'provider-a',
    streamId: 'stream-a',
    productIndex: 1,
    entries: [{
      node: createNode('node-a'),
      decoded: {
        count: 1,
        positionsPc: new Float32Array([10, 0, 0]),
        magAbs: new Float32Array([5]),
        teffLog8: new Uint8Array([120]),
        refs: [{ datasetId: 'dataset-a', nodeKey: 'node-a', ordinal: 0 }],
      },
    }],
    attributes: ['position', 'magAbs', 'teffLog8', 'objectRef', 'pickMeta'],
  });
  store.apply({ type: 'data/product-upsert', product });
  return store;
}

function createStar(overrides = {}) {
  const [x, y, z] = overrides.position ?? [10, 0, 0];
  const objectIndex = overrides.objectIndex ?? 0;
  return {
    product: {},
    productId: overrides.productId ?? 'product-a',
    objectIndex,
    position: { x, y, z },
    magAbs: overrides.magAbs ?? 5,
    teffLog8: overrides.teffLog8 ?? 120,
    objectRef: overrides.objectRef ?? { datasetId: 'dataset-a', nodeKey: 'node-a', ordinal: objectIndex },
    pickMeta: overrides.pickMeta ?? {
      nodeKey: 'node-a',
      ordinal: objectIndex,
      level: 1,
      gridX: 0,
      gridY: 0,
      gridZ: 0,
      centerX: 0,
      centerY: 0,
      centerZ: 0,
    },
  };
}

function createNode(nodeKey) {
  return {
    nodeKey,
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    halfSize: 1,
    level: 1,
    gridX: 0,
    gridY: 0,
    gridZ: 0,
  };
}

function createFakeCanvas(options = {}) {
  const ctx = createFakeContext();
  const canvas = {
    width: options.width ?? 300,
    height: options.height ?? 150,
    clientWidth: options.clientWidth ?? options.width ?? 300,
    clientHeight: options.clientHeight ?? options.height ?? 150,
    style: {},
    ownerDocument: {
      defaultView: {
        devicePixelRatio: options.dpr ?? 1,
      },
    },
    getContext(kind) {
      assert.equal(kind, '2d');
      return ctx;
    },
  };
  return { canvas, ctx };
}

function createFakeContext() {
  return {
    fillStyle: '',
    globalAlpha: 1,
    operations: [],
    transforms: [],
    save() {
      this.operations.push({ type: 'save' });
    },
    restore() {
      this.operations.push({ type: 'restore' });
    },
    setTransform(a, b, c, d, e, f) {
      this.transforms.push({ a, b, c, d, e, f });
    },
    clearRect(x, y, w, h) {
      this.operations.push({ type: 'clearRect', x, y, w, h });
    },
    fillRect(x, y, w, h) {
      this.operations.push({
        type: 'fillRect',
        x,
        y,
        w,
        h,
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
      });
    },
    beginPath() {
      this.operations.push({ type: 'beginPath' });
    },
    arc(x, y, radius, start, end) {
      this.operations.push({ type: 'arc', x, y, radius, start, end });
    },
    fill() {
      this.operations.push({
        type: 'fill',
        fillStyle: this.fillStyle,
        globalAlpha: this.globalAlpha,
      });
    },
  };
}
