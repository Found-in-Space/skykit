import * as THREE from 'three';
import {
  apparentMagnitude,
  decodeTemperatureK,
  temperatureToRgb,
} from '@found-in-space/star-trees';

export const HR_DIAGRAM_MODE_MAGNITUDE = 'magnitude-limited';
export const HR_DIAGRAM_MODE_VOLUME = 'volume-complete';
export const HR_DIAGRAM_MODE_FRUSTUM = 'frustum';

const DEFAULT_COOL_K = 2500;
const DEFAULT_HOT_K = 40000;
const DEFAULT_MIN_MAG = -6;
const DEFAULT_MAX_MAG = 17;
const DEFAULT_MARGIN_PX = 42;
const DEFAULT_LIMITING_MAGNITUDE = 6.5;
const DEFAULT_VOLUME_RADIUS_PC = 25;
const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_COORDINATE_UNITS_PER_PARSEC = 1;
const DEFAULT_BACKGROUND = '#020712';
const DEFAULT_POINT_ALPHA = 0.62;
const TEMPERATURE_TICKS_K = Object.freeze([3000, 5000, 8000, 15000, 30000]);

/**
 * @typedef {import('./index.d.ts').HrDiagramBounds} HrDiagramBounds
 * @typedef {import('./index.d.ts').HrDiagramMode} HrDiagramMode
 * @typedef {import('./index.d.ts').HrDiagramPoint} HrDiagramPoint
 * @typedef {import('./index.d.ts').HrDiagramRect} HrDiagramRect
 * @typedef {import('./index.d.ts').HrDiagramRenderer} HrDiagramRenderer
 * @typedef {import('./index.d.ts').HrDiagramRendererOptions} HrDiagramRendererOptions
 * @typedef {import('./index.d.ts').HrDiagramSelectedStar} HrDiagramSelectedStar
 * @typedef {import('./index.d.ts').HrDiagramView} HrDiagramView
 * @typedef {import('./index.d.ts').ProjectHrDiagramOptions} ProjectHrDiagramOptions
 * @typedef {import('./index.d.ts').ProjectHrDiagramResult} ProjectHrDiagramResult
 * @typedef {import('@found-in-space/star-trees').StarCellData} StarCellData
 * @typedef {import('@found-in-space/star-trees').StarCellDelta} StarCellDelta
 * @typedef {import('@found-in-space/star-trees').StarRow} StarRow
 */

/**
 * @param {HrDiagramMode | undefined} mode
 * @returns {HrDiagramMode}
 */
