import { resolvePreset } from './hud-presets.js';

const POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function normalizePosition(pos) {
  return POSITIONS.includes(pos) ? pos : 'bottom-left';
}

/**
 * Inject the HUD stylesheet into the document once.
 * Returns the shared <style> element (idempotent).
 */
let sharedStyle = null;

/** @internal Reset shared state — for testing only. */
export function _resetStyles() {
  sharedStyle?.remove?.();
  sharedStyle = null;
}

function ensureStyles() {
  if (sharedStyle) return;
  sharedStyle = document.createElement('style');
  sharedStyle.textContent = `
.skykit-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 100;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  display: grid;
  grid-template-areas:
    "tl tr"
    "bl br";
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  padding: 12px;
  gap: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  color: rgba(220, 235, 255, 0.9);
}
.skykit-hud-region {
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}
.skykit-hud-region--top-left     { grid-area: tl; align-items: start; justify-content: start; }
.skykit-hud-region--top-right    { grid-area: tr; align-items: end;   justify-content: start; }
.skykit-hud-region--bottom-left  { grid-area: bl; align-items: start; justify-content: end; }
.skykit-hud-region--bottom-right { grid-area: br; align-items: end;   justify-content: end; }

.skykit-hud-preset {
  display: grid;
  gap: 4px;
  pointer-events: none;
}
.skykit-hud-preset__label {
  grid-column: 1 / -1;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(180, 210, 255, 0.5);
  text-align: center;
  margin-bottom: 2px;
}

.skykit-hud-key {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(140, 200, 255, 0.35);
  border-radius: 6px;
  background: rgba(8, 16, 32, 0.6);
  backdrop-filter: blur(4px);
  color: rgba(220, 235, 255, 0.85);
  font-size: 15px;
  line-height: 1;
  pointer-events: auto;
  cursor: pointer;
  touch-action: none;
  transition: background 0.1s, border-color 0.1s;
}
.skykit-hud-key:hover {
  border-color: rgba(160, 220, 255, 0.6);
  background: rgba(20, 40, 70, 0.7);
}
.skykit-hud-key--active {
  background: rgba(80, 160, 255, 0.35);
  border-color: rgba(140, 210, 255, 0.8);
}

.skykit-hud-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid rgba(140, 200, 255, 0.35);
  border-radius: 6px;
  background: rgba(8, 16, 32, 0.6);
  backdrop-filter: blur(4px);
  color: rgba(220, 235, 255, 0.85);
  font: inherit;
  cursor: pointer;
  pointer-events: auto;
  touch-action: manipulation;
  transition: background 0.1s, border-color 0.1s;
}
.skykit-hud-action:hover {
  border-color: rgba(160, 220, 255, 0.6);
  background: rgba(20, 40, 70, 0.7);
}
.skykit-hud-action--active {
  background: rgba(80, 160, 255, 0.35);
  border-color: rgba(140, 210, 255, 0.8);
}

.skykit-hud-readout {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid rgba(140, 200, 255, 0.2);
  border-radius: 6px;
  background: rgba(8, 16, 32, 0.5);
  backdrop-filter: blur(4px);
  pointer-events: none;
  white-space: nowrap;
}
.skykit-hud-readout__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(180, 210, 255, 0.5);
}
.skykit-hud-readout__value {
  color: rgba(220, 235, 255, 0.9);
}
`;
  document.head.appendChild(sharedStyle);
}

// ---------------------------------------------------------------------------

function buildKeyControl(keyDef, cameraController) {
  const el = document.createElement('div');
  el.className = 'skykit-hud-key';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', keyDef.code);
  el.textContent = keyDef.symbol;
  if (keyDef.gridArea) el.style.gridArea = keyDef.gridArea;

  let activePointerId = null;

  function down(e) {
    e.preventDefault();
    e.stopPropagation();
    if (activePointerId != null) return;
    activePointerId = e.pointerId;
    el.setPointerCapture(e.pointerId);
    el.classList.add('skykit-hud-key--active');
    cameraController?.simulateKeyDown(keyDef.code);
  }

  function up(e) {
    if (e.pointerId !== activePointerId) return;
    e.preventDefault();
    e.stopPropagation();
    activePointerId = null;
    el.classList.remove('skykit-hud-key--active');
    cameraController?.simulateKeyUp(keyDef.code);
  }

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  return {
    element: el,
    dispose() {
      if (activePointerId != null) {
        cameraController?.simulateKeyUp(keyDef.code);
      }
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.remove();
    },
  };
}

function buildPresetGroup(presetDef, cameraController) {
  const container = document.createElement('div');
  container.className = 'skykit-hud-preset';
  container.style.gridTemplateAreas = presetDef.gridTemplate;
  container.style.gridTemplateColumns = presetDef.gridColumns;

  if (presetDef.label) {
    const lbl = document.createElement('div');
    lbl.className = 'skykit-hud-preset__label';
    lbl.textContent = presetDef.label;
    container.appendChild(lbl);
  }

  const children = presetDef.keys.map((k) => {
    const ctrl = buildKeyControl(k, cameraController);
    container.appendChild(ctrl.element);
    return ctrl;
  });

  return {
    element: container,
    dispose() {
      children.forEach((c) => c.dispose());
      container.remove();
    },
  };
}

