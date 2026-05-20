import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apparentMagnitude,
  consumeStarCellDeltas,
  combineStrategies,
  compareStarCellPriority,
  createFrustumTester,
  createLookaheadStrategy,
  createObserverShellStrategy,
  createPathDistanceEvaluator,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createStarCellData,
  createStarCellKey,
  createStarCellStore,
  createTargetFrustumStrategy,
  decodeMorton3D,
  decodeTemperatureK,
  encodeMorton3D,
  evaluateStarCellStrategyChange,
  estimateStarCellBytes,
  normalizeTargetFrustumView,
  parseStarCellKey,
  supportsTransferableBuffers,
  temperatureToRgb,
} from '../index.js';

test('createStarCellData builds typed cell arrays and metadata', () => {
  const node = createNode({ centerX: 10, centerY: 20, centerZ: 30 });
  const cell = createStarCellData({
    node,
    decoded: {
      count: 2,
      positionsPc: new Float32Array([1, 2, 3, 4, 5, 6]),
      teffLog8: new Uint8Array([100, 120]),
      magAbs: new Float32Array([1.5, 2.5]),
    },
    datasetId: 'dataset-a',
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });

  assert.equal(cell.cellKey, createStarCellKey(node));
  assert.deepEqual(cell.cell, { level: node.level, mortonCode: node.mortonCode });
  assert.deepEqual(Array.from(cell.coordinates.components), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(Array.from(cell.attributes.teffLog8), [100, 120]);
  assert.deepEqual(Array.from(cell.attributes.magAbs), [1.5, 2.5]);
  assert.equal(cell.bounds.centerPc.x, node.centerX);
  assert.equal(cell.bounds.gridZ, node.gridZ);
  assert.equal(cell.refs?.[1].datasetId, 'dataset-a');
  assert.equal(cell.refs?.[1].ordinal, 1);
  assert.equal(cell.pickMeta?.[1].cellKey, cell.cellKey);
  assert.equal(cell.pickMeta?.[1].gridZ, node.gridZ);
  assert.equal(estimateStarCellBytes(cell), 34);
});

test('createStarCellData omits unrequested attributes', () => {
  const cell = createStarCellData({
    node: createNode(),
    decoded: {
      count: 1,
      positionsPc: new Float32Array([1, 2, 3]),
      teffLog8: new Uint8Array([100]),
      magAbs: new Float32Array([1.5]),
    },
    attributes: ['position'],
  });

  assert.equal(cell.attributes.teffLog8, undefined);
  assert.equal(cell.attributes.magAbs, undefined);
  assert.equal(cell.pickMeta, undefined);
  assert.equal(cell.refs, undefined);
  assert.equal(estimateStarCellBytes(cell), 12);
});

test('createStarCellData reuses decoded buffers for borrowed no-transform cells', () => {
  const decoded = {
    count: 2,
    positionsPc: new Float32Array([1, 2, 3, 4, 5, 6]),
    teffLog8: new Uint8Array([100, 120]),
    magAbs: new Float32Array([1.5, 2.5]),
  };
  const cell = createStarCellData({
    node: createNode(),
    decoded,
    attributes: ['position', 'teffLog8', 'magAbs'],
  });

  assert.equal(cell.coordinates.components, decoded.positionsPc);
  assert.equal(cell.attributes.teffLog8, decoded.teffLog8);
  assert.equal(cell.attributes.magAbs, decoded.magAbs);
});

test('createStarCellData copy mode allocates independent typed arrays', () => {
  const decoded = {
    count: 1,
    positionsPc: new Float32Array([1, 2, 3]),
    teffLog8: new Uint8Array([100]),
    magAbs: new Float32Array([1.5]),
  };
  const cell = createStarCellData({
    node: createNode(),
    decoded,
    attributes: ['position', 'teffLog8', 'magAbs'],
    memoryOwnership: 'copy',
  });

  assert.notEqual(cell.coordinates.components, decoded.positionsPc);
  assert.notEqual(cell.coordinates.components.buffer, decoded.positionsPc.buffer);
  assert.notEqual(cell.attributes.teffLog8, decoded.teffLog8);
  assert.notEqual(cell.attributes.teffLog8.buffer, decoded.teffLog8.buffer);
  assert.notEqual(cell.attributes.magAbs, decoded.magAbs);
  assert.notEqual(cell.attributes.magAbs.buffer, decoded.magAbs.buffer);
  assert.deepEqual(Array.from(cell.coordinates.components), [1, 2, 3]);
  assert.deepEqual(Array.from(cell.attributes.teffLog8), [100]);
  assertFloatArrayClose(cell.attributes.magAbs, [1.5]);
});

test('createStarCellData applies coordinate transforms during packing', () => {
  const decoded = {
    count: 1,
    positionsPc: new Float32Array([10, 20, 30]),
  };
  const cell = createStarCellData({
    node: createNode(),
    decoded,
    attributes: ['position'],
    coordinates: {
      name: 'render-position',
      units: ['render', 'render', 'render'],
      transformPosition({ xPc, yPc, zPc }) {
        return {
          x: xPc * 0.001,
          y: yPc * 0.001 + 1,
          z: -zPc * 0.001,
        };
      },
    },
  });

  assert.equal(cell.coordinates.name, 'render-position');
  assert.deepEqual(cell.coordinates.units, ['render', 'render', 'render']);
  assert.notEqual(cell.coordinates.components, decoded.positionsPc);
  assert.notEqual(cell.coordinates.components.buffer, decoded.positionsPc.buffer);
  assertFloatArrayClose(cell.coordinates.components, [0.01, 1.02, -0.03]);
});

test('createStarCellData supports transfer ownership when available', () => {
  if (!supportsTransferableBuffers()) {
    return;
  }

  const cell = createStarCellData({
    node: createNode(),
    decoded: {
      count: 1,
      positionsPc: new Float32Array([1, 2, 3]),
      teffLog8: new Uint8Array([120]),
    },
    attributes: ['position', 'teffLog8'],
    memoryOwnership: 'transfer',
  });

  assert.deepEqual(Array.from(cell.coordinates.components), [1, 2, 3]);
  assert.deepEqual(Array.from(cell.attributes.teffLog8), [120]);
});

test('createStarCellStore applies cell deltas and exposes star helpers', async () => {
  const store = createStarCellStore();
  const cell = createStarCellData({
    node: createNode(),
    decoded: {
      count: 2,
      positionsPc: new Float32Array([1, 2, 3, 4, 5, 6]),
      teffLog8: new Uint8Array([100, 120]),
      magAbs: new Float32Array([1.5, 2.5]),
      refs: [
        { datasetId: 'dataset-a', level: 2, mortonCode: '53', ordinal: 0 },
        { datasetId: 'dataset-a', level: 2, mortonCode: '53', ordinal: 1 },
      ],
    },
    attributes: ['position', 'teffLog8', 'magAbs', 'objectRef', 'pickMeta'],
  });

  const result = await consumeStarCellDeltas(createDeltas([
    { type: 'stars/cells-upsert', providerId: 'provider-a', cells: [cell] },
    {
      type: 'stars/current',
      providerId: 'provider-a',
      demandRevision: 1,
      cellKeys: [cell.cellKey],
      starCount: 2,
    },
  ]), store, { stopOnCurrent: true });

  assert.equal(result.stoppedOn, 'current');
  assert.equal(store.getStarCount(), 2);
  assert.equal(store.getObjectRef(cell.cellKey, 1)?.ordinal, 1);
  assert.equal(store.getPickMeta(cell.cellKey, 1)?.gridZ, 3);
  assert.equal(store.getSnapshot().starCount, 2);
  assert.equal(store.getSnapshot().cellCount, 1);

  const rows = Array.from(store.stars());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1].position, { x: 4, y: 5, z: 6 });
  assert.equal(rows[1].teffLog8, 120);
  assert.equal(rows[1].magAbs, 2.5);
  assert.equal(rows[1].cellKey, cell.cellKey);

  store.apply({
    type: 'stars/cells-remove',
    providerId: 'provider-a',
    cellKeys: [cell.cellKey],
  });
  assert.equal(store.getStarCount(), 0);
});

