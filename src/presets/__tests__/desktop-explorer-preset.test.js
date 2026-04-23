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
  assert.equal(preset.hudController, null);
  assert.equal(preset.fullscreenController, null);
  assert.equal(preset.state.fieldStrategy, 'observer-shell');
  assert.deepEqual(preset.state.observerPc, SOLAR_ORIGIN_PC);
  assert.deepEqual(preset.state.targetPc, ORION_CENTER_PC);
});

test('createDesktopExplorerPreset wires optional fullscreen, HUD, and picking extras', () => {
  const preset = createDesktopExplorerPreset({
    fullscreen: true,
    navigationHud: true,
    picking: {
      onPick() {},
    },
  });

  assert.ok(preset.pickController);
  assert.ok(preset.hudController);
  assert.ok(preset.fullscreenController);
  assert.equal(preset.controllers.length, 5);
  assert.ok(preset.controls.length >= 4);
  assert.ok(preset.fullscreenControls.length > 0);
});

test('createDesktopExplorerPreset appends custom HUD controls when provided', () => {
  const preset = createDesktopExplorerPreset({
    navigationHud: true,
    controls: [
      { label: 'Custom', onPress() {} },
    ],
  });

  assert.ok(preset.hudController);
  assert.equal(preset.controls.at(-1)?.label, 'Custom');
});
