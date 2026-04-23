import { createJourneyController } from './journey-controller.js';

function clonePoint(point) {
  if (!point || typeof point !== 'object') return null;
  const { x, y, z } = point;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function composeArrivalCallback(...callbacks) {
  const handlers = callbacks.filter((callback) => typeof callback === 'function');
  if (handlers.length === 0) return undefined;
  return () => {
    for (const handler of handlers) {
      handler();
    }
  };
}

function shouldRefreshSelection(scene) {
  if (scene?.refreshSelection === true) {
    return true;
  }
  if (!scene?.state || typeof scene.state !== 'object') {
    return false;
  }

  return [
    'fieldStrategy',
    'mDesired',
    'targetPc',
    'observerPc',
    'verticalFovDeg',
    'overscanDeg',
    'nearPc',
    'farPc',
    'maxLevel',
    'motionAdaptiveMaxLevel',
  ].some((key) => Object.prototype.hasOwnProperty.call(scene.state, key));
}

function resolveSceneCameraAction(scene) {
  if (scene?.cameraAction && typeof scene.cameraAction === 'object') {
    return scene.cameraAction;
  }

  if (scene?.type === 'flyAndLook') {
    return {
      type: 'fly-to',
      observerPc: scene.observerPc,
      lookAtPc: scene.lookAtPc,
      speed: scene.flySpeed,
      deceleration: scene.deceleration,
      lockAt: {
        dwellMs: scene.dwellMs ?? 0,
        recenterSpeed: scene.recenterSpeed ?? 0.08,
      },
    };
  }

  if (scene?.type === 'free-roam') {
    return {
      type: 'fly-to',
      observerPc: scene.observerPc,
      lookAtPc: scene.lookAtPc,
      speed: scene.flySpeed,
      deceleration: scene.deceleration,
      unlockOnArrive: true,
      lockAt: {
        dwellMs: scene.dwellMs ?? 0,
        recenterSpeed: scene.recenterSpeed ?? 0.08,
      },
    };
  }

  if (scene?.type === 'orbit') {
    return {
      type: 'orbital-insert',
      centerPc: scene.centerPc,
      lookAtPc: scene.lookAtPc ?? scene.centerPc,
      orbitRadius: scene.orbitRadiusPc ?? scene.orbitRadius,
      angularSpeed: scene.angularSpeed,
      speed: scene.flySpeed ?? scene.approachSpeed,
      deceleration: scene.deceleration,
      lockAt: {
        dwellMs: scene.dwellMs ?? 5_000,
        recenterSpeed: scene.recenterSpeed ?? 0.06,
      },
    };
  }

  if (Array.isArray(scene?.routePointsPc)) {
    return {
      type: 'polyline',
      pointsPc: scene.routePointsPc,
      lookAtPc: scene.lookAtPc ?? null,
      speed: scene.flySpeed ?? scene.speed,
      deceleration: scene.deceleration,
      unlockOnArrive: Boolean(scene.unlockOnArrive),
      lockAt: scene.lookAtPc
        ? {
          dwellMs: scene.dwellMs ?? 0,
          recenterSpeed: scene.recenterSpeed ?? 0.08,
        }
        : null,
    };
  }

  if (scene?.observerPc && scene?.lookAtPc) {
    return {
      type: 'fly-to',
      observerPc: scene.observerPc,
      lookAtPc: scene.lookAtPc,
      speed: scene.flySpeed ?? scene.speed,
      deceleration: scene.deceleration,
      unlockOnArrive: Boolean(scene.unlockOnArrive),
      lockAt: {
        dwellMs: scene.dwellMs ?? 0,
        recenterSpeed: scene.recenterSpeed ?? 0.08,
      },
    };
  }

  return null;
}

/**
 * Apply one declarative viewer journey scene.
 *
 * @param {any} scene
 * @param {any} options
 */
export async function applyViewerJourneyScene(scene, options = {}) {
  const viewer = options.viewer;
  const cameraController = options.cameraController;
  if (!viewer || typeof viewer.setState !== 'function' || typeof viewer.refreshSelection !== 'function') {
    throw new TypeError('applyViewerJourneyScene() requires a viewer handle');
  }
  if (!cameraController || typeof cameraController.cancelAutomation !== 'function') {
    throw new TypeError('applyViewerJourneyScene() requires a camera controller');
  }

  const context = {
    viewer,
    cameraController,
    scene,
  };

  if (typeof options.preloadScene === 'function') {
    await options.preloadScene(scene, context);
  }

  if (scene?.state && typeof scene.state === 'object') {
    viewer.setState(scene.state);
    if (shouldRefreshSelection(scene)) {
      await viewer.refreshSelection();
    }
  }

  if (typeof options.applySceneState === 'function') {
    await options.applySceneState(scene, context);
  }

  const action = resolveSceneCameraAction(scene);
  if (!action) {
    return scene;
  }

  if (action.cancelAutomation !== false) {
    cameraController.cancelAutomation();
  }

  const lockTarget = clonePoint(action.lockAtPc ?? action.lookAtPc ?? null);
  if (lockTarget && action.lockAt !== false) {
    cameraController.lockAt(lockTarget, {
      dwellMs: action.lockAt?.dwellMs,
      recenterSpeed: action.lockAt?.recenterSpeed,
      upIcrs: action.lockAt?.upIcrs,
    });
  }

  const unlockOnArrive = action.unlockOnArrive === true
    ? () => cameraController.unlockAt()
    : null;
  const arrivalCallback = composeArrivalCallback(unlockOnArrive, action.onArrive);

  if (action.type === 'look-at') {
    const targetPc = clonePoint(action.targetPc ?? action.lookAtPc);
    if (targetPc) {
      cameraController.lookAt(targetPc, {
        blend: action.blend,
        upIcrs: action.upIcrs,
        arrivalThresholdRad: action.arrivalThresholdRad,
        onArrive: arrivalCallback,
      });
    }
    return scene;
  }

  if (action.type === 'fly-to') {
    const observerPc = clonePoint(action.observerPc);
    if (observerPc) {
      cameraController.flyTo(observerPc, {
        speed: action.speed,
        deceleration: action.deceleration,
        durationSecs: action.durationSecs,
        arrivalThreshold: action.arrivalThreshold,
        onArrive: arrivalCallback,
      });
    }
    return scene;
  }

  if (action.type === 'polyline') {
    const pointsPc = Array.isArray(action.pointsPc)
      ? action.pointsPc.map(clonePoint).filter(Boolean)
      : [];
    if (pointsPc.length > 1) {
      cameraController.flyPolyline(pointsPc, {
        speed: action.speed,
        deceleration: action.deceleration,
        durationSecs: action.durationSecs,
        arrivalThreshold: action.arrivalThreshold,
        onArrive: arrivalCallback,
      });
    }
    return scene;
  }

  if (action.type === 'orbital-insert') {
    const centerPc = clonePoint(action.centerPc);
    if (centerPc) {
      cameraController.orbitalInsert(centerPc, {
        orbitRadius: action.orbitRadius ?? action.orbitRadiusPc,
        angularSpeed: action.angularSpeed,
        approachSpeed: action.approachSpeed ?? action.speed,
        speed: action.speed,
        deceleration: action.deceleration,
        onInserted: arrivalCallback,
      });
    }
    return scene;
  }

  if (action.type === 'orbit') {
    const centerPc = clonePoint(action.centerPc);
    if (centerPc) {
      cameraController.orbit(centerPc, {
        radius: action.radius ?? action.orbitRadius ?? action.orbitRadiusPc,
        angularSpeed: action.angularSpeed,
        initialAngle: action.initialAngle,
      });
      arrivalCallback?.();
    }
    return scene;
  }

  return scene;
}

/**
 * Higher-level journey helper for viewer-driven tours and lessons.
 *
 * @param {any} options
 */
export function createViewerJourneyController(options = {}) {
  const {
    viewer,
    cameraController,
    preloadScene,
    applySceneState,
    ...controllerOptions
  } = options;

  return createJourneyController({
    ...controllerOptions,
    applyScene(scene) {
      return applyViewerJourneyScene(scene, {
        viewer,
        cameraController,
        preloadScene,
        applySceneState,
      });
    },
  });
}