test('cell identity helpers round-trip through Morton cell keys', () => {
  const mortonCode = encodeMorton3D(5, 2, 7, 3);
  const cellKey = createStarCellKey(3, mortonCode);
  const cell = parseStarCellKey(cellKey);

  assert.equal(cellKey, '3:373');
  assert.deepEqual(cell, { level: 3, mortonCode: '373' });
  assert.deepEqual(decodeMorton3D(cell.mortonCode, cell.level), {
    gridX: 5,
    gridY: 2,
    gridZ: 7,
  });

  const objectRef = {
    datasetId: 'dataset-a',
    level: cell.level,
    mortonCode: cell.mortonCode,
    ordinal: 9,
  };
  assert.equal(createStarCellKey(objectRef), cellKey);
});

test('star math helpers compute apparent magnitude, temperatures, and colors', () => {
  assert.equal(apparentMagnitude({ magAbs: 5, distancePc: 10 }), 5);
  assert.equal(decodeTemperatureK(255), 5800);

  const cool = decodeTemperatureK(0);
  const hot = decodeTemperatureK(200);
  assert.ok(cool < hot);

  const rgb = temperatureToRgb(5800, { input: 'kelvin' });
  assert.equal(rgb.length, 3);
  assert.ok(rgb.every((channel) => channel >= 0 && channel <= 255));
});

