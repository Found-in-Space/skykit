import * as THREE from 'three';

import { SKYKIT_ACTIONS, SKYKIT_CONTROLS } from '../actions.js';
import {
  cloneQuaternion,
  cloneVector3,
  finiteNumber,
  IDENTITY_QUATERNION,
  normalizeQuaternion,
  normalizeVector3,
  positiveFinite,
} from '../utils.js';
import { createSkykitXrControlBindings } from './controls.js';
import { createSkykitXrRaySource } from './rays.js';
import { enterSkykitXrSession, exitSkykitXrSession, isSkykitXrModeSupported } from './session.js';

const DEFAULT_XR_PICK_ATTRIBUTES = Object.freeze(['position', 'teffLog8', 'magAbs']);

/**
 * Bridge a SkyKit XR rig into the normal SkyKit observer-rig contract.
 *
 * @param {import('../xr.d.ts').CreateSkykitXrObserverRigOptions} options
 * @returns {import('../index.d.ts').SkykitObserverRig}
 */
export function createSkykitXrObserverRig(options) {
  if (!options?.rig) {
    throw new TypeError('createSkykitXrObserverRig() requires an XR rig.');
  }
  const rig = options.rig;
  let coordinateUnitsPerParsec = positiveFinite(
    options.coordinateUnitsPerParsec,
    rig.getScaleProfile?.().worldUnitsPerNavigationUnit ?? 1,
  );
  let previousObserverPc = rig.getNavigationPose().position;
  let motion = {
    velocityPcPerSec: { x: 0, y: 0, z: 0 },
    speedPcPerSec: 0,
  };
  let disposed = false;

  syncScaleProfile();

  return {
    type: 'xr',
    getObserverPc() {
      assertActive();
      return cloneVector3(rig.getNavigationPose().position);
    },
    getRenderObserverPosition() {
      assertActive();
      const position = rig.getNavigationPose().position;
      return {
        x: position.x * coordinateUnitsPerParsec,
        y: position.y * coordinateUnitsPerParsec,
        z: position.z * coordinateUnitsPerParsec,
      };
    },
    getOrientationIcrs() {
      assertActive();
      return cloneQuaternion(rig.getNavigationPose().orientation);
    },
    getMotion() {
      assertActive();
      return {
        velocityPcPerSec: cloneVector3(motion.velocityPcPerSec),
        speedPcPerSec: motion.speedPcPerSec,
      };
    },
    setObserverPc(observerPc) {
      assertActive();
      rig.setNavigationPose({ position: normalizeVector3(observerPc, rig.getNavigationPose().position) });
    },
    setOrientationIcrs(orientation) {
      assertActive();
      rig.setNavigationPose({ orientation: normalizeQuaternion(orientation, rig.getNavigationPose().orientation) });
    },
    update(frame) {
      assertActive();
      const nextScale = positiveFinite(frame?.view?.coordinateUnitsPerParsec, coordinateUnitsPerParsec);
      if (nextScale !== coordinateUnitsPerParsec) {
        coordinateUnitsPerParsec = nextScale;
        syncScaleProfile();
      }
      const dt = Math.max(0, finiteNumber(frame?.deltaSeconds, 0));
      const position = rig.getNavigationPose().position;
      if (dt > 0) {
        const velocity = {
          x: (position.x - previousObserverPc.x) / dt,
          y: (position.y - previousObserverPc.y) / dt,
          z: (position.z - previousObserverPc.z) / dt,
        };
        motion = {
          velocityPcPerSec: velocity,
          speedPcPerSec: Math.hypot(velocity.x, velocity.y, velocity.z),
        };
      } else {
        motion = {
          velocityPcPerSec: { x: 0, y: 0, z: 0 },
          speedPcPerSec: 0,
        };
      }
      previousObserverPc = cloneVector3(position);
    },
    dispose() {
      disposed = true;
    },
  };

  function syncScaleProfile() {
    rig.setScaleProfile?.({
      navigationUnits: 'pc',
      metersPerNavigationUnit: coordinateUnitsPerParsec,
      worldUnitsPerNavigationUnit: coordinateUnitsPerParsec,
    });
  }

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitXrObserverRig has been disposed.');
    }
  }
}

