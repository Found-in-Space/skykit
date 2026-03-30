import test from 'node:test';
import assert from 'node:assert/strict';
import { SCALE } from '../../services/octree/scene-scale.js';
import {
  computeApparentMagnitude,
  summarizeDecodedPayloadEntries,
  summarizeSelectedPayloadNodes,
} from '../observer-shell-diagnostic.js';

test('summarizeSelectedPayloadNodes groups nodes by level and applies JS batch planning', () => {
  const summary = summarizeSelectedPayloadNodes([
    { level: 2, payloadOffset: 100, payloadLength: 10 },
    { level: 2, payloadOffset: 120, payloadLength: 20 },
    { level: 4, payloadOffset: 1000, payloadLength: 30 },
  ], {
    payloadMaxGapBytes: 32,
    payloadMaxBatchBytes: 64,
  });

  assert.deepEqual(summary.byLevel, [
    {
      level: 2,
      payloadNodeCount: 2,
      payloadBytes: 30,
      starsLoaded: 0,
      starsRendered: 0,
    },
    {
      level: 4,
      payloadNodeCount: 1,
      payloadBytes: 30,
      starsLoaded: 0,
      starsRendered: 0,
    },
  ]);
  assert.deepEqual(summary.totals, {
    payloadNodeCount: 3,
    payloadBytes: 60,
    starsLoaded: 0,
    starsRendered: 0,
  });
  assert.deepEqual(summary.batches, {
    inputRanges: 3,
    outputBatches: 2,
    rawPayloadBytes: 60,
    totalSpanBytes: 70,
    largestBatchBytes: 40,
  });
});

test('summarizeDecodedPayloadEntries counts stars visible at the requested magnitude', () => {
  const renderService = {
    decodePayload(_buffer, node) {
      if (node.level === 2) {
        return {
          count: 2,
          positions: new Float32Array([
            1 * SCALE, 0, 0,
            200 * SCALE, 0, 0,
          ]),
          magAbs: new Float32Array([1.0, 1.0]),
        };
      }
      return {
        count: 1,
        positions: new Float32Array([
          2 * SCALE, 0, 0,
        ]),
        magAbs: new Float32Array([12.0]),
      };
    },
  };

  const summary = summarizeDecodedPayloadEntries([
    { node: { level: 2 }, buffer: new ArrayBuffer(0) },
    { node: { level: 4 }, buffer: new ArrayBuffer(0) },
  ], {
    renderService,
    observerPc: { x: 0, y: 0, z: 0 },
    mDesired: 6.5,
  });

  assert.deepEqual(summary.byLevel, [
    {
      level: 2,
      payloadNodeCount: 0,
      payloadBytes: 0,
      starsLoaded: 2,
      starsRendered: 1,
    },
    {
      level: 4,
      payloadNodeCount: 0,
      payloadBytes: 0,
      starsLoaded: 1,
      starsRendered: 0,
    },
  ]);
  assert.deepEqual(summary.totals, {
    payloadNodeCount: 0,
    payloadBytes: 0,
    starsLoaded: 3,
    starsRendered: 1,
  });
  assert.equal(
    computeApparentMagnitude({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 1),
    1,
  );
});
