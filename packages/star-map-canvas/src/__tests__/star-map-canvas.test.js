import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanvasStarMap,
  createGnomonicProjection,
  createRaDecProjection,
  createRaDecEquirectangularProjection,
  createStarMapProjection,
  drawProjectedStarMap,
  drawStarMap,
  icrsDirectionToRaDec,
  icrsPositionToRaDec,
  pickStarMapPoint,
  projectRaDecEquirectangular,
  projectStarMap,
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
    x: 360,
    y: 90,
  });
  assert.deepEqual(projection.project(createStar({ position: [0, 1, 0] }), context), {
    x: 270,
    y: 90,
  });
  assert.deepEqual(projection.project(createStar({ position: [0, 0, 1] }), context), {
    x: 360,
    y: 0,
  });
});

test('RA/Dec helpers and createRaDecProjection keep custom projections small', () => {
  const direction = icrsDirectionToRaDec([0, 1, 0]);
  const position = icrsPositionToRaDec(
    { x: 10, y: 10, z: 0 },
    { x: 10, y: 0, z: 0 },
  );
  const context = {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
    width: 360,
    height: 180,
    rect: { x: 0, y: 0, w: 360, h: 180 },
  };
  const projection = createRaDecProjection((sky) => ({
    x: sky.raDeg,
    y: 90 - sky.decDeg,
  }), { id: 'tiny-custom' });

  assert.equal(direction?.raDeg, 90);
  assert.equal(position?.raDeg, 90);
  assert.deepEqual(projectRaDecEquirectangular({ raDeg: 180, raHours: 12, decDeg: 0 }, context), {
    x: 180,
    y: 90,
  });
  assert.deepEqual(projectRaDecEquirectangular({ raDeg: 90, raHours: 6, decDeg: 0 }, context), {
    x: 270,
    y: 90,
  });
  assert.deepEqual(projectRaDecEquirectangular({ raDeg: 270, raHours: 18, decDeg: 0 }, context), {
    x: 90,
    y: 90,
  });
  assert.deepEqual(projection.project(createStar({ position: [0, 1, 0] }), context), {
    x: 90,
    y: 90,
  });
  assert.equal(projection.id, 'tiny-custom');
});