/**
 * @param {import('../xr.d.ts').SkykitXrSessionPluginOptions} options
 * @returns {import('../index.d.ts').SkykitPlugin & { enter(): Promise<import('../xr.d.ts').SkykitXrSessionHandle>; exit(): Promise<void>; getSnapshot(): unknown }}
 */
export function createSkykitXrSessionPlugin(options = {}) {
  const id = options.id ?? 'skykit-xr-session';
  const renderer = options.renderer;
  const mode = options.mode ?? 'immersive-vr';
  const referenceSpaceType = options.referenceSpaceType ?? 'local-floor';
  /** @type {import('../index.d.ts').SkykitThreePluginContext | null} */
  let context = null;
  /** @type {import('../xr.d.ts').SkykitXrSessionHandle | null} */
  let handle = null;
  let disposed = false;
  /** @type {boolean | null} */
  let supported = null;
  /** @type {string} */
  let enterStage = 'idle';
  /** @type {string | null} */
  let lastError = null;

  const part = {
    id,
    priority: options.priority ?? -1000,
    /** @param {import('../index.d.ts').SkykitThreeFrame} frame */
    update(frame) {
      const rendererXr = resolveRendererXr(renderer ?? frame.renderer);
      const session = handle?.session ?? rendererXr?.getSession?.() ?? null;
      const referenceSpace = handle?.referenceSpace ?? rendererXr?.getReferenceSpace?.() ?? null;
      const presenting = Boolean(handle?.presenting || rendererXr?.isPresenting || session || frame.xr?.presenting);
      if (presenting) {
        frame.xr = {
          ...(frame.xr ?? {}),
          presenting: true,
          ...(session ? { session } : {}),
          ...(referenceSpace ? { referenceSpace } : {}),
        };
      }
    },
    getSnapshot,
    dispose() {
      disposed = true;
      void exit();
    },
  };

  return {
    id,
    setup(pluginContext) {
      context = /** @type {import('../index.d.ts').SkykitThreePluginContext} */ (pluginContext);
      context.addPart(part);
      const unregisters = [
        context.actions.registerAction(SKYKIT_ACTIONS.xr.enter, () => enter(), { label: 'Enter XR' }),
        context.actions.registerAction(SKYKIT_ACTIONS.xr.exit, () => exit(), { label: 'Exit XR' }),
        context.actions.registerAction(SKYKIT_ACTIONS.xr.toggle, () => (isPresenting() ? exit() : enter()), { label: 'Toggle XR' }),
      ];
      void refreshSupport();
      return () => {
        for (const unregister of unregisters.reverse()) unregister();
        part.dispose();
        context = null;
      };
    },
    enter,
    exit,
    getSnapshot,
  };

  async function refreshSupport() {
    supported = await isSkykitXrModeSupported(mode, { navigator: options.navigator });
    return supported;
  }

  async function enter() {
    if (disposed) {
      throw new Error('SkykitXrSessionPlugin has been disposed.');
    }
    if (handle?.presenting) return handle;
    const activeRenderer = renderer ?? context?.renderer;
    const rendererXr = resolveRendererXr(activeRenderer);
    if (rendererXr) rendererXr.enabled = true;
    rendererXr?.setReferenceSpaceType?.(referenceSpaceType);
    enterStage = 'requesting-session';
    lastError = null;
    /** @type {import('../xr.d.ts').SkykitXrSessionHandle | null} */
    let nextHandle = null;
    try {
      nextHandle = await enterSkykitXrSession({
        navigator: options.navigator,
        mode,
        referenceSpaceType,
        sessionInit: options.sessionInit,
        requestReferenceSpace: false,
      });
      enterStage = 'binding-renderer';
      if (rendererXr && typeof rendererXr.setSession === 'function') {
        await rendererXr.setSession(nextHandle.session);
      }
      handle = nextHandle;
      enterStage = 'presenting';
      options.onSessionStarted?.(handle);
    } catch (error) {
      enterStage = 'failed';
      lastError = error instanceof Error ? error.message : String(error);
      if (nextHandle) {
        await exitSkykitXrSession(nextHandle).catch(() => {});
      }
      const activeSession = rendererXr?.getSession?.();
      if (activeSession && typeof /** @type {{ end?: unknown }} */ (activeSession).end === 'function') {
        const endResult = /** @type {{ end: () => Promise<void> | void }} */ (activeSession).end();
        if (endResult && typeof /** @type {Promise<void>} */ (endResult).catch === 'function') {
          await /** @type {Promise<void>} */ (endResult).catch(() => {});
        }
      }
      throw error;
    }
    context?.emit?.({
      type: 'xr/session-start',
      id,
      mode,
      referenceSpaceType,
    });
    return handle;
  }

  async function exit() {
    const previous = handle;
    handle = null;
    enterStage = 'exiting';
    const activeRenderer = renderer ?? context?.renderer;
    const rendererXr = resolveRendererXr(activeRenderer);
    if (previous) {
      await exitSkykitXrSession(previous);
    } else {
      const activeSession = rendererXr?.getSession?.();
      if (activeSession && typeof /** @type {{ end?: unknown }} */ (activeSession).end === 'function') {
        await /** @type {{ end: () => Promise<void> | void }} */ (activeSession).end();
      } else if (rendererXr && typeof rendererXr.setSession === 'function' && rendererXr.getSession?.()) {
        await rendererXr.setSession(null);
      }
    }
    enterStage = 'idle';
    context?.emit?.({
      type: 'xr/session-end',
      id,
      mode,
    });
  }

  function isPresenting() {
    return Boolean(handle?.presenting || resolveRendererXr(renderer ?? context?.renderer)?.isPresenting);
  }

  function getSnapshot() {
    return {
      id,
      mode,
      referenceSpaceType,
      supported,
      presenting: isPresenting(),
      enterStage,
      session: handle?.getSnapshot?.() ?? null,
      lastError,
      disposed,
    };
  }
}

