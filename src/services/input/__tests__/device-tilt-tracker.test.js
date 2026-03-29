import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceTiltTracker } from '../device-tilt-tracker.js';

class FakeEventTarget extends EventTarget {}

function createOrientationEvent(beta, gamma, alpha = 0) {
  const event = new Event('deviceorientation');
  Object.defineProperty(event, 'beta', { value: beta });
  Object.defineProperty(event, 'gamma', { value: gamma });
  Object.defineProperty(event, 'alpha', { value: alpha });
  return event;
}

test('DeviceTiltTracker remaps axes and inversion flags before reporting normalized values', async () => {
  const eventTarget = new FakeEventTarget();
  const updates = [];
  const tracker = createDeviceTiltTracker({
    eventTarget,
    screenSource: {
      screen: {
        orientation: {
          angle: 0,
          type: 'portrait-primary',
        },
      },
    },
    windowSource: { orientation: 0 },
    deviceOrientationEvent: {},
    swapAxes: true,
    invertX: true,
    onUpdate(state) {
      updates.push(state);
    },
  });

  const enabled = await tracker.enable();
  assert.equal(enabled.ok, true);

  eventTarget.dispatchEvent(createOrientationEvent(0, 0));
  eventTarget.dispatchEvent(createOrientationEvent(10, 0));

  assert.equal(updates[0].phase, 'calibrated');
  assert.equal(updates[1].phase, 'update');
  assert.ok(updates[1].normalized.x < -0.4);
  assert.equal(updates[1].normalized.y, 0);

  tracker.dispose();
});
