import assert from 'node:assert/strict';
import test from 'node:test';

import {
  drawAnchoredImageCanvas,
  drawAnchoredImageMeshCanvas,
} from '../canvas.js';
import { solveAnchoredImageMesh } from '../index.js';

const IMAGE = {
  id: 'plate-a',
  image: {
    src: 'plate.png',
    width: 100,
    height: 100,
    anchors: [
      { pixel: { x: 0, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 0 } },
      { pixel: { x: 100, y: 0 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 1, z: 0 } },
      { pixel: { x: 0, y: 100 }, target: { kind: 'direction', frame: 'icrs', x: 1, y: 0, z: 1 } },
    ],
  },
};

test('drawAnchoredImageCanvas projects and warps image triangles with Canvas2D calls', () => {
  const ctx = createFakeContext();
  const result = drawAnchoredImageCanvas(ctx, IMAGE, {
    sourceImage: { id: 'fake-image' },
    opacity: 0.5,
    projectTarget(target) {
      return {
        x: target.x * 10 + target.y * 20,
        y: target.z * 20,
      };
    },
  });

  assert.equal(result.imageId, 'plate-a');
  assert.equal(result.triangleCount, 2);
  assert.equal(result.drawnCount, 2);
  assert.equal(result.skippedCount, 0);
  assert.equal(ctx.operations.filter((op) => op.type === 'drawImage').length, 2);
  assert.equal(ctx.operations.filter((op) => op.type === 'clip').length, 2);
  assert.equal(ctx.alphaWrites[0], 0.5);
  assert.equal(ctx.alphaWrites.at(-1), 1);
});

test('drawAnchoredImageMeshCanvas skips hidden projected triangles and missing sources', () => {
  const ctx = createFakeContext();
  const mesh = solveAnchoredImageMesh(IMAGE);
  const missing = drawAnchoredImageMeshCanvas(ctx, mesh, {
    projectTarget() {
      return { x: 0, y: 0 };
    },
  });
  const hidden = drawAnchoredImageMeshCanvas(ctx, mesh, {
    sourceImage: {},
    projectTarget() {
      return { x: 0, y: 0, visible: false };
    },
  });

  assert.equal(missing.drawnCount, 0);
  assert.equal(missing.skippedCount, 1);
  assert.deepEqual(missing.skippedImages, ['plate-a']);
  assert.equal(hidden.drawnCount, 0);
  assert.equal(hidden.skippedCount, 2);
});

test('drawAnchoredImageMeshCanvas unwraps seam-crossing projected triangles', () => {
  const ctx = createFakeContext();
  const mesh = solveAnchoredImageMesh(IMAGE);
  const result = drawAnchoredImageMeshCanvas(ctx, mesh, {
    sourceImage: {},
    wrapWidth: 100,
    projectTarget(target) {
      return {
        x: target.y > 0.3 ? 5 : 95,
        y: target.z * 20,
      };
    },
  });

  assert.ok(result.drawnCount > 2);
});

function createFakeContext() {
  let alpha = 1;
  const ctx = {
    operations: [],
    alphaWrites: [],
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(value) {
      alpha = value;
      this.alphaWrites.push(value);
    },
    save() {
      this.operations.push({ type: 'save' });
    },
    restore() {
      this.operations.push({ type: 'restore' });
    },
    beginPath() {
      this.operations.push({ type: 'beginPath' });
    },
    moveTo(x, y) {
      this.operations.push({ type: 'moveTo', x, y });
    },
    lineTo(x, y) {
      this.operations.push({ type: 'lineTo', x, y });
    },
    closePath() {
      this.operations.push({ type: 'closePath' });
    },
    clip() {
      this.operations.push({ type: 'clip' });
    },
    transform(a, b, c, d, e, f) {
      this.operations.push({ type: 'transform', a, b, c, d, e, f });
    },
    drawImage(sourceImage, x, y, w, h) {
      this.operations.push({ type: 'drawImage', sourceImage, x, y, w, h });
    },
  };
  return ctx;
}
