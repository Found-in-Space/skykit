import { createSceneTouchDisplayController } from './scene-touch-display-controller.js';

const DEFAULT_HANDEDNESS = 'left';
const DEFAULT_PANEL_WIDTH = 0.20;
const DEFAULT_PANEL_HEIGHT = 0.28;

/**
 * XR tablet controller — XR host for a reusable touch-display runtime.
 *
 * This wrapper keeps the XR-specific "tablet in hand" placement, while the
 * underlying scene touch-display host handles the actual scene mesh, texture,
 * and pointer dispatch.
 */
export function createXrTabletController(options = {}) {
  const {
    items: initialItems = [],
    onChange,
    handedness = DEFAULT_HANDEDNESS,
    title,
    displayOptions = {},
    panelWidth = DEFAULT_PANEL_WIDTH,
    panelHeight = DEFAULT_PANEL_HEIGHT,
  } = options;

  return createSceneTouchDisplayController({
    id: options.id ?? 'xr-tablet-controller',
    title,
    items: initialItems,
    displayOptions,
    panelWidth,
    panelHeight,
    parent: 'cameraMount',
    depthTest: false,
    xrControls: {
      handedness,
    },
    updatePlacement(panelMesh, context, helpers) {
      const pose = helpers.getGripPose(context.xr, handedness);
      if (!pose) {
        return false;
      }

      const p = pose.transform.position;
      const o = pose.transform.orientation;
      panelMesh.position.set(p.x, p.y, p.z);
      panelMesh.quaternion.set(o.x, o.y, o.z, o.w);
      panelMesh.scale.set(1, 1, 1);

      // Tilt the panel toward the user and float it slightly above the grip.
      panelMesh.rotateX(-Math.PI * 0.35);
      panelMesh.translateZ(-0.02);
      panelMesh.translateY(0.08);
      return true;
    },
    onChange(id, value, detail) {
      if (typeof onChange === 'function') {
        onChange(id, value, detail);
      }
    },
  });
}
