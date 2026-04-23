import { createCameraRigController } from '../controllers/camera-rig-controller.js';
import { createPickController } from '../controllers/pick-controller.js';
import { createSelectionRefreshController } from '../controllers/selection-refresh-controller.js';
import { createObserverShellField } from '../fields/observer-shell-field.js';
import {
  DEFAULT_MAG_LIMIT,
  DEFAULT_STAR_FIELD_STATE,
  createDefaultStarFieldMaterialProfile,
} from '../layers/star-field-materials.js';
import { createStarFieldLayer } from '../layers/star-field-layer.js';
import { ORION_CENTER_PC, SOLAR_ORIGIN_PC } from '../scene-targets.js';
import { createHud } from '../ui/hud.js';
import { createFullscreenPreset } from './fullscreen-preset.js';
import { createSpeedReadout } from './navigation-presets.js';

function normalizeEnabledOptions(value, fallback = {}) {
  if (value === true) return { ...fallback };
  if (!value || typeof value !== 'object') return null;
  return { ...fallback, ...value };
}

/**
 * Compose the standard desktop explorer stack used across demos and website
 * exploration pages.
 *
 * Returns a bundle that can be passed directly into `createViewer(...)`:
 *
 * - `interestField`
 * - `controllers`
 * - `layers`
 * - `state`
 *
 * The preset can also add a few explicit extras:
 *
 * - `fullscreen`
 * - `navigationHud`
 * - `picking`
 *
 * @param {any} [options]
 */
export function createDesktopExplorerPreset(options = {}) {
  const idPrefix = options.idPrefix ?? 'desktop-explorer';
  const observerPc = options.observerPc ?? SOLAR_ORIGIN_PC;
  const targetPc = options.targetPc ?? options.lookAtPc ?? ORION_CENTER_PC;

  const interestField = createObserverShellField({
    id: options.interestFieldId ?? `${idPrefix}-field`,
    ...(options.interestField && typeof options.interestField === 'object'
      ? options.interestField
      : {}),
  });

  const cameraController = createCameraRigController({
    id: options.cameraControllerId ?? `${idPrefix}-camera`,
    lookAtPc: targetPc,
    icrsToSceneTransform: options.icrsToSceneTransform,
    sceneToIcrsTransform: options.sceneToIcrsTransform,
    moveSpeed: options.moveSpeed,
    keyboardTarget: options.keyboardTarget,
    ...(options.cameraController && typeof options.cameraController === 'object'
      ? options.cameraController
      : {}),
  });

  const selectionRefreshController = createSelectionRefreshController({
    id: options.selectionRefreshControllerId ?? `${idPrefix}-refresh`,
    observerDistancePc: 12,
    minIntervalMs: 250,
    watchSize: false,
    ...(options.selectionRefresh && typeof options.selectionRefresh === 'object'
      ? options.selectionRefresh
      : {}),
  });

  const pickingOptions = normalizeEnabledOptions(options.picking);
  const starFieldLayer = createStarFieldLayer({
    id: options.starFieldLayerId ?? `${idPrefix}-stars`,
    positionTransform: options.positionTransform,
    materialFactory: options.materialFactory
      ?? (() => createDefaultStarFieldMaterialProfile()),
    includePickMeta: Boolean(pickingOptions),
    ...(options.starFieldLayer && typeof options.starFieldLayer === 'object'
      ? options.starFieldLayer
      : {}),
  });

  const pickController = pickingOptions
    ? createPickController({
      id: pickingOptions.id ?? `${idPrefix}-pick`,
      getStarData: () => starFieldLayer?.getStarData?.(),
      onPick: pickingOptions.onPick,
      toleranceDeg: pickingOptions.toleranceDeg,
      scale: pickingOptions.scale,
    })
    : null;

  const fullscreen = normalizeEnabledOptions(options.fullscreen)
    ? createFullscreenPreset({
      id: options.fullscreen?.id ?? `${idPrefix}-fullscreen`,
      label: options.fullscreen?.label,
      title: options.fullscreen?.title,
      position: options.fullscreen?.position,
    })
    : null;

  const navigationHud = normalizeEnabledOptions(options.navigationHud);
  const controls = [];

  if (navigationHud) {
    controls.push(
      { preset: navigationHud.primaryPreset ?? 'arrows', position: navigationHud.primaryPosition ?? 'bottom-right' },
      { preset: navigationHud.secondaryPreset ?? 'wasd-qe', position: navigationHud.secondaryPosition ?? 'bottom-left' },
      createSpeedReadout(cameraController, {
        label: navigationHud.speedLabel ?? 'Speed',
        position: navigationHud.readoutPosition ?? 'top-left',
      }),
    );

    if (Array.isArray(navigationHud.controls)) {
      controls.push(...navigationHud.controls);
    }
  }

  if (fullscreen?.controls) {
    controls.push(...fullscreen.controls);
  }

  if (Array.isArray(options.controls)) {
    controls.push(...options.controls);
  }

  const hudController = controls.length > 0
    ? createHud({
      cameraController,
      controls,
    })
    : null;

  const controllers = [
    cameraController,
    selectionRefreshController,
    ...(pickController ? [pickController] : []),
    ...(fullscreen?.controller ? [fullscreen.controller] : []),
    ...(hudController ? [hudController] : []),
  ];

  const state = {
    ...DEFAULT_STAR_FIELD_STATE,
    observerPc: { ...observerPc },
    targetPc: targetPc ? { ...targetPc } : null,
    fieldStrategy: 'observer-shell',
    mDesired: options.mDesired ?? DEFAULT_MAG_LIMIT,
    ...(options.state && typeof options.state === 'object' ? options.state : {}),
  };

  return {
    interestField,
    cameraController,
    selectionRefreshController,
    starFieldLayer,
    pickController,
    hudController,
    fullscreenController: fullscreen?.controller ?? null,
    fullscreenControls: fullscreen?.controls ?? [],
    controllers,
    layers: [starFieldLayer],
    controls,
    state,
  };
}