test('bundled strategy values expose behavior, not identity fields', () => {
  const strategies = [
    createObserverShellStrategy(),
    createTargetFrustumStrategy({ overscanDeg: 0 }),
    createSphereVolumeStrategy({ centerPc: { x: 0, y: 0, z: 0 }, radiusPc: 1 }),
    createPathVolumeStrategy({
      pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      radiusPc: 1,
    }),
    createLookaheadStrategy({
      base: createObserverShellStrategy(),
      horizonSecs: 1,
      tickSecs: 1,
    }),
    combineStrategies([createObserverShellStrategy()]),
  ];

  for (const strategy of strategies) {
    assert.equal(typeof strategy.createAnchor, 'function');
    assert.equal(typeof strategy.createEvaluator, 'function');
    assert.equal(typeof strategy.diff, 'function');
    for (const key of ['kind', 'id', 'name', 'label', 'debugLabel']) {
      assert.equal(Object.hasOwn(strategy, key), false, key);
    }
  }
});

test('observer-shell strategy evaluates magnitude-limited cell relevance', () => {
  const evaluator = createEvaluator(
    createObserverShellStrategy(),
    { observerPc: { x: 0, y: 0, z: 0 }, limitingMagnitude: 6.5 },
    { indexMagnitude: 3 },
  );

  const near = evaluator.evaluateCell(createNode({ centerX: 1, halfSize: 1 }));
  const far = evaluator.evaluateCell(createNode({ centerX: 20, halfSize: 1 }));

  assert.equal(near.include, true);
  assert.equal(near.descend, true);
  assert.equal(near.emit, true);
  assert.ok(compareStarCellPriority(near.priority, far.priority) < 0);
  assert.equal(far.include, false);
  assert.equal(far.descend, false);
});

test('target-frustum strategy uses the nearest visible witness', () => {
  const evaluator = createEvaluator(
    createTargetFrustumStrategy({ overscanDeg: 0 }),
    {
      observerPc: { x: 0, y: 0, z: 0 },
      directionIcrs: { x: 0, y: 1, z: 0 },
      verticalFovDeg: 60,
      aspectRatio: 1,
      nearPc: 0,
      limitingMagnitude: 6.5,
    },
    { indexMagnitude: 3 },
  );
  const evaluation = evaluator.evaluateCell(createNode({
    centerX: 75,
    centerY: 75,
    centerZ: 0,
    halfSize: 25,
  }));

  assert.equal(evaluation.include, true);
  assert.equal(Math.round(evaluation.distancePc * 1e6) / 1e6, 100);
  assert.deepEqual(roundVector(evaluation.metadata.nearestVisiblePc), { x: 50, y: 86.60254, z: 0 });
});

test('target-frustum radial bounds keep far-plane corners visible', () => {
  const view = normalizeTargetFrustumView({
    observerPc: { x: 0, y: 0, z: 0 },
    directionIcrs: { x: 1, y: 0, z: 0 },
    verticalFovDeg: 60,
    aspectRatio: 1,
    nearPc: 0,
    farPc: 100,
  }, { overscanDeg: 0 });
  const frustum = createFrustumTester(view);

  assert.equal(frustum.intersectsCell(createNode({
    centerX: 100,
    centerY: Math.tan(Math.PI / 6) * 100,
    centerZ: Math.tan(Math.PI / 6) * 100,
    halfSize: 0.1,
  })), true);
  assert.equal(frustum.nearestVisiblePointToCell(createNode({
    centerX: 200,
    centerY: 200,
    centerZ: 200,
    halfSize: 1,
  })), null);
});

