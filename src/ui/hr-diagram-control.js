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
  const log8 = (Number(log8Byte) || 0) / 255;
  if (log8 >= 0.996) {
    return 5800;
  }
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
  let visibleCount = 0;

  for (let i = 0; i < value.starCount; i += 1) {
    const wx = value.positions[i * 3];
    const wy = value.positions[i * 3 + 1];
    const wz = value.positions[i * 3 + 2];

    if (!passesVisibilityFilter(value, i, wx, wy, wz)) {
      continue;
    }

    const teff = decodeTeff(value.teffLog8[i]);
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

export function createHRDiagramControl(options = {}) {
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
