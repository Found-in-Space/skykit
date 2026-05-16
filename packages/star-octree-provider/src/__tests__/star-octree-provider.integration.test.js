import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OCTREE_DEFAULT,
  createStarOctreeProviderService,
} from '../index.js';

const integrationEnabled = process.env.STAR_OCTREE_PROVIDER_INTEGRATION === '1';

test('streamObjectBatches supports nearest visible stars against the public octree', {
  skip: integrationEnabled
    ? false
    : 'set STAR_OCTREE_PROVIDER_INTEGRATION=1 to run the public octree integration test',
  timeout: 120_000,
}, async () => {
  const pointPc = { x: 0, y: 0, z: 0 };
  const limitingMagnitude = 6.5;
  const provider = createStarOctreeProviderService({
    id: 'provider-integration',
    url: process.env.STAR_OCTREE_PROVIDER_INTEGRATION_URL ??
      OCTREE_DEFAULT,
  });
  const nearest = [];
  let upsertCount = 0;
  let sawCurrent = false;

  for await (const delta of provider.streamObjectBatches({
    strategy: { kind: 'observer-shell' },
    view: {
      observerPc: pointPc,
      limitingMagnitude,
    },
  })) {
    if (delta.type === 'data/product-upsert') {
      upsertCount += 1;
      incorporateProduct(nearest, delta.product, pointPc, limitingMagnitude, 100);
    }

    if (delta.type === 'data/representation-current') {
      sawCurrent = true;
    }
  }

  assert.equal(sawCurrent, true);
  assert.equal(nearest.length, 100);
  assert.ok(upsertCount > 1, 'expected progressive product-upsert events');

  for (let index = 1; index < nearest.length; index += 1) {
    assert.ok(nearest[index - 1].distancePc <= nearest[index].distancePc);
  }

  for (const star of nearest) {
    assert.ok(star.apparentMagnitude <= limitingMagnitude);
  }
});

function incorporateProduct(nearest, product, pointPc, limitingMagnitude, count) {
  const positions = product.coordinates.primary.components;
  const magAbs = product.attributes.magAbs?.values;
  if (!magAbs) return;

  for (let index = 0; index < product.count; index += 1) {
    const positionPc = {
      x: positions[index * 3],
      y: positions[index * 3 + 1],
      z: positions[index * 3 + 2],
    };
    const distancePc = distanceBetween(pointPc, positionPc);
    const apparentMagnitude =
      magAbs[index] + 5 * (Math.log10(Math.max(distancePc, 1e-6)) - 1);
    if (apparentMagnitude > limitingMagnitude) continue;

    insertNearest(nearest, {
      distancePc,
      apparentMagnitude,
      positionPc,
    }, count);
  }
}

function insertNearest(nearest, star, count) {
  const last = nearest[nearest.length - 1];
  if (
    nearest.length >= count &&
    last &&
    star.distancePc >= last.distancePc
  ) {
    return;
  }

  let insertAt = nearest.findIndex((candidate) =>
    star.distancePc < candidate.distancePc
  );
  if (insertAt < 0) {
    insertAt = nearest.length;
  }
  nearest.splice(insertAt, 0, star);
  if (nearest.length > count) {
    nearest.length = count;
  }
}

function distanceBetween(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}