test('sphere, path, and composite strategies provide semantic priorities', () => {
  const sphere = createSphereVolumeStrategy({ centerPc: { x: 0, y: 0, z: 0 }, radiusPc: 10 });
  const path = createPathVolumeStrategy({
    pointsPc: [{ x: 20, y: -10, z: 0 }, { x: 20, y: 10, z: 0 }],
    radiusPc: 5,
  });
  const composite = createEvaluator(combineStrategies([sphere, path]));

  const sphereCell = composite.evaluateCell(createNode({ centerX: 0, halfSize: 1 }));
  const pathCell = composite.evaluateCell(createNode({ centerX: 20, centerY: 2, halfSize: 1 }));
  const farCell = composite.evaluateCell(createNode({ centerX: 100, halfSize: 1 }));

  assert.equal(sphereCell.include, true);
  assert.equal(pathCell.include, true);
  assert.equal(farCell.include, false);
  assert.ok(sphereCell.priority.score > 0);
  assert.equal(sphereCell.metadata.strategyContributors.length, 2);
});

test('path strategy normalizes path points once per prepared evaluator', () => {
  const evaluator = createEvaluator(
    createPathVolumeStrategy({
      pointsPc: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
      radiusPc: 2,
    }),
  );
  const distance = createPathDistanceEvaluator([
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ]);

  assert.equal(distance.distanceToCoordinates(5, 4, 0), 4);
  assert.equal(evaluator.evaluateCell(createNode({ centerX: 5, centerY: 2, centerZ: 0, halfSize: 0.5 })).include, true);
  assert.equal(evaluator.evaluateCell(createNode({ centerX: 5, centerY: 4, centerZ: 0, halfSize: 0.5 })).include, false);
});

test('demand gate helpers apply movement and direction thresholds', () => {
  const strategy = createObserverShellStrategy();
  const unchanged = evaluateStarCellStrategyChange({
    strategy,
    thresholds: { observerMoveThresholdPc: 1 },
    previousAnchor: strategy.createAnchor({ revision: 1, observerPc: { x: 0, y: 0, z: 0 } }),
    nextAnchor: strategy.createAnchor({ revision: 2, observerPc: { x: 0.5, y: 0, z: 0 } }),
  });
  const changed = evaluateStarCellStrategyChange({
    strategy,
    thresholds: { observerMoveThresholdPc: 1 },
    previousAnchor: strategy.createAnchor({ revision: 1, observerPc: { x: 0, y: 0, z: 0 } }),
    nextAnchor: strategy.createAnchor({ revision: 2, observerPc: { x: 2, y: 0, z: 0 } }),
  });

  assert.equal(unchanged.replan, false);
  assert.equal(changed.replan, true);
  assert.ok(changed.reasons.includes('observer-move-threshold'));
});

function createEvaluator(strategy, view = {}, context = {}) {
  const anchor = strategy.createAnchor(view);
  return strategy.createEvaluator(anchor, context);
}

function createNode(overrides = {}) {
  const node = {
    centerX: 1,
    centerY: 2,
    centerZ: 3,
    halfSize: 0.5,
    level: 2,
    gridX: 1,
    gridY: 2,
    gridZ: 3,
    ...overrides,
  };
  return {
    ...node,
    mortonCode: String(
      overrides.mortonCode ?? encodeMorton3D(
        node.gridX,
        node.gridY,
        node.gridZ,
        node.level,
      ),
    ),
  };
}

function roundVector(vector) {
  return {
    x: Math.round(vector.x * 1e6) / 1e6,
    y: Math.round(vector.y * 1e6) / 1e6,
    z: Math.round(vector.z * 1e6) / 1e6,
  };
}

function assertFloatArrayClose(actual, expected) {
  assert.equal(actual.length, expected.length);

  for (let index = 0; index < actual.length; index += 1) {
    assert.equal(Math.abs(actual[index] - expected[index]) < 1e-6, true);
  }
}

async function* createDeltas(deltas) {
  for (const delta of deltas) {
    yield delta;
  }
}