function buildActionButton(def) {
  const el = document.createElement('button');
  el.className = 'skykit-hud-action';
  el.setAttribute('type', 'button');
  if (def.title) el.setAttribute('title', def.title);

  const span = document.createElement('span');
  const staticLabel = typeof def.label === 'function' ? '' : (def.label ?? '');
  span.textContent = staticLabel || def.title || '';
  el.appendChild(span);

  let toggleState = def.initialActive === true;
  if (toggleState) el.classList.add('skykit-hud-action--active');

  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (def.toggle) {
      toggleState = !toggleState;
      el.classList.toggle('skykit-hud-action--active', toggleState);
      def.onPress?.(toggleState);
    } else {
      def.onPress?.();
    }
  });

  let lastLabel = null;

  return {
    element: el,
    update() {
      if (def.toggle && typeof def.isActive === 'function') {
        const external = Boolean(def.isActive());
        if (external !== toggleState) {
          toggleState = external;
          el.classList.toggle('skykit-hud-action--active', toggleState);
        }
      }
      if (typeof def.label === 'function') {
        const text = String(def.label() ?? '');
        if (text !== lastLabel) {
          span.textContent = text;
          lastLabel = text;
        }
      }
    },
    dispose() {
      el.remove();
    },
  };
}

function buildReadout(def) {
  const el = document.createElement('div');
  el.className = 'skykit-hud-readout';

  const lbl = document.createElement('span');
  lbl.className = 'skykit-hud-readout__label';
  lbl.textContent = def.label ?? '';
  el.appendChild(lbl);

  const val = document.createElement('span');
  val.className = 'skykit-hud-readout__value';
  val.textContent = '—';
  el.appendChild(val);

  let lastText = null;

  return {
    element: el,
    update() {
      if (typeof def.value !== 'function') return;
      const text = String(def.value() ?? '—');
      if (text !== lastText) {
        val.textContent = text;
        lastText = text;
      }
    },
    dispose() {
      el.remove();
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Create a heads-up display overlay for a viewer.
 *
 * Returns a controller-shaped object (`{ id, attach, update, dispose }`) so
 * it can be passed directly into `createViewer({ controllers: [...] })`.
 *
 * @param {object} options
 * @param {string}  [options.id]                  Controller id.
 * @param {Array}   options.controls              Array of control descriptors.
 * @param {string}  [options.visibility='always']  'always' | 'auto' | 'touch-only'.
 * @param {object}  [options.cameraController]    Camera-rig controller to wire
 *                                                 key presets to (must expose
 *                                                 simulateKeyDown / simulateKeyUp).
 */
export function createHud(options = {}) {
  const id = options.id ?? 'hud';
  const visibility = options.visibility ?? 'always';
  const controls = options.controls ?? [];
  const cameraController = options.cameraController ?? null;

  let root = null;
  const regions = {};
  const builtControls = [];
  const updatables = [];

  function getRegion(position) {
    const pos = normalizePosition(position);
    if (regions[pos]) return regions[pos];
    const el = document.createElement('div');
    el.className = `skykit-hud-region skykit-hud-region--${pos}`;
    root.appendChild(el);
    regions[pos] = el;
    return el;
  }

  function buildAll() {
    for (const def of controls) {
      if (def.preset) {
        const presetDef = resolvePreset(def.preset);
        const group = buildPresetGroup(presetDef, cameraController);
        getRegion(def.position).appendChild(group.element);
        builtControls.push(group);
      } else if (def.readout) {
        const readout = buildReadout(def);
        getRegion(def.position).appendChild(readout.element);
        builtControls.push(readout);
        updatables.push(readout);
      } else if (def.onPress) {
        const action = buildActionButton(def);
        getRegion(def.position).appendChild(action.element);
        builtControls.push(action);
        if (action.update) updatables.push(action);
      }
    }
  }

  function applyVisibility() {
    if (!root) return;
    if (visibility === 'always') {
      root.style.display = '';
      return;
    }
    const isTouch = 'ontouchstart' in globalThis
      || navigator.maxTouchPoints > 0;

    if (visibility === 'touch-only') {
      root.style.display = isTouch ? '' : 'none';
    } else if (visibility === 'auto') {
      root.style.display = isTouch ? '' : 'none';
    }
  }

  return {
    id,

    attach(context) {
      ensureStyles();

      const mount = context.canvas?.parentElement;
      if (!mount) return;

      const mountPosition = globalThis.getComputedStyle?.(mount)?.position;
      if (mountPosition === 'static' || !mountPosition) {
        mount.style.position = 'relative';
      }

      root = document.createElement('div');
      root.className = 'skykit-hud';
      mount.appendChild(root);

      buildAll();
      applyVisibility();
    },

    update() {
      for (const u of updatables) u.update();
    },

    dispose() {
      for (const c of builtControls) c.dispose();
      builtControls.length = 0;
      updatables.length = 0;
      root?.remove();
      root = null;
      for (const key of Object.keys(regions)) delete regions[key];
    },
  };
}
