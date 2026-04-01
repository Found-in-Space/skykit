/**
 * Feature preset that adds a fullscreen toggle button to the HUD.
 *
 * Returns `{ controller, controls }`. The controller captures the mount
 * element at attach time; the control uses `isActive` to stay in sync
 * when the user exits fullscreen via Escape.
 */
export function createFullscreenPreset(options = {}) {
  let mount = null;

  return {
    controller: {
      id: options.id ?? 'fullscreen-preset',
      attach(context) {
        mount = context.canvas?.parentElement ?? null;
      },
      update() {},
      dispose() { mount = null; },
    },
    controls: [{
      label: options.label ?? '⛶',
      title: options.title ?? 'Full screen',
      toggle: true,
      initialActive: false,
      position: options.position ?? 'top-right',
      onPress: (active) => {
        if (!mount) return;
        if (active) {
          mount.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      },
      isActive: () => document.fullscreenElement != null,
    }],
  };
}
