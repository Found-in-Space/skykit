import * as THREE from 'three';

import {
  combineStrategies,
  createLookaheadStrategy,
  createObserverShellStrategy,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createWarmStrategy,
} from '@found-in-space/star-trees';

import {
  SPATIAL_IDENTITY_QUATERNION,
  SPATIAL_LOCAL_RIGHT,
  SPATIAL_LOCAL_UP,
  addSpatialVectors,
  applySpatialQuaternion,
  buildSpatialOrbitalInsertRoute,
  buildSpatialOrbitTransferRoute,
  buildSpatialPolylineRoute,
  createSpatialPoseTransition,
  evaluateSpatialPoseTransition,
  createSpatialNavigationAutomation,
  createSpatialQuaternionFromAxisAngle as spatialQuaternionFromAxisAngle,
  normalizeSpatialDirection,
  subtractSpatialVectors,
  getSpatialVectorLength as spatialVectorLength,
} from '@found-in-space/spatial';
import {
  computeSkykitLookAtOrientation,
  resolveSkykitLookAt,
  resolveSkykitLookAtSync,
  resolveSkykitTarget,
  resolveSkykitTargetSync,
  skykitTargetToAimSpec,
} from './spatial-adapter.js';

import { SKYKIT_ACTIONS, SKYKIT_CONTROLS } from './actions.js';
import { createObject3dLayer } from './layers.js';
import { createStreamingStarLayer } from './streaming-stars.js';
import {
  cloneVector3,
  finiteNumber,
  normalizeQuaternion,
  normalizeVector3,
  positiveFinite,
  IDENTITY_QUATERNION,
} from './utils.js';

/**
 * @typedef {import('./index.d.ts').SkykitPlugin} SkykitPlugin
 * @typedef {import('./index.d.ts').SkykitThreePart} SkykitThreePart
 * @typedef {import('./index.d.ts').SkykitObject3dPlugin} SkykitObject3dPlugin
 * @typedef {import('./index.d.ts').SkykitStreamingStarsPlugin} SkykitStreamingStarsPlugin
 * @typedef {import('./index.d.ts').Object3dLayerOptions} Object3dLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayerOptions} StreamingStarLayerOptions
 * @typedef {import('./index.d.ts').StreamingStarLayer} StreamingStarLayer
 * @typedef {import('./index.d.ts').SkykitKeyboardNavigationOptions} SkykitKeyboardNavigationOptions
 * @typedef {import('./index.d.ts').SkykitKeyboardNavigationBindingContext} SkykitKeyboardNavigationBindingContext
 * @typedef {import('./index.d.ts').SkykitDragLookOptions} SkykitDragLookOptions
 * @typedef {import('./index.d.ts').SkykitOrbitDragOptions} SkykitOrbitDragOptions
 * @typedef {import('./index.d.ts').SkykitStatusPluginOptions} SkykitStatusPluginOptions
 * @typedef {import('./index.d.ts').Vector3Like} Vector3Like
 */

export const SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS = Object.freeze({
  KeyW: SKYKIT_ACTIONS.ship.moveForward,
  ArrowUp: SKYKIT_ACTIONS.ship.moveForward,
  KeyS: SKYKIT_ACTIONS.ship.moveBack,
  ArrowDown: SKYKIT_ACTIONS.ship.moveBack,
  KeyA: SKYKIT_ACTIONS.ship.moveLeft,
  ArrowLeft: SKYKIT_ACTIONS.ship.moveLeft,
  KeyD: SKYKIT_ACTIONS.ship.moveRight,
  ArrowRight: SKYKIT_ACTIONS.ship.moveRight,
  KeyE: SKYKIT_ACTIONS.ship.moveUp,
  PageUp: SKYKIT_ACTIONS.ship.moveUp,
  KeyQ: SKYKIT_ACTIONS.ship.moveDown,
  PageDown: SKYKIT_ACTIONS.ship.moveDown,
});

const DEFAULT_BOOST_KEYS = Object.freeze(['ShiftLeft', 'ShiftRight', 'Shift']);
const DEFAULT_ORBIT_SENSITIVITY_RADIANS_PER_PIXEL = 0.00115;
const DEFAULT_ORBIT_WORLD_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const ORBIT_EPSILON = 1e-9;

const LEGACY_KEYBOARD_ACTION_ALIASES = Object.freeze({
  forward: SKYKIT_ACTIONS.ship.moveForward,
  back: SKYKIT_ACTIONS.ship.moveBack,
  left: SKYKIT_ACTIONS.ship.moveLeft,
  right: SKYKIT_ACTIONS.ship.moveRight,
  up: SKYKIT_ACTIONS.ship.moveUp,
  down: SKYKIT_ACTIONS.ship.moveDown,
  pitchUp: SKYKIT_ACTIONS.ship.pitchUp,
  pitchDown: SKYKIT_ACTIONS.ship.pitchDown,
  yawLeft: SKYKIT_ACTIONS.ship.yawLeft,
  yawRight: SKYKIT_ACTIONS.ship.yawRight,
  rollClockwise: SKYKIT_ACTIONS.ship.rollClockwise,
  rollAnticlockwise: SKYKIT_ACTIONS.ship.rollAnticlockwise,
});

/**
 * @param {Partial<Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>>} [overrides]
 * @returns {Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>}
 */
export function createSkykitDefaultKeyboardNavigationBindings(overrides = {}) {
  return {
    ...SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS,
    ...overrides,
  };
}

/**
 * @param {Object3dLayerOptions} options
 * @returns {SkykitObject3dPlugin}
 */
export function createObject3dPlugin(options) {
  /** @type {SkykitThreePart | null} */
  let layer = null;
  const id = options?.id ?? 'object3d-plugin';
  return {
    id,
    setup(context) {
      layer = createObject3dLayer(options);
      context.addPart(layer);
    },
    getLayer() {
      return layer;
    },
    getSnapshot() {
      return layer?.getSnapshot?.() ?? { id, layer: null };
    },
  };
}

/**
 * @param {StreamingStarLayerOptions} options
 * @returns {SkykitStreamingStarsPlugin}
 */
export function createStreamingStarsPlugin(options) {
  /** @type {StreamingStarLayer | null} */
  let layer = null;
  const id = options?.id ?? 'streaming-stars-plugin';
  return {
    id,
    setup(context) {
      layer = createStreamingStarLayer(options);
      context.addPart(layer);
    },
    getLayer() {
      return layer;
    },
    getSnapshot() {
      return layer?.getSnapshot?.() ?? { id, layer: null };
    },
  };
}

