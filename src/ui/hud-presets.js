/**
 * Preset control groups for the HUD.
 *
 * Each preset is an array of key-control descriptors laid out in a grid.
 * `gridArea` values follow CSS grid-area syntax so presets can define
 * spatial relationships (cross layout for WASD, row for arrows, etc.).
 */

export const PRESET_ARROWS = {
  id: 'arrows',
  label: 'Move',
  gridTemplate: `". up ." "left down right"`,
  gridColumns: 'repeat(3, auto)',
  keys: [
    { code: 'ArrowUp', symbol: '↑', gridArea: 'up' },
    { code: 'ArrowDown', symbol: '↓', gridArea: 'down' },
    { code: 'ArrowLeft', symbol: '←', gridArea: 'left' },
    { code: 'ArrowRight', symbol: '→', gridArea: 'right' },
  ],
};

export const PRESET_WASD = {
  id: 'wasd',
  label: 'Look',
  gridTemplate: `". w ." "a s d"`,
  gridColumns: 'repeat(3, auto)',
  keys: [
    { code: 'KeyW', symbol: 'W', gridArea: 'w' },
    { code: 'KeyA', symbol: 'A', gridArea: 'a' },
    { code: 'KeyS', symbol: 'S', gridArea: 's' },
    { code: 'KeyD', symbol: 'D', gridArea: 'd' },
  ],
};

export const PRESET_QE = {
  id: 'qe',
  label: 'Roll',
  gridTemplate: `"q e"`,
  gridColumns: 'repeat(2, auto)',
  keys: [
    { code: 'KeyQ', symbol: 'Q', gridArea: 'q' },
    { code: 'KeyE', symbol: 'E', gridArea: 'e' },
  ],
};

export const PRESET_VERTICALS = {
  id: 'verticals',
  label: 'Up / Down',
  gridTemplate: `"space" "shift"`,
  gridColumns: 'auto',
  keys: [
    { code: 'Space', symbol: '␣', gridArea: 'space' },
    { code: 'ShiftLeft', symbol: '⇧', gridArea: 'shift' },
  ],
};

export const PRESET_WASD_QE = {
  id: 'wasd-qe',
  label: 'Look + Roll',
  gridTemplate: `"q w e" "a s d"`,
  gridColumns: 'repeat(3, auto)',
  keys: [
    { code: 'KeyW', symbol: 'W', gridArea: 'w' },
    { code: 'KeyA', symbol: 'A', gridArea: 'a' },
    { code: 'KeyS', symbol: 'S', gridArea: 's' },
    { code: 'KeyD', symbol: 'D', gridArea: 'd' },
    { code: 'KeyQ', symbol: 'Q', gridArea: 'q' },
    { code: 'KeyE', symbol: 'E', gridArea: 'e' },
  ],
};

const PRESETS_BY_NAME = {
  arrows: PRESET_ARROWS,
  wasd: PRESET_WASD,
  qe: PRESET_QE,
  verticals: PRESET_VERTICALS,
  'wasd-qe': PRESET_WASD_QE,
};

export function resolvePreset(name) {
  const preset = PRESETS_BY_NAME[name];
  if (!preset) throw new Error(`Unknown HUD preset: "${name}"`);
  return preset;
}
