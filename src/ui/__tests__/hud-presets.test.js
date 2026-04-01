import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESET_ARROWS,
  PRESET_QE,
  PRESET_VERTICALS,
  PRESET_WASD,
  PRESET_WASD_QE,
  resolvePreset,
} from '../hud-presets.js';

test('resolvePreset returns PRESET_ARROWS for "arrows"', () => {
  assert.strictEqual(resolvePreset('arrows'), PRESET_ARROWS);
});

test('resolvePreset returns PRESET_WASD for "wasd"', () => {
  assert.strictEqual(resolvePreset('wasd'), PRESET_WASD);
});

test('resolvePreset returns PRESET_QE for "qe"', () => {
  assert.strictEqual(resolvePreset('qe'), PRESET_QE);
});

test('resolvePreset returns PRESET_VERTICALS for "verticals"', () => {
  assert.strictEqual(resolvePreset('verticals'), PRESET_VERTICALS);
});

test('resolvePreset returns PRESET_WASD_QE for "wasd-qe"', () => {
  assert.strictEqual(resolvePreset('wasd-qe'), PRESET_WASD_QE);
});

test('resolvePreset throws for unknown preset', () => {
  assert.throws(() => resolvePreset('nope'), /Unknown HUD preset/);
});

test('PRESET_ARROWS has four keys with expected codes', () => {
  const codes = PRESET_ARROWS.keys.map((k) => k.code).sort();
  assert.deepEqual(codes, ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']);
});

test('PRESET_WASD_QE combines WASD and QE keys', () => {
  const codes = PRESET_WASD_QE.keys.map((k) => k.code).sort();
  assert.deepEqual(codes, ['KeyA', 'KeyD', 'KeyE', 'KeyQ', 'KeyS', 'KeyW']);
});

test('every preset key has a symbol and gridArea', () => {
  for (const preset of [PRESET_ARROWS, PRESET_WASD, PRESET_QE, PRESET_VERTICALS, PRESET_WASD_QE]) {
    for (const key of preset.keys) {
      assert.ok(key.symbol, `missing symbol for ${key.code} in ${preset.id}`);
      assert.ok(key.gridArea, `missing gridArea for ${key.code} in ${preset.id}`);
    }
  }
});
