import { createCameraRigController } from '../controllers/camera-rig-controller.js';
import { createSelectionRefreshController } from '../controllers/selection-refresh-controller.js';
import { createObserverShellField } from '../fields/observer-shell-field.js';
import { DEFAULT_MAG_LIMIT, DEFAULT_STAR_FIELD_STATE, createDefaultStarFieldMaterialProfile } from '../layers/star-field-materials.js';
import { createStarFieldLayer } from '../layers/star-field-layer.js';
import { SOLAR_ORIGIN_PC } from '../scene-targets.js';
import { createViewer } from './create-viewer.js';

export async function createDefaultViewer(host, options = {}) {
  const state = {
    ...DEFAULT_STAR_FIELD_STATE,
    observerPc: { ...SOLAR_ORIGIN_PC },
    mDesired: DEFAULT_MAG_LIMIT,
    ...(options.state && typeof options.state === 'object' ? options.state : {}),
  };

  const layers = Array.isArray(options.layers) && options.layers.length > 0
    ? options.layers
    : [
      createStarFieldLayer({
        id: options.starFieldLayerId ?? 'default-star-field-layer',
        materialFactory: options.materialFactory ?? (() => createDefaultStarFieldMaterialProfile()),
      }),
    ];

  const controllers = Array.isArray(options.controllers) && options.controllers.length > 0
    ? options.controllers
    : [
      createCameraRigController({
        id: options.cameraControllerId ?? 'default-camera-rig-controller',
      }),
      createSelectionRefreshController({
        id: options.selectionRefreshControllerId ?? 'default-selection-refresh-controller',
        observerDistancePc: 12,
        minIntervalMs: 250,
        watchSize: false,
      }),
    ];

  return createViewer(host, {
    ...options,
    interestField: options.interestField ?? createObserverShellField({
      id: options.interestFieldId ?? 'default-observer-shell-field',
    }),
    controllers,
    layers,
    state,
  });
}
