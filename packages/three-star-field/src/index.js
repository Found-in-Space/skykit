import * as THREE from 'three';
import { apparentMagnitude } from '@found-in-space/star-products';

export const DEFAULT_THREE_STAR_FIELD_VIEW = Object.freeze({
  observerPosition: Object.freeze({ x: 0, y: 0, z: 0 }),
  limitingMagnitude: 6.5,
  coordinateUnitsPerParsec: 1,
  renderScale: 1,
  exposure: 2500,
  magFadeRange: 3,
  baseSize: 0.9,
  sizeScale: 3,
  sizePower: 0.32,
  sizeMax: 384,
  halo: true,
  haloScale: 1.5,
  haloPower: 0.22,
  haloSizeMax: 1024,
});

const SOLAR_TEFF_LOG8 = 255;
const HIDDEN_MAG_ABS = 99;
const DEFAULT_PICK_TOLERANCE_DEG = 3;
const DEFAULT_MIN_CLICK_RADIUS_DEG = 0.15;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * @typedef {import('./index.d.ts').ThreeStarField} ThreeStarField
 * @typedef {import('./index.d.ts').ThreeStarFieldMaterialProfile} ThreeStarFieldMaterialProfile
 * @typedef {import('./index.d.ts').ThreeStarFieldOptions} ThreeStarFieldOptions
 * @typedef {import('./index.d.ts').ThreeStarFieldPickData} ThreeStarFieldPickData
 * @typedef {import('./index.d.ts').ThreeStarFieldPickOptions} ThreeStarFieldPickOptions
 * @typedef {import('./index.d.ts').ThreeStarFieldPickResult} ThreeStarFieldPickResult
 * @typedef {import('./index.d.ts').ThreeStarFieldView} ThreeStarFieldView
 * @typedef {import('./index.d.ts').ThreeStarFieldVisualRadiusInput} ThreeStarFieldVisualRadiusInput
 * @typedef {import('@found-in-space/star-products').ProductDelta<import('@found-in-space/star-products').StarObjectBatchProduct>} StarProductDelta
 * @typedef {import('@found-in-space/star-products').StarObjectBatchProduct} StarObjectBatchProduct
 */

/**
 * @param {ThreeStarFieldOptions} [options]
 * @returns {ThreeStarField}
 */