/**
 * @param {import('../xr.d.ts').SkykitXrNavigationPluginOptions} [options]
 * @returns {import('../index.d.ts').SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitXrNavigationPlugin(options = {}) {
  const id = options.id ?? 'skykit-xr-navigation';
  const controls = options.controls ?? createSkykitXrControlBindings({
    axes: {
      move: options.moveAxis ?? { hand: 'right' },
      attitude: options.attitudeAxis ?? { hand: 'left' },
    },
    buttons: {
      rollModifier: options.rollModifierButton ?? { hand: 'left', button: 'grip' },
      boost: options.boostButton ?? { hand: 'right', button: 'grip' },
    },
    deadzone: options.deadzone,
  });
  const moveSpeedPcPerSec = positiveFinite(options.moveSpeedPcPerSec, 4);
  const boostMultiplier = positiveFinite(options.boostMultiplier, 4);
  const yawRateRadPerSec = positiveFinite(options.yawRateRadPerSec, Math.PI * 0.375);
  const pitchRateRadPerSec = positiveFinite(options.pitchRateRadPerSec, Math.PI * 0.3);
  const rollRateRadPerSec = positiveFinite(options.rollRateRadPerSec, Math.PI * 0.375);
  let disposed = false;
  let presenting = false;
  let lastMove = { x: 0, y: 0, z: 0 };
  let lastAttitude = { pitch: 0, yaw: 0, roll: 0 };

  const part = {
    id,
    priority: options.priority,
    /** @param {import('../index.d.ts').SkykitThreeFrame} frame */
    update(frame) {
      if (disposed || frame.xr?.presenting !== true) {
        presenting = false;
        return;
      }
      presenting = true;
      const inputSources = frame.xr.session && typeof frame.xr.session === 'object'
        ? /** @type {{ inputSources?: Iterable<unknown> }} */ (frame.xr.session).inputSources
        : [];
      controls.update({ inputSources });
      const dt = Math.max(0, finiteNumber(frame.deltaSeconds, 0));
      const move = controls.getAxis('move');
      const attitude = controls.getAxis('attitude');
      const boosted = controls.getButton('boost').pressed;
      const rollModifier = controls.getButton('rollModifier').pressed;
      const speed = moveSpeedPcPerSec * (boosted ? boostMultiplier : 1);
      const orientation = normalizeQuaternion(frame.view.orientationIcrs, IDENTITY_QUATERNION);
      const patch = /** @type {Partial<import('../index.d.ts').SkykitViewState>} */ ({});

      const movement = movementFromAxes(move.x, move.y, orientation);
      if (movement.lengthSq() > 0 && dt > 0) {
        movement.normalize();
        const distance = speed * move.magnitude * dt;
        patch.observerPc = {
          x: frame.view.observerPc.x + movement.x * distance,
          y: frame.view.observerPc.y + movement.y * distance,
          z: frame.view.observerPc.z + movement.z * distance,
        };
        lastMove = {
          x: movement.x * speed * move.magnitude,
          y: movement.y * speed * move.magnitude,
          z: movement.z * speed * move.magnitude,
        };
      } else {
        lastMove = { x: 0, y: 0, z: 0 };
      }

      lastAttitude = {
        pitch: attitude.y,
        yaw: rollModifier ? 0 : -attitude.x,
        roll: rollModifier ? attitude.x : 0,
      };
      if ((attitude.x !== 0 || attitude.y !== 0) && dt > 0) {
        patch.orientationIcrs = rotateOrientation(orientation, {
          pitchRad: attitude.y * pitchRateRadPerSec * dt,
          yawRad: (rollModifier ? 0 : -attitude.x) * yawRateRadPerSec * dt,
          rollRad: (rollModifier ? attitude.x : 0) * rollRateRadPerSec * dt,
        });
      }

      frame.viewer.actions.setControlValue(SKYKIT_CONTROLS.ship.move, cloneVector3(lastMove), { source: id });
      frame.viewer.actions.setControlValue(SKYKIT_CONTROLS.ship.attitude, { ...lastAttitude }, { source: id });
      if (patch.observerPc || patch.orientationIcrs) {
        frame.viewer.requestViewState(patch, id);
      }
    },
    getSnapshot() {
      return {
        id,
        disposed,
        presenting,
        moveSpeedPcPerSec,
        lastMove: cloneVector3(lastMove),
        lastAttitude: { ...lastAttitude },
        controls: controls.getSnapshot?.() ?? null,
      };
    },
    dispose() {
      disposed = true;
      controls.dispose?.();
    },
  };

  return {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSnapshot: () => part.getSnapshot(),
  };
}

