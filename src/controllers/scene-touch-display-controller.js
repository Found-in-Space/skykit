import * as THREE from 'three';
import { createTouchDisplay } from '../ui/touch-display.js';

const DEFAULT_PANEL_WIDTH = 0.20;
const DEFAULT_PANEL_HEIGHT = 0.28;
const DEFAULT_RENDER_ORDER = 998;

const _ndc = new THREE.Vector2();
const _rayOrigin = new THREE.Vector3();
const _rayDirection = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _tmpQuat = new THREE.Quaternion();

function oppositeHand(handedness) {
  return handedness === 'left' ? 'right' : handedness === 'right' ? 'left' : handedness;
}

function getInputSourcePose(xr, handedness, spaceKey) {
  const { frame, referenceSpace, session } = xr ?? {};
  if (!frame || !referenceSpace || !session) {
    return null;
  }

  for (const source of session.inputSources) {
    if (source.handedness !== handedness) {
      continue;
    }
    const space = source?.[spaceKey];
    if (!space) {
      continue;
    }
    const pose = frame.getPose(space, referenceSpace);
    if (pose) {
      return pose;
    }
  }

  return null;
}

function getGripPose(xr, handedness) {
  return getInputSourcePose(xr, handedness, 'gripSpace');
}

function getTargetRayPose(xr, handedness) {
  return getInputSourcePose(xr, handedness, 'targetRaySpace');
}

function isXrButtonPressed(xr, handedness, buttonIndex = 0) {
  const session = xr?.session;
  if (!session) {
    return false;
  }

  for (const source of session.inputSources) {
    if (source.handedness !== handedness) {
      continue;
    }
    if (source.gamepad?.buttons?.[buttonIndex]?.pressed) {
      return true;
    }
  }

  return false;
}

function resolveParent(parent, context) {
  if (typeof parent === 'function') {
    return parent(context) ?? null;
  }

  if (parent && typeof parent === 'object' && parent.isObject3D) {
    return parent;
  }

  switch (parent) {
    case 'scene':
      return context.scene ?? null;
    case 'navigationRoot':
      return context.navigationRoot ?? null;
    case 'contentRoot':
      return context.contentRoot ?? null;
    case 'attachmentRoot':
      return context.attachmentRoot ?? null;
    case 'deck':
      return context.deck ?? null;
    case 'cameraMount':
    default:
      return context.cameraMount ?? null;
  }
}

function applyStaticTransform(mesh, options = {}) {
  const position = options.position ?? null;
  if (position) {
    mesh.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
  }

  if (options.quaternion) {
    mesh.quaternion.set(
      options.quaternion.x ?? 0,
      options.quaternion.y ?? 0,
      options.quaternion.z ?? 0,
      options.quaternion.w ?? 1,
    );
  } else if (options.rotation) {
    mesh.rotation.set(
      options.rotation.x ?? 0,
      options.rotation.y ?? 0,
      options.rotation.z ?? 0,
    );
  }

  if (Number.isFinite(options.scale)) {
    mesh.scale.setScalar(Number(options.scale));
  } else if (options.scale && typeof options.scale === 'object') {
    mesh.scale.set(
      options.scale.x ?? 1,
      options.scale.y ?? 1,
      options.scale.z ?? 1,
    );
  }
}

