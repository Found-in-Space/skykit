import { createSkykitXrControlBindings } from './controls.js';

/**
 * @param {import('../xr.d.ts').SkykitXrActionBindingsPluginOptions} [options]
 * @returns {import('../xr.d.ts').SkykitXrActionBindingsPlugin}
 */
export function createSkykitXrActionBindingsPlugin(options = {}) {
  const id = options.id ?? 'skykit-xr-action-bindings';
  const axisBindings = { ...(options.bindings?.axes ?? {}) };
  const buttonBindings = { ...(options.bindings?.buttons ?? {}) };
  const controls = options.controls ?? createSkykitXrControlBindings({
    id: `${id}:controls`,
    axes: axisBindings,
    buttons: buttonBindings,
  });
  let disposed = false;
  let presenting = false;

  const part = {
    id,
    priority: options.priority ?? 40,
    /** @param {import('../index.d.ts').SkykitThreeFrame} frame */
    update(frame) {
      if (disposed) return;
      presenting = frame.xr?.presenting === true;
      const session = frame.xr?.session && typeof frame.xr.session === 'object'
        ? /** @type {{ inputSources?: Iterable<unknown> }} */ (frame.xr.session)
        : null;
      controls.update({ inputSources: session?.inputSources ?? [] });
      for (const [name, binding] of Object.entries(axisBindings)) {
        if (!binding.controlId) continue;
        const axis = controls.getAxis(name);
        const value = typeof binding.transform === 'function' ? binding.transform(axis) : axis;
        frame.viewer.actions.setControlValue(binding.controlId, value, {
          source: binding.source ?? `${id}:${name}`,
          control: name,
          activeHand: axis.activeHand,
        });
      }
      for (const [name, binding] of Object.entries(buttonBindings)) {
        const button = controls.getButton(name);
        const source = binding.source ?? `${id}:${name}`;
        const metadata = {
          source,
          control: name,
          activeHand: button.activeHand,
          value: button.value,
        };
        if (button.pressedEdge) {
          if (binding.actionId) {
            frame.viewer.actions.press(binding.actionId, button, metadata);
          }
          if (binding.pressActionId) {
            frame.viewer.actions.press(binding.pressActionId, button, metadata);
            frame.viewer.actions.release(binding.pressActionId, metadata);
          }
        }
        if (button.releasedEdge) {
          if (binding.actionId) {
            frame.viewer.actions.release(binding.actionId, metadata);
          }
          if (binding.releaseActionId) {
            frame.viewer.actions.press(binding.releaseActionId, button, metadata);
            frame.viewer.actions.release(binding.releaseActionId, metadata);
          }
        }
      }
    },
    dispose() {
      disposed = true;
      if (!options.controls) controls.dispose?.();
    },
    getSnapshot,
  };

  return {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSnapshot,
  };

  function getSnapshot() {
    return {
      id,
      disposed,
      presenting,
      axes: Object.keys(axisBindings),
      buttons: Object.keys(buttonBindings),
      controls: controls.getSnapshot?.() ?? null,
    };
  }
}
