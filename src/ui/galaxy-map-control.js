import { createNode } from '@found-in-space/touch-os';
import { GALACTIC_CENTER_PC } from '../scene-targets.js';
import { runtimeNodeGeometry } from '../services/octree/octree-file-service.js';

const GALACTIC_TO_ICRS_ROTATION = [
  [-0.0548755604, +0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, +0.7469822445, +0.4559837762],
];

const PRACTICAL_MAX_RADIAL_SPAN_PC = 16000;
const DEFAULT_FOCUSED_MAX_RADIAL_SPAN_PC = 10000;
const PRACTICAL_MAX_VERTICAL_HALF_SPAN_PC = 2500;
const MIN_VERTICAL_HALF_SPAN_PC = 1200;
const RADIAL_ROUNDING_PC = 500;
const VERTICAL_ROUNDING_PC = 100;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function roundUpTo(value, step) {
  if (!(Number.isFinite(value) && value > 0 && Number.isFinite(step) && step > 0)) {
    return step;
  }
  return Math.ceil(value / step) * step;
}

function icrsToGalactic(ix, iy, iz) {
  return [
    GALACTIC_TO_ICRS_ROTATION[0][0] * ix
      + GALACTIC_TO_ICRS_ROTATION[1][0] * iy
      + GALACTIC_TO_ICRS_ROTATION[2][0] * iz,
    GALACTIC_TO_ICRS_ROTATION[0][1] * ix
      + GALACTIC_TO_ICRS_ROTATION[1][1] * iy
      + GALACTIC_TO_ICRS_ROTATION[2][1] * iz,
    GALACTIC_TO_ICRS_ROTATION[0][2] * ix
      + GALACTIC_TO_ICRS_ROTATION[1][2] * iy
      + GALACTIC_TO_ICRS_ROTATION[2][2] * iz,
  ];
}

function toGalacticPoint(point) {
  if (!point) {
    return null;
  }
  const [x, y, z] = icrsToGalactic(point.x, point.y, point.z);
  return { x, y, z };
}

export const GALACTIC_CENTER_GALACTIC_PC = Object.freeze((() => {
  const [x, y, z] = icrsToGalactic(
    GALACTIC_CENTER_PC.x,
    GALACTIC_CENTER_PC.y,
    GALACTIC_CENTER_PC.z,
  );
  return { x, y, z };
})());

const SOLAR_GALACTOCENTRIC_PC = Object.freeze({
  x: -GALACTIC_CENTER_GALACTIC_PC.x,
  y: -GALACTIC_CENTER_GALACTIC_PC.y,
  z: -GALACTIC_CENTER_GALACTIC_PC.z,
});

const MIN_RADIAL_SPAN_PC = roundUpTo(
  Math.hypot(SOLAR_GALACTOCENTRIC_PC.x, SOLAR_GALACTOCENTRIC_PC.y) * 1.15,
  RADIAL_ROUNDING_PC,
);

export const DEFAULT_GALAXY_MAP_SCALE_HINT = Object.freeze({
  baseRadialSpanPc: MIN_RADIAL_SPAN_PC,
  maxRadialSpanPc: PRACTICAL_MAX_RADIAL_SPAN_PC,
  baseVerticalHalfSpanPc: MIN_VERTICAL_HALF_SPAN_PC,
  maxVerticalHalfSpanPc: PRACTICAL_MAX_VERTICAL_HALF_SPAN_PC,
});

function toGalactocentricPoint(point) {
  const galactic = toGalacticPoint(point);
  if (!galactic) {
    return null;
  }
  return {
    x: galactic.x - GALACTIC_CENTER_GALACTIC_PC.x,
    y: galactic.y - GALACTIC_CENTER_GALACTIC_PC.y,
    z: galactic.z - GALACTIC_CENTER_GALACTIC_PC.z,
  };
}

function measureCornerExtents(points, extents) {
  for (const point of points) {
    const rel = toGalactocentricPoint(point);
    if (!rel) {
      continue;
    }
    extents.maxRadialPc = Math.max(extents.maxRadialPc, Math.hypot(rel.x, rel.y));
    extents.maxAbsHeightPc = Math.max(extents.maxAbsHeightPc, Math.abs(rel.z));
  }
}

function collectCubeCorners(centerX, centerY, centerZ, halfSize) {
  const corners = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push({
          x: centerX + sx * halfSize,
          y: centerY + sy * halfSize,
          z: centerZ + sz * halfSize,
        });
      }
    }
  }
  return corners;
}

function deriveExtentsFromHeader(header) {
  if (!header || !Number.isFinite(header.worldHalfSize)) {
    return null;
  }

  const corners = collectCubeCorners(
    header.worldCenterX ?? 0,
    header.worldCenterY ?? 0,
    header.worldCenterZ ?? 0,
    header.worldHalfSize,
  );
  const extents = { maxRadialPc: 0, maxAbsHeightPc: 0 };
  measureCornerExtents(corners, extents);
  return extents;
}

