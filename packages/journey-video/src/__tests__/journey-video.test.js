import assert from 'node:assert/strict';
import test from 'node:test';

import { JOURNEY_VIDEO_PACKAGE_STATUS } from '../index.js';

test('journey-video package is an explicit placeholder', () => {
  assert.equal(JOURNEY_VIDEO_PACKAGE_STATUS, 'placeholder');
});
