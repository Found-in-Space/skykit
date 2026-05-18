import * as THREE from 'three';
import {
  apparentMagnitude,
  decodeTemperatureK,
  temperatureToRgb,
} from '@found-in-space/star-products';

export const HR_DIAGRAM_MODE_MAGNITUDE = 'magnitude-limited';
export const HR_DIAGRAM_MODE_VOLUME = 'volume-complete';
export const HR_DIAGRAM_MODE_FRUSTUM = 'frustum';

const DEFAULT_COOL_K = 2500;
const DEFAULT_HOT_K = 40000;
const DEFAULT_MIN_MAG = -6;
const DEFAULT_MAX_MAG = 17;
const DEFAULT_MARGIN_PX = 28;
const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_VOLUME_RADIUS_PC = 25;
const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * @typedef {import('./index.d.ts').HrDiagramBounds} HrDiagramBounds
 * @typedef {import('./index.d.ts').HrDiagramMode} HrDiagramMode
 * @typedef {import('./index.d.ts').HrDiagramPoint} HrDiagramPoint
 * @typedef {import('./index.d.ts').HrDiagramRect} HrDiagramRect
 * @typedef {import('./index.d.ts').HrDiagramRenderer} HrDiagramRenderer
 * @typedef {import('./index.d.ts').HrDiagramRendererOptions} HrDiagramRendererOptions
 * @typedef {import('./index.d.ts').HrDiagramView} HrDiagramView
 * @typedef {import('./index.d.ts').ProjectHrDiagramOptions} ProjectHrDiagramOptions
 * @typedef {import('./index.d.ts').ProjectHrDiagramResult} ProjectHrDiagramResult
 * @typedef {import('@found-in-space/star-products').StarCellData} StarCellData
 * @typedef {import('@found-in-space/star-products').StarCellDelta} StarCellDelta
 * @typedef {import('@found-in-space/star-products').StarRow} StarRow
 */

/**
 * @param {HrDiagramMode | 0 | 1 | 2 | undefined} mode
 * @returns {HrDiagramMode}
 */
export function normalizeHrDiagramMode(mode) {
  if (mode === 0 || mode === HR_DIAGRAM_MODE_MAGNITUDE || mode === undefined) {
    return HR_DIAGRAM_MODE_MAGNITUDE;
  }
  if (mode === 1 || mode === HR_DIAGRAM_MODE_VOLUME) {
    return HR_DIAGRAM_MODE_VOLUME;
  }
  if (mode === 2 || mode === HR_DIAGRAM_MODE_FRUSTUM) {
    return HR_DIAGRAM_MODE_FRUSTUM;
  }
  return HR_DIAGRAM_MODE_MAGNITUDE;
}

/**
 * @param {number} teffK
 * @param {number} width
 * @param {HrDiagramBounds} [options]
 */
export function temperatureToHrX(teffK, width, options = {}) {
  const bounds = normalizeBounds(options);
  const logT = Math.log10(clamp(Number(teffK), bounds.coolK, bounds.hotK));
  const minLogT = Math.log10(bounds.coolK);
  const maxLogT = Math.log10(bounds.hotK);
  const tNorm = (logT - minLogT) / (maxLogT - minLogT);
  return width - bounds.marginPx - tNorm * Math.max(0, width - bounds.marginPx * 2);
}

/**
 * @param {number} magAbs
 * @param {number} height
 * @param {HrDiagramBounds} [options]
 */
export function absoluteMagnitudeToHrY(magAbs, height, options = {}) {
  const bounds = normalizeBounds(options);
  const mNorm = (Number(magAbs) - bounds.minMag) / (bounds.maxMag - bounds.minMag);
  return bounds.marginPx + clamp(mNorm, 0, 1) * Math.max(0, height - bounds.marginPx * 2);
}

/**
 * @param {{
 *   teffLog8?: number;
 *   temperatureK?: number;
 *   magAbs: number;
 *   rect: HrDiagramRect;
 * } & HrDiagramBounds} options
 * @returns {HrDiagramPoint | null}
 */
