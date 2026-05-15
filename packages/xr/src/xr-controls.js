import { finiteNumber } from './xr-math.js';

const BUTTON_ALIASES = Object.freeze({
  trigger: 0,
  grip: 1,
  primary: 4,
  secondary: 5,
});

/**
 * @param {Iterable<unknown>} inputSources
 * @param {import('./index.d.ts').XrAxisBinding & { deadzone?: number }} binding
 * @returns {import('./index.d.ts').XrAxisState}
 */
export function readXrAxis(inputSources, binding = {}) {
  const deadzone = normalizeDeadzone(binding.deadzone);
  let best = axisState(0, 0, null);
  let bestMagnitude = 0;
  for (const source of Array.from(inputSources ?? [])) {
    if (!sourceMatchesHand(source, binding.hand)) continue;
    const axes = /** @type {{ gamepad?: { axes?: ArrayLike<number> }; handedness?: string }} */ (source)
      ?.gamepad?.axes;
    if (!axes || axes.length < 2) continue;
    const [xIndex, yIndex] = resolveAxisIndices(axes.length, binding);
    const rawX = finiteNumber(axes[xIndex], 0) * (binding.invertX ? -1 : 1);
    const rawY = finiteNumber(axes[yIndex], 0) * (binding.invertY ? -1 : 1);
    const x = Math.abs(rawX) < deadzone ? 0 : rawX;
    const y = Math.abs(rawY) < deadzone ? 0 : rawY;
    const magnitude = Math.hypot(x, y);
    if (magnitude > bestMagnitude) {
      bestMagnitude = magnitude;
      best = axisState(
        x,
        y,
        typeof /** @type {{ handedness?: unknown }} */ (source).handedness === 'string'
          ? /** @type {{ handedness: string }} */ (source).handedness
          : null,
      );
    }
  }
  return best;
}

/**
 * @param {Iterable<unknown>} inputSources
 * @param {import('./index.d.ts').XrButtonBinding} binding
 * @param {import('./index.d.ts').XrButtonState | null} [previous]
 * @returns {import('./index.d.ts').XrButtonState}
 */
export function readXrButton(inputSources, binding = {}, previous = null) {
  const buttonIndex = resolveButtonIndex(binding.button);
  /** @type {import('./index.d.ts').XrButtonState} */
  let best = {
    pressed: false,
    touched: false,
    value: 0,
    pressedEdge: false,
    releasedEdge: false,
    activeHand: null,
  };
  for (const source of Array.from(inputSources ?? [])) {
    if (!sourceMatchesHand(source, binding.hand)) continue;
    const button = /** @type {{ gamepad?: { buttons?: ArrayLike<{ pressed?: boolean; touched?: boolean; value?: number }> }; handedness?: string }} */ (source)
      ?.gamepad?.buttons?.[buttonIndex];
    if (!button) continue;
    const value = finiteNumber(button.value, button.pressed ? 1 : 0);
    if (button.pressed || button.touched || value > best.value) {
      best = {
        pressed: button.pressed === true,
        touched: button.touched === true,
        value,
        pressedEdge: false,
        releasedEdge: false,
        activeHand: typeof /** @type {{ handedness?: unknown }} */ (source).handedness === 'string'
          ? /** @type {{ handedness: string }} */ (source).handedness
          : null,
      };
    }
  }
  best.pressedEdge = best.pressed && previous?.pressed !== true;
  best.releasedEdge = !best.pressed && previous?.pressed === true;
  return best;
}

/**
 * @param {import('./index.d.ts').XrControlBindingsOptions} [options]
 * @returns {import('./index.d.ts').XrControlBindingsHandle}
 */
