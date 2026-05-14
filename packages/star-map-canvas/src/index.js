import {
  apparentMagnitude,
  icrsToRaDec,
  projectEquirectangular,
  temperatureToRgb,
} from '@found-in-space/star-products';

export const DEFAULT_LIMITING_MAGNITUDE = 6.5;

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_STYLE = Object.freeze({
  background: '#020712',
  magFadeRange: 1.5,
  minRadiusPx: 0.75,
  maxRadiusPx: 5.5,
  radiusScale: 1.6,
  radiusPower: 0.48,
  haloScale: 2.6,
  haloAlpha: 0.18,
  alpha: 0.9,
  fallbackColor: '#dce8ff',
});

/**
 * @typedef {import('./index.d.ts').CanvasStarMap} CanvasStarMap
 * @typedef {import('./index.d.ts').CanvasStarMapOptions} CanvasStarMapOptions
 * @typedef {import('./index.d.ts').CanvasStarMapPickOptions} CanvasStarMapPickOptions
 * @typedef {import('./index.d.ts').CanvasStarMapPickResult} CanvasStarMapPickResult
 * @typedef {import('./index.d.ts').CanvasStarMapRenderOptions} CanvasStarMapRenderOptions
 * @typedef {import('./index.d.ts').CanvasStarMapRenderResult} CanvasStarMapRenderResult
 * @typedef {import('./index.d.ts').DrawStarMapOptions} DrawStarMapOptions
 * @typedef {import('./index.d.ts').StarMapPoint} StarMapPoint
 * @typedef {import('./index.d.ts').StarMapProjection} StarMapProjection
 * @typedef {import('./index.d.ts').StarMapProjectionContext} StarMapProjectionContext
 * @typedef {import('./index.d.ts').StarMapStyle} StarMapStyle
 * @typedef {import('@found-in-space/star-products').StarRepresentationStore} StarRepresentationStore
 * @typedef {import('@found-in-space/star-products').StarRow} StarRow
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasStarMapOptions} [options]
 * @returns {CanvasStarMap}
 */
export function createCanvasStarMap(canvas, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('createCanvasStarMap() requires an HTMLCanvasElement.');
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('createCanvasStarMap() could not create a 2D canvas context.');
  }

  const baseOptions = {
    store: options.store,
    projection: options.projection ?? createRaDecEquirectangularProjection(),
    style: normalizeStyle(options.style),
    autoResize: options.autoResize !== false,
  };
  let size = resolveCanvasSize(canvas);
  /** @type {CanvasStarMapRenderResult | null} */
  let lastRender = null;
  let disposed = false;

  resize();

  return {
    render(renderOptions = {}) {
      assertActive();
      if (baseOptions.autoResize) {
        resize();
      }

      const projection = renderOptions.projection ?? baseOptions.projection;
      const style = normalizeStyle({
        ...baseOptions.style,
        ...(renderOptions.style ?? {}),
      });

      ctx.save?.();
      applyDprTransform(ctx, size.dpr);
      try {
        const renderResult = drawStarMap(ctx, {
          x: 0,
          y: 0,
          w: size.width,
          h: size.height,
        }, {
          ...renderOptions,
          store: renderOptions.store ?? baseOptions.store,
          projection,
          style,
        });
        lastRender = {
          ...renderResult,
          dpr: size.dpr,
        };
      } finally {
        ctx.restore?.();
      }

      return lastRender;
    },

    resize(resizeOptions = {}) {
      assertActive();
      resize(resizeOptions);
    },

    getLastRender() {
      return lastRender;
    },

    pick(point, pickOptions = {}) {
      assertActive();
      return pickFromLastRender(lastRender, point, pickOptions);
    },

    dispose() {
      disposed = true;
      lastRender = null;
    },
  };

  /**
   * @param {{ width?: number; height?: number; dpr?: number }} [resizeOptions]
   */
  function resize(resizeOptions = {}) {
    size = resolveCanvasSize(canvas, resizeOptions);
    const pixelWidth = Math.max(1, Math.round(size.width * size.dpr));
    const pixelHeight = Math.max(1, Math.round(size.height * size.dpr));

    if (canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
    }
    if (canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
    }

    if (resizeOptions.width !== undefined && canvas.style) {
      canvas.style.width = `${size.width}px`;
    }
    if (resizeOptions.height !== undefined && canvas.style) {
      canvas.style.height = `${size.height}px`;
    }
  }

  function assertActive() {
    if (disposed) {
      throw new Error('Canvas star map is disposed.');
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number; y: number; w: number; h: number }} rect
 * @param {DrawStarMapOptions} [options]
 * @returns {CanvasStarMapRenderResult}
 */