function blockEvent(event) {
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

/**
 * Turns a canvas-backed touch display into a native interactive Three.js scene object.
 *
 * The resulting plane can be parented anywhere in the scene graph, driven by XR rays,
 * desktop mouse rays, or both, and updated like any other runtime controller.
 */
export function createSceneTouchDisplayController(options = {}) {
  const {
    id = 'scene-touch-display-controller',
    items: initialItems = [],
    onChange,
    title,
    displayOptions = {},
    panelWidth = DEFAULT_PANEL_WIDTH,
    panelHeight = DEFAULT_PANEL_HEIGHT,
    renderOrder = DEFAULT_RENDER_ORDER,
    parent = 'cameraMount',
    mouseControls = false,
    xrControls = null,
    updatePlacement = null,
    ...staticPlacement
  } = options;

  const display = createTouchDisplay({
    title,
    items: initialItems,
    ...displayOptions,
    onAction(id, value, detail) {
      if (typeof onChange === 'function') {
        onChange(id, value, detail);
      }
    },
  });

  const texture = new THREE.CanvasTexture(display.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const panelGeometry = new THREE.PlaneGeometry(panelWidth, panelHeight);
  const panelMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: options.depthTest !== false,
    side: THREE.DoubleSide,
  });
  const panelMesh = new THREE.Mesh(panelGeometry, panelMaterial);
  panelMesh.renderOrder = renderOrder;
  panelMesh.visible = false;

  const xrInput = xrControls
    ? {
      handedness: xrControls.handedness ?? 'left',
      pointerHand: xrControls.pointerHand ?? oppositeHand(xrControls.handedness ?? 'left'),
      buttonIndex: xrControls.buttonIndex ?? 0,
    }
    : null;

  let latestContext = null;
  let pointerTarget = null;
  let parentObject = null;
  let currentHit = null;
  let hoverActive = false;
  let activePointerId = null;
  let suppressClick = false;
  let xrPointerActive = false;

  function updateWorldMatrices() {
    if (latestContext?.scene?.updateMatrixWorld) {
      latestContext.scene.updateMatrixWorld(true);
      return;
    }

    latestContext?.navigationRoot?.updateMatrixWorld?.(true);
    latestContext?.contentRoot?.updateMatrixWorld?.(true);
    latestContext?.cameraMount?.updateMatrixWorld?.(true);
    latestContext?.camera?.updateMatrixWorld?.(true);
    panelMesh.parent?.updateMatrixWorld?.(true);
    panelMesh.updateMatrixWorld?.(true);
  }

  function syncTexture() {
    if (display.draw()) {
      texture.needsUpdate = true;
    }
  }

  function ensureParented(context) {
    const nextParent = resolveParent(parent, context);
    if (nextParent === parentObject) {
      return;
    }
    if (parentObject) {
      parentObject.remove(panelMesh);
    }
    if (nextParent) {
      nextParent.add(panelMesh);
    }
    parentObject = nextParent;
  }

  function applyPlacement(context) {
    if (typeof updatePlacement === 'function') {
      const result = updatePlacement(panelMesh, context, {
        getGripPose,
        getTargetRayPose,
        isXrButtonPressed,
      });
      if (result === false) {
        panelMesh.visible = false;
        return;
      }
      if (result && typeof result === 'object' && result !== true) {
        applyStaticTransform(panelMesh, result);
      }
      panelMesh.visible = true;
      return;
    }

    applyStaticTransform(panelMesh, staticPlacement);
    panelMesh.visible = true;
  }

  function clearPointerState() {
    currentHit = null;
    hoverActive = false;
    xrPointerActive = false;
    display.handlePointer(null, false);
    syncTexture();
  }

  function intersectPanel(origin, direction) {
    if (!panelMesh.visible) {
      return null;
    }

    updateWorldMatrices();
    _raycaster.ray.origin.copy(origin);
    _raycaster.ray.direction.copy(direction).normalize();
    const hit = _raycaster.intersectObject(panelMesh, false)[0];
    if (!hit?.uv) {
      return null;
    }

    return {
      u: hit.uv.x,
      v: hit.uv.y,
      distance: hit.distance,
      point: hit.point.clone(),
    };
  }

  function getMouseHit(event) {
    if (!pointerTarget || !latestContext?.camera) {
      return null;
    }

    const rect = pointerTarget.getBoundingClientRect?.();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
      return null;
    }

    _ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    updateWorldMatrices();
    _raycaster.setFromCamera(_ndc, latestContext.camera);
    return intersectPanel(_raycaster.ray.origin, _raycaster.ray.direction);
  }

  function updateMouseDisplay(event, pressed) {
    const hit = getMouseHit(event);
    currentHit = hit;
    display.handlePointer(hit, pressed);
    syncTexture();
    return hit;
  }

  function onPointerDown(event) {
    if (!mouseControls || latestContext?.xr?.presenting === true || event.button !== 0) {
      return;
    }

    const hit = updateMouseDisplay(event, true);
    if (!hit) {
      return;
    }

    activePointerId = event.pointerId;
    suppressClick = true;
    hoverActive = true;
    pointerTarget?.setPointerCapture?.(event.pointerId);
    blockEvent(event);
  }

  function onPointerMove(event) {
    if (!mouseControls || latestContext?.xr?.presenting === true) {
      return;
    }
    if (activePointerId != null && event.pointerId !== activePointerId) {
      return;
    }

    const pressed = activePointerId != null;
    const hit = updateMouseDisplay(event, pressed);

    if (pressed || hit) {
      hoverActive = Boolean(hit) || pressed;
      blockEvent(event);
      return;
    }

    if (hoverActive) {
      hoverActive = false;
      currentHit = null;
      display.handlePointer(null, false);
      syncTexture();
    }
  }

  function onPointerEnd(event) {
    if (!mouseControls || latestContext?.xr?.presenting === true) {
      return;
    }
    if (activePointerId == null || event.pointerId !== activePointerId) {
      return;
    }

    const hit = updateMouseDisplay(event, false);
    pointerTarget?.releasePointerCapture?.(event.pointerId);
    activePointerId = null;
    hoverActive = Boolean(hit);
    blockEvent(event);
  }

  function onPointerLeave() {
    if (!mouseControls || latestContext?.xr?.presenting === true || activePointerId != null) {
      return;
    }
    if (!hoverActive) {
      return;
    }
    hoverActive = false;
    currentHit = null;
    display.handlePointer(null, false);
    syncTexture();
  }

  function onClick(event) {
    if (!mouseControls || latestContext?.xr?.presenting === true) {
      return;
    }

    const hit = getMouseHit(event);
    if (suppressClick || hit) {
      blockEvent(event);
    }
    suppressClick = false;
  }

  function bindMouse(context) {
    pointerTarget = mouseControls?.pointerTarget ?? context.canvas ?? null;
    if (!pointerTarget?.addEventListener) {
      return;
    }

    pointerTarget.addEventListener('pointerdown', onPointerDown, true);
    pointerTarget.addEventListener('pointermove', onPointerMove, true);
    pointerTarget.addEventListener('pointerup', onPointerEnd, true);
    pointerTarget.addEventListener('pointercancel', onPointerEnd, true);
    pointerTarget.addEventListener('pointerleave', onPointerLeave, true);
    pointerTarget.addEventListener('click', onClick, true);
  }

  function unbindMouse() {
    if (!pointerTarget?.removeEventListener) {
      pointerTarget = null;
      return;
    }

    pointerTarget.removeEventListener('pointerdown', onPointerDown, true);
    pointerTarget.removeEventListener('pointermove', onPointerMove, true);
    pointerTarget.removeEventListener('pointerup', onPointerEnd, true);
    pointerTarget.removeEventListener('pointercancel', onPointerEnd, true);
    pointerTarget.removeEventListener('pointerleave', onPointerLeave, true);
    pointerTarget.removeEventListener('click', onClick, true);
    pointerTarget = null;
  }

  function updateXrPointer(context) {
    if (!xrInput || context.xr?.presenting !== true || !panelMesh.visible) {
      if (xrPointerActive) {
        xrPointerActive = false;
        currentHit = null;
        display.handlePointer(null, false);
        syncTexture();
      }
      return;
    }

    const pose = getTargetRayPose(context.xr, xrInput.pointerHand);
    if (!pose) {
      if (xrPointerActive) {
        xrPointerActive = false;
        currentHit = null;
        display.handlePointer(null, false);
        syncTexture();
      }
      return;
    }

    _rayOrigin.set(
      pose.transform.position.x,
      pose.transform.position.y,
      pose.transform.position.z,
    );
    _rayDirection.set(0, 0, -1).applyQuaternion(_tmpQuat.set(
      pose.transform.orientation.x,
      pose.transform.orientation.y,
      pose.transform.orientation.z,
      pose.transform.orientation.w,
    ));

    const hit = intersectPanel(_rayOrigin, _rayDirection);
    const pressed = isXrButtonPressed(context.xr, xrInput.pointerHand, xrInput.buttonIndex);
    currentHit = hit;
    xrPointerActive = Boolean(hit) || pressed;
    display.handlePointer(hit, pressed);
    syncTexture();
  }

  return {
    id,
    mesh: panelMesh,
    panelMesh,
    display,

    getHit() {
      if (!currentHit) {
        return null;
      }
      return {
        length: currentHit.distance,
        blocked: true,
      };
    },

    draw() {
      syncTexture();
    },

    getItem(id) {
      return display.getItem(id);
    },

    attach(context) {
      latestContext = context;
      if (mouseControls) {
        bindMouse(context);
      }
      syncTexture();
    },

    update(context) {
      latestContext = context;
      ensureParented(context);
      applyPlacement(context);

      if (!panelMesh.visible) {
        clearPointerState();
        return;
      }

      updateXrPointer(context);
      syncTexture();
    },

    setDisplay(id, lines) {
      display.setDisplay(id, lines);
      syncTexture();
    },

    setItems(nextItems) {
      display.setItems(nextItems);
      syncTexture();
    },

    setItemValue(id, value) {
      display.setItemValue(id, value);
      syncTexture();
    },

    dispose() {
      unbindMouse();
      if (parentObject) {
        parentObject.remove(panelMesh);
      }
      panelGeometry.dispose();
      panelMaterial.dispose();
      texture.dispose();
      parentObject = null;
      currentHit = null;
      latestContext = null;
    },
  };
}
