import { createNode } from '@found-in-space/touch-os';
import { SCALE as SCENE_SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_COOL_K = 2500;
const DEFAULT_HOT_K = 40000;
const DEFAULT_MIN_MAG = -6;
const DEFAULT_MAX_MAG = 17;
const DEFAULT_MARGIN_PX = 28;
const DEFAULT_HEIGHT = 220;
const TEMP_TICKS = [3000, 5000, 8000, 15000, 30000];
const MAG_TICK_STEP = 4;
const DIRECT_DRAW_THRESHOLD = 2000;
const INVALID_TEFF_LOG8 = 255;
const PLOT_BG_RGBA = [1, 6, 16, 255];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeViewProjection(viewProjection) {
  if (!viewProjection) {
    return undefined;
  }
  if (Array.isArray(viewProjection) || ArrayBuffer.isView(viewProjection)) {
    return viewProjection;
  }
  if (Array.isArray(viewProjection.elements) || ArrayBuffer.isView(viewProjection.elements)) {
    return viewProjection.elements;
  }
  return undefined;
}

function resolveStarCount(starCount, positions, teffLog8, magAbs) {
  const maxCount = Math.min(
    Math.floor((positions?.length ?? 0) / 3),
    teffLog8?.length ?? 0,
    magAbs?.length ?? 0,
  );
  const requested = Number.isFinite(starCount) ? Math.floor(starCount) : maxCount;
  return clamp(requested, 0, maxCount);
}

function createImageDataBuffer(ctx, width, height) {
  if (typeof ctx?.createImageData === 'function') {
    return ctx.createImageData(width, height);
  }
  if (typeof ImageData === 'function') {
    return new ImageData(width, height);
  }
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  };
}

export function decodeTeff(log8Byte) {
  const encoded = Number(log8Byte);
  if (!Number.isFinite(encoded) || encoded >= INVALID_TEFF_LOG8) {
    return null;
  }
  const log8 = encoded / 255;
  return 2000 * Math.pow(25, log8);
}

function teffToRgbComponents(tempK) {
  const t = clamp(tempK, 1000, 40000) / 100;

  let r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  let g;
  if (t <= 66) {
    g = 99.4708025861 * Math.log(t) - 161.119568166;
  } else {
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  let b;
  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }

  return [
    clamp(Math.round(r), 0, 255),
    clamp(Math.round(g), 0, 255),
    clamp(Math.round(b), 0, 255),
  ];
}

export function tempToX(tempK, width, margin, coolK, hotK) {
  const minLogT = Math.log10(coolK);
  const maxLogT = Math.log10(hotK);
  const logT = Math.log10(clamp(tempK, coolK, hotK));
  const tNorm = (logT - minLogT) / (maxLogT - minLogT);
  return width - margin - tNorm * (width - 2 * margin);
}

export function magToY(mag, height, margin, minMag, maxMag) {
  const mNorm = clamp((mag - minMag) / (maxMag - minMag), 0, 1);
  return margin + mNorm * (height - 2 * margin);
}

function passesVisibilityFilter(value, index, wx, wy, wz) {
  if (value.mode !== 0 && value.mode !== 2) {
    return true;
  }

  const dx = wx - value.observerX;
  const dy = wy - value.observerY;
  const dz = wz - value.observerZ;
  const distancePc = Math.sqrt(dx * dx + dy * dy + dz * dz) / SCENE_SCALE;
  const mApp = value.magAbs[index] + 5 * Math.log10(Math.max(distancePc, 0.001)) - 5;
  if (mApp > value.appMagLimit) {
    return false;
  }

  if (value.mode !== 2 || !value.viewProjection) {
    return true;
  }

  const vp = value.viewProjection;
  const cx = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12];
  const cy = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13];
  const cz = vp[2] * wx + vp[6] * wy + vp[10] * wz + vp[14];
  const cw = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15];
  if (!(cw > 0)) {
    return false;
  }

  return !(cz < 0 || Math.abs(cx) > cw * 1.05 || Math.abs(cy) > cw * 1.05);
}