function deriveExtentsFromRootNodes(bootstrap, rootShard) {
  if (!bootstrap?.header || !rootShard?.hdr || typeof rootShard.readNode !== 'function') {
    return null;
  }

  const extents = { maxRadialPc: 0, maxAbsHeightPc: 0 };
  let foundNode = false;

  for (let octant = 0; octant < 8; octant += 1) {
    const nodeIndex = rootShard.hdr.entryNodes?.[octant] ?? 0;
    if (!(nodeIndex > 0)) {
      continue;
    }
    foundNode = true;
    const record = rootShard.readNode(nodeIndex);
    const geom = runtimeNodeGeometry(bootstrap.header, rootShard.hdr, record);
    const corners = collectCubeCorners(
      geom.centerX,
      geom.centerY,
      geom.centerZ,
      geom.halfSize,
    );
    measureCornerExtents(corners, extents);
  }

  return foundNode ? extents : null;
}

export function deriveGalaxyMapScaleHint(bootstrap, rootShard, options = {}) {
  const minRadialSpanPc = Number.isFinite(options.minRadialSpanPc)
    ? Number(options.minRadialSpanPc)
    : MIN_RADIAL_SPAN_PC;
  const focusedMaxRadialSpanPc = Number.isFinite(options.focusedMaxRadialSpanPc)
    ? Number(options.focusedMaxRadialSpanPc)
    : DEFAULT_FOCUSED_MAX_RADIAL_SPAN_PC;
  const maxRadialSpanPc = Number.isFinite(options.maxRadialSpanPc)
    ? Number(options.maxRadialSpanPc)
    : PRACTICAL_MAX_RADIAL_SPAN_PC;
  const minVerticalHalfSpanPc = Number.isFinite(options.minVerticalHalfSpanPc)
    ? Number(options.minVerticalHalfSpanPc)
    : MIN_VERTICAL_HALF_SPAN_PC;
  const maxVerticalHalfSpanPc = Number.isFinite(options.maxVerticalHalfSpanPc)
    ? Number(options.maxVerticalHalfSpanPc)
    : PRACTICAL_MAX_VERTICAL_HALF_SPAN_PC;

  const extents = deriveExtentsFromRootNodes(bootstrap, rootShard)
    ?? deriveExtentsFromHeader(bootstrap?.header)
    ?? { maxRadialPc: minRadialSpanPc, maxAbsHeightPc: minVerticalHalfSpanPc };

  return {
    baseRadialSpanPc: clamp(
      roundUpTo(extents.maxRadialPc, RADIAL_ROUNDING_PC),
      minRadialSpanPc,
      Math.min(focusedMaxRadialSpanPc, maxRadialSpanPc),
    ),
    maxRadialSpanPc,
    baseVerticalHalfSpanPc: clamp(
      roundUpTo(extents.maxAbsHeightPc, VERTICAL_ROUNDING_PC),
      minVerticalHalfSpanPc,
      maxVerticalHalfSpanPc,
    ),
    maxVerticalHalfSpanPc,
  };
}

function buildRadialTicks(radialSpanPc) {
  const rawStep = Math.max(RADIAL_ROUNDING_PC, radialSpanPc / 4);
  const step = roundUpTo(rawStep, RADIAL_ROUNDING_PC);
  const ticks = [];
  for (let value = step; value < radialSpanPc; value += step) {
    ticks.push(value);
  }
  return ticks;
}

export function buildGalaxyMapValue(observerPc, selectedPc, scaleHint = DEFAULT_GALAXY_MAP_SCALE_HINT) {
  const observer = toGalactocentricPoint(observerPc) ?? { ...SOLAR_GALACTOCENTRIC_PC };
  const selected = toGalactocentricPoint(selectedPc);
  const baseRadialSpanPc = scaleHint?.baseRadialSpanPc ?? DEFAULT_GALAXY_MAP_SCALE_HINT.baseRadialSpanPc;
  const maxRadialSpanPc = scaleHint?.maxRadialSpanPc ?? DEFAULT_GALAXY_MAP_SCALE_HINT.maxRadialSpanPc;
  const baseVerticalHalfSpanPc = scaleHint?.baseVerticalHalfSpanPc ?? DEFAULT_GALAXY_MAP_SCALE_HINT.baseVerticalHalfSpanPc;
  const maxVerticalHalfSpanPc = scaleHint?.maxVerticalHalfSpanPc ?? DEFAULT_GALAXY_MAP_SCALE_HINT.maxVerticalHalfSpanPc;

  const radialObserverPc = Math.hypot(observer.x, observer.y);
  const radialSelectedPc = selected ? Math.hypot(selected.x, selected.y) : 0;
  const desiredRadialSpanPc = Math.max(
    baseRadialSpanPc,
    radialObserverPc * 1.05,
    radialSelectedPc * 1.05,
  );
  const desiredVerticalHalfSpanPc = Math.max(
    baseVerticalHalfSpanPc,
    Math.abs(observer.z) * 1.1,
    selected ? Math.abs(selected.z) * 1.1 : 0,
  );

  const radialSpanPc = clamp(
    roundUpTo(desiredRadialSpanPc, RADIAL_ROUNDING_PC),
    baseRadialSpanPc,
    maxRadialSpanPc,
  );
  const verticalHalfSpanPc = clamp(
    roundUpTo(desiredVerticalHalfSpanPc, VERTICAL_ROUNDING_PC),
    baseVerticalHalfSpanPc,
    maxVerticalHalfSpanPc,
  );

  return {
    observer,
    selected,
    radialSpanPc,
    radialTicksPc: buildRadialTicks(radialSpanPc),
    verticalHalfSpanPc,
  };
}