export function projectHrPoint(options) {
  const magAbs = Number(options.magAbs);
  const teffK = Number.isFinite(options.temperatureK)
    ? Number(options.temperatureK)
    : decodeTemperatureK(Number(options.teffLog8));

  if (!Number.isFinite(teffK) || !Number.isFinite(magAbs)) {
    return null;
  }

  const rect = normalizeRect(options.rect);
  const localX = temperatureToHrX(teffK, rect.w, options);
  const localY = absoluteMagnitudeToHrY(magAbs, rect.h, options);
  const color = temperatureToRgb(teffK, { input: 'kelvin' });

  return {
    x: rect.x + localX,
    y: rect.y + localY,
    teffK,
    magAbs,
    color,
  };
}

/**
 * @param {HrDiagramRect} rect
 * @param {ProjectHrDiagramOptions} [options]
 * @returns {ProjectHrDiagramResult}
 */
export function projectHrDiagramStars(rect, options = {}) {
  const normalizedRect = normalizeRect(rect);
  const mode = normalizeHrDiagramMode(options.mode);
  const observerPc = normalizePoint(options.observerPc, DEFAULT_OBSERVER_PC);
  const limitingMagnitude = normalizeFiniteNumber(
    options.limitingMagnitude,
    DEFAULT_LIMITING_MAGNITUDE,
  );
  const volumeRadiusPc = normalizeFiniteNumber(
    options.volumeRadiusPc,
    DEFAULT_VOLUME_RADIUS_PC,
  );
  const points = [];
  let starCount = 0;
  let filteredCount = 0;

  for (const star of resolveStarRows(options)) {
    starCount += 1;

    if (!passesCanvasVisibility(star, {
      mode,
      observerPc,
      limitingMagnitude,
      volumeRadiusPc,
    })) {
      filteredCount += 1;
      continue;
    }

    const point = projectHrPoint({
      ...options,
      rect: normalizedRect,
      teffLog8: star.teffLog8,
      magAbs: star.magAbs ?? Number.NaN,
    });

    if (!point) {
      filteredCount += 1;
      continue;
    }

    points.push({
      ...point,
      cellKey: star.cellKey,
      objectIndex: star.objectIndex,
    });
  }

  return {
    points,
    starCount,
    visibleCount: points.length,
    filteredCount,
    rect: normalizedRect,
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {HrDiagramRect} rect
 * @param {import('./index.d.ts').DrawHrDiagramCanvasOptions} [options]
 * @returns {ProjectHrDiagramResult}
 */
export function drawHrDiagramCanvas(ctx, rect, options = {}) {
  if (!ctx) {
    throw new TypeError('drawHrDiagramCanvas() requires a CanvasRenderingContext2D.');
  }

  const projected = projectHrDiagramStars(rect, options);
  const background = options.background === undefined
    ? '#020712'
    : options.background;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(projected.rect.x, projected.rect.y, projected.rect.w, projected.rect.h);
  }

  const alpha = clamp(normalizeFiniteNumber(options.alpha, 0.62), 0, 1);
  for (const point of projected.points) {
    const [r, g, b] = point.color;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.fillRect(Math.round(point.x), Math.round(point.y), 1, 1);
  }

  return projected;
}

/**
 * @param {HrDiagramRendererOptions} [options]
 * @returns {HrDiagramRenderer}
 */
export function createHrDiagramRenderer(options = {}) {
  const scene = options.scene ?? new THREE.Scene();
  const camera = options.camera ?? new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const material = createHrDiagramMaterial(options);
  /** @type {Map<string, StarCellData>} */
  const cellsByKey = new Map();
  let geometry = createHrDiagramGeometryFromCells([]);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  let disposed = false;
  let view = normalizeView(options);

  setMaterialView(material, view);

  return {
    scene,
    camera,
    material,
    apply,
    setCells,
    clear,
    setView,
    render,
    getSnapshot,
    dispose,
  };

  /**
   * @param {StarCellDelta} delta
   */
  function apply(delta) {
    assertActive();
    if (delta.type === 'stars/cells-upsert') {
      upsertCells(delta.cells);
      return;
    }
    if (delta.type === 'stars/cells-remove') {
      removeCells(delta.cellKeys);
    }
  }

  /**
   * @param {Iterable<StarCellData>} nextCells
   */
  function setCells(nextCells) {
    assertActive();
    cellsByKey.clear();
    for (const cell of nextCells) {
      cellsByKey.set(cell.cellKey, cell);
    }
    rebuildGeometry();
  }

  function clear() {
    cellsByKey.clear();
    rebuildGeometry();
  }

  /**
   * @param {HrDiagramView} nextView
   */
  function setView(nextView) {
    assertActive();
    view = normalizeView({
      ...view,
      ...nextView,
    });
    setMaterialView(material, view);
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget | null} [target]
   */
  function render(renderer, target = undefined) {
    assertActive();
    if (!renderer || typeof renderer.render !== 'function') {
      throw new TypeError('HrDiagramRenderer.render() requires a THREE.WebGLRenderer.');
    }

    if (target !== undefined && typeof renderer.setRenderTarget === 'function') {
      const previousTarget = renderer.getRenderTarget?.() ?? null;
      renderer.setRenderTarget(target);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget);
      }
      return;
    }

    renderer.render(scene, camera);
  }

  function getSnapshot() {
    let starCount = 0;
    for (const cell of cellsByKey.values()) {
      starCount += cell.count;
    }
    return {
      cellCount: cellsByKey.size,
      starCount,
      disposed,
      view,
    };
  }

  function dispose() {
    if (disposed) return;
    scene.remove(points);
    geometry.dispose();
    cellsByKey.clear();
    material.dispose();
    disposed = true;
  }

  /**
   * @param {StarCellData[]} cells
   */
  function upsertCells(cells) {
    for (const cell of cells) {
      cellsByKey.set(cell.cellKey, cell);
    }
    rebuildGeometry();
  }

  /**
   * @param {string[]} cellKeys
   */
  function removeCells(cellKeys) {
    let changed = false;
    for (const cellKey of cellKeys) {
      changed = cellsByKey.delete(cellKey) || changed;
    }
    if (changed) {
      rebuildGeometry();
    }
  }

  function rebuildGeometry() {
    const nextGeometry = createHrDiagramGeometryFromCells(cellsByKey.values());
    const previousGeometry = geometry;
    geometry = nextGeometry;
    points.geometry = nextGeometry;
    previousGeometry.dispose();
  }

  function assertActive() {
    if (disposed) {
      throw new Error('HR diagram renderer is disposed.');
    }
  }
}