function drawStarsDirect(ctx, x, y, plotW, plotH, value, options) {
  let visibleCount = 0;
  for (let i = 0; i < value.starCount; i += 1) {
    const wx = value.positions[i * 3];
    const wy = value.positions[i * 3 + 1];
    const wz = value.positions[i * 3 + 2];

    if (!passesVisibilityFilter(value, i, wx, wy, wz)) {
      continue;
    }

    const teff = decodeTeff(value.teffLog8[i]);
    if (!Number.isFinite(teff)) {
      continue;
    }
    const px = Math.floor(tempToX(teff, plotW, 0, options.coolK, options.hotK));
    const py = Math.floor(magToY(value.magAbs[i], plotH, 0, options.minMag, options.maxMag));

    if (px < 0 || px >= plotW || py < 0 || py >= plotH) {
      continue;
    }

    const [r, g, b] = teffToRgbComponents(teff);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`;
    ctx.fillRect(x + px, y + py, 1, 1);
    visibleCount += 1;
  }

  return visibleCount;
}

function buildStarImageData(ctx, plotW, plotH, value, options) {
  const imageData = createImageDataBuffer(ctx, plotW, plotH);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = PLOT_BG_RGBA[0];
    data[i + 1] = PLOT_BG_RGBA[1];
    data[i + 2] = PLOT_BG_RGBA[2];
    data[i + 3] = PLOT_BG_RGBA[3];
  }
  let visibleCount = 0;

  for (let i = 0; i < value.starCount; i += 1) {
    const wx = value.positions[i * 3];
    const wy = value.positions[i * 3 + 1];
    const wz = value.positions[i * 3 + 2];

    if (!passesVisibilityFilter(value, i, wx, wy, wz)) {
      continue;
    }

    const teff = decodeTeff(value.teffLog8[i]);
    if (!Number.isFinite(teff)) {
      continue;
    }
    const px = Math.floor(tempToX(teff, plotW, 0, options.coolK, options.hotK));
    const py = Math.floor(magToY(value.magAbs[i], plotH, 0, options.minMag, options.maxMag));

    if (px < 0 || px >= plotW || py < 0 || py >= plotH) {
      continue;
    }

    const idx = (py * plotW + px) * 4;
    const [r, g, b] = teffToRgbComponents(teff);

    data[idx] = Math.min(255, data[idx] + r * 0.55);
    data[idx + 1] = Math.min(255, data[idx + 1] + g * 0.55);
    data[idx + 2] = Math.min(255, data[idx + 2] + b * 0.55);
    data[idx + 3] = Math.min(255, data[idx + 3] + 180);
    visibleCount += 1;
  }

  return { imageData, visibleCount };
}

function drawSelectedStars(ctx, x, y, plotW, plotH, value, options) {
  const selectedStars = Array.isArray(value?.selectedStars) ? value.selectedStars : null;
  if (!selectedStars?.length) {
    return;
  }

  ctx.save();
  for (const star of selectedStars) {
    const teff = Number(star?.teffK);
    const magAbs = Number(star?.magAbs);
    if (!Number.isFinite(teff) || !Number.isFinite(magAbs)) {
      continue;
    }
    const px = tempToX(teff, plotW, 0, options.coolK, options.hotK);
    const py = magToY(magAbs, plotH, 0, options.minMag, options.maxMag);
    const sx = x + px;
    const sy = y + py;
    ctx.strokeStyle = 'rgba(255, 236, 138, 0.96)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(21, 30, 51, 0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - 6, sy);
    ctx.lineTo(sx + 6, sy);
    ctx.moveTo(sx, sy - 6);
    ctx.lineTo(sx, sy + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAxes(ctx, rect, options) {
  const {
    x,
    y,
    w,
    h,
    margin,
    coolK,
    hotK,
    minMag,
    maxMag,
    starCount,
    theme,
  } = options;

  const border = theme?.border ?? 'rgba(242, 200, 121, 0.3)';
  const text = theme?.textDim ?? 'rgba(236, 238, 246, 0.45)';
  const label = theme?.text ?? 'rgba(236, 238, 246, 0.7)';
  const accent = theme?.accent ?? 'rgba(159, 233, 255, 0.75)';

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + margin, y + margin, w - margin * 2, h - margin * 2);

  ctx.fillStyle = text;
  ctx.strokeStyle = text;
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';

  for (const temp of TEMP_TICKS) {
    if (temp < coolK || temp > hotK) {
      continue;
    }
    const tx = x + tempToX(temp, w, margin, coolK, hotK);
    ctx.beginPath();
    ctx.moveTo(tx, y + h - margin);
    ctx.lineTo(tx, y + h - margin + 3);
    ctx.stroke();
    ctx.fillText(temp >= 1000 ? `${Math.floor(temp / 1000)}k` : String(temp), tx, y + h - margin + 12);
  }

  ctx.textAlign = 'right';
  const magStart = Math.ceil(minMag / MAG_TICK_STEP) * MAG_TICK_STEP;
  for (let mag = magStart; mag <= maxMag; mag += MAG_TICK_STEP) {
    const ty = y + magToY(mag, h, margin, minMag, maxMag);
    ctx.beginPath();
    ctx.moveTo(x + margin - 3, ty);
    ctx.lineTo(x + margin, ty);
    ctx.stroke();
    ctx.fillText(String(mag), x + margin - 4, ty + 3);
  }

  ctx.textAlign = 'start';
  ctx.fillStyle = label;
  ctx.fillText('Hot', x + margin + 2, y + h - margin + 12);
  ctx.fillText('Cool', x + w - margin - 22, y + h - margin + 12);

  ctx.save();
  ctx.translate(x + 8, y + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Abs. mag', 0, 0);
  ctx.restore();

  if (starCount > 0) {
    ctx.fillStyle = accent;
    ctx.textAlign = 'right';
    ctx.fillText(`${starCount.toLocaleString()} stars`, x + w - margin, y + margin - 4);
    ctx.textAlign = 'start';
  }
}

export function buildHRDiagramValue(geometry, options = {}) {
  const positions = geometry?.attributes?.position?.array;
  const teffLog8 = geometry?.attributes?.teff_log8?.array;
  const magAbs = geometry?.attributes?.magAbs?.array;
  if (!positions || !teffLog8 || !magAbs) {
    return null;
  }

  const observerPc = options.observerPc ?? { x: 0, y: 0, z: 0 };
  const viewProjection = normalizeViewProjection(options.viewProjection);
  const starCount = resolveStarCount(
    options.starCount,
    positions,
    teffLog8,
    magAbs,
  );

  return {
    positions,
    teffLog8,
    magAbs,
    starCount,
    observerX: (observerPc.x ?? 0) * SCENE_SCALE,
    observerY: (observerPc.y ?? 0) * SCENE_SCALE,
    observerZ: (observerPc.z ?? 0) * SCENE_SCALE,
    mode: Number.isFinite(options.mode) ? Number(options.mode) : 1,
    appMagLimit: Number.isFinite(options.appMagLimit) ? Number(options.appMagLimit) : 6.5,
    viewProjection,
    selectedStars: Array.isArray(options.selectedStars)
      ? options.selectedStars.map((star) => ({
        teffK: Number(star?.teffK),
        magAbs: Number(star?.magAbs),
      }))
      : null,
  };
}

export function drawHRDiagramGraphic(ctx, rect, value, options = {}) {
  if (!ctx || !rect) {
    return 0;
  }

  const x = rect.x ?? 0;
  const y = rect.y ?? 0;
  const w = rect.w ?? 0;
  const h = rect.h ?? 0;

  const coolK = options.coolK ?? DEFAULT_COOL_K;
  const hotK = options.hotK ?? DEFAULT_HOT_K;
  const minMag = options.minMag ?? DEFAULT_MIN_MAG;
  const maxMag = options.maxMag ?? DEFAULT_MAX_MAG;
  const margin = options.margin ?? DEFAULT_MARGIN_PX;
  const background = options.theme?.itemBg ?? 'rgba(1, 6, 16, 0.88)';

  ctx.fillStyle = background;
  ctx.fillRect(x, y, w, h);

  if (!value) {
    return 0;
  }

  const plotW = Math.floor(w - margin * 2);
  const plotH = Math.floor(h - margin * 2);
  if (!(plotW > 0 && plotH > 0)) {
    return 0;
  }

  const drawOptions = { coolK, hotK, minMag, maxMag };

  const visibleCount = value.starCount < DIRECT_DRAW_THRESHOLD
    ? drawStarsDirect(ctx, x + margin, y + margin, plotW, plotH, value, drawOptions)
    : (() => {
      const { imageData, visibleCount: count } = buildStarImageData(
        ctx,
        plotW,
        plotH,
        value,
        drawOptions,
      );
      ctx.putImageData(imageData, x + margin, y + margin);
      return count;
    })();

  drawSelectedStars(
    ctx,
    x + margin,
    y + margin,
    plotW,
    plotH,
    value,
    drawOptions,
  );

  drawAxes(ctx, { x, y, w, h }, {
    x,
    y,
    w,
    h,
    margin,
    coolK,
    hotK,
    minMag,
    maxMag,
    starCount: visibleCount,
    theme: options.theme,
  });

  return visibleCount;
}

const HRDiagramComponent = {
  kind: 'skykit-hr-diagram',

  mount() {
    return {
      bitmapSignature: null,
    };
  },

  measure(ctx) {
    return {
      width: ctx.constraints.maxWidth,
      height: ctx.props.height ?? DEFAULT_HEIGHT,
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
      coolK: ctx.props.coolK ?? DEFAULT_COOL_K,
      hotK: ctx.props.hotK ?? DEFAULT_HOT_K,
      minMag: ctx.props.minMag ?? DEFAULT_MIN_MAG,
      maxMag: ctx.props.maxMag ?? DEFAULT_MAX_MAG,
      margin: ctx.props.margin ?? DEFAULT_MARGIN_PX,
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
      previous.coolK === signature.coolK &&
      previous.hotK === signature.hotK &&
      previous.minMag === signature.minMag &&
      previous.maxMag === signature.maxMag &&
      previous.margin === signature.margin &&
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

    drawHRDiagramGraphic(
      context2d,
      { x: 0, y: 0, w: width, h: height },
      signature.value,
      {
        coolK: signature.coolK,
        hotK: signature.hotK,
        minMag: signature.minMag,
        maxMag: signature.maxMag,
        margin: signature.margin,
        theme: {
          itemBg: signature.backgroundColor,
          border: signature.borderColor,
          textDim: signature.mutedTextColor,
          accent: signature.accentColor,
        },
      },
    );

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
        role: 'hr-diagram',
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

export function createHRDiagramControl(idOrOptions, props = {}) {
  if (typeof idOrOptions !== 'string') {
    return createLegacyHRDiagramControl(idOrOptions ?? {});
  }

  return createNode(idOrOptions, HRDiagramComponent, props);
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

function createLegacyHRDiagramControl(options = {}) {
  const config = {
    height: options.height ?? DEFAULT_HEIGHT,
    coolK: options.coolK ?? DEFAULT_COOL_K,
    hotK: options.hotK ?? DEFAULT_HOT_K,
    minMag: options.minMag ?? DEFAULT_MIN_MAG,
    maxMag: options.maxMag ?? DEFAULT_MAX_MAG,
    margin: options.margin ?? DEFAULT_MARGIN_PX,
  };

  let cachedImageData = null;
  let cacheMeta = null;

  function canUseCache(value, plotW, plotH) {
    if (!cacheMeta || !value || value.starCount < DIRECT_DRAW_THRESHOLD) {
      return false;
    }
    return cacheMeta.plotW === plotW
      && cacheMeta.plotH === plotH
      && cacheMeta.value === value;
  }

  return {
    getHeight() {
      return config.height;
    },

    render(ctx, rect, item, _state, env) {
      const value = item.value ?? null;
      const x = rect.x ?? 0;
      const y = rect.y ?? 0;
      const w = rect.w ?? 0;
      const h = rect.h ?? 0;
      const plotW = Math.floor(w - config.margin * 2);
      const plotH = Math.floor(h - config.margin * 2);
      ctx.fillStyle = env.theme?.itemBg ?? 'rgba(1, 6, 16, 0.88)';
      ctx.fillRect(x, y, w, h);

      drawAxes(ctx, { x, y, w, h }, {
        x,
        y,
        w,
        h,
        margin: config.margin,
        coolK: config.coolK,
        hotK: config.hotK,
        minMag: config.minMag,
        maxMag: config.maxMag,
        starCount: 0,
        theme: env.theme,
      });

      if (!value || !(plotW > 0 && plotH > 0)) {
        cachedImageData = null;
        cacheMeta = null;
        return;
      }

      let visibleCount = 0;
      if (value.starCount < DIRECT_DRAW_THRESHOLD) {
        cachedImageData = null;
        cacheMeta = null;
        visibleCount = drawStarsDirect(ctx, x + config.margin, y + config.margin, plotW, plotH, value, config);
      } else if (canUseCache(value, plotW, plotH) && cachedImageData) {
        ctx.putImageData(cachedImageData, x + config.margin, y + config.margin);
        visibleCount = cacheMeta.visibleCount;
      } else {
        const rendered = buildStarImageData(ctx, plotW, plotH, value, config);
        cachedImageData = rendered.imageData;
        cacheMeta = { value, plotW, plotH, visibleCount: rendered.visibleCount };
        ctx.putImageData(cachedImageData, x + config.margin, y + config.margin);
        visibleCount = rendered.visibleCount;
      }

      drawSelectedStars(
        ctx,
        x + config.margin,
        y + config.margin,
        plotW,
        plotH,
        value,
        config,
      );

      drawAxes(ctx, { x, y, w, h }, {
        x,
        y,
        w,
        h,
        margin: config.margin,
        coolK: config.coolK,
        hotK: config.hotK,
        minMag: config.minMag,
        maxMag: config.maxMag,
        starCount: visibleCount,
        theme: env.theme,
      });
    },
  };
}