export function drawStarMap(ctx, rect, options = {}) {
  if (!ctx) {
    throw new TypeError('drawStarMap() requires a CanvasRenderingContext2D.');
  }

  const width = normalizePositiveNumber(rect.w, 0);
  const height = normalizePositiveNumber(rect.h, 0);
  const x = normalizeFiniteNumber(rect.x, 0);
  const y = normalizeFiniteNumber(rect.y, 0);
  const dpr = 1;
  const style = normalizeStyle(options.style);
  const observerPc = normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC);
  const limitingMagnitude = normalizeFiniteNumber(
    options.limitingMagnitude,
    DEFAULT_LIMITING_MAGNITUDE,
  );
  const projection = options.projection ?? createRaDecEquirectangularProjection();
  const stars = resolveStars(options);

  if (options.clear !== false) {
    ctx.clearRect?.(x, y, width, height);
  }
  if (style.background !== null) {
    ctx.fillStyle = style.background;
    ctx.fillRect(x, y, width, height);
  }

  /** @type {StarMapPoint[]} */
  const points = [];
  let starCount = 0;
  let filteredCount = 0;

  const context = {
    observerPc,
    limitingMagnitude,
    width,
    height,
    rect: { x, y, w: width, h: height },
  };

  for (const star of stars) {
    starCount += 1;
    const magAbs = Number(star.magAbs);
    if (!Number.isFinite(magAbs)) {
      filteredCount += 1;
      continue;
    }

    const distancePc = distanceBetween(star.position, observerPc);
    const mApp = apparentMagnitude({ magAbs, distancePc });
    if (mApp > limitingMagnitude) {
      filteredCount += 1;
      continue;
    }

    const projected = projection.project(star, context);
    if (!projected || projected.visible === false) {
      filteredCount += 1;
      continue;
    }

    const px = x + projected.x;
    const py = y + projected.y;
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      filteredCount += 1;
      continue;
    }

    const radius = computeVisualRadiusPx(mApp, style);
    const alpha = computeVisualAlpha(mApp, limitingMagnitude, style);
    if (!(radius > 0) || !(alpha > 0)) {
      filteredCount += 1;
      continue;
    }

    const point = {
      x: px,
      y: py,
      radius,
      alpha,
      color: colorForStar(star, style),
      distancePc,
      apparentMagnitude: mApp,
      productId: star.productId,
      objectIndex: star.objectIndex,
      objectRef: star.objectRef ?? null,
      pickMeta: star.pickMeta ?? null,
      star,
      ...(projected.depth !== undefined ? { depth: projected.depth } : {}),
      ...(projected.wrapKey !== undefined ? { wrapKey: projected.wrapKey } : {}),
    };
    points.push(point);
    drawStarPoint(ctx, point, style);
  }

  return {
    width,
    height,
    dpr,
    starCount,
    visibleCount: points.length,
    drawnCount: points.length,
    filteredCount,
    points,
  };
}

/**
 * @param {{ id?: string }} [options]
 * @returns {StarMapProjection}
 */
export function createRaDecEquirectangularProjection(options = {}) {
  return createStarMapProjection((star, context) => {
    const sky = icrsToRaDec(star.position, context.observerPc);
    if (!sky) {
      return null;
    }
    return projectEquirectangular({
      raDeg: sky.raDeg,
      decDeg: sky.decDeg,
      width: context.width,
      height: context.height,
    });
  }, {
    id: options.id ?? 'ra-dec-equirectangular',
  });
}

