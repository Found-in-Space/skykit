import * as THREE from 'three';

const DEFAULT_HANDEDNESS = 'left';
const PANEL_WIDTH = 0.20;
const PANEL_HEIGHT = 0.28;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 560;
const PANEL_RENDER_ORDER = 998;

const COLORS = {
  bg: '#0a0e1aee',
  border: '#334466',
  itemBg: '#141c2e',
  itemHover: '#1e2e50',
  itemPress: '#2a4070',
  text: '#c8d0e0',
  textDim: '#6a7a94',
  accent: '#44ff66',
  toggleOff: '#333c50',
  toggleOn: '#44ff66',
  toggleKnob: '#e0e6f0',
};

const LAYOUT = {
  padding: 20,
  titleHeight: 50,
  itemHeight: 60,
  itemGap: 8,
  itemPaddingX: 16,
  itemRadius: 8,
  toggleWidth: 44,
  toggleHeight: 24,
  fontSize: 20,
  titleFontSize: 22,
  displayLineHeight: 24,
  displayFontSize: 17,
  displayPaddingY: 12,
  displayLabelFontSize: 13,
};

function getItemHeight(item) {
  if (item.type === 'display') {
    const contentLines = Math.max(item.lines?.length ?? 0, 1);
    const labelLines = item.label ? 1 : 0;
    return LAYOUT.displayPaddingY * 2 + (contentLines + labelLines) * LAYOUT.displayLineHeight;
  }
  return LAYOUT.itemHeight;
}

const _plane = new THREE.Plane();
const _intersect = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _localPt = new THREE.Vector3();
const _rayOrig = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

function getGripPose(xr, handedness) {
  const { frame, referenceSpace, session } = xr ?? {};
  if (!frame || !referenceSpace || !session) return null;

  for (const source of session.inputSources) {
    if (source.handedness !== handedness) continue;
    if (!source.gripSpace) continue;
    const pose = frame.getPose(source.gripSpace, referenceSpace);
    if (pose) return pose;
  }
  return null;
}

function getTargetRayPose(xr, handedness) {
  const { frame, referenceSpace, session } = xr ?? {};
  if (!frame || !referenceSpace || !session) return null;

  for (const source of session.inputSources) {
    if (source.handedness !== handedness) continue;
    if (!source.targetRaySpace) continue;
    const pose = frame.getPose(source.targetRaySpace, referenceSpace);
    if (pose) return pose;
  }
  return null;
}

function isTriggerPressed(xr, handedness) {
  const session = xr?.session;
  if (!session) return false;
  for (const source of session.inputSources) {
    if (source.handedness !== handedness) continue;
    const btn = source.gamepad?.buttons?.[0];
    if (btn?.pressed) return true;
  }
  return false;
}

function hitTestPanel(panelMesh, rayOrigin, rayDirection) {
  // Both ray and panel are in cameraMount-local (XR reference) space.
  // Use the panel's local transform, not world, to stay in that space.
  _normal.set(0, 0, 1).applyQuaternion(panelMesh.quaternion);
  _plane.setFromNormalAndCoplanarPoint(_normal, panelMesh.position);

  const denom = _normal.dot(rayDirection);
  if (Math.abs(denom) < 1e-6) return null;

  const t = _plane.distanceToPoint(rayOrigin) / -denom;
  if (t < 0) return null;

  _intersect.copy(rayOrigin).addScaledVector(rayDirection, t);

  _tmpQuat.copy(panelMesh.quaternion).invert();
  _localPt.copy(_intersect).sub(panelMesh.position).applyQuaternion(_tmpQuat);
  const u = _localPt.x / PANEL_WIDTH + 0.5;
  const v = _localPt.y / PANEL_HEIGHT + 0.5;

  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { u, v, distance: t, point: _intersect.clone() };
}

const DISMISS_SIZE = 28;
const DISMISS_MARGIN = 10;

function itemAtUV(items, u, v) {
  const px = u * CANVAS_WIDTH;
  const py = (1 - v) * CANVAS_HEIGHT;

  let y = LAYOUT.padding + LAYOUT.titleHeight;
  for (const item of items) {
    const h = getItemHeight(item);
    const rectRight = CANVAS_WIDTH - LAYOUT.padding;
    if (item.type === 'display') {
      if (item.dismissible && item.lines?.length > 0) {
        const bx = rectRight - DISMISS_MARGIN - DISMISS_SIZE;
        const by = y + DISMISS_MARGIN;
        if (px >= bx && px <= bx + DISMISS_SIZE && py >= by && py <= by + DISMISS_SIZE) {
          return item;
        }
      }
    } else if (
      px >= LAYOUT.padding && px <= rectRight &&
      py >= y && py <= y + h
    ) {
      return item;
    }
    y += h + LAYOUT.itemGap;
  }
  return null;
}