export function createXrControlBindings(options = {}) {
  let config = normalizeBindingOptions(options);
  /** @type {Map<string, import('./index.d.ts').XrAxisState>} */
  const axisStates = new Map();
  /** @type {Map<string, import('./index.d.ts').XrButtonState>} */
  const buttonStates = new Map();
  /** @type {Map<string, Set<(state: import('./index.d.ts').XrAxisState | import('./index.d.ts').XrButtonState) => void>>} */
  const listeners = new Map();
  let disposed = false;

  for (const name of Object.keys(config.axes)) {
    axisStates.set(name, axisState(0, 0, null));
  }
  for (const name of Object.keys(config.buttons)) {
    buttonStates.set(name, readXrButton([], config.buttons[name], null));
  }

  return {
    update,
    getAxis,
    getButton,
    isPressed,
    on,
    setBindings,
    getSnapshot,
    dispose,
  };

  /**
   * @param {Iterable<unknown> | { inputSources?: Iterable<unknown>; session?: { inputSources?: Iterable<unknown> } }} source
   */
  function update(source = []) {
    assertActive();
    const inputSources = resolveInputSources(source);
    for (const [name, binding] of Object.entries(config.axes)) {
      const next = readXrAxis(inputSources, { ...binding, deadzone: config.deadzone });
      const previous = axisStates.get(name);
      axisStates.set(name, next);
      if (!axisEqual(previous, next)) {
        notify(name, next);
      }
    }
    for (const [name, binding] of Object.entries(config.buttons)) {
      const next = readXrButton(inputSources, binding, buttonStates.get(name) ?? null);
      const previous = buttonStates.get(name);
      buttonStates.set(name, next);
      if (!buttonEqual(previous, next)) {
        notify(name, next);
      }
    }
  }

  /**
   * @param {string} name
   */
  function getAxis(name) {
    return { ...(axisStates.get(name) ?? axisState(0, 0, null)) };
  }

  /**
   * @param {string} name
   */
  function getButton(name) {
    return { ...(buttonStates.get(name) ?? readXrButton([], {}, null)) };
  }

  /**
   * @param {string} name
   */
  function isPressed(name) {
    return getButton(name).pressed;
  }

  /**
   * @param {string} name
   * @param {(state: import('./index.d.ts').XrAxisState | import('./index.d.ts').XrButtonState) => void} listener
   */
  function on(name, listener) {
    assertActive();
    if (typeof listener !== 'function') {
      throw new TypeError('XrControlBindings.on() requires a listener.');
    }
    if (!listeners.has(name)) {
      listeners.set(name, new Set());
    }
    listeners.get(name)?.add(listener);
    return () => {
      listeners.get(name)?.delete(listener);
    };
  }

  /**
   * @param {import('./index.d.ts').XrControlBindingsOptions} next
   */
  function setBindings(next) {
    assertActive();
    config = normalizeBindingOptions({
      ...config,
      ...next,
      axes: { ...config.axes, ...(next.axes ?? {}) },
      buttons: { ...config.buttons, ...(next.buttons ?? {}) },
    });
    for (const name of Object.keys(config.axes)) {
      if (!axisStates.has(name)) axisStates.set(name, axisState(0, 0, null));
    }
    for (const name of Object.keys(config.buttons)) {
      if (!buttonStates.has(name)) buttonStates.set(name, readXrButton([], config.buttons[name], null));
    }
  }

  function getSnapshot() {
    return {
      disposed,
      deadzone: config.deadzone,
      axes: Object.fromEntries(Array.from(axisStates.entries()).map(([name, state]) => [name, { ...state }])),
      buttons: Object.fromEntries(Array.from(buttonStates.entries()).map(([name, state]) => [name, { ...state }])),
      bindings: {
        axes: cloneRecord(config.axes),
        buttons: cloneRecord(config.buttons),
      },
    };
  }

  function dispose() {
    disposed = true;
    listeners.clear();
  }

  /**
   * @param {string} name
   * @param {import('./index.d.ts').XrAxisState | import('./index.d.ts').XrButtonState} state
   */
  function notify(name, state) {
    for (const listener of listeners.get(name) ?? []) {
      listener({ ...state });
    }
  }

  function assertActive() {
    if (disposed) {
      throw new Error('XrControlBindings has been disposed.');
    }
  }
}

/**
 * @param {import('./index.d.ts').XrControlBindingsOptions} options
 */
function normalizeBindingOptions(options) {
  return {
    deadzone: normalizeDeadzone(options.deadzone),
    axes: { ...(options.axes ?? {}) },
    buttons: { ...(options.buttons ?? {}) },
  };
}

/**
 * @param {unknown} value
 */
function normalizeDeadzone(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0.15;
}

/**
 * @param {number} axesLength
 * @param {import('./index.d.ts').XrAxisBinding} binding
 * @returns {[number, number]}
 */
function resolveAxisIndices(axesLength, binding) {
  if (Array.isArray(binding.axes) && binding.axes.length === 2) {
    return [
      clampIndex(binding.axes[0], axesLength),
      clampIndex(binding.axes[1], axesLength),
    ];
  }
  if (binding.stick === 'secondary') {
    return [0, Math.min(1, axesLength - 1)];
  }
  return axesLength >= 4 ? [2, 3] : [0, Math.min(1, axesLength - 1)];
}

/**
 * @param {unknown} value
 * @param {number} length
 */
function clampIndex(value, length) {
  const index = Number.isInteger(value) ? Number(value) : 0;
  return Math.min(length - 1, Math.max(0, index));
}

/**
 * @param {unknown} button
 */
function resolveButtonIndex(button) {
  if (typeof button === 'number' && Number.isInteger(button) && button >= 0) {
    return button;
  }
  if (typeof button === 'string' && Object.hasOwn(BUTTON_ALIASES, button)) {
    return BUTTON_ALIASES[/** @type {keyof typeof BUTTON_ALIASES} */ (button)];
  }
  return 0;
}

/**
 * @param {unknown} source
 * @param {unknown} hand
 */
function sourceMatchesHand(source, hand) {
  if (!hand || hand === 'any') return true;
  return /** @type {{ handedness?: unknown }} */ (source)?.handedness === hand;
}

/**
 * @param {unknown} source
 */
function resolveInputSources(source) {
  if (source && typeof source === 'object' && Symbol.iterator in Object(source)) {
    return /** @type {Iterable<unknown>} */ (source);
  }
  const context = /** @type {{ inputSources?: Iterable<unknown>; session?: { inputSources?: Iterable<unknown> } }} */ (source);
  return context.inputSources ?? context.session?.inputSources ?? [];
}

/**
 * @param {number} x
 * @param {number} y
 * @param {string | null} activeHand
 */
function axisState(x, y, activeHand) {
  return {
    x,
    y,
    active: x !== 0 || y !== 0,
    magnitude: Math.hypot(x, y),
    activeHand,
  };
}

/**
 * @param {import('./index.d.ts').XrAxisState | undefined} a
 * @param {import('./index.d.ts').XrAxisState} b
 */
function axisEqual(a, b) {
  return !!a && a.x === b.x && a.y === b.y && a.activeHand === b.activeHand;
}

/**
 * @param {import('./index.d.ts').XrButtonState | undefined} a
 * @param {import('./index.d.ts').XrButtonState} b
 */
function buttonEqual(a, b) {
  return !!a
    && a.pressed === b.pressed
    && a.touched === b.touched
    && a.value === b.value
    && a.activeHand === b.activeHand;
}

/**
 * @template T
 * @param {Record<string, T>} record
 */
function cloneRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, { .../** @type {object} */ (value) }]));
}