/**
 * @param {import('../xr.d.ts').SkykitXrRayVisualPluginOptions} options
 * @returns {import('../index.d.ts').SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitXrRayVisualPlugin(options) {
  if (!options?.raySource || typeof options.raySource.getRay !== 'function') {
    throw new TypeError('createSkykitXrRayVisualPlugin() requires a raySource.');
  }
  const id = options.id ?? 'skykit-xr-ray-visual';
  const root = new THREE.Group();
  root.name = id;
  root.visible = false;
  const positions = new Float32Array(6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = options.material ?? new THREE.LineBasicMaterial({
    color: options.color ?? 0x66ffe8,
    transparent: true,
    opacity: options.opacity ?? 0.72,
    depthTest: options.depthTest ?? false,
    depthWrite: false,
  });
  const ownsMaterial = options.material == null;
  const line = new THREE.Line(geometry, material);
  line.name = `${id}:line`;
  line.frustumCulled = false;
  line.renderOrder = finiteNumber(options.renderOrder, 10_000);
  root.add(line);

  /** @type {THREE.Object3D | null} */
  let parent = null;
  let disposed = false;
  let visible = false;
  let blocked = false;
  let lastLength = 0;

  const part = {
    id,
    priority: options.priority ?? 45,
    object3d: root,
    /** @param {import('../index.d.ts').SkykitThreePluginContext} context */
    attach(context) {
      parent = resolveRayVisualParent(options.parent, context);
      parent.add(root);
    },
    /** @param {import('../index.d.ts').SkykitThreeFrame} frame */
    update(frame) {
      if (disposed || frame.xr?.presenting !== true) {
        setVisible(false);
        return;
      }
      const session = frame.xr.session && typeof frame.xr.session === 'object'
        ? /** @type {{ inputSources?: Iterable<unknown> }} */ (frame.xr.session)
        : null;
      const ray = options.raySource.getRay({
        frame: frame.xr.frame,
        referenceSpace: frame.xr.referenceSpace,
        session: /** @type {any} */ (frame.xr.session),
        inputSources: session?.inputSources ?? [],
        rig: options.rig,
        viewer: frame.viewer,
      });
      if (!ray) {
        setVisible(false);
        return;
      }

      const resolved = resolveRayVisualLength(ray, frame, options);
      blocked = resolved.blocked;
      if (!(resolved.length > 0)) {
        setVisible(false);
        return;
      }

      const direction = new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize();
      positions[0] = ray.origin.x;
      positions[1] = ray.origin.y;
      positions[2] = ray.origin.z;
      positions[3] = ray.origin.x + direction.x * resolved.length;
      positions[4] = ray.origin.y + direction.y * resolved.length;
      positions[5] = ray.origin.z + direction.z * resolved.length;
      geometry.attributes.position.needsUpdate = true;
      geometry.computeBoundingSphere();
      lastLength = resolved.length;
      setVisible(true);
    },
    detach() {
      parent?.remove(root);
      parent = null;
    },
    dispose() {
      disposed = true;
      parent?.remove(root);
      parent = null;
      geometry.dispose();
      if (ownsMaterial) {
        material.dispose();
      }
      options.raySource.dispose?.();
    },
    getSnapshot() {
      return {
        id,
        disposed,
        visible,
        blocked,
        lastLength,
        parentName: parent?.name ?? null,
        raySource: options.raySource.getSnapshot?.() ?? null,
      };
    },
  };

  return {
    id,
    setup(context) {
      context.addPart(part);
    },
    getSnapshot: () => part.getSnapshot(),
  };

  /** @param {boolean} nextVisible */
  function setVisible(nextVisible) {
    visible = nextVisible;
    root.visible = nextVisible;
  }
}