function drawPanel(ctx, items, hoveredId, pressedId) {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.fillStyle = COLORS.bg;
  roundRect(ctx, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 16);
  ctx.fill();

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, CANVAS_WIDTH - 2, CANVAS_HEIGHT - 2, 16);
  ctx.stroke();

  ctx.fillStyle = COLORS.accent;
  ctx.font = `bold ${LAYOUT.titleFontSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText('SkyKit', LAYOUT.padding, LAYOUT.padding + LAYOUT.titleHeight / 2);

  let y = LAYOUT.padding + LAYOUT.titleHeight;
  for (const item of items) {
    const h = getItemHeight(item);
    const rect = {
      x: LAYOUT.padding,
      y,
      w: CANVAS_WIDTH - LAYOUT.padding * 2,
      h,
    };

    if (item.type === 'display') {
      drawDisplay(ctx, rect, item, item.id === hoveredId, item.id === pressedId);
    } else {
      const isHovered = item.id === hoveredId;
      const isPressed = item.id === pressedId;

      ctx.fillStyle = isPressed
        ? COLORS.itemPress
        : isHovered
          ? COLORS.itemHover
          : COLORS.itemBg;
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, LAYOUT.itemRadius);
      ctx.fill();

      ctx.fillStyle = COLORS.text;
      ctx.font = `${LAYOUT.fontSize}px sans-serif`;
      ctx.textBaseline = 'middle';

      if (item.type === 'toggle') {
        ctx.fillText(item.label, rect.x + LAYOUT.itemPaddingX, rect.y + rect.h / 2);
        drawToggle(
          ctx,
          rect.x + rect.w - LAYOUT.itemPaddingX - LAYOUT.toggleWidth,
          rect.y + (rect.h - LAYOUT.toggleHeight) / 2,
          LAYOUT.toggleWidth,
          LAYOUT.toggleHeight,
          item.value,
        );
      } else {
        const textWidth = ctx.measureText(item.label).width;
        ctx.fillText(
          item.label,
          rect.x + (rect.w - textWidth) / 2,
          rect.y + rect.h / 2,
        );
      }
    }

    y += h + LAYOUT.itemGap;
  }
}

function drawDisplay(ctx, rect, item, isHovered, isPressed) {
  ctx.fillStyle = COLORS.itemBg;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, LAYOUT.itemRadius);
  ctx.fill();

  if (item.label) {
    ctx.fillStyle = COLORS.accent;
    ctx.font = `bold ${LAYOUT.displayLabelFontSize}px sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(
      item.label.toUpperCase(),
      rect.x + LAYOUT.itemPaddingX,
      rect.y + LAYOUT.displayPaddingY,
    );
  }

  const lines = item.lines;
  if (!lines || lines.length === 0) {
    ctx.fillStyle = COLORS.textDim;
    ctx.font = `${LAYOUT.displayFontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText('No selection', rect.x + LAYOUT.itemPaddingX, rect.y + rect.h / 2);
    return;
  }

  ctx.font = `${LAYOUT.displayFontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  const labelOffset = item.label ? LAYOUT.displayLineHeight : 0;
  let ly = rect.y + LAYOUT.displayPaddingY + labelOffset;
  for (const line of lines) {
    ctx.fillStyle = COLORS.text;
    ctx.fillText(line, rect.x + LAYOUT.itemPaddingX, ly);
    ly += LAYOUT.displayLineHeight;
  }

  if (item.dismissible) {
    const cx = rect.x + rect.w - DISMISS_MARGIN - DISMISS_SIZE / 2;
    const cy = rect.y + DISMISS_MARGIN + DISMISS_SIZE / 2;
    const r = DISMISS_SIZE / 2;

    ctx.fillStyle = isPressed
      ? COLORS.itemPress
      : isHovered
        ? COLORS.itemHover
        : COLORS.toggleOff;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const s = 6;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy - s);
    ctx.lineTo(cx + s, cy + s);
    ctx.moveTo(cx + s, cy - s);
    ctx.lineTo(cx - s, cy + s);
    ctx.stroke();
  }
}