/**
 * @param {import('./index.d.ts').SkykitNavigationPluginOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitNavigationPlugin(options = {}) {
  const id = options.id ?? 'navigation';
  const navigation = options.navigation ?? createSpatialNavigationAutomation();
  const scaleProfile = options.scaleProfile ?? { navigationUnits: 'pc', metersPerNavigationUnit: 3.085677581e16 };
  let disposed = false;
  /** @type {import('@found-in-space/spatial').SpatialPoseTransition | null} */
  let activeTransition = null;
  /** @type {(() => void) | null} */
  let activeTransitionOnArrive = null;
  let transitionElapsedSeconds = 0;

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    update(frame) {
      if (disposed) return;
      if (activeTransition) {
        transitionElapsedSeconds += Math.max(0, finiteNumber(frame.deltaSeconds, 0));
        const sample = evaluateSpatialPoseTransition(activeTransition, transitionElapsedSeconds);
        const current = frame.view;
        if (!sameVector(current.observerPc, sample.pose.observerPc) || !sameQuaternion(current.orientationIcrs, sample.pose.orientationIcrs)) {
          frame.viewer.requestViewState({
            observerPc: sample.pose.observerPc,
            orientationIcrs: sample.pose.orientationIcrs,
          }, id);
        }
        if (sample.complete) {
          const onArrive = activeTransitionOnArrive;
          activeTransition = null;
          activeTransitionOnArrive = null;
          transitionElapsedSeconds = 0;
          onArrive?.();
        }
        return;
      }
      const pose = navigation.update({
        pose: {
          observerPc: frame.view.observerPc,
          orientationIcrs: frame.view.orientationIcrs ?? SPATIAL_IDENTITY_QUATERNION,
        },
        deltaSecs: frame.deltaSeconds,
        manualLookActive: Boolean(frame.viewer.actions.getControlValue('skykit:navigation.manualLookActive')),
      });
      const current = frame.view;
      if (!sameVector(current.observerPc, pose.observerPc) || !sameQuaternion(current.orientationIcrs, pose.orientationIcrs)) {
        frame.viewer.requestViewState({
          observerPc: pose.observerPc,
          orientationIcrs: pose.orientationIcrs,
        }, id);
      }
    },
    dispose() {
      disposed = true;
      navigation.dispose?.();
    },
    getSnapshot() {
      return {
        id,
        disposed,
        navigation: navigation.getDiagnostics?.() ?? null,
        transition: activeTransition
          ? {
              active: true,
              elapsedSeconds: transitionElapsedSeconds,
              durationSecs: activeTransition.durationSecs,
            }
          : { active: false },
      };
    },
  };

  return {
    id,
    setup(context) {
      const threeContext = /** @type {import('./index.d.ts').SkykitThreePluginContext} */ (context);
      const removePart = threeContext.addPart(part);
      const unregisterActions = registerNavigationActions(threeContext);
      return () => {
        unregisterActions();
        removePart();
      };
    },
    getSnapshot: () => part.getSnapshot?.() ?? null,
  };

  /**
   * @param {import('./index.d.ts').SkykitThreePluginContext} context
   */
  function registerNavigationActions(context) {
    const unregisters = [
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.flyTo, async ({ payload }) => {
        const target = await resolveTarget(payload, context);
        if (target) {
          const route = buildRouteToTarget(context.getViewState().observerPc, target, payload);
          if (route) navigation.flyRoute(route);
        }
        return target;
      }, { label: 'Fly to target' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.flyPolyline, async ({ payload }) => {
        const points = await resolvePointList(payload, context);
        if (points.length >= 2) {
          navigation.flyRoute(buildSpatialPolylineRoute({
            pointsPc: points,
            travel: { kind: 'polyline', timing: resolveRouteTiming(payload, points) },
          }));
        }
        return points;
      }, { label: 'Fly polyline' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.transitionTo, async ({ payload }) => {
        activeTransition = await createTransition(payload, context);
        activeTransitionOnArrive = resolveOnArrive(payload);
        transitionElapsedSeconds = 0;
        navigation.cancel();
        return activeTransition;
      }, { label: 'Transition to view' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.orbit, async ({ payload }) => {
        const target = await resolveCenter(payload, context);
        if (target) navigation.orbit(resolveOrbitSpec(target, payload));
        return target;
      }, { label: 'Orbit target' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.orbitalInsert, async ({ payload }) => {
        const target = await resolveCenter(payload, context);
        if (target) {
          const route = buildSpatialOrbitalInsertRoute({
            from: { positionPc: context.getViewState().observerPc },
            orbit: resolveOrbitSpec(target, payload),
            travel: {
              kind: 'orbitalInsert',
              timing: resolveRouteTiming(payload),
              sampleStepSecs: resolveSampleStepSecs(payload),
            },
          });
          if (route) navigation.flyRoute(route);
        }
        return target;
      }, { label: 'Insert into orbit' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.lookAt, async ({ payload }) => {
        const target = await resolveTarget(payload, context);
        if (target) navigation.lookAt(/** @type {import('@found-in-space/spatial').SpatialAimSpec} */ (skykitTargetToAimSpec(target, payloadOptions(payload))));
        return target;
      }, { label: 'Look at target' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.lockAt, async ({ payload }) => {
        const target = await resolveTarget(payload, context);
        if (target) navigation.lockAt(/** @type {Extract<import('@found-in-space/spatial').SpatialAimSpec, { kind: 'target' }>} */ (skykitTargetToAimSpec(target, payloadOptions(payload))));
        return target;
      }, { label: 'Lock at target' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.unlockAt, () => {
        navigation.unlockAt();
      }, { label: 'Unlock look target' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.cancelMovement, () => {
        activeTransition = null;
        activeTransitionOnArrive = null;
        transitionElapsedSeconds = 0;
        navigation.cancel();
      }, { label: 'Cancel movement' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.cancelOrientation, () => {
        activeTransition = null;
        activeTransitionOnArrive = null;
        transitionElapsedSeconds = 0;
        navigation.cancel();
      }, { label: 'Cancel orientation' }),
      context.actions.registerAction(SKYKIT_ACTIONS.navigation.cancel, () => {
        activeTransition = null;
        activeTransitionOnArrive = null;
        transitionElapsedSeconds = 0;
        navigation.cancel();
      }, { label: 'Cancel navigation' }),
    ];
    return () => {
      for (const unregister of unregisters.reverse()) unregister();
    };
  }

  /**
   * @param {unknown} input
   * @param {import('./index.d.ts').SkykitThreePluginContext} context
   */
  async function resolveTarget(input, context) {
    const custom = options.resolveTarget?.(input, context);
    if (custom !== undefined) {
      return await custom;
    }
    return await resolveSkykitTarget(input, {
      observerPc: context.getViewState().observerPc,
      resolveBookmark: typeof options.resolveBookmark === 'function'
        ? (/** @type {string} */ bookmarkId, /** @type {import('@found-in-space/spatial').SpatialTargetSpec} */ original) => {
          const resolved = options.resolveBookmark?.(bookmarkId, original, context);
          return resolved === undefined ? null : resolved;
        }
        : undefined,
    });
  }

  /**
   * @param {unknown} payload
   * @param {import('./index.d.ts').SkykitThreePluginContext} context
   */
  async function resolveCenter(payload, context) {
    if (payload && typeof payload === 'object' && 'center' in payload) {
      return resolveTarget(/** @type {{ center?: unknown }} */ (payload).center, context);
    }
    return resolveTarget(payload, context);
  }

  /**
   * @param {unknown} payload
   * @param {import('./index.d.ts').SkykitThreePluginContext} context
   */
  async function resolvePointList(payload, context) {
    const rawPoints = payload && typeof payload === 'object' && 'points' in payload
      ? /** @type {{ points?: Iterable<unknown> }} */ (payload).points
      : payload;
    const points = [];
    for (const point of Array.from(/** @type {Iterable<unknown>} */ (rawPoints ?? []))) {
      const resolved = await resolveTarget(point, context);
      if (resolved) points.push(resolved);
    }
    return points;
  }

  /**
   * @param {unknown} payload
   * @param {import('./index.d.ts').SkykitThreePluginContext} context
   */
  async function createTransition(payload, context) {
    const source = /** @type {Record<string, unknown>} */ (payload && typeof payload === 'object' ? payload : {});
    const targetSource = /** @type {Record<string, unknown>} */ (
      source.view && typeof source.view === 'object'
        ? source.view
        : source.to && typeof source.to === 'object'
          ? source.to
          : source
    );
    const current = context.getViewState();
    const positionInput = resolveTransitionPositionInput(targetSource);
    const position = positionInput === undefined
      ? current.observerPc
      : await resolveTarget(positionInput, context) ?? current.observerPc;
    const lookAtInput = targetSource.lookAt;
    const resolvedLook = lookAtInput !== undefined
      ? await resolveSkykitLookAt(lookAtInput, {
        observerPc: position,
        resolveBookmark: typeof options.resolveBookmark === 'function'
          ? (/** @type {string} */ bookmarkId, /** @type {import('@found-in-space/spatial').SpatialTargetSpec} */ original) => options.resolveBookmark?.(bookmarkId, original, context) ?? null
          : undefined,
      })
      : null;
    const orientationInput = targetSource.orientationIcrs
      ?? (targetSource.orientation && isQuaternionLike(targetSource.orientation) ? targetSource.orientation : undefined)
      ?? source.orientationIcrs;
    const orientation = resolvedLook?.orientationIcrs
      ?? normalizeQuaternion(orientationInput, current.orientationIcrs ?? IDENTITY_QUATERNION);
    const durationSecs = source.durationSecs ?? targetSource.durationSecs;
    return createSpatialPoseTransition({
      from: {
        observerPc: current.observerPc,
        orientationIcrs: current.orientationIcrs ?? IDENTITY_QUATERNION,
      },
      to: {
        observerPc: position,
        orientationIcrs: orientation,
      },
      ...(durationSecs !== undefined ? { durationSecs: finiteNumber(durationSecs, 1) } : {}),
      movement: normalizeTransitionLane(source.movement ?? targetSource.movement, source.movementDurationSecs),
      orientation: normalizeTransitionLane(
        isQuaternionLike(source.orientation) ? undefined : source.orientation ?? targetSource.orientationTransition,
        source.orientationDurationSecs,
      ),
    });
  }
}


/**
 * Strategy-only convenience helper. View-bound lookahead hints stay in preload
 * requests so their authored view can travel with the warm-lane strategy.
 *
 * @param {Iterable<import('@found-in-space/spatial').SpatialPreloadHint>} hints
 * @param {import('./index.d.ts').SkykitSpatialPreloadStrategyOptions} [options]
 */
export function createSkykitStarStrategiesFromSpatialHints(hints, options = {}) {
  const requests = createSkykitStarPreloadRequestsFromSpatialHints(hints, options);
  const strategies = requests
    .filter((request) => !request.view)
    .map((request) => request.strategy);
  if (options.combine === false) return strategies;
  if (strategies.length === 0) return null;
  return strategies.length === 1 ? strategies[0] : combineStrategies(strategies);
}

/**
 * @param {Iterable<import('@found-in-space/spatial').SpatialPreloadHint>} hints
 * @param {import('./index.d.ts').SkykitSpatialPreloadStrategyOptions} [options]
 * @returns {import('./index.d.ts').SkykitStarPreloadRequest[]}
 */
export function createSkykitStarPreloadRequestsFromSpatialHints(hints, options = {}) {
  /** @type {import('./index.d.ts').SkykitStarPreloadRequest[]} */
  const requests = [];
  for (const hint of Array.from(hints ?? [])) {
    if (!hint || typeof hint !== 'object') continue;
    if (hint.kind === 'pathVolume' && hint.pointsPc.length >= 2 && hint.radiusPc > 0) {
      requests.push({
        strategy: createWarmStrategy(createPathVolumeStrategy({
          pointsPc: hint.pointsPc,
          radiusPc: hint.radiusPc,
        }), {
          reason: 'spatial-preload',
          scoreBias: finiteNumber(hint.priority, 0),
        }),
        sourceHint: hint,
      });
      continue;
    }
    if (hint.kind === 'sphereVolume' && hint.radiusPc > 0) {
      requests.push({
        strategy: createWarmStrategy(createSphereVolumeStrategy({
          centerPc: hint.centerPc,
          radiusPc: hint.radiusPc,
        }), {
          reason: 'spatial-preload',
          scoreBias: finiteNumber(hint.priority, 0),
        }),
        sourceHint: hint,
      });
      continue;
    }
    if (hint.kind === 'viewLookahead' && hint.lookaheadSecs > 0) {
      const velocity = cloneVector3(hint.velocityPcPerSec);
      requests.push({
        strategy: createLookaheadStrategy({
          base: options.baseStrategy ?? createObserverShellStrategy(),
          horizonSecs: hint.lookaheadSecs,
          tickSecs: hint.lookaheadSecs,
        }),
        view: {
          observerPc: cloneVector3(hint.pose.observerPc),
          orientationIcrs: normalizeQuaternion(hint.pose.orientationIcrs, IDENTITY_QUATERNION),
          motion: {
            velocityPcPerSec: velocity,
            speedPcPerSec: Math.hypot(velocity.x, velocity.y, velocity.z),
            lookaheadSecs: hint.lookaheadSecs,
          },
        },
        sourceHint: hint,
      });
    }
  }
  return requests;
}

/**
 * @param {SkykitKeyboardNavigationOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createKeyboardNavigationPlugin(options = {}) {
  const id = options.id ?? 'keyboard-navigation';
  const speedPcPerSec = positiveFinite(options.speedPcPerSec, 1);
  const rotationSpeedDegPerSec = positiveFinite(options.rotationSpeedDegPerSec, 60);
  const boostMultiplier = positiveFinite(options.boostMultiplier, 10);
  const bindings = /** @type {Record<string, import('./index.d.ts').SkykitKeyboardNavigationBinding>} */ (
    options.bindings ?? SKYKIT_DEFAULT_KEYBOARD_NAVIGATION_BINDINGS
  );
  const boostKeys = new Set(options.boostKeys ?? DEFAULT_BOOST_KEYS);
  const verticalMode = options.verticalMode ?? 'view';
  const pressed = new Set();
  let enabled = options.enabled !== false;
  let attached = false;
  /** @type {import('./index.d.ts').SkykitThreePluginContext | null} */
  let pluginContext = null;
  /** @type {EventTarget | null} */
  let activeTarget = null;
  /** @type {Vector3Like} */
  let lastVelocityPcPerSec = { x: 0, y: 0, z: 0 };

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    attach(context) {
      pluginContext = context;
      activeTarget = options.target ?? getDefaultEventTarget();
      activeTarget?.addEventListener?.('keydown', onKeyDown);
      activeTarget?.addEventListener?.('keyup', onKeyUp);
      attached = Boolean(activeTarget);
    },
    update(frame) {
      if (!enabled) return;
      const deltaSeconds = Math.max(0, finiteNumber(frame.deltaSeconds, 0));
      const actions = pluginContext?.actions ?? frame.viewer.actions;
      const boosted = actions.isPressed(SKYKIT_ACTIONS.ship.boost);
      const patch = /** @type {Partial<import('./index.d.ts').SkykitViewState>} */ ({});
      const movement = resolveMovementVector(frame.view.orientationIcrs, actions, verticalMode);
      const length = Math.hypot(movement.x, movement.y, movement.z);
      if (length > 0) {
        const speed = speedPcPerSec * (boosted ? boostMultiplier : 1);
        const distance = speed * deltaSeconds;
        const unit = {
          x: movement.x / length,
          y: movement.y / length,
          z: movement.z / length,
        };
        patch.observerPc = {
          x: frame.view.observerPc.x + unit.x * distance,
          y: frame.view.observerPc.y + unit.y * distance,
          z: frame.view.observerPc.z + unit.z * distance,
        };
        lastVelocityPcPerSec = {
          x: unit.x * speed,
          y: unit.y * speed,
          z: unit.z * speed,
        };
      } else {
        lastVelocityPcPerSec = { x: 0, y: 0, z: 0 };
      }
      actions.setControlValue(SKYKIT_CONTROLS.ship.move, cloneVector3(lastVelocityPcPerSec), {
        source: id,
      });

      const rotation = resolveRotationInput(actions);
      const rotationLength = Math.hypot(rotation.pitch, rotation.yaw, rotation.roll);
      actions.setControlValue(SKYKIT_CONTROLS.ship.attitude, { ...rotation }, {
        source: id,
      });
      if (rotationLength > 0) {
        const radiansPerSecond = (rotationSpeedDegPerSec * Math.PI) / 180;
        const angle = radiansPerSecond * (boosted ? boostMultiplier : 1) * deltaSeconds;
        patch.orientationIcrs = rotateOrientationByKeyboard(frame.view.orientationIcrs, {
          pitchRad: (rotation.pitch / rotationLength) * angle,
          yawRad: (rotation.yaw / rotationLength) * angle,
          rollRad: (rotation.roll / rotationLength) * angle,
        });
      }

      if (patch.observerPc || patch.orientationIcrs) {
        frame.viewer.requestViewState(patch, 'keyboard-navigation');
      }
    },
    detach() {
      releasePressedKeys();
      activeTarget?.removeEventListener?.('keydown', onKeyDown);
      activeTarget?.removeEventListener?.('keyup', onKeyUp);
      activeTarget = null;
      pluginContext = null;
      attached = false;
      pressed.clear();
    },
    dispose() {
      this.detach?.();
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

  /** @param {Event} event */
  function onKeyDown(event) {
    const key = getEventKey(event);
    if (!key) return;
    const binding = bindings[key];
    if (typeof binding === 'function') {
      pressed.delete(key);
      if (options.preventDefault !== false) event.preventDefault?.();
      void binding(createKeyboardBindingContext(key, event));
      return;
    }
    const action = typeof binding === 'string' ? normalizeKeyboardAction(binding) : null;
    if (action && pluginContext) {
      if (isHeldKeyboardAction(action)) {
        if (!pressed.has(key)) {
          pluginContext.actions.press(action, { key }, keyboardMetadata(key));
        }
        pressed.add(key);
      } else {
        void pluginContext.actions.invoke(action, { key }, keyboardMetadata(key));
      }
    }
    if (boostKeys.has(key) && pluginContext) {
      pluginContext.actions.press(SKYKIT_ACTIONS.ship.boost, { key }, keyboardMetadata(key));
      pressed.add(key);
    }
    if (binding || boostKeys.has(key)) {
      if (options.preventDefault !== false) event.preventDefault?.();
    }
  }

  /** @param {Event} event */
  function onKeyUp(event) {
    const key = getEventKey(event);
    if (!key) return;
    const binding = bindings[key];
    const action = typeof binding === 'string' ? normalizeKeyboardAction(binding) : null;
    if (action && isHeldKeyboardAction(action)) {
      pluginContext?.actions.release(action, keyboardMetadata(key));
    }
    if (boostKeys.has(key)) {
      pluginContext?.actions.release(SKYKIT_ACTIONS.ship.boost, keyboardMetadata(key));
    }
    pressed.delete(key);
    if (bindings[key] || boostKeys.has(key)) {
      if (options.preventDefault !== false) event.preventDefault?.();
    }
  }

  /**
   * @param {string} key
   * @param {Event} event
   * @returns {SkykitKeyboardNavigationBindingContext}
   */
  function createKeyboardBindingContext(key, event) {
    if (!pluginContext) {
      throw new Error('Keyboard binding callback fired before the keyboard plugin was attached.');
    }
    const context = pluginContext;
    return {
      key,
      event,
      context,
      viewer: context.viewer,
      actions: context.actions,
      getViewState() {
        return context.getViewState();
      },
      requestViewState(patch, reason = 'keyboard-navigation') {
        context.requestViewState(patch, reason);
      },
    };
  }

  function getSnapshot() {
    return {
      id,
      enabled,
      attached,
      pressed: Array.from(pressed),
      speedPcPerSec,
      rotationSpeedDegPerSec,
      boostMultiplier,
      verticalMode,
      lastVelocityPcPerSec: cloneVector3(lastVelocityPcPerSec),
      pressedActions: pluginContext
        ? [
            SKYKIT_ACTIONS.ship.moveForward,
            SKYKIT_ACTIONS.ship.moveBack,
            SKYKIT_ACTIONS.ship.moveLeft,
            SKYKIT_ACTIONS.ship.moveRight,
            SKYKIT_ACTIONS.ship.moveUp,
            SKYKIT_ACTIONS.ship.moveDown,
            SKYKIT_ACTIONS.ship.pitchUp,
            SKYKIT_ACTIONS.ship.pitchDown,
            SKYKIT_ACTIONS.ship.yawLeft,
            SKYKIT_ACTIONS.ship.yawRight,
            SKYKIT_ACTIONS.ship.rollClockwise,
            SKYKIT_ACTIONS.ship.rollAnticlockwise,
            SKYKIT_ACTIONS.ship.boost,
          ].filter((action) => pluginContext?.actions.isPressed(action))
        : [],
    };
  }

  /**
   * @param {boolean} nextEnabled
   */
  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) releasePressedKeys();
  }

  // Expose a tiny imperative seam for lessons/tests without introducing a registry.
  Object.assign(part, { setEnabled });

  function releasePressedKeys() {
    if (!pluginContext) {
      pressed.clear();
      return;
    }
    for (const key of pressed) {
      const binding = bindings[key];
      const action = typeof binding === 'string' ? normalizeKeyboardAction(binding) : null;
      if (action && isHeldKeyboardAction(action)) {
        pluginContext.actions.release(action, keyboardMetadata(key));
      }
      if (boostKeys.has(key)) {
        pluginContext.actions.release(SKYKIT_ACTIONS.ship.boost, keyboardMetadata(key));
      }
    }
    pressed.clear();
  }
}

/**
 * @param {SkykitDragLookOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkyGrabPlugin(options = {}) {
  return createDragLookPlugin({
    ...options,
    id: options.id ?? 'sky-grab',
    dragMode: 'grab',
  });
}

/**
 * @param {SkykitDragLookOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createMouseLookPlugin(options = {}) {
  return createDragLookPlugin({
    ...options,
    id: options.id ?? 'mouse-look',
    dragMode: 'look',
  });
}

/**
 * @param {SkykitOrbitDragOptions} [options]
 * @returns {SkykitPlugin & {
 *   getSnapshot(): unknown;
 *   setEnabled(nextEnabled: boolean): void;
 *   setCenter(nextCenter: unknown): void;
 * }}
 */
export function createSkyOrbitPlugin(options = {}) {
  const id = options.id ?? 'sky-orbit';
  const sensitivityRadiansPerPixel = positiveFinite(
    options.sensitivityRadiansPerPixel,
    DEFAULT_ORBIT_SENSITIVITY_RADIANS_PER_PIXEL,
  );
  const verticalSensitivityRadiansPerPixel = positiveFinite(
    options.verticalSensitivityRadiansPerPixel,
    sensitivityRadiansPerPixel,
  );
  const horizontalAxisMode = options.horizontalAxisMode === 'world-up' ? 'world-up' : 'screen-up';
  const worldUp = normalizeOrbitDirection(options.worldUp) ?? cloneVector3(DEFAULT_ORBIT_WORLD_UP);
  const button = Number.isInteger(options.button) ? Number(options.button) : 0;
  const fallbackCenter = normalizeOrbitFallbackCenter(options.fallbackCenter);
  const lockLookAt = options.lockLookAt !== false;
  const centerPcInput = options.centerPc;
  let configuredCenter = options.center;
  let enabled = options.enabled !== false;
  let attached = false;
  let pointerId = /** @type {number | null} */ (null);
  let lastClientX = /** @type {number | null} */ (null);
  let lastClientY = /** @type {number | null} */ (null);
  let lastCenterPc = /** @type {Vector3Like | null} */ (null);
  let lastRadiusPc = /** @type {number | null} */ (null);
  /** @type {{ centerPc: Vector3Like; radial: Vector3Like; radiusPc: number; up: Vector3Like; right: Vector3Like } | null} */
  let dragState = null;
  /** @type {EventTarget | null} */
  let activeTarget = null;
  /** @type {{ setPointerCapture?: (pointerId: number) => void; releasePointerCapture?: (pointerId: number) => void } | null} */
  let pointerCaptureTarget = null;
  /** @type {import('./index.d.ts').SkykitViewer | null} */
  let viewer = null;

  /** @type {SkykitThreePart & {
   *   setEnabled(nextEnabled: boolean): void;
   *   setCenter(nextCenter: unknown): void;
   * }}
   */
  const part = {
    id,
    priority: options.priority,
    attach(context) {
      viewer = context.viewer;
      activeTarget = options.target ?? getDefaultEventTarget();
      activeTarget?.addEventListener?.('pointerdown', onPointerDown);
      activeTarget?.addEventListener?.('pointermove', onPointerMove);
      activeTarget?.addEventListener?.('pointerup', onPointerUp);
      activeTarget?.addEventListener?.('pointercancel', onPointerUp);
      attached = Boolean(activeTarget);
    },
    detach() {
      clearDragState({ releaseCapture: true });
      activeTarget?.removeEventListener?.('pointerdown', onPointerDown);
      activeTarget?.removeEventListener?.('pointermove', onPointerMove);
      activeTarget?.removeEventListener?.('pointerup', onPointerUp);
      activeTarget?.removeEventListener?.('pointercancel', onPointerUp);
      activeTarget = null;
      pointerCaptureTarget = null;
      viewer = null;
      attached = false;
      lastCenterPc = null;
      lastRadiusPc = null;
    },
    dispose() {
      this.detach?.();
    },
    getSnapshot,
    setEnabled,
    setCenter,
  };

  /** @type {SkykitPlugin & {
   *   getSnapshot(): unknown;
   *   setEnabled(nextEnabled: boolean): void;
   *   setCenter(nextCenter: unknown): void;
   * }}
   */
  const plugin = {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSnapshot,
    setEnabled,
    setCenter,
  };

  return plugin;

  /** @param {Event} event */
  function onPointerDown(event) {
    if (!enabled || !viewer) return;
    const pointerEvent = /** @type {{ button?: unknown; pointerId?: unknown; clientX?: unknown; clientY?: unknown; preventDefault?: () => void; currentTarget?: unknown }} */ (event);
    if (Number(pointerEvent.button ?? 0) !== button) return;
    const view = viewer.getViewState();
    const centerPc = resolveOrbitCenter(view);
    if (!centerPc || !isQuaternionLike(view.orientationIcrs)) return;
    const orientationIcrs = /** @type {import('./index.d.ts').QuaternionLike} */ (view.orientationIcrs);
    const radial = subtractSpatialVectors(view.observerPc, centerPc);
    const radiusPc = spatialVectorLength(radial);
    if (!(radiusPc > ORBIT_EPSILON)) return;
    const frame = deriveOrbitCameraFrame(orientationIcrs);
    if (!frame) return;
    dragState = {
      centerPc,
      radial,
      radiusPc,
      up: frame.up,
      right: frame.right,
    };
    lastCenterPc = cloneVector3(centerPc);
    lastRadiusPc = radiusPc;
    pointerId = Number.isFinite(Number(pointerEvent.pointerId)) ? Number(pointerEvent.pointerId) : null;
    lastClientX = Number.isFinite(Number(pointerEvent.clientX)) ? Number(pointerEvent.clientX) : null;
    lastClientY = Number.isFinite(Number(pointerEvent.clientY)) ? Number(pointerEvent.clientY) : null;
    pointerCaptureTarget = /** @type {{ releasePointerCapture?: (pointerId: number) => void; setPointerCapture?: (pointerId: number) => void } | null} */ (
      pointerEvent.currentTarget ?? activeTarget
    );
    if (pointerId != null) {
      try {
        pointerCaptureTarget?.setPointerCapture?.(pointerId);
      } catch {
        // Some DOM implementations throw when capture is not available for the pointer.
      }
    }
    viewer.actions.setControlValue('skykit:navigation.manualLookActive', true, { source: id });
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  /** @param {Event} event */
  function onPointerMove(event) {
    if (!enabled || !dragState || !viewer) return;
    const pointerEvent = /** @type {{ pointerId?: unknown; clientX?: unknown; clientY?: unknown; movementX?: unknown; movementY?: unknown; preventDefault?: () => void }} */ (event);
    const eventPointerId = Number(pointerEvent.pointerId);
    if (pointerId != null && Number.isFinite(eventPointerId) && eventPointerId !== pointerId) return;
    const clientX = Number(pointerEvent.clientX);
    const clientY = Number(pointerEvent.clientY);
    let movementX = finiteNumber(pointerEvent.movementX, 0);
    let movementY = finiteNumber(pointerEvent.movementY, 0);
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      movementX = lastClientX == null ? 0 : clientX - lastClientX;
      movementY = lastClientY == null ? 0 : clientY - lastClientY;
      lastClientX = clientX;
      lastClientY = clientY;
    }
    if (movementX === 0 && movementY === 0) return;

    const next = computeNextOrbitDragState(
      dragState,
      movementX * sensitivityRadiansPerPixel,
      movementY * verticalSensitivityRadiansPerPixel,
    );
    if (!next) return;
    dragState = next.state;
    lastCenterPc = cloneVector3(next.state.centerPc);
    lastRadiusPc = next.state.radiusPc;
    viewer.actions.setControlValue('skykit:navigation.manualLookActive', true, { source: id });
    viewer.requestViewState(next.patch, id);
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  /** @param {Event} event */
  function onPointerUp(event) {
    if (!dragState && pointerId == null) return;
    const pointerEvent = /** @type {{ pointerId?: unknown; preventDefault?: () => void; currentTarget?: unknown }} */ (event);
    const eventPointerId = Number(pointerEvent.pointerId);
    if (pointerId != null && Number.isFinite(eventPointerId) && eventPointerId !== pointerId) return;
    clearDragState({
      releaseCapture: true,
      currentTarget: /** @type {{ releasePointerCapture?: (pointerId: number) => void } | null} */ (pointerEvent.currentTarget ?? null),
    });
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  /**
   * @param {{ centerPc: Vector3Like; radial: Vector3Like; radiusPc: number; up: Vector3Like; right: Vector3Like }} state
   * @param {number} horizontalRad
   * @param {number} verticalRad
   * @returns {{ state: { centerPc: Vector3Like; radial: Vector3Like; radiusPc: number; up: Vector3Like; right: Vector3Like }; patch: Partial<import('./index.d.ts').SkykitViewState> } | null}
   */
  function computeNextOrbitDragState(state, horizontalRad, verticalRad) {
    const horizontalAxis = horizontalAxisMode === 'world-up' ? worldUp : state.up;
    const horizontalDelta = spatialQuaternionFromAxisAngle(horizontalAxis, horizontalRad);
    let radial = applySpatialQuaternion(state.radial, horizontalDelta);
    let up = applySpatialQuaternion(state.up, horizontalDelta);
    let right = applySpatialQuaternion(state.right, horizontalDelta);
    const verticalAxis = normalizeOrbitDirection(right);
    if (!verticalAxis) return null;
    const verticalDelta = spatialQuaternionFromAxisAngle(verticalAxis, verticalRad);
    radial = applySpatialQuaternion(radial, verticalDelta);
    up = applySpatialQuaternion(up, verticalDelta);
    right = verticalAxis;

    const nextObserverPc = addSpatialVectors(state.centerPc, radial);
    const nextRadiusPc = spatialVectorLength(radial);
    const normalizedUp = normalizeOrbitDirection(up);
    const normalizedRight = normalizeOrbitDirection(right);
    if (!normalizedUp || !normalizedRight || !(nextRadiusPc > ORBIT_EPSILON)) return null;

    if (!lockLookAt) {
      return {
        state: {
          centerPc: cloneVector3(state.centerPc),
          radial,
          radiusPc: nextRadiusPc,
          up: normalizedUp,
          right: normalizedRight,
        },
        patch: { observerPc: nextObserverPc },
      };
    }

    const nextOrientationIcrs = computeSkykitLookAtOrientation({
      observerPc: nextObserverPc,
      targetPc: state.centerPc,
      upIcrs: normalizedUp,
    });
    if (!nextOrientationIcrs) return null;
    const frame = deriveOrbitCameraFrame(nextOrientationIcrs);
    if (!frame) return null;
    return {
      state: {
        centerPc: cloneVector3(state.centerPc),
        radial,
        radiusPc: nextRadiusPc,
        up: frame.up,
        right: frame.right,
      },
      patch: {
        observerPc: nextObserverPc,
        targetPc: cloneVector3(state.centerPc),
        orientationIcrs: nextOrientationIcrs,
      },
    };
  }

  /** @param {import('./index.d.ts').SkykitViewState} view */
  function resolveOrbitCenter(view) {
    if (configuredCenter != null) {
      return resolveOrbitCenterInput(configuredCenter, view);
    }
    if (centerPcInput != null) {
      return resolveOrbitCenterInput(centerPcInput, view);
    }
    if ((fallbackCenter === 'targetPc' || fallbackCenter === 'lookAt') && view.targetPc) {
      return cloneVector3(view.targetPc);
    }
    if (fallbackCenter === 'lookAt' && view.lookAt) {
      return resolveOrbitCenterInput(view.lookAt, view);
    }
    if (fallbackCenter === 'origin') {
      return { x: 0, y: 0, z: 0 };
    }
    return null;
  }

  /**
   * @param {unknown} input
   * @param {import('./index.d.ts').SkykitViewState} view
   * @returns {Vector3Like | null}
   */
  function resolveOrbitCenterInput(input, view) {
    try {
      const target = /** @type {Vector3Like | null} */ (resolveSkykitTargetSync(input, { observerPc: view.observerPc }));
      if (target) return cloneVector3(target);
      const resolvedLookAt = resolveSkykitLookAtSync(input, { observerPc: view.observerPc });
      return resolvedLookAt?.targetPc ? cloneVector3(resolvedLookAt.targetPc) : null;
    } catch {
      return null;
    }
  }

  function getSnapshot() {
    return {
      id,
      enabled,
      attached,
      dragging: Boolean(dragState),
      centerPc: lastCenterPc ? cloneVector3(lastCenterPc) : null,
      radiusPc: lastRadiusPc,
      sensitivityRadiansPerPixel,
      verticalSensitivityRadiansPerPixel,
      horizontalAxisMode,
      worldUp: horizontalAxisMode === 'world-up' ? cloneVector3(worldUp) : null,
    };
  }

  /** @param {boolean} nextEnabled */
  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) clearDragState({ releaseCapture: true });
  }

  /**
   * @param {unknown} nextCenter
   */
  function setCenter(nextCenter) {
    configuredCenter = /** @type {import('@found-in-space/spatial').SpatialTargetSpec | import('./index.d.ts').SkykitLookAtInput | Vector3Like | null} */ (nextCenter);
    if (!dragState) {
      lastCenterPc = null;
      lastRadiusPc = null;
    }
  }

  /**
   * @param {{ releaseCapture?: boolean; currentTarget?: { releasePointerCapture?: (pointerId: number) => void } | null }} [options]
   */
  function clearDragState(options = {}) {
    if (options.releaseCapture && pointerId != null) {
      const captureTarget = options.currentTarget ?? pointerCaptureTarget;
      try {
        captureTarget?.releasePointerCapture?.(pointerId);
      } catch {
        // Pointer capture release is best-effort across DOM shims and browsers.
      }
    }
    pointerId = null;
    lastClientX = null;
    lastClientY = null;
    dragState = null;
    pointerCaptureTarget = null;
    viewer?.actions.setControlValue('skykit:navigation.manualLookActive', false, { source: id });
  }
}

/**
 * @param {SkykitDragLookOptions & { dragMode: 'grab' | 'look' }} options
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
function createDragLookPlugin(options) {
  const id = options.id ?? 'drag-look';
  const sensitivityRadiansPerPixel = positiveFinite(options.sensitivityRadiansPerPixel, 0.0009);
  const pitchLimitRad = Math.min(
    Math.max((positiveFinite(options.pitchLimitDeg, 89) * Math.PI) / 180, 0),
    Math.PI / 2 - 1e-4,
  );
  const button = Number.isInteger(options.button) ? Number(options.button) : 0;
  let enabled = options.enabled !== false;
  let dragging = false;
  let attached = false;
  let pointerId = /** @type {number | null} */ (null);
  /** @type {import('./index.d.ts').QuaternionLike} */
  let orientation = { ...IDENTITY_QUATERNION };
  let yawRad = 0;
  let pitchRad = 0;
  let lastClientX = /** @type {number | null} */ (null);
  let lastClientY = /** @type {number | null} */ (null);
  /** @type {EventTarget | null} */
  let activeTarget = null;
  /** @type {import('./index.d.ts').SkykitViewer | null} */
  let viewer = null;

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    attach(context) {
      viewer = context.viewer;
      syncAnglesFromOrientation(context.getViewState().orientationIcrs);
      activeTarget = options.target ?? getDefaultEventTarget();
      activeTarget?.addEventListener?.('pointerdown', onPointerDown);
      activeTarget?.addEventListener?.('pointermove', onPointerMove);
      activeTarget?.addEventListener?.('pointerup', onPointerUp);
      activeTarget?.addEventListener?.('pointercancel', onPointerUp);
      attached = Boolean(activeTarget);
    },
    setView(view) {
      if (!dragging) syncAnglesFromOrientation(view.orientationIcrs);
    },
    detach() {
      activeTarget?.removeEventListener?.('pointerdown', onPointerDown);
      activeTarget?.removeEventListener?.('pointermove', onPointerMove);
      activeTarget?.removeEventListener?.('pointerup', onPointerUp);
      activeTarget?.removeEventListener?.('pointercancel', onPointerUp);
      activeTarget = null;
      viewer = null;
      pointerId = null;
      lastClientX = null;
      lastClientY = null;
      dragging = false;
      attached = false;
    },
    dispose() {
      this.detach?.();
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

  /** @param {Event} event */
  function onPointerDown(event) {
    if (!enabled) return;
    const pointerEvent = /** @type {{ button?: unknown; pointerId?: unknown; clientX?: unknown; clientY?: unknown; preventDefault?: () => void; currentTarget?: unknown }} */ (event);
    if (Number(pointerEvent.button ?? 0) !== button) return;
    syncAnglesFromOrientation(viewer?.getViewState().orientationIcrs);
    dragging = true;
    pointerId = Number.isFinite(Number(pointerEvent.pointerId)) ? Number(pointerEvent.pointerId) : null;
    lastClientX = Number.isFinite(Number(pointerEvent.clientX)) ? Number(pointerEvent.clientX) : null;
    lastClientY = Number.isFinite(Number(pointerEvent.clientY)) ? Number(pointerEvent.clientY) : null;
    const captureTarget = /** @type {{ setPointerCapture?: (pointerId: number) => void }} */ (pointerEvent.currentTarget ?? activeTarget);
    if (pointerId != null) captureTarget.setPointerCapture?.(pointerId);
    viewer?.actions.setControlValue('skykit:navigation.manualLookActive', true, { source: id });
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  /** @param {Event} event */
  function onPointerMove(event) {
    if (!enabled || !dragging || !viewer) return;
    const pointerEvent = /** @type {{ pointerId?: unknown; clientX?: unknown; clientY?: unknown; movementX?: unknown; movementY?: unknown; preventDefault?: () => void }} */ (event);
    const eventPointerId = Number(pointerEvent.pointerId);
    if (pointerId != null && Number.isFinite(eventPointerId) && eventPointerId !== pointerId) return;
    const clientX = Number(pointerEvent.clientX);
    const clientY = Number(pointerEvent.clientY);
    let movementX = finiteNumber(pointerEvent.movementX, 0);
    let movementY = finiteNumber(pointerEvent.movementY, 0);
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      movementX = lastClientX == null ? 0 : clientX - lastClientX;
      movementY = lastClientY == null ? 0 : clientY - lastClientY;
      lastClientX = clientX;
      lastClientY = clientY;
    }
    if (movementX === 0 && movementY === 0) return;
    const dragSign = options.dragMode === 'look' ? -1 : 1;
    orientation = rotateOrientationInScreenSpace(
      orientation,
      movementX * sensitivityRadiansPerPixel * dragSign,
      movementY * sensitivityRadiansPerPixel * dragSign,
    );
    syncAnglesFromOrientation(orientation);
    viewer.actions.setControlValue('skykit:navigation.manualLookActive', true, { source: id });
    viewer.requestViewState({ orientationIcrs: orientation }, id);
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  /** @param {Event} event */
  function onPointerUp(event) {
    const pointerEvent = /** @type {{ pointerId?: unknown; preventDefault?: () => void; currentTarget?: unknown }} */ (event);
    const eventPointerId = Number(pointerEvent.pointerId);
    if (pointerId != null && Number.isFinite(eventPointerId) && eventPointerId !== pointerId) return;
    const captureTarget = /** @type {{ releasePointerCapture?: (pointerId: number) => void }} */ (pointerEvent.currentTarget ?? activeTarget);
    if (pointerId != null) captureTarget.releasePointerCapture?.(pointerId);
    pointerId = null;
    lastClientX = null;
    lastClientY = null;
    dragging = false;
    viewer?.actions.setControlValue('skykit:navigation.manualLookActive', false, { source: id });
    if (options.preventDefault !== false) pointerEvent.preventDefault?.();
  }

  function getSnapshot() {
    return {
      id,
      enabled,
      attached,
      dragging,
      yawRad,
      pitchRad,
      sensitivityRadiansPerPixel,
      pitchLimitDeg: (pitchLimitRad * 180) / Math.PI,
    };
  }

  /** @param {boolean} nextEnabled */
  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    if (!enabled) {
      pointerId = null;
      lastClientX = null;
      lastClientY = null;
      dragging = false;
    }
  }

  /** @param {import('./index.d.ts').QuaternionLike | null | undefined} nextOrientation */
  function syncAnglesFromOrientation(nextOrientation) {
    const q = normalizeQuaternion(nextOrientation, IDENTITY_QUATERNION);
    orientation = q;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      new THREE.Quaternion(q.x, q.y, q.z, q.w),
    );
    yawRad = -Math.atan2(forward.x, -forward.z);
    pitchRad = Math.min(
      Math.max(Math.asin(Math.min(Math.max(forward.y, -1), 1)), -pitchLimitRad),
      pitchLimitRad,
    );
  }

  Object.assign(part, { setEnabled });
}

/**
 * @param {SkykitStatusPluginOptions} [options]
 * @returns {SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitStatusPlugin(options = {}) {
  const id = options.id ?? 'skykit-status';
  const intervalSeconds = Math.max(0, finiteNumber(options.intervalSeconds, 0));
  let elapsedSinceRender = 0;
  let renderCount = 0;
  /** @type {string | null} */
  let lastTargetText = null;
  /** @type {{ viewerId?: string; viewRevision?: number } | null} */
  let lastSummary = null;

  /** @type {SkykitThreePart} */
  const part = {
    id,
    priority: options.priority,
    start(context) {
      renderStatus(context.viewer.getSnapshot(), context.getViewState());
    },
    update(frame) {
      elapsedSinceRender += Math.max(0, finiteNumber(frame.deltaSeconds, 0));
      if (elapsedSinceRender < intervalSeconds) return;
      elapsedSinceRender = 0;
      renderStatus(frame.viewer.getSnapshot(), frame.view);
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

  /**
   * @param {import('./index.d.ts').SkykitViewerSnapshot} viewerSnapshot
   * @param {import('./index.d.ts').SkykitViewState} view
   */
  function renderStatus(viewerSnapshot, view) {
    const payload = { viewer: viewerSnapshot, view };
    lastSummary = {
      viewerId: viewerSnapshot.id,
      viewRevision: view.revision,
    };
    renderCount += 1;
    if (typeof options.render === 'function') {
      options.render(payload);
    } else if (options.target && 'textContent' in options.target) {
      const targetText = JSON.stringify(viewerSnapshot, null, 2);
      if (targetText !== lastTargetText) {
        lastTargetText = targetText;
        options.target.textContent = targetText;
      }
    }
  }

  function getSnapshot() {
    return {
      id,
      renderCount,
      lastSummary,
    };
  }
}

function getDefaultEventTarget() {
  return typeof globalThis.addEventListener === 'function' ? globalThis : null;
}

/**
 * @param {unknown} value
 * @returns {'targetPc' | 'lookAt' | 'origin' | 'none'}
 */
function normalizeOrbitFallbackCenter(value) {
  const fallback = String(value ?? 'targetPc');
  return fallback === 'lookAt' || fallback === 'origin' || fallback === 'none'
    ? fallback
    : 'targetPc';
}

/**
 * @param {import('./index.d.ts').QuaternionLike} orientation
 * @returns {{ up: Vector3Like; right: Vector3Like } | null}
 */
function deriveOrbitCameraFrame(orientation) {
  const q = normalizeQuaternion(orientation, IDENTITY_QUATERNION);
  const up = normalizeOrbitDirection(applySpatialQuaternion(SPATIAL_LOCAL_UP, q));
  const right = normalizeOrbitDirection(applySpatialQuaternion(SPATIAL_LOCAL_RIGHT, q));
  return up && right ? { up, right } : null;
}

/** @param {unknown} value */
function unwrapResolvedVector(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof /** @type {Promise<unknown>} */ (value).then === 'function') return null;
  return normalizeOrbitVector(value);
}

/** @param {unknown} value */
function normalizeOrbitVector(value) {
  if (!value || typeof value !== 'object') return null;
  const vector = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  const x = Number(vector.x);
  const y = Number(vector.y);
  const z = Number(vector.z);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

/** @param {unknown} value */
function normalizeOrbitDirection(value) {
  const vector = normalizeOrbitVector(value);
  if (!vector || !(spatialVectorLength(vector) > ORBIT_EPSILON)) return null;
  return normalizeSpatialDirection(vector);
}


/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
function payloadOptions(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const options = /** @type {Record<string, unknown>} */ ({ ...payload });
  delete options.x;
  delete options.y;
  delete options.z;
  delete options.raDeg;
  delete options.raHours;
  delete options.decDeg;
  delete options.distancePc;
  delete options.position;
  delete options.targetPc;
  delete options.center;
  delete options.points;
  delete options.bookmarkId;
  return options;
}

/**
 * @param {Vector3Like} startPc
 * @param {Vector3Like} targetPc
 * @param {unknown} payload
 */
function buildRouteToTarget(startPc, targetPc, payload) {
  return buildSpatialOrbitTransferRoute({
    from: { positionPc: startPc },
    to: { positionPc: targetPc },
    travel: {
      kind: 'orbitTransfer',
      timing: resolveRouteTiming(payload),
      sampleStepSecs: resolveSampleStepSecs(payload),
    },
  });
}

/**
 * @param {unknown} payload
 * @param {Vector3Like[]} [points]
 */
function resolveRouteTiming(payload, points) {
  const source = /** @type {Record<string, unknown>} */ (payload && typeof payload === 'object' ? payload : {});
  if (source.timing && typeof source.timing === 'object') {
    return /** @type {import('@found-in-space/spatial').SpatialTimingSpec} */ (source.timing);
  }
  if (source.durationSecs !== undefined) {
    return { kind: 'duration', durationSecs: positiveFinite(source.durationSecs, 1) };
  }
  const speed = positiveFinite(source.speedPcPerSec ?? source.speed, Number.NaN);
  if (Number.isFinite(speed)) {
    return { kind: 'constantSpeed', speedPcPerSec: speed };
  }
  if (points && points.length >= 2) {
    return { kind: 'duration', durationSecs: Math.max(1, routePointLength(points)) };
  }
  return { kind: 'duration', durationSecs: 1 };
}

/** @param {unknown} payload */
function resolveSampleStepSecs(payload) {
  const source = /** @type {Record<string, unknown>} */ (payload && typeof payload === 'object' ? payload : {});
  return positiveFinite(source.sampleStepSecs, 1 / 60);
}

/**
 * @param {Vector3Like} centerPc
 * @param {unknown} payload
 * @returns {import('@found-in-space/spatial').SpatialOrbitSpec}
 */
function resolveOrbitSpec(centerPc, payload) {
  const source = /** @type {Record<string, unknown>} */ (payload && typeof payload === 'object' ? payload : {});
  return {
    centerPc,
    radiusPc: positiveFinite(source.radiusPc ?? source.radius, 1),
    ...(source.orbitNormal !== undefined || source.normal !== undefined ? { orbitNormal: normalizeVector3(source.orbitNormal ?? source.normal, { x: 0, y: 1, z: 0 }) } : {}),
    ...(source.referenceAxis !== undefined ? { referenceAxis: normalizeVector3(source.referenceAxis, { x: 1, y: 0, z: 0 }) } : {}),
    ...(source.initialAngleRad !== undefined || source.initialAngle !== undefined ? { initialAngleRad: finiteNumber(source.initialAngleRad ?? source.initialAngle, 0) } : {}),
    angularSpeedRadPerSec: finiteNumber(source.angularSpeedRadPerSec ?? source.angularSpeed, 0.1),
  };
}

/** @param {Vector3Like[]} points */
function routePointLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
      points[index].z - points[index - 1].z,
    );
  }
  return total;
}

/** @param {unknown} payload */
function resolveOnArrive(payload) {
  return payload && typeof payload === 'object' && typeof /** @type {{ onArrive?: unknown }} */ (payload).onArrive === 'function'
    ? /** @type {() => void} */ (/** @type {{ onArrive: unknown }} */ (payload).onArrive)
    : null;
}

/** @param {Record<string, unknown>} targetSource */
function resolveTransitionPositionInput(targetSource) {
  if (targetSource.observerPc !== undefined) return targetSource.observerPc;
  if (targetSource.position !== undefined) return targetSource.position;
  if (targetSource.targetPc !== undefined) return targetSource.targetPc;
  if (targetSource.target !== undefined) return targetSource.target;
  return isSpatialTargetLike(targetSource) ? targetSource : undefined;
}

/** @param {unknown} value */
function isSpatialTargetLike(value) {
  if (!value || typeof value !== 'object') return false;
  const source = /** @type {Record<string, unknown>} */ (value);
  if ([source.x, source.y, source.z].every((component) => Number.isFinite(Number(component)))) return true;
  if ((Number.isFinite(Number(source.raDeg)) || Number.isFinite(Number(source.raHours)))
    && Number.isFinite(Number(source.decDeg))
    && Number.isFinite(Number(source.distancePc))) return true;
  if (typeof source.bookmarkId === 'string') return true;
  if (source.kind === 'bookmark' && typeof source.id === 'string') return true;
  return Array.isArray(value) && value.length >= 3;
}


/**
 * @param {unknown} value
 * @param {unknown} durationSecs
 * @returns {import('@found-in-space/spatial').SpatialTransitionLaneSpec | undefined}
 */
function normalizeTransitionLane(value, durationSecs) {
  if (value && typeof value === 'object') {
    const source = /** @type {Record<string, unknown>} */ (value);
    return {
      ...(source.durationSecs !== undefined ? { durationSecs: finiteNumber(source.durationSecs, finiteNumber(durationSecs, 1)) } : {}),
      ...(source.delaySecs !== undefined ? { delaySecs: finiteNumber(source.delaySecs, 0) } : {}),
      ...(source.easing !== undefined ? { easing: /** @type {import('@found-in-space/spatial').SpatialEasingSpec} */ (source.easing) } : {}),
      ...(source.interpolation !== undefined ? { interpolation: /** @type {import('@found-in-space/spatial').SpatialTransitionLaneSpec['interpolation']} */ (source.interpolation) } : {}),
    };
  }
  if (durationSecs !== undefined) {
    return { durationSecs: finiteNumber(durationSecs, 1) };
  }
  return undefined;
}

/** @param {unknown} value */
function isQuaternionLike(value) {
  if (!value || typeof value !== 'object') return false;
  const q = /** @type {Record<string, unknown>} */ (value);
  return Number.isFinite(Number(q.x))
    && Number.isFinite(Number(q.y))
    && Number.isFinite(Number(q.z))
    && Number.isFinite(Number(q.w));
}

/**
 * @param {Vector3Like | null | undefined} left
 * @param {Vector3Like | null | undefined} right
 */
function sameVector(left, right) {
  if (!left || !right) return false;
  return Math.abs(left.x - right.x) < 1e-12
    && Math.abs(left.y - right.y) < 1e-12
    && Math.abs(left.z - right.z) < 1e-12;
}

/**
 * @param {import('./index.d.ts').QuaternionLike | null | undefined} left
 * @param {import('./index.d.ts').QuaternionLike | null | undefined} right
 */
function sameQuaternion(left, right) {
  if (!left || !right) return false;
  return Math.abs(left.x - right.x) < 1e-12
    && Math.abs(left.y - right.y) < 1e-12
    && Math.abs(left.z - right.z) < 1e-12
    && Math.abs(left.w - right.w) < 1e-12;
}

/** @param {Event} event */
function getEventKey(event) {
  const keyboardEvent = /** @type {{ code?: unknown; key?: unknown }} */ (event);
  const code = typeof keyboardEvent.code === 'string' ? keyboardEvent.code : '';
  const key = typeof keyboardEvent.key === 'string' ? keyboardEvent.key : '';
  return code || key || null;
}

/**
 * @param {import('./index.d.ts').QuaternionLike | null | undefined} orientation
 * @param {import('./index.d.ts').SkykitActionRegistry} actions
 * @param {'view' | 'world'} verticalMode
 * @returns {Vector3Like}
 */
function resolveMovementVector(orientation, actions, verticalMode) {
  const q = normalizeQuaternion(orientation, IDENTITY_QUATERNION);
  const quaternion = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = verticalMode === 'world'
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const movement = new THREE.Vector3();
  if (actions.isPressed(SKYKIT_ACTIONS.ship.moveForward)) movement.add(forward);
  if (actions.isPressed(SKYKIT_ACTIONS.ship.moveBack)) movement.sub(forward);
  if (actions.isPressed(SKYKIT_ACTIONS.ship.moveRight)) movement.add(right);
  if (actions.isPressed(SKYKIT_ACTIONS.ship.moveLeft)) movement.sub(right);
  if (actions.isPressed(SKYKIT_ACTIONS.ship.moveUp)) movement.add(up);
  if (actions.isPressed(SKYKIT_ACTIONS.ship.moveDown)) movement.sub(up);
  return normalizeVector3(movement, { x: 0, y: 0, z: 0 });
}

/**
 * @param {import('./index.d.ts').SkykitActionRegistry} actions
 * @returns {{ pitch: number; yaw: number; roll: number }}
 */
function resolveRotationInput(actions) {
  const rotation = { pitch: 0, yaw: 0, roll: 0 };
  if (actions.isPressed(SKYKIT_ACTIONS.ship.pitchUp)) rotation.pitch += 1;
  if (actions.isPressed(SKYKIT_ACTIONS.ship.pitchDown)) rotation.pitch -= 1;
  if (actions.isPressed(SKYKIT_ACTIONS.ship.yawLeft)) rotation.yaw += 1;
  if (actions.isPressed(SKYKIT_ACTIONS.ship.yawRight)) rotation.yaw -= 1;
  if (actions.isPressed(SKYKIT_ACTIONS.ship.rollClockwise)) rotation.roll += 1;
  if (actions.isPressed(SKYKIT_ACTIONS.ship.rollAnticlockwise)) rotation.roll -= 1;
  return rotation;
}

/**
 * @param {string} action
 */
function isHeldKeyboardAction(action) {
  return action === SKYKIT_ACTIONS.ship.moveForward
    || action === SKYKIT_ACTIONS.ship.moveBack
    || action === SKYKIT_ACTIONS.ship.moveLeft
    || action === SKYKIT_ACTIONS.ship.moveRight
    || action === SKYKIT_ACTIONS.ship.moveUp
    || action === SKYKIT_ACTIONS.ship.moveDown
    || action === SKYKIT_ACTIONS.ship.pitchUp
    || action === SKYKIT_ACTIONS.ship.pitchDown
    || action === SKYKIT_ACTIONS.ship.yawLeft
    || action === SKYKIT_ACTIONS.ship.yawRight
    || action === SKYKIT_ACTIONS.ship.rollClockwise
    || action === SKYKIT_ACTIONS.ship.rollAnticlockwise
    || action === SKYKIT_ACTIONS.ship.boost;
}

/** @param {string} action */
function normalizeKeyboardAction(action) {
  return /** @type {Record<string, string>} */ (LEGACY_KEYBOARD_ACTION_ALIASES)[action] ?? action;
}

/** @param {string} key */
function keyboardMetadata(key) {
  return {
    source: `keyboard:${key}`,
    input: 'keyboard',
    key,
  };
}

/**
 * @param {import('./index.d.ts').QuaternionLike | null | undefined} orientation
 * @param {{ pitchRad: number; yawRad: number; rollRad: number }} input
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function rotateOrientationByKeyboard(orientation, input) {
  let next = rotateOrientationInScreenSpace(
    normalizeQuaternion(orientation, IDENTITY_QUATERNION),
    input.yawRad,
    input.pitchRad,
  );
  if (input.rollRad !== 0) {
    const forward = normalizeVector3(rotateVectorByQuaternion({ x: 0, y: 0, z: -1 }, next), { x: 0, y: 0, z: -1 });
    const roll = quaternionFromAxisAngle(forward, input.rollRad);
    next = normalizeQuaternion(multiplyQuaternions(roll, next), IDENTITY_QUATERNION);
  }
  return next;
}

/**
 * @param {import('./index.d.ts').QuaternionLike} orientation
 * @param {number} horizontalRad
 * @param {number} verticalRad
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function rotateOrientationInScreenSpace(orientation, horizontalRad, verticalRad) {
  const current = normalizeQuaternion(orientation, IDENTITY_QUATERNION);
  const localRight = normalizeVector3(rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, current), { x: 1, y: 0, z: 0 });
  const localUp = normalizeVector3(rotateVectorByQuaternion({ x: 0, y: 1, z: 0 }, current), { x: 0, y: 1, z: 0 });
  const horizontal = quaternionFromAxisAngle(localUp, horizontalRad);
  const vertical = quaternionFromAxisAngle(localRight, verticalRad);
  return normalizeQuaternion(
    multiplyQuaternions(vertical, multiplyQuaternions(horizontal, current)),
    IDENTITY_QUATERNION,
  );
}

/**
 * @param {Vector3Like} axis
 * @param {number} angleRad
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function quaternionFromAxisAngle(axis, angleRad) {
  const length = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const halfAngle = angleRad / 2;
  const s = Math.sin(halfAngle);
  return {
    x: (axis.x / length) * s,
    y: (axis.y / length) * s,
    z: (axis.z / length) * s,
    w: Math.cos(halfAngle),
  };
}

/**
 * @param {import('./index.d.ts').QuaternionLike} a
 * @param {import('./index.d.ts').QuaternionLike} b
 * @returns {import('./index.d.ts').QuaternionLike}
 */
function multiplyQuaternions(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * @param {Vector3Like} vector
 * @param {import('./index.d.ts').QuaternionLike} q
 * @returns {Vector3Like}
 */
function rotateVectorByQuaternion(vector, q) {
  const qVector = { x: vector.x, y: vector.y, z: vector.z, w: 0 };
  const inverse = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
  const rotated = multiplyQuaternions(multiplyQuaternions(q, qVector), inverse);
  return { x: rotated.x, y: rotated.y, z: rotated.z };
}
