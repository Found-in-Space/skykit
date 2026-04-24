import assert from 'node:assert/strict';
import test from 'node:test';

import { ORION_CENTER_PC, SOLAR_ORIGIN_PC } from '../../scene-targets.js';
import { createDesktopExplorerPreset } from '../desktop-explorer-preset.js';

test('createDesktopExplorerPreset returns the standard desktop explorer stack', () => {
  const preset = createDesktopExplorerPreset();

  assert.equal(preset.interestField.id, 'desktop-explorer-field');
  assert.equal(preset.cameraController.id, 'desktop-explorer-camera');
  assert.equal(preset.selectionRefreshController.id, 'desktop-explorer-refresh');
  assert.equal(preset.starFieldLayer.id, 'desktop-explorer-stars');
  assert.equal(preset.controllers.length, 2);
  assert.equal(preset.layers.length, 1);
  assert.equal(preset.pickController, null);
  assert.equal(preset.state.fieldStrategy, 'observer-shell');
  assert.deepEqual(preset.state.observerPc, SOLAR_ORIGIN_PC);
  assert.deepEqual(preset.state.targetPc, ORION_CENTER_PC);
});

test('createDesktopExplorerPreset wires optional picking support', () => {
  const preset = createDesktopExplorerPreset({
    picking: {
      onPick() {},
    },
  });

  assert.ok(preset.pickController);
  assert.equal(preset.controllers.length, 3);
});