test('gnomonic projection centers requested RA/Dec, clips outside FoV, and supports roll', () => {
  const context = {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
    width: 100,
    height: 100,
    rect: { x: 0, y: 0, w: 100, h: 100 },
  };
  const projection = createGnomonicProjection({
    centerRaDeg: 0,
    centerDecDeg: 0,
    fovDeg: 90,
  });
  const rolled = createGnomonicProjection({
    centerRaDeg: 0,
    centerDecDeg: 0,
    fovDeg: 90,
    rollDeg: 180,
  });

  assert.deepEqual(roundProjection(projection.project(createStar({ position: [1, 0, 0] }), context)), {
    x: 50,
    y: 50,
    depth: 1,
  });
  assert.equal(projection.project(createStar({ position: [0, 1, 0] }), context), null);
  assert.equal(projection.projectRaDec?.({ raDeg: 60, raHours: 4, decDeg: 0 }, context), null);
  assert.ok(projection.projectRaDec?.({ raDeg: 60, raHours: 4, decDeg: 0 }, {
    ...context,
    clip: false,
  })?.x < 0);

  const east = projection.project(createStar({ position: [10, 1, 0] }), context);
  const west = projection.project(createStar({ position: [10, -1, 0] }), context);
  assert.ok(east && east.x < 50);
  assert.ok(west && west.x > 50);

  const north = projection.project(createStar({ position: [10, 0, 1] }), context);
  const northRolled = rolled.project(createStar({ position: [10, 0, 1] }), context);
  assert.ok(north && north.y < 50);
  assert.ok(northRolled && northRolled.y > 50);
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

test('projectStarMap returns a Canvas-free draw list with drawStarMap count parity', () => {
  const stars = [
    createStar({ position: [10, 0, 0], magAbs: 5, teffLog8: 120 }),
    createStar({ objectIndex: 1, position: [10, 0, 0], magAbs: 12, teffLog8: 120 }),
  ];
  const ctx = createFakeContext();
  const projected = projectStarMap({ x: 10, y: 20, w: 360, h: 180 }, {
    stars,
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
    timeMs: 123,
    deltaMs: 16,
  });
  const rendered = drawStarMap(ctx, { x: 10, y: 20, w: 360, h: 180 }, {
    stars,
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 6.5,
    timeMs: 123,
    deltaMs: 16,
  });

  assert.equal(projected.starCount, rendered.starCount);
  assert.equal(projected.visibleCount, rendered.visibleCount);
  assert.equal(projected.filteredCount, rendered.filteredCount);
  assert.equal(projected.points[0].x, 370);
  assert.equal(projected.points[0].y, 110);
  assert.equal(projected.timeMs, 123);
  assert.equal(projected.deltaMs, 16);
});

test('drawProjectedStarMap draws projected data without star rows', () => {
  const ctx = createFakeContext();
  const projected = projectStarMap({ x: 0, y: 0, w: 360, h: 180 }, {
    stars: [createStar()],
  });
  const result = drawProjectedStarMap(ctx, projected, {
    style: { background: null },
  });

  assert.equal(result.drawnCount, 1);
  assert.equal(ctx.operations.filter((op) => op.type === 'arc').length, 2);
  assert.equal(ctx.operations.filter((op) => op.type === 'fillRect').length, 0);
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

test('mapPoint can modify or hide final points and picking uses the modified cache', () => {
  const projected = projectStarMap({ x: 0, y: 0, w: 100, h: 50 }, {
    stars: [
      createStar({ objectIndex: 0, productId: 'visible' }),
      createStar({ objectIndex: 1, productId: 'hidden' }),
    ],
    projection: createStarMapProjection((star) => ({
      x: star.objectIndex === 0 ? 10 : 20,
      y: 10,
    })),
    mapPoint(point) {
      if (point.productId === 'hidden') {
        return null;
      }
      return {
        ...point,
        x: point.x + 30,
        radius: 8,
        color: '#fff',
      };
    },
  });
  const pickedMoved = pickStarMapPoint(projected, { x: 40, y: 10 }, { tolerancePx: 1 });
  const pickedOriginal = pickStarMapPoint(projected, { x: 10, y: 10 }, { tolerancePx: 1 });

  assert.equal(projected.visibleCount, 1);
  assert.equal(projected.filteredCount, 1);
  assert.equal(projected.points[0].x, 40);
  assert.equal(projected.points[0].color, '#fff');
  assert.equal(pickedMoved?.productId, 'visible');
  assert.equal(pickedOriginal, null);
});

test('drawPoint replaces the default glyph renderer', () => {
  const ctx = createFakeContext();
  const result = drawStarMap(ctx, { x: 0, y: 0, w: 100, h: 50 }, {
    stars: [createStar()],
    drawPoint(drawCtx, point, context) {
      drawCtx.operations.push({
        type: 'customDrawPoint',
        x: point.x,
        y: point.y,
        projectionId: context.projected.projectionId,
      });
    },
  });

  assert.equal(result.drawnCount, 1);
  assert.equal(ctx.operations.filter((op) => op.type === 'arc').length, 0);
  assert.deepEqual(ctx.operations.find((op) => op.type === 'customDrawPoint'), {
    type: 'customDrawPoint',
    x: 100,
    y: 25,
    projectionId: 'ra-dec-equirectangular',
  });
});

test('background and foreground layers run in deterministic order with projection helpers', () => {
  const ctx = createFakeContext();
  const calls = [];
  const result = drawStarMap(ctx, { x: 5, y: 7, w: 360, h: 180 }, {
    stars: [createStar()],
    layers: [
      {
        id: 'grid',
        phase: 'background',
        render(context) {
          calls.push({
            id: 'grid',
            visible: context.projected.visibleCount,
            projected: context.projectRaDec?.({ raDeg: 0, raHours: 0, decDeg: 0 }),
          });
          context.ctx.operations.push({ type: 'layer', id: 'grid' });
        },
      },
      {
        id: 'labels',
        phase: 'foreground',
        render(context) {
          calls.push({
            id: 'labels',
            drawn: context.result?.drawnCount,
            ra: context.icrsDirectionToRaDec([1, 0, 0])?.raDeg,
          });
          context.ctx.operations.push({ type: 'layer', id: 'labels' });
        },
      },
    ],
  });

  assert.equal(result.drawnCount, 1);
  assert.deepEqual(calls[0], {
    id: 'grid',
    visible: 1,
    projected: { x: 365, y: 97 },
  });
  assert.deepEqual(calls[1], {
    id: 'labels',
    drawn: 1,
    ra: 0,
  });
  assert.deepEqual(ctx.operations.map((op) => op.type).filter((type) => type === 'layer' || type === 'arc'), [
    'layer',
    'arc',
    'arc',
    'layer',
  ]);
});

test('layers can request unclipped RA/Dec projection for warped overlays', () => {
  const ctx = createFakeContext();
  const calls = [];
  drawStarMap(ctx, { x: 0, y: 0, w: 100, h: 100 }, {
    stars: [],
    projection: createGnomonicProjection({
      centerRaDeg: 0,
      centerDecDeg: 0,
      fovDeg: 90,
    }),
    layers: [{
      phase: 'background',
      render(context) {
        const sky = { raDeg: 60, raHours: 4, decDeg: 0 };
        calls.push({
          clipped: context.projectRaDec?.(sky),
          unclipped: context.projectRaDecUnclipped?.(sky),
        });
      },
    }],
  });

  assert.equal(calls[0].clipped, null);
  assert.ok(calls[0].unclipped.x < 0);
  assert.equal(calls[0].unclipped.y, 50);
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

test('createCanvasStarMap supports layers and timing context', () => {
  const { canvas } = createFakeCanvas({
    clientWidth: 200,
    clientHeight: 100,
  });
  const layerCalls = [];
  const map = createCanvasStarMap(canvas, {
    stars: undefined,
    autoResize: false,
    layers: [{
      phase: 'foreground',
      render(context) {
        layerCalls.push({
          timeMs: context.timeMs,
          deltaMs: context.deltaMs,
          dpr: context.dpr,
        });
      },
    }],
  });

  map.resize({ width: 200, height: 100, dpr: 2 });
  const result = map.render({
    stars: [createStar()],
    timeMs: 250,
    deltaMs: 33,
  });

  assert.equal(result.dpr, 2);
  assert.deepEqual(layerCalls, [{ timeMs: 250, deltaMs: 33, dpr: 2 }]);
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

function roundProjection(projected) {
  return projected
    ? Object.fromEntries(
      Object.entries(projected).map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value,
      ]),
    )
    : null;
}
