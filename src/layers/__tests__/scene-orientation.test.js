import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIcrsToSceneYUpTransform,
  createSceneToIcrsYUpTransform,
} from '../scene-orientation.js';

test('scene orientation transforms round-trip through Orion frame', () => {
  const targetPc = { x: 62.775, y: 602.667, z: -12.713 };
  const icrsToScene = createIcrsToSceneYUpTransform(targetPc);
  const sceneToIcrs = createSceneToIcrsYUpTransform(targetPc);

  const source = { x: 12.5, y: -42.75, z: 3.25 };
  const [sceneX, sceneY, sceneZ] = icrsToScene(source.x, source.y, source.z);
  const [icrsX, icrsY, icrsZ] = sceneToIcrs(sceneX, sceneY, sceneZ);

  assert.ok(Math.abs(icrsX - source.x) < 1e-9);
  assert.ok(Math.abs(icrsY - source.y) < 1e-9);
  assert.ok(Math.abs(icrsZ - source.z) < 1e-9);
});
