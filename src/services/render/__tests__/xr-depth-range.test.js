import assert from 'node:assert/strict';
import test from 'node:test';
import { computeXrDepthRange } from '../xr-depth-range.js';

test('computeXrDepthRange sizes far plane from selected node bounds and margin', () => {
  const result = computeXrDepthRange({
    near: 0.25,
    metersPerParsec: 2,
    marginFactor: 1.2,
    minFar: 100,
    maxFar: 1000,
    observerPc: { x: 0, y: 0, z: 0 },
    selection: {
      nodes: [
        {
          bounds: {
            minX: -2,
            maxX: 2,
            minY: -3,
            maxY: 3,
            minZ: -4,
            maxZ: 4,
          },
        },
      ],
    },
  });

  const expectedRequiredPc = Math.hypot(2, 3, 4);
  assert.equal(result.telemetry.requiredDistancePc, expectedRequiredPc);
  assert.equal(result.far, 100);
  assert.equal(result.telemetry.minClampApplied, true);
  assert.equal(result.depthFar, result.far);
});

test('computeXrDepthRange expands far plane for constellation sphere when enabled', () => {
  const result = computeXrDepthRange({
    near: 0.25,
    metersPerParsec: 10,
    marginFactor: 1.1,
    minFar: 1,
    maxFar: 2000,
    observerPc: { x: 3, y: 4, z: 0 },
    includeConstellationSphere: true,
    constellationSphereRadiusPc: 8,
    selection: { nodes: [] },
  });

  // observer length = 5 pc, far edge of sphere = 13 pc.
  assert.equal(result.telemetry.farthestConstellationPc, 13);
  assert.equal(result.far, 13 * 10 * 1.1);
});

test('computeXrDepthRange applies hard cap and reports cap telemetry', () => {
  const result = computeXrDepthRange({
    near: 0.25,
    metersPerParsec: 100,
    marginFactor: 1.3,
    minFar: 100,
    maxFar: 500,
    observerPc: { x: 0, y: 0, z: 0 },
    selection: {
      nodes: [{ centerX: 10, centerY: 0, centerZ: 0 }],
    },
  });

  assert.equal(result.far, 500);
  assert.equal(result.telemetry.capApplied, true);
});