export function normalizeHrDiagramMode(mode) {
  if (mode === HR_DIAGRAM_MODE_MAGNITUDE || mode === undefined) {
    return HR_DIAGRAM_MODE_MAGNITUDE;
  }
  if (mode === HR_DIAGRAM_MODE_VOLUME) {
    return HR_DIAGRAM_MODE_VOLUME;
  }
  if (mode === HR_DIAGRAM_MODE_FRUSTUM) {
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
  const coordinateUnitsPerParsec = normalizeCoordinateUnitsPerParsec(
    options.coordinateUnitsPerParsec,
  );
  const observerPosition = normalizePoint(
    options.observerPosition,
    scalePoint(observerPc, coordinateUnitsPerParsec),
  );
  const viewProjection = normalizeMatrixArray(options.viewProjection);
  const points = [];
  let starCount = 0;
  let filteredCount = 0;

  for (const star of resolveStarRows(options)) {
    starCount += 1;

    if (!passesCanvasVisibility(star, {
      mode,
      observerPc,
      observerPosition,
      coordinateUnitsPerParsec,
      limitingMagnitude,
      volumeRadiusPc,
      viewProjection,
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
  drawHrDiagramFrame(ctx, projected.rect, options, projected.visibleCount, projected.starCount);

  const alpha = clamp(normalizeFiniteNumber(options.alpha, DEFAULT_POINT_ALPHA), 0, 1);
  for (const point of projected.points) {
    const [r, g, b] = point.color;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.fillRect(Math.round(point.x), Math.round(point.y), 1, 1);
  }

  drawSelectedStars(ctx, projected.rect, options);
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
  let geometryDirty = false;
  let geometryRevision = 0;
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;
  scene.add(points);
  let disposed = false;
  let view = normalizeView(options);
  const axesOverlay = createAxesOverlay(view);
  let axesRevision = 0;
  let axesDirty = true;
  if (axesOverlay) {
    axesOverlay.mesh.renderOrder = 0;
    scene.add(axesOverlay.mesh);
  }

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
    markGeometryDirty();
  }

  function clear() {
    const hadCells = cellsByKey.size > 0;
    cellsByKey.clear();
    if (hadCells || geometryDirty) {
      markGeometryDirty();
    }
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
    markAxesDirty();
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

    updateGeometryIfNeeded();
    updateAxesOverlayIfNeeded();

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
    const projected = projectCurrentCells();
    return {
      cellCount: cellsByKey.size,
      starCount: projected.starCount,
      visibleCount: projected.visibleCount,
      axesRevision,
      axesAvailable: Boolean(axesOverlay),
      geometryDirty,
      geometryRevision,
      disposed,
      view,
    };
  }

  function dispose() {
    if (disposed) return;
    scene.remove(points);
    if (axesOverlay) {
      scene.remove(axesOverlay.mesh);
      axesOverlay.dispose();
    }
    geometry.dispose();
    cellsByKey.clear();
    material.dispose();
    disposed = true;
  }

  /**
   * @param {StarCellData[]} cells
   */
  function upsertCells(cells) {
    let changed = false;
    for (const cell of cells) {
      cellsByKey.set(cell.cellKey, cell);
      changed = true;
    }
    if (changed) {
      markGeometryDirty();
    }
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
      markGeometryDirty();
    }
  }

  function rebuildGeometry() {
    const nextGeometry = createHrDiagramGeometryFromCells(cellsByKey.values());
    const previousGeometry = geometry;
    geometry = nextGeometry;
    points.geometry = nextGeometry;
    previousGeometry.dispose();
    geometryRevision += 1;
    markAxesDirty();
  }

  function markGeometryDirty() {
    geometryDirty = true;
    markAxesDirty();
  }

  function markAxesDirty() {
    axesDirty = true;
  }

  function updateGeometryIfNeeded() {
    if (!geometryDirty) {
      return;
    }
    rebuildGeometry();
    geometryDirty = false;
  }

  function updateAxesOverlayIfNeeded() {
    if (!axesOverlay || !axesDirty) {
      return;
    }
    const projected = projectCurrentCells();
    axesOverlay.update(view, projected.visibleCount, projected.starCount);
    axesDirty = false;
    axesRevision += 1;
  }

  function projectCurrentCells() {
    return projectHrDiagramStars(
      { x: 0, y: 0, w: view.width, h: view.height },
      {
        ...view,
        cells: cellsByKey.values(),
      },
    );
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
      uObserverPosition: {
        value: new THREE.Vector3(
          view.observerPosition.x,
          view.observerPosition.y,
          view.observerPosition.z,
        ),
      },
      uCoordinateUnitsPerParsec: { value: view.coordinateUnitsPerParsec },
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

      uniform vec3 uObserverPosition;
      uniform float uCoordinateUnitsPerParsec;
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
        vec3 worldPos = position;
        float dPc = max(length(worldPos - uObserverPosition) / max(uCoordinateUnitsPerParsec, 0.000001), 0.001);
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
          vec4 clip = uViewProjection * vec4(worldPos, 1.0);
          if (clip.w <= 0.0 || abs(clip.x) > clip.w * 1.05 || abs(clip.y) > clip.w * 1.05 || clip.z < -clip.w * 1.05 || clip.z > clip.w * 1.05) {
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
  material.uniforms.uObserverPosition.value.set(
    view.observerPosition.x,
    view.observerPosition.y,
    view.observerPosition.z,
  );
  material.uniforms.uCoordinateUnitsPerParsec.value = view.coordinateUnitsPerParsec;
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
 * @param {Required<HrDiagramView>} initialView
 */
function createAxesOverlay(initialView) {
  const canvas = createRasterCanvas(initialView.width, initialView.height);
  if (!canvas || typeof canvas.getContext !== 'function') {
    return null;
  }
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  let texture = createCanvasTexture(canvas);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    update(nextView, visibleCount, starCount) {
      const width = Math.max(1, Math.round(nextView.width));
      const height = Math.max(1, Math.round(nextView.height));
      if (canvas.width !== width) {
        canvas.width = width;
        replaceTexture();
      }
      if (canvas.height !== height) {
        canvas.height = height;
        replaceTexture();
      }
      drawHrDiagramFrame(
        context,
        { x: 0, y: 0, w: width, h: height },
        nextView,
        visibleCount,
        starCount,
      );
      drawSelectedStars(context, { x: 0, y: 0, w: width, h: height }, nextView);
      texture.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };

  function replaceTexture() {
    texture.dispose();
    texture = createCanvasTexture(canvas);
    material.map = texture;
    material.needsUpdate = true;
  }
}

/**
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 */
function createCanvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  if ('colorSpace' in texture && THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

/**
 * @param {number} width
 * @param {number} height
 */
function createRasterCanvas(width, height) {
  const normalizedWidth = Math.max(1, Math.round(width));
  const normalizedHeight = Math.max(1, Math.round(height));
  const documentRef = globalThis.document;
  if (documentRef && typeof documentRef.createElement === 'function') {
    const canvas = documentRef.createElement('canvas');
    canvas.width = normalizedWidth;
    canvas.height = normalizedHeight;
    return canvas;
  }
  if (typeof globalThis.OffscreenCanvas === 'function') {
    return new globalThis.OffscreenCanvas(normalizedWidth, normalizedHeight);
  }
  return null;
}

/**
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {HrDiagramRect} rect
 * @param {HrDiagramView | import('./index.d.ts').DrawHrDiagramCanvasOptions} options
 * @param {number} visibleCount
 * @param {number} starCount
 */
function drawHrDiagramFrame(ctx, rect, options, visibleCount, starCount) {
  const normalizedRect = normalizeRect(rect);
  const bounds = normalizeBounds(options);
  const background = options.background === undefined
    ? DEFAULT_BACKGROUND
    : options.background;

  ctx.save();
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(normalizedRect.x, normalizedRect.y, normalizedRect.w, normalizedRect.h);
  } else {
    ctx.clearRect(normalizedRect.x, normalizedRect.y, normalizedRect.w, normalizedRect.h);
  }

  drawHighlightRegion(ctx, normalizedRect, options.highlightRegion ?? null, bounds);

  if (options.showAxes !== false) {
    drawAxes(ctx, normalizedRect, bounds);
  }

  if (options.showCount !== false) {
    ctx.fillStyle = 'rgba(225, 236, 255, 0.72)';
    ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const label = `${visibleCount.toLocaleString()} visible`;
    ctx.fillText(
      label,
      normalizedRect.x + normalizedRect.w - bounds.marginPx,
      normalizedRect.y + Math.max(8, bounds.marginPx - 30),
    );
    if (starCount !== visibleCount) {
      ctx.fillStyle = 'rgba(171, 188, 218, 0.62)';
      ctx.fillText(
        `${starCount.toLocaleString()} loaded`,
        normalizedRect.x + normalizedRect.w - bounds.marginPx,
        normalizedRect.y + Math.max(23, bounds.marginPx - 15),
      );
    }
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {HrDiagramRect} rect
 * @param {HrDiagramHighlightRegion | null} highlight
 * @param {Required<HrDiagramBounds>} bounds
 */
function drawHighlightRegion(ctx, rect, highlight, bounds) {
  if (!highlight) {
    return;
  }

  const xHot = rect.x + temperatureToHrX(highlight.teffMax, rect.w, bounds);
  const xCool = rect.x + temperatureToHrX(highlight.teffMin, rect.w, bounds);
  const yBright = rect.y + absoluteMagnitudeToHrY(highlight.magAbsMin, rect.h, bounds);
  const yDim = rect.y + absoluteMagnitudeToHrY(highlight.magAbsMax, rect.h, bounds);
  const left = Math.min(xHot, xCool);
  const top = Math.min(yBright, yDim);
  const width = Math.max(0, Math.abs(xCool - xHot));
  const height = Math.max(0, Math.abs(yDim - yBright));
  const color = cssColorFromValue(highlight.color ?? '#8cffb8', 1);

  ctx.save();
  ctx.fillStyle = cssColorFromValue(highlight.color ?? '#8cffb8', 0.09);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash?.([5, 4]);
  ctx.fillRect(left, top, width, height);
  ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
  if (highlight.label) {
    ctx.setLineDash?.([]);
    ctx.fillStyle = color;
    ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(highlight.label, left + 6, Math.max(rect.y + 4, top - 4));
  }
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {HrDiagramRect} rect
 * @param {Required<HrDiagramBounds>} bounds
 */
function drawAxes(ctx, rect, bounds) {
  const left = rect.x + bounds.marginPx;
  const right = rect.x + rect.w - bounds.marginPx;
  const top = rect.y + bounds.marginPx;
  const bottom = rect.y + rect.h - bounds.marginPx;

  ctx.save();
  ctx.strokeStyle = 'rgba(137, 164, 204, 0.32)';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, right - left), Math.max(0, bottom - top));

  ctx.font = '10px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(205, 218, 238, 0.76)';
  ctx.strokeStyle = 'rgba(137, 164, 204, 0.18)';

  for (const tick of TEMPERATURE_TICKS_K) {
    if (tick < bounds.coolK || tick > bounds.hotK) continue;
    const x = rect.x + temperatureToHrX(tick, rect.w, bounds);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top);
    ctx.lineTo(x + 0.5, bottom);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(formatTemperatureTick(tick), x, bottom + 9);
  }

  const firstMagTick = Math.ceil(bounds.minMag / 2) * 2;
  for (let tick = firstMagTick; tick <= bounds.maxMag; tick += 2) {
    const y = rect.y + absoluteMagnitudeToHrY(tick, rect.h, bounds);
    ctx.beginPath();
    ctx.moveTo(left, y + 0.5);
    ctx.lineTo(right, y + 0.5);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(tick), left - 10, y);
  }

  ctx.fillStyle = 'rgba(230, 238, 252, 0.86)';
  ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('Hot', left, bottom + 23);
  ctx.textAlign = 'right';
  ctx.fillText('Cool', right, bottom + 23);

  ctx.save();
  ctx.translate(rect.x + 13, top + (bottom - top) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Abs. magnitude', 0, 0);
  ctx.restore();
  ctx.restore();
}

/**
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx
 * @param {HrDiagramRect} rect
 * @param {HrDiagramView | import('./index.d.ts').DrawHrDiagramCanvasOptions} options
 */
function drawSelectedStars(ctx, rect, options) {
  if (!options.selectedStars) {
    return;
  }

  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const selected of options.selectedStars) {
    const point = projectHrPoint({
      ...options,
      rect,
      teffLog8: selected.teffLog8,
      temperatureK: selected.temperatureK,
      magAbs: selected.magAbs,
    });
    if (!point) continue;
    const color = selected.color ?? [255, 255, 255];
    ctx.strokeStyle = cssColorFromValue(color, 0.95);
    ctx.fillStyle = cssColorFromValue(color, 0.95);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point.x - 7, point.y);
    ctx.lineTo(point.x + 7, point.y);
    ctx.moveTo(point.x, point.y - 7);
    ctx.lineTo(point.x, point.y + 7);
    ctx.stroke();
    if (selected.label) {
      ctx.fillText(selected.label, point.x + 8, point.y);
    }
  }
  ctx.restore();
}

/**
 * @param {string | [number, number, number]} value
 * @param {number} alpha
 */
function cssColorFromValue(value, alpha = 1) {
  if (Array.isArray(value)) {
    return `rgba(${clamp(Number(value[0]), 0, 255)}, ${clamp(Number(value[1]), 0, 255)}, ${clamp(Number(value[2]), 0, 255)}, ${clamp(alpha, 0, 1)})`;
  }
  if (alpha >= 0.999) {
    return value;
  }
  const color = new THREE.Color(value);
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${clamp(alpha, 0, 1)})`;
}

/**
 * @param {number} tick
 */
function formatTemperatureTick(tick) {
  return tick >= 10000 ? `${Math.round(tick / 1000)}k` : String(tick);
}

/**
 * @param {HrDiagramView} [view]
 * @returns {Required<HrDiagramView>}
 */
function normalizeView(view = {}) {
  const coordinateUnitsPerParsec = normalizeCoordinateUnitsPerParsec(
    view.coordinateUnitsPerParsec,
  );
  const observerPc = normalizePoint(view.observerPc, DEFAULT_OBSERVER_PC);
  return {
    mode: normalizeHrDiagramMode(view.mode),
    observerPc,
    observerPosition: normalizePoint(
      view.observerPosition,
      scalePoint(observerPc, coordinateUnitsPerParsec),
    ),
    coordinateUnitsPerParsec,
    limitingMagnitude: normalizeFiniteNumber(view.limitingMagnitude, DEFAULT_LIMITING_MAGNITUDE),
    volumeRadiusPc: normalizeFiniteNumber(view.volumeRadiusPc, DEFAULT_VOLUME_RADIUS_PC),
    viewProjection: view.viewProjection,
    highlightRegion: view.highlightRegion ?? null,
    selectedStars: view.selectedStars ?? [],
    showAxes: view.showAxes !== false,
    showCount: view.showCount !== false,
    background: view.background === undefined ? DEFAULT_BACKGROUND : view.background,
    alpha: clamp(normalizeFiniteNumber(view.alpha, DEFAULT_POINT_ALPHA), 0, 1),
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
 *   observerPosition: { x: number; y: number; z: number };
 *   coordinateUnitsPerParsec: number;
 *   limitingMagnitude: number;
 *   volumeRadiusPc: number;
 *   viewProjection: Float32Array | number[] | null;
 * }} options
 */
function passesCanvasVisibility(star, options) {
  const distancePc = pointDistance(star.position, options.observerPosition) /
    Math.max(options.coordinateUnitsPerParsec, 0.000001);
  if (options.mode === HR_DIAGRAM_MODE_VOLUME) {
    return distancePc <= options.volumeRadiusPc;
  }
  if (options.mode === HR_DIAGRAM_MODE_MAGNITUDE) {
    const magAbs = Number(star.magAbs);
    return Number.isFinite(magAbs) &&
      apparentMagnitude({ magAbs, distancePc }) <= options.limitingMagnitude;
  }
  if (options.mode === HR_DIAGRAM_MODE_FRUSTUM) {
    const magAbs = Number(star.magAbs);
    return Number.isFinite(magAbs) &&
      apparentMagnitude({ magAbs, distancePc }) <= options.limitingMagnitude &&
      pointInFrustum(star.position, options.viewProjection);
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
 * @param {{ x: number; y: number; z: number }} point
 * @param {number} scale
 */
function scalePoint(point, scale) {
  return {
    x: Number(point.x) * scale,
    y: Number(point.y) * scale,
    z: Number(point.z) * scale,
  };
}

/**
 * @param {unknown} value
 */
function normalizeCoordinateUnitsPerParsec(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : DEFAULT_COORDINATE_UNITS_PER_PARSEC;
}

/**
 * @param {unknown} value
 * @returns {Float32Array | number[] | null}
 */
function normalizeMatrixArray(value) {
  if (!value) {
    return null;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return /** @type {Float32Array | number[]} */ (value);
  }
  if (typeof value === 'object' && 'elements' in value) {
    const elements = /** @type {{ elements?: unknown }} */ (value).elements;
    if (Array.isArray(elements) || ArrayBuffer.isView(elements)) {
      return /** @type {Float32Array | number[]} */ (elements);
    }
  }
  return null;
}

/**
 * @param {{ x: number; y: number; z: number }} position
 * @param {Float32Array | number[] | null} matrix
 */
function pointInFrustum(position, matrix) {
  if (!matrix || matrix.length < 16) {
    return true;
  }
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  const clipX = Number(matrix[0]) * x + Number(matrix[4]) * y + Number(matrix[8]) * z + Number(matrix[12]);
  const clipY = Number(matrix[1]) * x + Number(matrix[5]) * y + Number(matrix[9]) * z + Number(matrix[13]);
  const clipZ = Number(matrix[2]) * x + Number(matrix[6]) * y + Number(matrix[10]) * z + Number(matrix[14]);
  const clipW = Number(matrix[3]) * x + Number(matrix[7]) * y + Number(matrix[11]) * z + Number(matrix[15]);
  if (!Number.isFinite(clipW) || clipW <= 0) {
    return false;
  }
  const tolerance = clipW * 1.05;
  return Math.abs(clipX) <= tolerance &&
    Math.abs(clipY) <= tolerance &&
    clipZ >= -tolerance &&
    clipZ <= tolerance;
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