/**
 * @param {import('../xr.d.ts').SkykitXrStarPickingPluginOptions} options
 * @returns {import('../index.d.ts').SkykitPlugin & { getSnapshot(): unknown }}
 */
export function createSkykitXrStarPickingPlugin(options) {
  if (!options?.renderer || typeof options.renderer.pick !== 'function') {
    throw new TypeError('createSkykitXrStarPickingPlugin() requires a renderer with pick().');
  }
  const id = options.id ?? 'skykit-xr-star-picking';
  const pickHand = normalizePickHand(options.handedness);
  const raySource = options.raySource ?? createSkykitXrRaySource({
    kind: 'target-ray',
    handedness: options.handedness ?? 'right',
  });
  const controls = options.controls ?? createSkykitXrControlBindings({
    buttons: {
      select: options.selectButton ?? { hand: pickHand, button: 'trigger' },
    },
  });
  const attributes = Array.from(new Set([...(options.attributes ?? []), ...DEFAULT_XR_PICK_ATTRIBUTES]));
  /** @type {(() => void) | null} */
  let unregisterDemand = null;
  let disposed = false;
  let pickCount = 0;
  let missCount = 0;
  let blockedCount = 0;
  /** @type {unknown} */
  let lastPick = null;

  const part = {
    id,
    priority: options.priority ?? 50,
    /** @param {import('../index.d.ts').SkykitThreeFrame} frame */
    update(frame) {
      if (disposed || frame.xr?.presenting !== true) return;
      const session = frame.xr.session && typeof frame.xr.session === 'object'
        ? /** @type {{ inputSources?: Iterable<unknown> }} */ (frame.xr.session)
        : null;
      controls.update({ inputSources: session?.inputSources ?? [] });
      if (!controls.getButton('select').pressedEdge) return;
      const ray = raySource.getRay({
        frame: frame.xr.frame,
        referenceSpace: frame.xr.referenceSpace,
        session: /** @type {any} */ (frame.xr.session),
        inputSources: session?.inputSources ?? [],
        rig: options.rig,
      });
      if (!ray) return;
      const blocked = resolveBlockedRay(ray, frame, options.blockers);
      if (blocked) {
        blockedCount += 1;
        frame.viewer.emit({
          type: 'stars/xr-pick-blocked',
          id,
          ray,
          blocker: blocked.blocker,
          hit: blocked.hit,
        });
        return;
      }
      const pick = options.renderer.pick({
        origin: ray.origin,
        direction: ray.direction,
      }, {
        observerPosition: frame.view.renderObserverPosition,
        coordinateUnitsPerParsec: frame.view.coordinateUnitsPerParsec,
        limitingMagnitude: frame.view.limitingMagnitude,
        ...(frame.view.verticalFovDeg !== undefined ? { fovRad: (frame.view.verticalFovDeg * Math.PI) / 180 } : {}),
        ...(options.pickOptions ?? {}),
      });
      if (!pick) {
        missCount += 1;
        const event = /** @type {import('../xr.d.ts').SkykitXrStarPickMissEvent} */ ({
          type: 'stars/xr-pick-miss',
          id,
          ray,
          view: frame.view,
        });
        frame.viewer.emit(/** @type {import('../index.d.ts').SkykitEvent} */ (event));
        void options.onMiss?.(event);
        return;
      }
      pickCount += 1;
      lastPick = pick;
      const event = /** @type {import('../xr.d.ts').SkykitXrStarPickEvent} */ ({
        type: 'stars/xr-pick',
        id,
        pick,
        label: `${pick.cellKey}:${pick.objectIndex}`,
        ray,
        view: frame.view,
      });
      frame.viewer.emit(/** @type {import('../index.d.ts').SkykitEvent} */ (event));
      void options.onPick?.(event);
    },
    getSnapshot() {
      return {
        id,
        disposed,
        pickCount,
        missCount,
        blockedCount,
        attributes,
        lastPick: lastPick && typeof lastPick === 'object'
          ? {
              cellKey: /** @type {{ cellKey?: unknown }} */ (lastPick).cellKey ?? null,
              objectIndex: /** @type {{ objectIndex?: unknown }} */ (lastPick).objectIndex ?? null,
            }
          : null,
      };
    },
    dispose() {
      disposed = true;
      unregisterDemand?.();
      unregisterDemand = null;
      controls.dispose?.();
      raySource.dispose?.();
    },
  };

  return {
    id,
    setup(context) {
      if (options.source) {
        unregisterDemand = options.source.addDemand({
          id: `${id}:attributes`,
          attributes,
        });
      }
      context.addPart(part);
    },
    getSnapshot: () => part.getSnapshot(),
  };
}