/**
 * @param {Iterable<StarCellData>} cells
 * @returns {THREE.BufferGeometry}
 */
export function createHrDiagramGeometryFromCells(cells) {
  const orderedCells = Array.from(cells)
    .sort((left, right) => left.cellKey.localeCompare(right.cellKey));
  const totalCount = orderedCells.reduce((sum, cell) => sum + cell.count, 0);
  const positions = new Float32Array(totalCount * 3);
  const teffLog8 = new Uint8Array(totalCount);
  const magAbs = new Float32Array(totalCount);
  let offset = 0;

  for (const cell of orderedCells) {
    positions.set(cell.coordinates.components, offset * 3);
    teffLog8.set(cell.attributes.teffLog8 ?? new Uint8Array(cell.count).fill(255), offset);
    magAbs.set(cell.attributes.magAbs ?? new Float32Array(cell.count), offset);
    offset += cell.count;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    'teff_log8',
    new THREE.BufferAttribute(teffLog8, 1, true),
  );
  geometry.setAttribute(
    'magAbs',
    new THREE.BufferAttribute(magAbs, 1),
  );
  geometry.setDrawRange(0, totalCount);
  return geometry;
}

/**
 * @param {HrDiagramRendererOptions} options
 */
function createHrDiagramMaterial(options) {
  const view = normalizeView(options);
  return new THREE.ShaderMaterial({
    uniforms: {
      uObserverPc: { value: new THREE.Vector3(view.observerPc.x, view.observerPc.y, view.observerPc.z) },
      uLimitingMagnitude: { value: view.limitingMagnitude },
      uVolumeRadiusPc: { value: view.volumeRadiusPc },
      uMode: { value: modeToShaderValue(view.mode) },
      uMinLogT: { value: Math.log10(view.coolK) },
      uMaxLogT: { value: Math.log10(view.hotK) },
      uMinMag: { value: view.minMag },
      uMaxMag: { value: view.maxMag },
      uMarginPx: { value: view.marginPx },
      uWidth: { value: view.width },
      uHeight: { value: view.height },
      uViewProjection: { value: new THREE.Matrix4() },
      uHighlightEnabled: { value: 0 },
      uHighlightTeffMin: { value: 0 },
      uHighlightTeffMax: { value: 0 },
      uHighlightMagAbsMin: { value: 0 },
      uHighlightMagAbsMax: { value: 0 },
      uHighlightColor: { value: new THREE.Color(0x8cffb8) },
    },
    vertexShader: /* glsl */ `
      attribute float teff_log8;
      attribute float magAbs;

      uniform vec3 uObserverPc;
      uniform float uLimitingMagnitude;
      uniform float uVolumeRadiusPc;
      uniform int uMode;
      uniform float uMinLogT;
      uniform float uMaxLogT;
      uniform float uMinMag;
      uniform float uMaxMag;
      uniform float uMarginPx;
      uniform float uWidth;
      uniform float uHeight;
      uniform mat4 uViewProjection;
      uniform int uHighlightEnabled;
      uniform float uHighlightTeffMin;
      uniform float uHighlightTeffMax;
      uniform float uHighlightMagAbsMin;
      uniform float uHighlightMagAbsMax;
      uniform vec3 uHighlightColor;

      varying vec3 vColor;
      varying float vAlpha;

      float decodeTemperature(float log8) {
        if (log8 >= 0.996) return 5800.0;
        return 2000.0 * pow(25.0, log8);
      }

      vec3 blackbodyToRGB(float temp) {
        float t = clamp(temp, 1000.0, 40000.0) / 100.0;
        vec3 c;
        if (t <= 66.0) c.r = 255.0;
        else c.r = 329.698727446 * pow(t - 60.0, -0.1332047592);
        if (t <= 66.0) c.g = 99.4708025861 * log(t) - 161.119568166;
        else c.g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
        if (t >= 66.0) c.b = 255.0;
        else if (t <= 19.0) c.b = 0.0;
        else c.b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
        return clamp(c / 255.0, 0.0, 1.0);
      }

      void hidePoint() {
        gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
        gl_PointSize = 0.0;
        vAlpha = 0.0;
      }

      void main() {
        vec3 worldPosPc = position;
        float dPc = max(length(worldPosPc - uObserverPc), 0.001);
        float mApp = magAbs + 5.0 * log(dPc) / log(10.0) - 5.0;

        if (uMode == 0 && mApp > uLimitingMagnitude) {
          hidePoint();
          return;
        }

        if (uMode == 1 && dPc > uVolumeRadiusPc) {
          hidePoint();
          return;
        }

        if (uMode == 2) {
          if (mApp > uLimitingMagnitude) {
            hidePoint();
            return;
          }
          vec4 clip = uViewProjection * vec4(worldPosPc, 1.0);
          if (abs(clip.x) > clip.w * 1.05 || abs(clip.y) > clip.w * 1.05 || clip.z < 0.0) {
            hidePoint();
            return;
          }
        }

        float tempK = decodeTemperature(teff_log8);
        vColor = blackbodyToRGB(tempK);
        vAlpha = uMode == 0 || uMode == 2
          ? 0.55 * (1.0 - smoothstep(uLimitingMagnitude - 1.5, uLimitingMagnitude, mApp))
          : 0.5;

        if (
          uHighlightEnabled == 1 &&
          tempK >= uHighlightTeffMin &&
          tempK <= uHighlightTeffMax &&
          magAbs >= uHighlightMagAbsMin &&
          magAbs <= uHighlightMagAbsMax
        ) {
          vColor = mix(vColor, uHighlightColor, 0.65);
          vAlpha = max(vAlpha, 0.82);
        }

        float logT = log(tempK) / log(10.0);
        float tNorm = clamp((logT - uMinLogT) / (uMaxLogT - uMinLogT), 0.0, 1.0);
        float plotW = uWidth - 2.0 * uMarginPx;
        float xPx = uWidth - uMarginPx - tNorm * plotW;
        float x = xPx / uWidth * 2.0 - 1.0;

        float mNorm = clamp((magAbs - uMinMag) / (uMaxMag - uMinMag), 0.0, 1.0);
        float plotH = uHeight - 2.0 * uMarginPx;
        float yPx = uMarginPx + mNorm * plotH;
        float y = 1.0 - yPx / uHeight * 2.0;

        gl_Position = vec4(x, y, 0.0, 1.0);
        gl_PointSize = 1.5;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.0) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * @param {THREE.ShaderMaterial} material
 * @param {Required<HrDiagramView>} view
 */
function setMaterialView(material, view) {
  material.uniforms.uObserverPc.value.set(
    view.observerPc.x,
    view.observerPc.y,
    view.observerPc.z,
  );
  material.uniforms.uLimitingMagnitude.value = view.limitingMagnitude;
  material.uniforms.uVolumeRadiusPc.value = view.volumeRadiusPc;
  material.uniforms.uMode.value = modeToShaderValue(view.mode);
  material.uniforms.uMinLogT.value = Math.log10(view.coolK);
  material.uniforms.uMaxLogT.value = Math.log10(view.hotK);
  material.uniforms.uMinMag.value = view.minMag;
  material.uniforms.uMaxMag.value = view.maxMag;
  material.uniforms.uMarginPx.value = view.marginPx;
  material.uniforms.uWidth.value = view.width;
  material.uniforms.uHeight.value = view.height;
  setMatrixUniform(material.uniforms.uViewProjection.value, view.viewProjection);
  setHighlightUniforms(material, view.highlightRegion);
}

/**
 * @param {THREE.Matrix4} matrix
 * @param {unknown} value
 */
function setMatrixUniform(matrix, value) {
  if (value && typeof value === 'object' && 'elements' in value) {
    matrix.fromArray(/** @type {{ elements: number[] | Float32Array }} */ (value).elements);
    return;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    matrix.fromArray(/** @type {number[] | Float32Array} */ (value));
  }
}

/**
 * @param {THREE.ShaderMaterial} material
 * @param {HrDiagramView['highlightRegion']} highlight
 */
function setHighlightUniforms(material, highlight) {
  material.uniforms.uHighlightEnabled.value = highlight ? 1 : 0;
  if (!highlight) return;

  material.uniforms.uHighlightTeffMin.value = Number(highlight.teffMin);
  material.uniforms.uHighlightTeffMax.value = Number(highlight.teffMax);
  material.uniforms.uHighlightMagAbsMin.value = Number(highlight.magAbsMin);
  material.uniforms.uHighlightMagAbsMax.value = Number(highlight.magAbsMax);
  setColorUniform(material.uniforms.uHighlightColor.value, highlight.color ?? '#8cffb8');
}

/**
 * @param {THREE.Color} color
 * @param {string | [number, number, number]} value
 */
function setColorUniform(color, value) {
  if (Array.isArray(value)) {
    color.setRGB(
      clamp(Number(value[0]), 0, 255) / 255,
      clamp(Number(value[1]), 0, 255) / 255,
      clamp(Number(value[2]), 0, 255) / 255,
    );
    return;
  }
  color.set(value);
}

/**
 * @param {HrDiagramView} [view]
 * @returns {Required<HrDiagramView>}
 */
function normalizeView(view = {}) {
  return {
    mode: normalizeHrDiagramMode(view.mode),
    observerPc: normalizePoint(view.observerPc, DEFAULT_OBSERVER_PC),
    limitingMagnitude: normalizeFiniteNumber(view.limitingMagnitude, DEFAULT_LIMITING_MAGNITUDE),
    volumeRadiusPc: normalizeFiniteNumber(view.volumeRadiusPc, DEFAULT_VOLUME_RADIUS_PC),
    viewProjection: view.viewProjection,
    highlightRegion: view.highlightRegion ?? null,
    ...normalizeBounds(view),
    width: normalizeFiniteNumber(view.width, 480),
    height: normalizeFiniteNumber(view.height, 320),
  };
}

/**
 * @param {HrDiagramBounds} options
 */
function normalizeBounds(options = {}) {
  const coolK = normalizeFiniteNumber(options.coolK, DEFAULT_COOL_K);
  const hotK = normalizeFiniteNumber(options.hotK, DEFAULT_HOT_K);
  return {
    coolK: Math.min(coolK, hotK),
    hotK: Math.max(coolK, hotK),
    minMag: normalizeFiniteNumber(options.minMag, DEFAULT_MIN_MAG),
    maxMag: normalizeFiniteNumber(options.maxMag, DEFAULT_MAX_MAG),
    marginPx: normalizeFiniteNumber(options.marginPx, DEFAULT_MARGIN_PX),
  };
}

/**
 * @param {HrDiagramRect} rect
 */
function normalizeRect(rect) {
  return {
    x: normalizeFiniteNumber(rect.x, 0),
    y: normalizeFiniteNumber(rect.y, 0),
    w: Math.max(0, normalizeFiniteNumber(rect.w, 0)),
    h: Math.max(0, normalizeFiniteNumber(rect.h, 0)),
  };
}

/**
 * @param {HrDiagramMode} mode
 */
function modeToShaderValue(mode) {
  if (mode === HR_DIAGRAM_MODE_VOLUME) return 1;
  if (mode === HR_DIAGRAM_MODE_FRUSTUM) return 2;
  return 0;
}

/**
 * @param {ProjectHrDiagramOptions} options
 * @returns {Iterable<StarRow>}
 */
function resolveStarRows(options) {
  if (options.stars) {
    return options.stars;
  }
  if (options.store) {
    return options.store.stars();
  }
  if (options.cells) {
    return iterateCellRows(options.cells);
  }
  return [];
}

/**
 * @param {Iterable<StarCellData>} cells
 */
function* iterateCellRows(cells) {
  for (const cell of cells) {
    const positions = cell.coordinates.components;
    const teff = cell.attributes.teffLog8;
    const magAbs = cell.attributes.magAbs;
    for (let objectIndex = 0; objectIndex < cell.count; objectIndex += 1) {
      const offset = objectIndex * 3;
      yield {
        cell,
        cellKey: cell.cellKey,
        objectIndex,
        position: {
          x: positions[offset] ?? 0,
          y: positions[offset + 1] ?? 0,
          z: positions[offset + 2] ?? 0,
        },
        ...(teff ? { teffLog8: teff[objectIndex] } : {}),
        ...(magAbs ? { magAbs: magAbs[objectIndex] } : {}),
        objectRef: cell.refs?.[objectIndex] ?? null,
        pickMeta: cell.pickMeta?.[objectIndex] ?? null,
      };
    }
  }
}

/**
 * @param {StarRow} star
 * @param {{
 *   mode: HrDiagramMode;
 *   observerPc: { x: number; y: number; z: number };
 *   limitingMagnitude: number;
 *   volumeRadiusPc: number;
 * }} options
 */
function passesCanvasVisibility(star, options) {
  const distancePc = pointDistance(star.position, options.observerPc);
  if (options.mode === HR_DIAGRAM_MODE_VOLUME) {
    return distancePc <= options.volumeRadiusPc;
  }
  if (options.mode === HR_DIAGRAM_MODE_MAGNITUDE || options.mode === HR_DIAGRAM_MODE_FRUSTUM) {
    const magAbs = Number(star.magAbs);
    return Number.isFinite(magAbs) &&
      apparentMagnitude({ magAbs, distancePc }) <= options.limitingMagnitude;
  }
  return true;
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function pointDistance(left, right) {
  const dx = Number(left.x) - Number(right.x);
  const dy = Number(left.y) - Number(right.y);
  const dz = Number(left.z) - Number(right.z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