export function createThreeStarField(options = {}) {
  const fieldId = options.id ?? 'three-star-field';
  const object3d = new THREE.Group();
  object3d.name = fieldId;

  let view = normalizeView(options);
  object3d.scale.setScalar(view.renderScale);

  const materialProfile = normalizeMaterialProfile(
    options.materialProfile ??
      options.materialFactory?.({ fieldId, view }) ??
      createDefaultThreeStarFieldMaterialProfile(view),
  );
  const disposeMaterialProfile = options.disposeMaterialProfile !== false;
  /** @type {Map<string, { product: StarObjectBatchProduct; geometry: THREE.BufferGeometry; points: THREE.Points; haloPoints: THREE.Points | null }>} */
  const products = new Map();
  const frustumCulled = options.frustumCulled === true;
  /** @type {ThreeStarFieldSnapshotStatus} */
  let status = 'idle';
  /** @type {string | null} */
  let lastError = null;
  /** @type {{ viewRevision?: number; demandRevision?: number } | null} */
  let lastCurrentRevision = null;
  let disposed = false;

  materialProfile.updateUniforms?.({ view });

  return {
    object3d,
    apply,
    setProducts,
    clear,
    setView,
    pick,
    getSnapshot,
    dispose,
  };

  /**
   * @param {StarProductDelta} delta
   */
  function apply(delta) {
    assertActive();
    if (!delta || typeof delta.type !== 'string') {
      throw new TypeError('ThreeStarField.apply() requires a product delta.');
    }

    if (delta.type === 'data/product-upsert') {
      upsertProduct(delta.product);
      status = 'streaming';
      lastError = null;
      return;
    }

    if (delta.type === 'data/product-stale' || delta.type === 'data/product-remove') {
      removeProduct(delta.productId);
      status = 'streaming';
      return;
    }

    if (delta.type === 'data/representation-current') {
      status = 'current';
      lastCurrentRevision = {
        ...(delta.viewRevision !== undefined ? { viewRevision: delta.viewRevision } : {}),
        ...(delta.demandRevision !== undefined ? { demandRevision: delta.demandRevision } : {}),
      };
      return;
    }

    if (delta.type === 'data/product-error') {
      status = 'failed';
      lastError = delta.error?.message ?? 'Product stream failed.';
      return;
    }

    throw new TypeError(`Unsupported star product delta type: ${delta.type}`);
  }

  /**
   * @param {Iterable<StarObjectBatchProduct>} nextProducts
   */
  function setProducts(nextProducts) {
    assertActive();
    clearProducts();
    for (const product of nextProducts) {
      upsertProduct(product);
    }
    status = products.size > 0 ? 'streaming' : 'idle';
  }

  function clear() {
    assertActive();
    clearProducts();
    status = 'idle';
    lastError = null;
    lastCurrentRevision = null;
  }

  /**
   * @param {Partial<ThreeStarFieldView>} nextView
   */
  function setView(nextView) {
    assertActive();
    view = normalizeView({
      ...view,
      ...nextView,
      observerPosition: nextView.observerPosition ?? view.observerPosition,
    });
    object3d.scale.setScalar(view.renderScale);
    materialProfile.updateUniforms?.({ view });
    syncHaloVisibility();
  }

  /**
   * @param {THREE.Ray | { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } }} ray
   * @param {ThreeStarFieldPickOptions} [pickOptions]
   * @returns {ThreeStarFieldPickResult | null}
   */
  function pick(ray, pickOptions = {}) {
    assertActive();
    return pickThreeStarFieldData(ray, {
      products: Array.from(products.values()).map((record) => record.product),
      object3d,
      view,
    }, pickOptions);
  }

  function getSnapshot() {
    let starCount = 0;
    let bytes = 0;
    let renderObjectCount = 0;
    for (const record of products.values()) {
      starCount += record.product.count;
      bytes += record.product.memory?.bytes ?? 0;
      renderObjectCount += 1 + (record.haloPoints ? 1 : 0);
    }
    return {
      status: disposed ? 'disposed' : status,
      productCount: products.size,
      starCount,
      renderObjectCount,
      bytes,
      disposed,
      view: cloneView(view),
      lastError,
      lastCurrentRevision,
    };
  }

  function dispose() {
    if (disposed) return;
    clearProducts();
    if (disposeMaterialProfile) {
      materialProfile.dispose();
    }
    disposed = true;
    status = 'disposed';
  }

  /**
   * @param {StarObjectBatchProduct} product
   */
  function upsertProduct(product) {
    if (!product || typeof product.id !== 'string') {
      throw new TypeError('ThreeStarField product upsert requires a StarObjectBatchProduct.');
    }

    removeProduct(product.id);
    const geometry = createThreeStarFieldGeometryFromProduct(product);
    const points = new THREE.Points(geometry, materialProfile.material);
    points.name = `${fieldId}:${product.id}:points`;
    points.frustumCulled = frustumCulled;
    points.userData.productId = product.id;
    object3d.add(points);

    const haloPoints = materialProfile.haloMaterial
      ? new THREE.Points(geometry, materialProfile.haloMaterial)
      : null;
    if (haloPoints) {
      haloPoints.name = `${fieldId}:${product.id}:halo`;
      haloPoints.frustumCulled = frustumCulled;
      haloPoints.visible = view.halo;
      haloPoints.userData.productId = product.id;
      object3d.add(haloPoints);
    }

    products.set(product.id, {
      product,
      geometry,
      points,
      haloPoints,
    });
  }

  /**
   * @param {string} productId
   */
  function removeProduct(productId) {
    const record = products.get(productId);
    if (!record) return;
    object3d.remove(record.points);
    if (record.haloPoints) {
      object3d.remove(record.haloPoints);
    }
    record.geometry.dispose();
    products.delete(productId);
  }

  function clearProducts() {
    for (const productId of Array.from(products.keys())) {
      removeProduct(productId);
    }
  }

  function syncHaloVisibility() {
    for (const record of products.values()) {
      if (record.haloPoints) {
        record.haloPoints.visible = view.halo;
      }
    }
  }

  function assertActive() {
    if (disposed) {
      throw new Error('ThreeStarField is disposed.');
    }
  }
}

/**
 * @param {StarObjectBatchProduct} product
 * @returns {THREE.BufferGeometry}
 */