/**
 * @param {unknown} renderer
 */
function resolveRendererXr(renderer) {
  return renderer && typeof renderer === 'object'
    ? /** @type {{ enabled?: boolean; isPresenting?: boolean; getSession?: () => unknown; getReferenceSpace?: () => unknown; setReferenceSpaceType?: (type: string) => void; setSession?: (session: unknown) => Promise<void> | void }} */ (
        /** @type {{ xr?: unknown }} */ (renderer).xr
      )
    : null;
}

/**
 * @param {unknown} handedness
 * @returns {'left' | 'right' | 'any'}
 */
function normalizePickHand(handedness) {
  return handedness === 'left' || handedness === 'right' || handedness === 'any'
    ? handedness
    : 'right';
}

/**
 * @param {number} x
 * @param {number} y
 * @param {import('../index.d.ts').QuaternionLike} orientation
 */
function movementFromAxes(x, y, orientation) {
  const quaternion = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  return new THREE.Vector3()
    .addScaledVector(right, x)
    .addScaledVector(forward, -y);
}

/**
 * @param {import('../index.d.ts').QuaternionLike} orientation
 * @param {{ pitchRad: number; yawRad: number; rollRad: number }} input
 * @returns {import('../index.d.ts').QuaternionLike}
 */
function rotateOrientation(orientation, input) {
  const current = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w).normalize();
  const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(current).normalize();
  const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(current).normalize();
  const localForward = new THREE.Vector3(0, 0, -1).applyQuaternion(current).normalize();
  const yaw = new THREE.Quaternion().setFromAxisAngle(localUp, input.yawRad);
  const pitch = new THREE.Quaternion().setFromAxisAngle(localRight, input.pitchRad);
  const roll = new THREE.Quaternion().setFromAxisAngle(localForward, input.rollRad);
  const next = pitch.multiply(yaw).multiply(current);
  if (input.rollRad !== 0) next.premultiply(roll);
  next.normalize();
  return { x: next.x, y: next.y, z: next.z, w: next.w };
}