/**
 * @param {StarMapProjection['project']} project
 * @param {{ id?: string }} [options]
 * @returns {StarMapProjection}
 */
export function createStarMapProjection(project, options = {}) {
  if (typeof project !== 'function') {
    throw new TypeError('createStarMapProjection() requires a project function.');
  }
  return {
    id: options.id ?? 'custom',
    project,
  };
}

/**
 * @param {CanvasStarMapRenderResult | null} lastRender
 * @param {{ x: number; y: number }} point
 * @param {CanvasStarMapPickOptions} options
 * @returns {CanvasStarMapPickResult | null}
 */
function pickFromLastRender(lastRender, point, options) {
  if (!lastRender || !point) {
    return null;
  }

  const px = Number(point.x);
  const py = Number(point.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return null;
  }

  const tolerancePx = normalizePositiveNumber(options.tolerancePx, 4);
  /** @type {CanvasStarMapPickResult | null} */
  let best = null;

  for (const candidate of lastRender.points) {
    const distancePx = Math.hypot(candidate.x - px, candidate.y - py);
    const hitRadius = Math.max(candidate.radius, tolerancePx);
    if (distancePx > hitRadius) {
      continue;
    }
    const score = distancePx / hitRadius;
    if (
      !best ||
      score < best.score ||
      (score === best.score &&
        candidate.apparentMagnitude < best.apparentMagnitude)
    ) {
      best = {
        ...candidate,
        distancePx,
        score,
      };
    }
  }

  return best;
}

/**
 * @param {DrawStarMapOptions} options
 * @returns {Iterable<StarRow>}
 */
function resolveStars(options) {
  if (options.stars) {
    return options.stars;
  }
  if (options.store) {
    return options.store.stars();
  }
  return [];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {StarMapPoint} point
 * @param {Required<StarMapStyle>} style
 */
function drawStarPoint(ctx, point, style) {
  const previousAlpha = typeof ctx.globalAlpha === 'number'
    ? ctx.globalAlpha
    : 1;
  const haloRadius = point.radius * style.haloScale;

  if (haloRadius > point.radius && style.haloAlpha > 0) {
    ctx.globalAlpha = point.alpha * style.haloAlpha;
    ctx.fillStyle = point.color;
    ctx.beginPath?.();
    ctx.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
    ctx.fill?.();
  }

  ctx.globalAlpha = point.alpha;
  ctx.fillStyle = point.color;
  ctx.beginPath?.();
  ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
  ctx.fill?.();

  ctx.globalAlpha = previousAlpha;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ width?: number; height?: number; dpr?: number }} [options]
 */
function resolveCanvasSize(canvas, options = {}) {
  const dpr = normalizePositiveNumber(
    options.dpr,
    readDevicePixelRatio(canvas),
  );
  const width = normalizePositiveNumber(
    options.width,
    normalizePositiveNumber(
      canvas.clientWidth,
      normalizePositiveNumber(canvas.width / dpr, 300),
    ),
  );
  const height = normalizePositiveNumber(
    options.height,
    normalizePositiveNumber(
      canvas.clientHeight,
      normalizePositiveNumber(canvas.height / dpr, 150),
    ),
  );

  return { width, height, dpr };
}

/**
 * @param {HTMLCanvasElement} canvas
 */
function readDevicePixelRatio(canvas) {
  if (typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)) {
    return window.devicePixelRatio;
  }
  const view = canvas.ownerDocument?.defaultView;
  return Number.isFinite(view?.devicePixelRatio) ? view.devicePixelRatio : 1;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} dpr
 */
function applyDprTransform(ctx, dpr) {
  if (typeof ctx.setTransform === 'function') {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return;
  }
  if (typeof ctx.scale === 'function') {
    ctx.scale(dpr, dpr);
  }
}

