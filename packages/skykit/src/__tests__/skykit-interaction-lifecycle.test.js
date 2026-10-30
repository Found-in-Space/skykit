import assert from 'node:assert/strict';
import test from 'node:test';
import { createSkykitViewer } from '../index.js';
import { createSkykitInteractionPlugin } from '../interaction.js';

test('removing an interaction plugin stops updates and retains the borrowed environment', async () => {
  const viewer = await createSkykitViewer({ renderer: { render() {} } });
  let frames = 0, disposed = false;
  const environment = { update() { frames++; }, dispose() { disposed = true; } };
  const baseline = viewer.getSnapshot().partCount;
  const remove = await viewer.addPlugin(createSkykitInteractionPlugin({ environment }));
  viewer.frame(0); assert.equal(frames, 1);
  await remove(); assert.equal(viewer.getSnapshot().partCount, baseline);
  viewer.frame(0); assert.equal(frames, 1); assert.equal(disposed, false);
  await viewer.dispose(); assert.equal(disposed, false);
});