export function createThreeStarFieldGeometryFromProduct(product) {
  const geometry = new THREE.BufferGeometry();
  const positions = product.coordinates.primary.components;
  const teffLog8 = product.attributes.teffLog8?.values ?? createFallbackTeff(product.count);
  const magAbs = product.attributes.magAbs?.values ?? createFallbackMagAbs(product.count);

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('teff_log8', new THREE.BufferAttribute(teffLog8, 1, true));
  geometry.setAttribute('magAbs', new THREE.BufferAttribute(magAbs, 1));
  geometry.setDrawRange(0, product.count);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * @param {Partial<ThreeStarFieldView>} [options]
 * @returns {ThreeStarFieldMaterialProfile}
 */
export function createDefaultThreeStarFieldMaterialProfile(options = {}) {
  const view = normalizeView(options);
  const material = new THREE.ShaderMaterial({
    uniforms: createBaseUniforms(view),
    vertexShader: STAR_FIELD_VERTEX_SHADER,
    fragmentShader: STAR_FIELD_FRAGMENT_SHADER,
    transparent: true,
    alphaTest: 0.003,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: createHaloUniforms(view),
    vertexShader: STAR_FIELD_HALO_VERTEX_SHADER,
    fragmentShader: STAR_FIELD_HALO_FRAGMENT_SHADER,
    transparent: true,
    alphaTest: 0.003,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return {
    material,
    haloMaterial,
    updateUniforms(context = { view }) {
      const nextView = normalizeView(context.view);
      syncBaseUniforms(material.uniforms, nextView);
      syncHaloUniforms(haloMaterial.uniforms, nextView);
    },
    dispose() {
      material.dispose();
      haloMaterial.dispose();
    },
  };
}

/**
 * @param {ThreeStarFieldVisualRadiusInput} input
 */
export function computeThreeStarFieldVisualRadiusPx(input) {
  const view = normalizeView(input);
  const mApp = Number.isFinite(input.apparentMagnitude)
    ? Number(input.apparentMagnitude)
    : Number.isFinite(input.magAbs) && Number.isFinite(input.distancePc)
      ? apparentMagnitude({
        magAbs: Number(input.magAbs),
        distancePc: Number(input.distancePc),
      })
      : Number.NaN;

  if (!Number.isFinite(mApp)) return 0;

  const fade = computeMagnitudeFade(mApp, view.limitingMagnitude, view.magFadeRange);
  if (fade <= 0) return 0;

  const flux = Math.pow(10, -0.4 * mApp);
  const sizeSignal = Math.max(
    Math.pow(1 + Math.max(flux * view.exposure, 0), view.sizePower) - 1,
    0,
  );
  return Math.min(
    Math.max(view.baseSize + view.sizeScale * sizeSignal, 0),
    view.sizeMax,
  ) * fade;
}

/**
 * @param {THREE.Ray | { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } }} ray
 * @param {ThreeStarFieldPickData} data
 * @param {ThreeStarFieldPickOptions} [options]
 * @returns {ThreeStarFieldPickResult | null}
 */
export function pickThreeStarFieldData(ray, data, options = {}) {
  if (!data || !data.products) {
    throw new TypeError('pickThreeStarFieldData() requires products.');
  }

  const view = normalizeView({
    ...(data.view ?? {}),
    ...options,
    observerPosition: options.observerPosition ?? data.view?.observerPosition,
  });
  const localRay = createLocalRay(ray, data.object3d);
  const toleranceDeg = normalizePositiveNumber(
    options.toleranceDeg,
    DEFAULT_PICK_TOLERANCE_DEG,
  );
  const minClickRadiusDeg = normalizePositiveNumber(
    options.minClickRadiusDeg,
    DEFAULT_MIN_CLICK_RADIUS_DEG,
  );
  const toleranceRad = toleranceDeg * DEG_TO_RAD;
  const tanTolerance = Math.tan(toleranceRad);
  const minClickRadiusRad = minClickRadiusDeg * DEG_TO_RAD;
  const pixelsPerRadian = Number.isFinite(options.fovRad) &&
    Number(options.fovRad) > 0 &&
    Number.isFinite(options.viewportHeight) &&
    Number(options.viewportHeight) > 0
    ? Number(options.viewportHeight) / (2 * Math.tan(Number(options.fovRad) / 2))
    : 0;

  /** @type {ThreeStarFieldPickResult | null} */
  let best = null;

  for (const product of data.products) {
    const positions = product.coordinates.primary.components;
    const magAbs = product.attributes.magAbs?.values;
    const teffLog8 = product.attributes.teffLog8?.values;

    for (let objectIndex = 0; objectIndex < product.count; objectIndex += 1) {
      const positionIndex = objectIndex * 3;
      const px = positions[positionIndex] ?? 0;
      const py = positions[positionIndex + 1] ?? 0;
      const pz = positions[positionIndex + 2] ?? 0;
      const vx = px - localRay.origin.x;
      const vy = py - localRay.origin.y;
      const vz = pz - localRay.origin.z;
      const alongRay =
        vx * localRay.direction.x +
        vy * localRay.direction.y +
        vz * localRay.direction.z;
      if (alongRay <= 0) continue;

      const distSq = vx * vx + vy * vy + vz * vz;
      const perpDistSq = Math.max(distSq - alongRay * alongRay, 0);
      const coneRadius = alongRay * tanTolerance;
      if (perpDistSq > coneRadius * coneRadius) continue;

      const distanceUnits = Math.sqrt(distSq);
      const distancePc = distanceUnits / view.coordinateUnitsPerParsec;
      const absoluteMag = magAbs?.[objectIndex];
      if (!Number.isFinite(absoluteMag)) continue;
      const apparentMag = apparentMagnitude({
        magAbs: Number(absoluteMag),
        distancePc,
      });
      const visualRadiusPx = computeThreeStarFieldVisualRadiusPx({
        ...view,
        apparentMagnitude: apparentMag,
      });
      if (visualRadiusPx <= 0) continue;

      const perpDist = Math.sqrt(perpDistSq);
      const angularDistanceRad = Math.atan2(perpDist, alongRay);
      const visualAngularRadius = pixelsPerRadian > 0
        ? Math.max(visualRadiusPx / pixelsPerRadian, minClickRadiusRad)
        : minClickRadiusRad;
      const score = angularDistanceRad / visualAngularRadius;

      if (!best || score < best.score) {
        best = {
          productId: product.id,
          objectIndex,
          product,
          position: { x: px, y: py, z: pz },
          distancePc,
          apparentMagnitude: apparentMag,
          visualRadiusPx,
          objectRef: product.refs?.[objectIndex] ?? null,
          pickMeta: product.pickMeta?.[objectIndex] ?? null,
          ...(teffLog8 ? { teffLog8: teffLog8[objectIndex] } : {}),
          magAbs: Number(absoluteMag),
          score,
          angularDistanceDeg: angularDistanceRad * RAD_TO_DEG,
        };
      }
    }
  }

  return best;
}

/**
 * @typedef {'idle' | 'streaming' | 'current' | 'failed' | 'disposed'} ThreeStarFieldSnapshotStatus
 */

/**
 * @param {THREE.Material | ThreeStarFieldMaterialProfile} profile
 * @returns {Required<ThreeStarFieldMaterialProfile>}
 */
function normalizeMaterialProfile(profile) {
  if (profile instanceof THREE.Material) {
    return {
      material: profile,
      haloMaterial: null,
      updateUniforms: () => {},
      dispose: () => {
        profile.dispose();
      },
    };
  }
  if (!profile?.material || !(profile.material instanceof THREE.Material)) {
    throw new TypeError('ThreeStarField material profile requires a THREE.Material.');
  }

  const haloMaterial = profile.haloMaterial instanceof THREE.Material
    ? profile.haloMaterial
    : null;
  return {
    material: profile.material,
    haloMaterial,
    updateUniforms: typeof profile.updateUniforms === 'function'
      ? profile.updateUniforms.bind(profile)
      : () => {},
    dispose: typeof profile.dispose === 'function'
      ? profile.dispose.bind(profile)
      : () => {
        profile.material.dispose();
        haloMaterial?.dispose();
      },
  };
}

/**
 * @param {Partial<ThreeStarFieldView>} input
 * @returns {ThreeStarFieldView}
 */
function normalizeView(input = {}) {
  const defaults = DEFAULT_THREE_STAR_FIELD_VIEW;
  return {
    observerPosition: normalizeVector(input.observerPosition, defaults.observerPosition),
    limitingMagnitude: normalizeFiniteNumber(input.limitingMagnitude, defaults.limitingMagnitude),
    coordinateUnitsPerParsec: normalizePositiveNumber(
      input.coordinateUnitsPerParsec,
      defaults.coordinateUnitsPerParsec,
    ),
    renderScale: normalizePositiveNumber(input.renderScale, defaults.renderScale),
    exposure: normalizePositiveNumber(input.exposure, defaults.exposure),
    magFadeRange: Math.max(0, normalizeFiniteNumber(input.magFadeRange, defaults.magFadeRange)),
    baseSize: Math.max(0, normalizeFiniteNumber(input.baseSize, defaults.baseSize)),
    sizeScale: Math.max(0, normalizeFiniteNumber(input.sizeScale, defaults.sizeScale)),
    sizePower: Math.max(0, normalizeFiniteNumber(input.sizePower, defaults.sizePower)),
    sizeMax: normalizePositiveNumber(input.sizeMax, defaults.sizeMax),
    halo: input.halo !== undefined ? input.halo !== false : defaults.halo,
    haloScale: Math.max(0, normalizeFiniteNumber(input.haloScale, defaults.haloScale)),
    haloPower: Math.max(0, normalizeFiniteNumber(input.haloPower, defaults.haloPower)),
    haloSizeMax: normalizePositiveNumber(input.haloSizeMax, defaults.haloSizeMax),
  };
}

/**
 * @param {ThreeStarFieldView} view
 */
function cloneView(view) {
  return {
    ...view,
    observerPosition: { ...view.observerPosition },
  };
}

/**
 * @param {unknown} value
 * @param {{ x: number; y: number; z: number }} fallback
 */
function normalizeVector(value, fallback) {
  if (!value || typeof value !== 'object') return { ...fallback };
  const vector = /** @type {{ x?: unknown; y?: unknown; z?: unknown }} */ (value);
  return {
    x: normalizeFiniteNumber(vector.x, fallback.x),
    y: normalizeFiniteNumber(vector.y, fallback.y),
    z: normalizeFiniteNumber(vector.z, fallback.z),
  };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizeFiniteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function normalizePositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

/**
 * @param {number} mag
 * @param {number} limit
 * @param {number} range
 */
function computeMagnitudeFade(mag, limit, range) {
  if (!(range > 0)) return mag <= limit ? 1 : 0;
  return 1 - smoothstep(limit - range, limit, mag);
}

/**
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} value
 */
function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * @param {number} count
 */
function createFallbackTeff(count) {
  return new Uint8Array(Math.max(0, count)).fill(SOLAR_TEFF_LOG8);
}

/**
 * @param {number} count
 */
function createFallbackMagAbs(count) {
  return new Float32Array(Math.max(0, count)).fill(HIDDEN_MAG_ABS);
}

/**
 * @param {ThreeStarFieldView} view
 */
function createBaseUniforms(view) {
  const uniforms = {
    uObserverPosition: { value: new THREE.Vector3() },
    uCoordinateUnitsPerParsec: { value: 1 },
    uLimitingMagnitude: { value: 6.5 },
    uMagFadeRange: { value: 3 },
    uExposure: { value: 2500 },
    uBaseSize: { value: 0.9 },
    uSizeScale: { value: 3 },
    uSizePower: { value: 0.32 },
    uSizeMax: { value: 384 },
  };
  syncBaseUniforms(uniforms, view);
  return uniforms;
}

/**
 * @param {ThreeStarFieldView} view
 */
function createHaloUniforms(view) {
  const uniforms = {
    ...createBaseUniforms(view),
    uHaloScale: { value: 1.5 },
    uHaloPower: { value: 0.22 },
    uHaloSizeMax: { value: 1024 },
  };
  syncHaloUniforms(uniforms, view);
  return uniforms;
}

/**
 * @param {Record<string, { value: unknown }>} uniforms
 * @param {ThreeStarFieldView} view
 */
function syncBaseUniforms(uniforms, view) {
  /** @type {THREE.Vector3} */ (uniforms.uObserverPosition.value)
    .set(view.observerPosition.x, view.observerPosition.y, view.observerPosition.z);
  uniforms.uCoordinateUnitsPerParsec.value = view.coordinateUnitsPerParsec;
  uniforms.uLimitingMagnitude.value = view.limitingMagnitude;
  uniforms.uMagFadeRange.value = view.magFadeRange;
  uniforms.uExposure.value = view.exposure;
  uniforms.uBaseSize.value = view.baseSize;
  uniforms.uSizeScale.value = view.sizeScale;
  uniforms.uSizePower.value = view.sizePower;
  uniforms.uSizeMax.value = view.sizeMax;
}

/**
 * @param {Record<string, { value: unknown }>} uniforms
 * @param {ThreeStarFieldView} view
 */
function syncHaloUniforms(uniforms, view) {
  syncBaseUniforms(uniforms, view);
  uniforms.uHaloScale.value = view.haloScale;
  uniforms.uHaloPower.value = view.haloPower;
  uniforms.uHaloSizeMax.value = view.haloSizeMax;
}

/**
 * @param {THREE.Ray | { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } }} ray
 * @param {THREE.Object3D | undefined} object3d
 */
function createLocalRay(ray, object3d) {
  const origin = new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z);
  const direction = new THREE.Vector3(ray.direction.x, ray.direction.y, ray.direction.z).normalize();

  if (object3d) {
    object3d.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(object3d.matrixWorld).invert();
    origin.applyMatrix4(inverse);
    direction.transformDirection(inverse).normalize();
  }

  return { origin, direction };
}

const STAR_FIELD_SHARED_VERTEX = /* glsl */ `
  attribute float teff_log8;
  attribute float magAbs;

  uniform vec3 uObserverPosition;
  uniform float uCoordinateUnitsPerParsec;
  uniform float uLimitingMagnitude;
  uniform float uMagFadeRange;
  uniform float uExposure;

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

  float smoothMagnitudeFade(float mApp) {
    if (uMagFadeRange <= 0.0) {
      return mApp <= uLimitingMagnitude ? 1.0 : 0.0;
    }
    return 1.0 - smoothstep(uLimitingMagnitude - uMagFadeRange, uLimitingMagnitude, mApp);
  }

  float apparentFlux(float mApp) {
    return pow(10.0, -0.4 * mApp);
  }

  void computeStarBase(
    out float apparentMag,
    out float flux,
    out float fade,
    out vec3 color
  ) {
    float distanceUnits = max(length(position - uObserverPosition), 0.000001);
    float distancePc = max(distanceUnits / max(uCoordinateUnitsPerParsec, 0.000001), 0.000001);
    apparentMag = magAbs + 5.0 * (log(distancePc) / log(10.0) - 1.0);
    flux = apparentFlux(apparentMag);
    fade = smoothMagnitudeFade(apparentMag);
    color = blackbodyToRGB(decodeTemperature(teff_log8));
  }
`;

const STAR_FIELD_VERTEX_SHADER = STAR_FIELD_SHARED_VERTEX + /* glsl */ `
  uniform float uBaseSize;
  uniform float uSizeScale;
  uniform float uSizePower;
  uniform float uSizeMax;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vWhiteMix;

  void main() {
    float apparentMag;
    float flux;
    float fade;
    vec3 color;
    computeStarBase(apparentMag, flux, fade, color);

    float sizeSignal = max(pow(1.0 + max(flux * uExposure, 0.0), uSizePower) - 1.0, 0.0);
    gl_PointSize = fade > 0.0 ? clamp(uBaseSize + uSizeScale * sizeSignal, 0.0, uSizeMax) : 0.0;
    vColor = color;
    vAlpha = fade * clamp(1.0 - exp(-flux * uExposure), 0.05, 1.0);
    vWhiteMix = clamp(0.15 + 0.1 * sizeSignal, 0.0, 0.85);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_FIELD_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vWhiteMix;

  void main() {
    if (vAlpha <= 0.0) discard;
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    float core = exp(-dist * 18.0);
    float soft = 1.0 - smoothstep(0.1, 0.5, dist);
    float alpha = max(core, soft * 0.35) * vAlpha;
    if (alpha < 0.003) discard;
    vec3 color = mix(vColor, vec3(1.0), core * vWhiteMix);
    gl_FragColor = vec4(color, alpha);
  }
`;

const STAR_FIELD_HALO_VERTEX_SHADER = STAR_FIELD_SHARED_VERTEX + /* glsl */ `
  uniform float uBaseSize;
  uniform float uSizeScale;
  uniform float uSizePower;
  uniform float uSizeMax;
  uniform float uHaloScale;
  uniform float uHaloPower;
  uniform float uHaloSizeMax;

  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float apparentMag;
    float flux;
    float fade;
    vec3 color;
    computeStarBase(apparentMag, flux, fade, color);

    float sizeSignal = max(pow(1.0 + max(flux * uExposure, 0.0), uSizePower) - 1.0, 0.0);
    float haloSignal = max(pow(1.0 + max(flux * uExposure, 0.0), uHaloPower) - 1.0, 0.0);
    float coreSize = clamp(uBaseSize + uSizeScale * sizeSignal, 0.0, uSizeMax);
    gl_PointSize = fade > 0.0 ? clamp(coreSize * (1.0 + uHaloScale * haloSignal), 0.0, uHaloSizeMax) : 0.0;
    vColor = color;
    vAlpha = fade * clamp(1.0 - exp(-flux * uExposure * 0.18), 0.0, 0.55);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_FIELD_HALO_FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.0) discard;
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * vAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;