/**
 * @param {import('../xr.d.ts').SkykitXrRay} ray
 * @param {import('../index.d.ts').SkykitThreeFrame} frame
 * @param {Iterable<import('../xr.d.ts').SkykitXrPickBlocker> | undefined} blockers
 */
function resolveBlockedRay(ray, frame, blockers) {
  for (const blocker of blockers ?? []) {
    const result = callBlocker(blocker, ray, {
      frame: frame.xr?.frame,
      referenceSpace: frame.xr?.referenceSpace,
      session: /** @type {any} */ (frame.xr?.session),
      ray,
      viewer: frame.viewer,
      maxDistance: ray.length,
    });
    if (result?.consumed === true || result?.blocked === true) {
      return { blocker, hit: result.hit ?? result };
    }
  }
  return null;
}

/**
 * @param {import('../xr.d.ts').SkykitXrPickBlocker} blocker
 * @param {import('../xr.d.ts').SkykitXrRay} ray
 * @param {import('../xr.d.ts').SkykitXrRayContext & { maxDistance?: number | null }} context
 */
function callBlocker(blocker, ray, context) {
  if (typeof blocker === 'function') {
    return blocker(ray, context);
  }
  return blocker.blockRay?.(ray, context) ?? blocker.pick?.(ray, context) ?? null;
}

/**
 * @param {import('../xr.d.ts').SkykitXrRay} ray
 * @param {import('../index.d.ts').SkykitThreeFrame} frame
 * @param {import('../xr.d.ts').SkykitXrRayVisualPluginOptions} options
 */
function resolveRayVisualLength(ray, frame, options) {
  const fallbackLength = positiveFinite(options.length, 12);
  let length = positiveFinite(ray.length, fallbackLength);
  let blocked = false;
  for (const blocker of options.blockers ?? []) {
    const result = callBlocker(blocker, ray, {
      frame: frame.xr?.frame,
      referenceSpace: frame.xr?.referenceSpace,
      session: /** @type {any} */ (frame.xr?.session),
      ray,
      viewer: frame.viewer,
      maxDistance: length,
    });
    if (!result) continue;
    const hitDistance = finiteNumber(
      result.distance
        ?? result.maxDistance
        ?? /** @type {{ length?: unknown }} */ (result.hit ?? {}).length,
      Number.NaN,
    );
    if (Number.isFinite(hitDistance) && hitDistance >= 0) {
      length = Math.min(length, hitDistance);
    } else if (result.consumed === true || result.blocked === true) {
      length = 0;
    }
    blocked = blocked || result.consumed === true || result.blocked === true;
  }
  return { length, blocked };
}

/**
 * @param {import('../xr.d.ts').SkykitXrRayVisualPluginOptions['parent']} parent
 * @param {import('../index.d.ts').SkykitThreePluginContext} context
 */
function resolveRayVisualParent(parent, context) {
  if (typeof parent === 'function') {
    return parent(context) ?? context.scene;
  }
  return parent ?? context.scene;
}