export function drawGalaxyMapGraphic(ctx, rect, value, options = {}) {
  if (!ctx || !rect || !value) {
    return;
  }

  const observer = value.observer ?? { x: 0, y: 0, z: 0 };
  const selected = value.selected ?? null;
  const radialSpanPc = Number.isFinite(value.radialSpanPc) && value.radialSpanPc > 0
    ? value.radialSpanPc
    : DEFAULT_GALAXY_MAP_SCALE_HINT.baseRadialSpanPc;
  const radialTicksPc = Array.isArray(value.radialTicksPc) ? value.radialTicksPc : [];
  const verticalHalfSpanPc = Number.isFinite(value.verticalHalfSpanPc) && value.verticalHalfSpanPc > 0
    ? value.verticalHalfSpanPc
    : DEFAULT_GALAXY_MAP_SCALE_HINT.baseVerticalHalfSpanPc;

  const theme = {
    bg: options.bg ?? '#08121f',
    border: options.border ?? 'rgba(159, 233, 255, 0.18)',
    axis: options.axis ?? 'rgba(159, 233, 255, 0.28)',
    text: options.text ?? '#9fb3c8',
    accent: options.accent ?? '#44ff66',
    title: options.title ?? 'GALACTIC MAP (XY + Z)',
  };

  const x = rect.x ?? 0;
  const y = rect.y ?? 0;
  const width = rect.w ?? 0;
  const height = rect.h ?? 0;
  const innerX = x + 16;
  const innerY = y + 26;
  const innerW = width - 32;
  const innerH = height - 38;
  const barGap = 14;
  const barW = 24;
  const mapAreaW = Math.max(48, innerW - barW - barGap);
  const radius = Math.max(20, Math.min((mapAreaW - 8) * 0.5, innerH - 8));
  const mapW = radius * 2 + 8;
  const mapX = innerX + (mapAreaW - mapW) * 0.5;
  const mapCenterX = mapX + mapW * 0.5;
  const mapBaseY = innerY + innerH - 4;
  const barX = innerX + mapAreaW + barGap;
  const barY = innerY;
  const barH = innerH;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(x, y, width, height);

  ctx.fillStyle = theme.text;
  ctx.font = 'bold 12px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(theme.title, x + 16, y + 8);

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1.2;
  for (const tick of radialTicksPc) {
    if (!(tick > 0 && tick < radialSpanPc)) {
      continue;
    }
    ctx.beginPath();
    ctx.arc(mapCenterX, mapBaseY, radius * (tick / radialSpanPc), Math.PI, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.arc(mapCenterX, mapBaseY, radius, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mapCenterX - radius, mapBaseY);
  ctx.lineTo(mapCenterX + radius, mapBaseY);
  ctx.moveTo(mapCenterX, mapBaseY);
  ctx.lineTo(mapCenterX, mapBaseY - radius);
  ctx.stroke();

  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(mapCenterX, mapBaseY, 2.5, 0, Math.PI * 2);
  ctx.fill();

  function drawPlanMarker(point, color, fill = true) {
    if (!point) {
      return;
    }
    const nearSide = -point.x;
    const tangential = point.y;
    const radial = Math.hypot(nearSide, tangential);
    const angle = clamp(Math.atan2(tangential, nearSide), -Math.PI * 0.5, Math.PI * 0.5);
    const r = radius * clamp01(radial / radialSpanPc);
    const px = mapCenterX + Math.sin(angle) * r;
    const py = mapBaseY - Math.cos(angle) * r;
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  ctx.strokeStyle = theme.border;
  ctx.strokeRect(barX, barY, barW, barH);
  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.moveTo(barX, barY + barH * 0.5);
  ctx.lineTo(barX + barW, barY + barH * 0.5);
  ctx.stroke();

  function drawHeightMarker(point, color, fill = true) {
    if (!point) {
      return;
    }
    const t = clamp01((point.z + verticalHalfSpanPc) / (verticalHalfSpanPc * 2));
    const px = barX + barW * 0.5;
    const py = barY + (1 - t) * barH;
    ctx.beginPath();
    ctx.arc(px, py, 4.5, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawPlanMarker(observer, '#44ff66');
  drawPlanMarker(selected, '#ffcc66', false);
  drawHeightMarker(observer, '#44ff66');
  drawHeightMarker(selected, '#ffcc66', false);

  ctx.fillStyle = theme.text;
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('GC', mapCenterX + 7, mapBaseY - 6);
  ctx.fillText(`Near-side plane 0..${Math.round(radialSpanPc).toLocaleString()} pc`, mapX, y + height - 8);
  ctx.fillText(`Z ±${Math.round(verticalHalfSpanPc).toLocaleString()} pc`, barX - 6, y + height - 8);
}

const GalaxyMapComponent = {
  kind: 'skykit-galaxy-map',

  mount() {
    return {
      bitmapSignature: null,
    };
  },

  measure(ctx) {
    return {
      width: ctx.constraints.maxWidth,
      height: ctx.props.height ?? 190,
    };
  },

  layout(ctx) {
    ctx.setContentBounds(ctx.bounds);

    const width = Math.max(1, Math.round(ctx.bounds.width));
    const height = Math.max(1, Math.round(ctx.bounds.height));
    const theme = ctx.services.theme.getTokens();
    const signature = {
      width,
      height,
      value: ctx.props.value ?? null,
      title: ctx.props.title ?? 'GALACTIC MAP (XY + Z)',
      backgroundColor: theme.backgroundColor,
      borderColor: theme.borderColor,
      mutedTextColor: theme.mutedTextColor,
      accentColor: theme.accentColor,
    };
    const previous = ctx.state.bitmapSignature;
    if (
      previous &&
      previous.width === signature.width &&
      previous.height === signature.height &&
      previous.value === signature.value &&
      previous.title === signature.title &&
      previous.backgroundColor === signature.backgroundColor &&
      previous.borderColor === signature.borderColor &&
      previous.mutedTextColor === signature.mutedTextColor &&
      previous.accentColor === signature.accentColor
    ) {
      return;
    }

    const canvas = createRasterCanvas(width, height);
    const context2d = canvas?.getContext?.('2d');
    if (!context2d) {
      return;
    }

    drawGalaxyMapGraphic(context2d, { x: 0, y: 0, w: width, h: height }, signature.value ?? {}, {
      bg: signature.backgroundColor,
      border: signature.borderColor,
      axis: signature.mutedTextColor,
      text: signature.mutedTextColor,
      accent: signature.accentColor,
      title: signature.title,
    });

    const bitmapId = getBitmapId(ctx.id);
    const existing = ctx.services.bitmaps.getHandle(bitmapId);
    if (existing) {
      ctx.services.bitmaps.update(bitmapId, {
        image: canvas,
        width,
        height,
      });
    } else {
      ctx.services.bitmaps.allocate(bitmapId, {
        image: canvas,
        width,
        height,
      });
    }

    ctx.state.bitmapSignature = signature;
  },

  render(ctx) {
    const handle = ctx.services.bitmaps.getHandle(getBitmapId(ctx.id));
    if (!handle) {
      return [];
    }

    return [
      {
        type: 'bitmap',
        componentId: ctx.id,
        role: 'galaxy-map',
        rect: ctx.bounds,
        handle,
        fit: 'stretch',
        sampling: 'nearest',
      },
    ];
  },

  dispose(ctx) {
    ctx.services.bitmaps.release(getBitmapId(ctx.id));
  },
};

export function createGalaxyMapControl(idOrOptions, props = {}) {
  if (typeof idOrOptions !== 'string') {
    return createLegacyGalaxyMapControl(idOrOptions ?? {});
  }

  return createNode(idOrOptions, GalaxyMapComponent, props);
}

function getBitmapId(componentId) {
  return `${componentId}:bitmap`;
}

function createRasterCanvas(width, height) {
  const scope = globalThis;
  if (typeof scope.OffscreenCanvas === 'function') {
    return new scope.OffscreenCanvas(width, height);
  }
  if (scope.document?.createElement) {
    const canvas = scope.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

function createLegacyGalaxyMapControl(options = {}) {
  return {
    getHeight() {
      return options.height ?? 190;
    },

    render(ctx, rect, item, _state, env) {
      drawGalaxyMapGraphic(ctx, rect, item.value ?? {}, {
        bg: env.theme.itemBg,
        border: env.theme.border,
        axis: env.theme.textDim,
        text: env.theme.textDim,
        accent: env.theme.accent,
        title: options.title ?? 'GALACTIC MAP (XY + Z)',
      });
    },
  };
}
