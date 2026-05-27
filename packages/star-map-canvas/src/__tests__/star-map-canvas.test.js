import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStarCellData,
  createStarCellStore,
  encodeMorton3D,
} from '@found-in-space/star-trees';
import {
  createGnomonicProjection,
  createRaDecEquirectangularProjection,
  drawProjectedStarMap,
  icrsDirectionToRaDec,
  pickStarMapPoint,
  projectStarMap,
} from '../index.js';

test('projects star rows from a cell store with cell-keyed points', () => {
  const store = createStarCellStore();
  const cell = createCell();
  store.apply({ type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cell] });

  const result = projectStarMap(
    { x: 0, y: 0, w: 400, h: 200 },
    {
      store,
      limitingMagnitude: 20,
      projection: createRaDecEquirectangularProjection(),
    },
  );

  assert.equal(result.visibleCount, 1);
  assert.equal(result.points[0].cellKey, cell.cellKey);
  assert.equal(result.points[0].objectIndex, 0);
});

test('pickStarMapPoint returns the nearest visible cell point', () => {
  const projected = {
    width: 100,
    height: 100,
    dpr: 1,
    starCount: 2,
    visibleCount: 2,
    filteredCount: 0,
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 20,
    projectionId: 'test',
    rect: { x: 0, y: 0, w: 100, h: 100 },
    timeMs: 0,
    deltaMs: 0,
    points: [
      createPoint({ cellKey: '2:1', x: 10, y: 10 }),
      createPoint({ cellKey: '2:2', x: 20, y: 20 }),
    ],
  };

  const picked = pickStarMapPoint(projected, { x: 21, y: 20 });
  assert.equal(picked?.cellKey, '2:2');
});

test('drawProjectedStarMap draws visible points and layers', () => {
  const calls = [];
  const ctx = {
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    beginPath: () => calls.push(['beginPath']),
    arc: (...args) => calls.push(['arc', ...args]),
    fill: () => calls.push(['fill']),
    save: () => {},
    restore: () => {},
    set fillStyle(value) {
      calls.push(['fillStyle', value]);
    },
    get globalAlpha() {
      return 1;
    },
    set globalAlpha(value) {
      calls.push(['globalAlpha', value]);
    },
  };
  const projected = {
    width: 100,
    height: 100,
    dpr: 1,
    starCount: 1,
    visibleCount: 1,
    filteredCount: 0,
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 20,
    projectionId: 'test',
    rect: { x: 0, y: 0, w: 100, h: 100 },
    timeMs: 0,
    deltaMs: 0,
    points: [createPoint({ cellKey: '2:1', x: 10, y: 10 })],
  };

  const result = drawProjectedStarMap(ctx, projected);
  assert.equal(result.drawnCount, 1);
  assert.ok(calls.some((call) => call[0] === 'arc'));
});

test('direction to RA/Dec remains stable', () => {
  assert.deepEqual(icrsDirectionToRaDec({ x: 1, y: 0, z: 0 }), {
    raDeg: 0,
    raHours: 0,
    decDeg: 0,
  });
});

test('gnomonic projection uses positionAngleDeg for sky rotation', () => {
  const projection = createGnomonicProjection({
    centerRaDeg: 0,
    centerDecDeg: 0,
    fovDeg: 90,
    positionAngleDeg: 90,
  });
  const projected = projection.projectRaDec?.(
    { raDeg: 0, raHours: 0, decDeg: 10 },
    createProjectionContext(),
  );

  assert.ok(projected);
  assert.ok(projected.x > 50);
  assert.ok(Math.abs(projected.y - 50) < 1e-9);
});

function createCell() {
  const node = {
    level: 2,
    gridX: 1,
    gridY: 0,
    gridZ: 0,
    mortonCode: String(encodeMorton3D(1, 0, 0, 2)),
    centerX: 10,
    centerY: 0,
    centerZ: 0,
    halfSize: 0.5,
  };
  return createStarCellData({
    node,
    decoded: {
      count: 1,
      positionsPc: new Float32Array([10, 0, 0]),
      teffLog8: new Uint8Array([128]),
      magAbs: new Float32Array([1]),
    },
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });
}

function createPoint(overrides = {}) {
  return {
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    radius: 2,
    alpha: 1,
    color: '#fff',
    distancePc: 10,
    apparentMagnitude: 1,
    cellKey: overrides.cellKey ?? '2:1',
    objectIndex: 0,
    objectRef: null,
    pickMeta: null,
    star: {
      cellKey: overrides.cellKey ?? '2:1',
      objectIndex: 0,
      position: { x: 0, y: 0, z: 0 },
    },
  };
}

function createProjectionContext() {
  return {
    observerPc: { x: 0, y: 0, z: 0 },
    limitingMagnitude: 20,
    width: 100,
    height: 100,
    rect: { x: 0, y: 0, w: 100, h: 100 },
    timeMs: 0,
    deltaMs: 0,
  };
}