function drawToggle(ctx, x, y, w, h, on) {
  const r = h / 2;
  ctx.fillStyle = on ? COLORS.toggleOn : COLORS.toggleOff;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  const knobR = r - 3;
  const knobX = on ? x + w - r : x + r;
  const knobY = y + r;
  ctx.fillStyle = COLORS.toggleKnob;
  ctx.beginPath();
  ctx.arc(knobX, knobY, knobR, 0, Math.PI * 2);
  ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * XR tablet controller — a canvas-texture panel attached to the left
 * controller's grip space, interacted with by the right controller's
 * laser pointer.
 *
 * Items are plain config objects: `{ id, label, type, value }`.
 * Supported types: 'toggle' (boolean), 'button' (momentary),
 * and 'display' (non-interactive multi-line text, updated via setDisplay).
 *
 * The controller exposes `getHit()` so the pick controller can
 * shorten its laser and suppress star picks when the pointer is
 * aimed at the panel.
 */
export function createXrTabletController(options = {}) {
  const {
    items = [],
    onChange,
    handedness = DEFAULT_HANDEDNESS,
  } = options;

  const pointerHand = handedness === 'left' ? 'right' : 'left';

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const panelGeo = new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT);
  const panelMat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const panelMesh = new THREE.Mesh(panelGeo, panelMat);
  panelMesh.renderOrder = PANEL_RENDER_ORDER;
  panelMesh.visible = false;

  let parent = null;
  let hoveredId = null;
  let pressedId = null;
  let triggerWasPressed = false;
  let needsRedraw = true;
  let currentHit = null;

  function redraw() {
    drawPanel(ctx, items, hoveredId, pressedId);
    texture.needsUpdate = true;
    needsRedraw = false;
  }

  function setHovered(id) {
    if (hoveredId !== id) {
      hoveredId = id;
      needsRedraw = true;
    }
  }

  function activateItem(item) {
    if (!item) return;
    if (item.type === 'toggle') {
      item.value = !item.value;
      needsRedraw = true;
    }
    if (typeof onChange === 'function') {
      onChange(item.id, item.value);
    }
  }

  function ensureParented(cameraMount) {
    if (parent === cameraMount) return;
    if (parent) parent.remove(panelMesh);
    cameraMount.add(panelMesh);
    parent = cameraMount;
  }

  function positionPanel(xr) {
    const pose = getGripPose(xr, handedness);
    if (!pose) {
      panelMesh.visible = false;
      return;
    }

    const p = pose.transform.position;
    const o = pose.transform.orientation;
    panelMesh.position.set(p.x, p.y, p.z);
    panelMesh.quaternion.set(o.x, o.y, o.z, o.w);

    // Tilt the panel ~30° toward the user and offset slightly above the grip
    panelMesh.rotateX(-Math.PI * 0.35);
    panelMesh.translateZ(-0.02);
    panelMesh.translateY(0.08);

    panelMesh.visible = true;
  }

  function testPointer(xr) {
    const pose = getTargetRayPose(xr, pointerHand);
    if (!pose || !panelMesh.visible) {
      currentHit = null;
      return;
    }

    const p = pose.transform.position;
    const o = pose.transform.orientation;
    _rayOrig.set(p.x, p.y, p.z);
    _rayDir.set(0, 0, -1).applyQuaternion(_tmpQuat.set(o.x, o.y, o.z, o.w));

    const hit = hitTestPanel(panelMesh, _rayOrig, _rayDir);
    currentHit = hit;

    if (hit) {
      const item = itemAtUV(items, hit.u, hit.v);
      setHovered(item?.id ?? null);
    } else {
      setHovered(null);
    }
  }

  function handleTrigger(xr) {
    const pressed = isTriggerPressed(xr, pointerHand);
    if (pressed && !triggerWasPressed && hoveredId != null) {
      const item = items.find((i) => i.id === hoveredId);
      pressedId = hoveredId;
      needsRedraw = true;
      activateItem(item);
    }
    if (!pressed && pressedId != null) {
      pressedId = null;
      needsRedraw = true;
    }
    triggerWasPressed = pressed;
  }

  redraw();

  return {
    id: options.id ?? 'xr-tablet-controller',

    /**
     * Called by the pick controller to check if its laser hits the
     * tablet. Returns `{ length, blocked: true }` when hit, or null.
     */
    getHit() {
      if (!currentHit) return null;
      return { length: currentHit.distance, blocked: true };
    },

    attach(_context) {},

    update(context) {
      if (context.xr?.presenting !== true) {
        panelMesh.visible = false;
        currentHit = null;
        return;
      }

      ensureParented(context.cameraMount);
      positionPanel(context.xr);
      testPointer(context.xr);
      handleTrigger(context.xr);

      if (needsRedraw) redraw();
    },

    setItemValue(id, value) {
      const item = items.find((i) => i.id === id);
      if (item) {
        item.value = value;
        needsRedraw = true;
      }
    },

    setDisplay(id, lines) {
      const item = items.find((i) => i.id === id && i.type === 'display');
      if (item) {
        item.lines = lines;
        needsRedraw = true;
      }
    },

    dispose() {
      if (parent) parent.remove(panelMesh);
      panelGeo.dispose();
      panelMat.dispose();
      texture.dispose();
      parent = null;
      currentHit = null;
    },
  };
}