/**
 * @param {number} mApp
 * @param {Required<StarMapStyle>} style
 */
function computeVisualRadiusPx(mApp, style) {
  const flux = Math.pow(10, -0.4 * mApp);
  const scaledFlux = Math.max(flux * 100, 0);
  const signal = Math.max(Math.pow(1 + scaledFlux, style.radiusPower) - 1, 0);
  return clamp(
    style.minRadiusPx + style.radiusScale * signal,
    style.minRadiusPx,
    style.maxRadiusPx,
  );
}

/**
 * @param {number} mApp
 * @param {number} limitingMagnitude
 * @param {Required<StarMapStyle>} style
 */
function computeVisualAlpha(mApp, limitingMagnitude, style) {
  const fade = computeMagnitudeFade(
    mApp,
    limitingMagnitude,
    style.magFadeRange,
  );
  const flux = Math.pow(10, -0.4 * mApp);
  const brightness = clamp(Math.log1p(flux * 2500) / Math.log(2), 0, 8);
  return clamp(style.alpha * fade * (0.2 + brightness * 0.1), 0, 1);
}

/**
 * @param {number} mApp
 * @param {number} limitingMagnitude
 * @param {number} fadeRange
 */
function computeMagnitudeFade(mApp, limitingMagnitude, fadeRange) {
  if (!(fadeRange > 0)) {
    return mApp <= limitingMagnitude ? 1 : 0;
  }
  return 1 - smoothstep(
    limitingMagnitude - fadeRange,
    limitingMagnitude,
    mApp,
  );
}

/**
 * @param {StarRow} star
 * @param {Required<StarMapStyle>} style
 */
function colorForStar(star, style) {
  if (Number.isFinite(star.teffLog8)) {
    const [r, g, b] = temperatureToRgb(Number(star.teffLog8));
    return `rgb(${r}, ${g}, ${b})`;
  }
  return style.fallbackColor;
}

/**
 * @param {StarMapStyle | undefined} style
 * @returns {Required<StarMapStyle>}
 */
function normalizeStyle(style = {}) {
  return {
    background: style.background === undefined
      ? DEFAULT_STYLE.background
      : style.background,
    magFadeRange: normalizeFiniteNumber(
      style.magFadeRange,
      DEFAULT_STYLE.magFadeRange,
    ),
    minRadiusPx: normalizePositiveNumber(
      style.minRadiusPx,
      DEFAULT_STYLE.minRadiusPx,
    ),
    maxRadiusPx: normalizePositiveNumber(
      style.maxRadiusPx,
      DEFAULT_STYLE.maxRadiusPx,
    ),
    radiusScale: normalizePositiveNumber(
      style.radiusScale,
      DEFAULT_STYLE.radiusScale,
    ),
    radiusPower: normalizePositiveNumber(
      style.radiusPower,
      DEFAULT_STYLE.radiusPower,
    ),
    haloScale: normalizePositiveNumber(
      style.haloScale,
      DEFAULT_STYLE.haloScale,
    ),
    haloAlpha: clamp(
      normalizeFiniteNumber(style.haloAlpha, DEFAULT_STYLE.haloAlpha),
      0,
      1,
    ),
    alpha: clamp(
      normalizeFiniteNumber(style.alpha, DEFAULT_STYLE.alpha),
      0,
      1,
    ),
    fallbackColor: style.fallbackColor ?? DEFAULT_STYLE.fallbackColor,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function distanceBetween(left, right) {
  return Math.hypot(
    Number(left.x) - Number(right.x),
    Number(left.y) - Number(right.y),
    Number(left.z) - Number(right.z),
  );
}

/**
 * @param {unknown} value
 * @param {{ x: number; y: number; z: number }} fallback
 */
function normalizePoint(value, fallback) {
  if (!value || typeof value !== 'object') {
    return { ...fallback };
  }
  const point = /** @type {Partial<typeof fallback>} */ (value);
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? { x, y, z }
    : { ...fallback };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} value
 */
function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
