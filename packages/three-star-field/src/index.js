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
  sizeFluxScale: 2500,
  sizeScale: 3,
  sizePower: 0.32,
  sizeMax: 384,
  halo: true,
  haloScale: 1.5,
  haloPower: 0.22,
  haloSizeMax: 1024,
  extinctionScale: 1,
  nearMagLimitFloor: 25,
  nearMagLimitRadiusPc: 0,
  nearMagLimitFeatherPc: 0.25,
  nearSizeFloor: 0,
  nearAlphaFloor: 0,
});

const SOLAR_TEFF_LOG8 = 255;
const HIDDEN_MAG_ABS = 99;
const DEFAULT_PICK_TOLERANCE_DEG = 3;
const DEFAULT_MIN_CLICK_RADIUS_DEG = 0.15;
const DEFAULT_VR_EXPOSURE = 100_000;
const DEFAULT_VR_SIZE_MIN = 1;
const DEFAULT_VR_SIZE_MAX = 8;
const DEFAULT_VR_HYPERLOCAL_SIZE_MAX = 64;
const DEFAULT_VR_MAG_LIMIT_NEAR = 25;
const DEFAULT_VR_NEAR_DISTANCE_LO = 4;
const DEFAULT_VR_NEAR_DISTANCE_HI = 15;
const DEFAULT_VR_SAFE_MIN_SIZE = 4;
const DEFAULT_VR_NEARFIELD_RADIUS_PC = 5;
const DEFAULT_VR_NEARFIELD_MIN_INTENSITY = 0.15;
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
  const pointTexture = createCircleTexture();
  const haloTexture = createBigHaloTexture();
  const material = new THREE.ShaderMaterial({
    uniforms: createTunedPointUniforms(view, pointTexture),
    vertexShader: TUNED_STAR_FIELD_VERTEX_SHADER,
    fragmentShader: TUNED_STAR_FIELD_FRAGMENT_SHADER,
    transparent: true,
    alphaTest: 0.003,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: createTunedHaloUniforms(view, haloTexture),
    vertexShader: TUNED_STAR_FIELD_HALO_VERTEX_SHADER,
    fragmentShader: TUNED_STAR_FIELD_HALO_FRAGMENT_SHADER,
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
      syncTunedUniforms(material.uniforms, nextView);
      syncTunedUniforms(haloMaterial.uniforms, nextView);
    },
    dispose() {
      material.dispose();
      haloMaterial.dispose();
      pointTexture.dispose();
      haloTexture.dispose();
    },
  };
}

/**
 * @param {Partial<ThreeStarFieldView>} [options]
 * @returns {ThreeStarFieldMaterialProfile}
 */
export function createVrThreeStarFieldMaterialProfile(options = {}) {
  const view = normalizeView({
    exposure: DEFAULT_VR_EXPOSURE,
    sizeMax: DEFAULT_VR_SIZE_MAX,
    ...options,
  });
  const texture = createCircleTexture();
  const material = new THREE.ShaderMaterial({
    uniforms: createVrUniforms(view, texture, options),
    vertexShader: VR_STAR_FIELD_VERTEX_SHADER,
    fragmentShader: VR_STAR_FIELD_FRAGMENT_SHADER,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return {
    material,
    haloMaterial: null,
    updateUniforms(context = { view }) {
      syncVrUniforms(material.uniforms, normalizeView(context.view));
    },
    dispose() {
      material.dispose();
      texture.dispose();
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

  const effectiveLimit = computeEffectiveMagnitudeLimit(view.limitingMagnitude, input.distancePc, view);
  const fade = computeMagnitudeFade(mApp, effectiveLimit, view.magFadeRange);
  if (fade <= 0) return 0;

  const flux = Math.pow(10, -0.4 * mApp);
  const sizeSignal = Math.max(
    Math.pow(1 + Math.max(flux * view.sizeFluxScale, 0), view.sizePower) - 1,
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
    sizeFluxScale: Math.max(0, normalizeFiniteNumber(input.sizeFluxScale, defaults.sizeFluxScale)),
    sizeScale: Math.max(0, normalizeFiniteNumber(input.sizeScale, defaults.sizeScale)),
    sizePower: Math.max(0, normalizeFiniteNumber(input.sizePower, defaults.sizePower)),
    sizeMax: normalizePositiveNumber(input.sizeMax, defaults.sizeMax),
    halo: input.halo !== undefined ? input.halo !== false : defaults.halo,
    haloScale: Math.max(0, normalizeFiniteNumber(input.haloScale, defaults.haloScale)),
    haloPower: Math.max(0, normalizeFiniteNumber(input.haloPower, defaults.haloPower)),
    haloSizeMax: normalizePositiveNumber(input.haloSizeMax, defaults.haloSizeMax),
    extinctionScale: normalizeFiniteNumber(input.extinctionScale, defaults.extinctionScale),
    nearMagLimitFloor: normalizeFiniteNumber(input.nearMagLimitFloor, defaults.nearMagLimitFloor),
    nearMagLimitRadiusPc: Math.max(0, normalizeFiniteNumber(input.nearMagLimitRadiusPc, defaults.nearMagLimitRadiusPc)),
    nearMagLimitFeatherPc: Math.max(0, normalizeFiniteNumber(input.nearMagLimitFeatherPc, defaults.nearMagLimitFeatherPc)),
    nearSizeFloor: Math.max(0, normalizeFiniteNumber(input.nearSizeFloor, defaults.nearSizeFloor)),
    nearAlphaFloor: Math.max(0, normalizeFiniteNumber(input.nearAlphaFloor, defaults.nearAlphaFloor)),
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
 * @param {number} magLimit
 * @param {unknown} distancePc
 * @param {ThreeStarFieldView} view
 */
function computeEffectiveMagnitudeLimit(magLimit, distancePc, view) {
  const distance = Number(distancePc);
  if (!(Number.isFinite(distance) && view.nearMagLimitRadiusPc > 0)) return magLimit;
  const floorLimit = Math.max(view.nearMagLimitFloor, magLimit);
  if (!(floorLimit > magLimit)) return magLimit;
  const feather = Math.max(view.nearMagLimitFeatherPc, 0.0001);
  const blend = 1 - smoothstep(
    view.nearMagLimitRadiusPc,
    view.nearMagLimitRadiusPc + feather,
    distance,
  );
  return magLimit + (floorLimit - magLimit) * blend;
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
 * @param {THREE.Texture} texture
 */
function createTunedPointUniforms(view, texture) {
  const uniforms = {
    uObserverPosition: { value: new THREE.Vector3() },
    uScale: { value: 1 },
    uMagLimit: { value: 6.5 },
    uMagFadeRange: { value: 3 },
    uExtinctionScale: { value: 1 },
    uExposure: { value: 2500 },
    uSizeFluxScale: { value: 2500 },
    uBaseSize: { value: 0.9 },
    uSizeScale: { value: 3 },
    uSizePower: { value: 0.32 },
    uSizeMax: { value: 384 },
    uNearMagLimitFloor: { value: 25 },
    uNearMagLimitRadiusPc: { value: 0 },
    uNearMagLimitFeatherPc: { value: 0.25 },
    uNearSizeFloor: { value: 0 },
    uNearAlphaFloor: { value: 0 },
    map: { value: texture },
  };
  syncTunedUniforms(uniforms, view);
  return uniforms;
}

/**
 * @param {ThreeStarFieldView} view
 * @param {THREE.Texture} texture
 */
function createTunedHaloUniforms(view, texture) {
  const uniforms = {
    uObserverPosition: { value: new THREE.Vector3() },
    uScale: { value: 1 },
    uMagLimit: { value: 6.5 },
    uMagFadeRange: { value: 3 },
    uExtinctionScale: { value: 1 },
    uExposure: { value: 2500 },
    uSizeFluxScale: { value: 2500 },
    uBaseSize: { value: 0.9 },
    uSizeScale: { value: 3 },
    uSizePower: { value: 0.32 },
    uSizeMax: { value: 384 },
    uGlowScale: { value: 1.5 },
    uGlowPower: { value: 0.22 },
    uHaloSizeMax: { value: 1024 },
    uNearMagLimitFloor: { value: 25 },
    uNearMagLimitRadiusPc: { value: 0 },
    uNearMagLimitFeatherPc: { value: 0.25 },
    map: { value: texture },
  };
  syncTunedUniforms(uniforms, view);
  return uniforms;
}

/**
 * @param {Record<string, { value: unknown }>} uniforms
 * @param {ThreeStarFieldView} view
 */
function syncTunedUniforms(uniforms, view) {
  /** @type {THREE.Vector3} */ (uniforms.uObserverPosition.value)
    .set(view.observerPosition.x, view.observerPosition.y, view.observerPosition.z);
  uniforms.uScale.value = view.coordinateUnitsPerParsec;
  uniforms.uMagLimit.value = view.limitingMagnitude;
  uniforms.uMagFadeRange.value = view.magFadeRange;
  uniforms.uExtinctionScale.value = view.extinctionScale;
  uniforms.uExposure.value = view.exposure;
  uniforms.uSizeFluxScale.value = view.sizeFluxScale;
  uniforms.uBaseSize.value = view.baseSize;
  uniforms.uSizeScale.value = view.sizeScale;
  uniforms.uSizePower.value = view.sizePower;
  uniforms.uSizeMax.value = view.sizeMax;
  if (uniforms.uGlowScale) uniforms.uGlowScale.value = view.haloScale;
  if (uniforms.uGlowPower) uniforms.uGlowPower.value = view.haloPower;
  if (uniforms.uHaloSizeMax) uniforms.uHaloSizeMax.value = view.haloSizeMax;
  if (uniforms.uNearMagLimitFloor) uniforms.uNearMagLimitFloor.value = view.nearMagLimitFloor;
  if (uniforms.uNearMagLimitRadiusPc) uniforms.uNearMagLimitRadiusPc.value = view.nearMagLimitRadiusPc;
  if (uniforms.uNearMagLimitFeatherPc) uniforms.uNearMagLimitFeatherPc.value = view.nearMagLimitFeatherPc;
  if (uniforms.uNearSizeFloor) uniforms.uNearSizeFloor.value = view.nearSizeFloor;
  if (uniforms.uNearAlphaFloor) uniforms.uNearAlphaFloor.value = view.nearAlphaFloor;
}

/**
 * @param {ThreeStarFieldView} view
 * @param {THREE.Texture} texture
 * @param {Partial<ThreeStarFieldView> & Record<string, unknown>} options
 */
function createVrUniforms(view, texture, options) {
  const uniforms = {
    uSizeMin: { value: Number(options.sizeMin) || DEFAULT_VR_SIZE_MIN },
    uSizeMax: { value: view.sizeMax || DEFAULT_VR_SIZE_MAX },
    uScale: { value: view.coordinateUnitsPerParsec },
    uMagLimit: { value: view.limitingMagnitude },
    uMagLimitNear: { value: Number(options.magLimitNear) || DEFAULT_VR_MAG_LIMIT_NEAR },
    uNearDistanceLo: { value: Number(options.nearDistanceLo) || DEFAULT_VR_NEAR_DISTANCE_LO },
    uNearDistanceHi: { value: Number(options.nearDistanceHi) || DEFAULT_VR_NEAR_DISTANCE_HI },
    uObserverPosition: { value: new THREE.Vector3() },
    uClipMargin: { value: Number(options.clipMargin) || 1 },
    uExposure: { value: view.exposure },
    uSafeMinSize: { value: Number(options.safeMinSize) || DEFAULT_VR_SAFE_MIN_SIZE },
    uMagFadeRange: { value: view.magFadeRange },
    uExtinctionScale: { value: view.extinctionScale },
    uTime: { value: 0 },
    uHyperlocalSizeMax: { value: Number(options.hyperlocalSizeMax) || DEFAULT_VR_HYPERLOCAL_SIZE_MAX },
    uNearfieldRadiusPc: { value: Number(options.nearfieldRadiusPc) || DEFAULT_VR_NEARFIELD_RADIUS_PC },
    uNearfieldMinIntensity: { value: Number(options.nearfieldMinIntensity) || DEFAULT_VR_NEARFIELD_MIN_INTENSITY },
    map: { value: texture },
  };
  syncVrUniforms(uniforms, view);
  return uniforms;
}

/**
 * @param {Record<string, { value: unknown }>} uniforms
 * @param {ThreeStarFieldView} view
 */
function syncVrUniforms(uniforms, view) {
  /** @type {THREE.Vector3} */ (uniforms.uObserverPosition.value)
    .set(view.observerPosition.x, view.observerPosition.y, view.observerPosition.z);
  uniforms.uScale.value = view.coordinateUnitsPerParsec;
  uniforms.uMagLimit.value = view.limitingMagnitude;
  uniforms.uMagFadeRange.value = view.magFadeRange;
  uniforms.uExtinctionScale.value = view.extinctionScale;
  uniforms.uExposure.value = view.exposure;
}

function createCircleTexture() {
  return createRadialTexture(64, [
    [0, [255, 255, 255, 255]],
    [0.12, [255, 255, 255, 230]],
    [0.28, [255, 255, 255, 64]],
    [0.45, [255, 255, 255, 0]],
    [1, [255, 255, 255, 0]],
  ]);
}

function createBigHaloTexture() {
  return createRadialTexture(128, [
    [0, [255, 255, 255, 115]],
    [0.08, [255, 255, 255, 64]],
    [0.25, [255, 255, 255, 15]],
    [0.5, [255, 255, 255, 4]],
    [1, [255, 255, 255, 0]],
  ]);
}

/**
 * @param {number} size
 * @param {Array<[number, [number, number, number, number]]>} stops
 */
function createRadialTexture(size, stops) {
  const documentRef = globalThis.document;
  if (documentRef?.createElement) {
    const canvas = documentRef.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [offset, rgba] of stops) {
      gradient.addColorStop(offset, `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3] / 255})`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - half;
      const dy = y - half;
      const r = Math.min(Math.hypot(dx, dy) / half, 1);
      const color = sampleRadialStops(stops, r);
      const offset = (y * size + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * @param {Array<[number, [number, number, number, number]]>} stops
 * @param {number} r
 */
function sampleRadialStops(stops, r) {
  let previous = stops[0];
  for (let index = 1; index < stops.length; index += 1) {
    const next = stops[index];
    if (r <= next[0]) {
      const span = Math.max(next[0] - previous[0], 1e-6);
      const t = Math.min(Math.max((r - previous[0]) / span, 0), 1);
      return previous[1].map((value, component) => Math.round(value + (next[1][component] - value) * t));
    }
    previous = next;
  }
  return previous[1];
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

const TUNED_STAR_FIELD_SHARED_VERTEX = /* glsl */ `
  attribute float teff_log8;
  attribute float magAbs;

  uniform vec3 uObserverPosition;
  uniform float uScale;
  uniform float uMagLimit;
  uniform float uMagFadeRange;
  uniform float uExtinctionScale;
  uniform float uExposure;
  uniform float uSizeFluxScale;
  uniform float uNearMagLimitFloor;
  uniform float uNearMagLimitRadiusPc;
  uniform float uNearMagLimitFeatherPc;

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

  float apparentFluxFromMagnitude(float mApp) {
    return pow(10.0, -0.4 * mApp);
  }

  float fluxSignal(float flux, float power) {
    return max(pow(1.0 + max(flux, 0.0), power) - 1.0, 0.0);
  }

  float brightnessSignal(float displayFlux) {
    return max(log(1.0 + max(displayFlux, 0.0)) / log(2.0), 0.0);
  }

  float nearDistanceBlend(float dPc) {
    if (!(uNearMagLimitRadiusPc > 0.0)) {
      return 0.0;
    }
    float feather = max(uNearMagLimitFeatherPc, 0.0001);
    return 1.0 - smoothstep(uNearMagLimitRadiusPc, uNearMagLimitRadiusPc + feather, dPc);
  }

  float effectiveMagnitudeLimit(float nearBlend) {
    float floorLimit = max(uNearMagLimitFloor, uMagLimit);
    if (!(floorLimit > uMagLimit)) {
      return uMagLimit;
    }
    return mix(uMagLimit, floorLimit, nearBlend);
  }

  float magnitudeFade(float mApp, float effectiveMagLimit) {
    return 1.0 - smoothstep(effectiveMagLimit - uMagFadeRange, effectiveMagLimit, mApp);
  }

  void computeStarBase(
    out float mApp,
    out float apparentFlux,
    out float displayFlux,
    out float fade,
    out float nearBlend,
    out vec3 color
  ) {
    float distanceUnits = max(length(position - uObserverPosition), 0.000001);
    float dPc = max(distanceUnits / max(uScale, 0.000001), 0.001);
    nearBlend = nearDistanceBlend(dPc);
    float effectiveMagLimit = effectiveMagnitudeLimit(nearBlend);
    mApp = magAbs + uExtinctionScale * (5.0 * log(dPc) / log(10.0) - 5.0);
    apparentFlux = apparentFluxFromMagnitude(mApp);
    displayFlux = apparentFlux * uExposure;
    fade = magnitudeFade(mApp, effectiveMagLimit);
    color = blackbodyToRGB(decodeTemperature(teff_log8));
  }
`;

const TUNED_STAR_FIELD_VERTEX_SHADER = TUNED_STAR_FIELD_SHARED_VERTEX + /* glsl */ `
  uniform float uBaseSize;
  uniform float uSizeScale;
  uniform float uSizePower;
  uniform float uSizeMax;
  uniform float uNearSizeFloor;
  uniform float uNearAlphaFloor;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vWhiteMix;

  void main() {
    float mApp, apparentFlux, displayFlux, fade, nearBlend;
    vec3 starColor;
    computeStarBase(mApp, apparentFlux, displayFlux, fade, nearBlend, starColor);
    vColor = starColor;

    float sizeSignal = fluxSignal(apparentFlux * max(uSizeFluxScale, 0.0), uSizePower);
    float radius = uBaseSize + uSizeScale * sizeSignal;
    radius = max(radius, max(uNearSizeFloor, 0.0) * nearBlend);
    gl_PointSize = clamp(radius, 0.0, uSizeMax);

    float alphaSignal = 1.0 - exp(-0.25 * brightnessSignal(displayFlux));
    vAlpha = fade * mix(0.18, 1.0, alphaSignal);
    vAlpha = max(vAlpha, fade * clamp(uNearAlphaFloor * nearBlend, 0.0, 1.0));
    vWhiteMix = clamp(0.2 + 0.12 * brightnessSignal(displayFlux), 0.0, 0.95);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TUNED_STAR_FIELD_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vWhiteMix;

  void main() {
    if (vAlpha <= 0.0) discard;
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    vec4 texColor = texture2D(map, gl_PointCoord);
    float core = exp(-dist * 18.0);
    float halo = texColor.a;
    vec3 finalColor = mix(vColor, vec3(1.0), core * vWhiteMix);
    float starAlpha = min(halo + core, 1.0) * vAlpha;
    if (starAlpha < 0.003) discard;
    gl_FragColor = vec4(finalColor, starAlpha);
  }
`;

const TUNED_STAR_FIELD_HALO_VERTEX_SHADER = TUNED_STAR_FIELD_SHARED_VERTEX + /* glsl */ `
  uniform float uBaseSize;
  uniform float uSizeScale;
  uniform float uSizePower;
  uniform float uSizeMax;
  uniform float uGlowScale;
  uniform float uGlowPower;
  uniform float uHaloSizeMax;

  varying vec3 vColor;
  varying float vHaloAlpha;

  void main() {
    float mApp, apparentFlux, displayFlux, fade, nearBlend;
    vec3 starColor;
    computeStarBase(mApp, apparentFlux, displayFlux, fade, nearBlend, starColor);
    vColor = starColor;

    float sizeSignal = fluxSignal(apparentFlux * max(uSizeFluxScale, 0.0), uSizePower);
    float coreSize = uBaseSize + uSizeScale * sizeSignal;
    float glowSignal = fluxSignal(apparentFlux * max(uSizeFluxScale, 0.0), uGlowPower);
    float haloSize = coreSize * (1.0 + uGlowScale * glowSignal);

    vHaloAlpha = fade * (1.0 - exp(-0.12 * brightnessSignal(displayFlux)));
    gl_PointSize = vHaloAlpha > 0.001 ? clamp(haloSize, 0.0, max(uHaloSizeMax, uSizeMax)) : 0.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TUNED_STAR_FIELD_HALO_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  varying vec3 vColor;
  varying float vHaloAlpha;

  void main() {
    if (vHaloAlpha <= 0.0) discard;
    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;
    vec4 texColor = texture2D(map, gl_PointCoord);
    float alpha = texColor.a * vHaloAlpha;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`;

const VR_STAR_FIELD_VERTEX_SHADER = /* glsl */ `
  attribute float teff_log8;
  attribute float magAbs;

  varying vec3 vColor;
  varying float vIntensity;
  varying float vCoronaStrength;

  uniform float uSizeMin;
  uniform float uSizeMax;
  uniform float uScale;
  uniform float uMagLimit;
  uniform float uMagLimitNear;
  uniform float uNearDistanceLo;
  uniform float uNearDistanceHi;
  uniform vec3 uObserverPosition;
  uniform float uClipMargin;
  uniform float uExposure;
  uniform float uSafeMinSize;
  uniform float uMagFadeRange;
  uniform float uExtinctionScale;
  uniform float uNearfieldRadiusPc;
  uniform float uNearfieldMinIntensity;
  uniform float uHyperlocalSizeMax;

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

  void main() {
    float d = max(length(position - uObserverPosition), 0.000001);
    float dPc = max(d / max(uScale, 0.000001), 0.001);
    float mApp = magAbs + uExtinctionScale * (5.0 * log(dPc) / log(10.0) - 5.0);

    float tempK = decodeTemperature(teff_log8);
    vColor = blackbodyToRGB(tempK);

    float t = smoothstep(uNearDistanceLo, uNearDistanceHi, dPc);
    float effectiveMagLimit = mix(uMagLimitNear, uMagLimit, t);
    float magDiff = effectiveMagLimit - mApp;
    float baseSize = pow(max(magDiff, 0.0), 1.2);

    float flux = pow(10.0, -0.4 * mApp);
    float rawEnergy = flux * uExposure;
    vIntensity = clamp(rawEnergy, 0.05, 1.0);

    float targetSize = baseSize + (flux * 0.5);
    float renderedSize = max(max(targetSize, uSizeMin), uSafeMinSize);
    if (targetSize < uSafeMinSize) {
      float areaRatio = (targetSize * targetSize) / (uSafeMinSize * uSafeMinSize);
      vIntensity *= areaRatio;
    }

    float hyperlocalFade = 1.0 - smoothstep(0.5, 2.0, dPc);
    float inverseDistBoost = min(1.0 / max(dPc, 0.01), 8.0);
    renderedSize *= mix(1.0, inverseDistBoost, hyperlocalFade);
    float effectiveSizeMax = mix(uSizeMax, uHyperlocalSizeMax, hyperlocalFade);

    float closeFade = 1.0 - smoothstep(1.0, 3.0, dPc);
    renderedSize *= 1.0 + closeFade;
    gl_PointSize = min(renderedSize, effectiveSizeMax);
    vCoronaStrength = max(hyperlocalFade, closeFade * max(0.5, smoothstep(1000.0, 50000.0, rawEnergy)));

    float nearfieldFade = 1.0 - smoothstep(0.0, uNearfieldRadiusPc, dPc);
    vIntensity = max(vIntensity, uNearfieldMinIntensity * nearfieldFade);

    float edgeFade = 1.0 - smoothstep(effectiveMagLimit - uMagFadeRange, effectiveMagLimit, mApp);
    vIntensity *= edgeFade;

    vec4 clipPos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    clipPos.xy *= uClipMargin;
    gl_Position = clipPos;
  }
`;

const VR_STAR_FIELD_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float uTime;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vCoronaStrength;

  void main() {
    if (vIntensity <= 0.0) discard;

    float dist = distance(gl_PointCoord, vec2(0.5));
    if (dist > 0.5) discard;

    vec4 texColor = texture2D(map, gl_PointCoord);
    float core = exp(-dist * 8.0);
    float halo = texColor.a;

    vec3 finalColor = mix(vColor, vec3(1.0), core);
    float wispyCorona = vCoronaStrength * 0.6 * exp(-2.0 * dist) * (1.0 - smoothstep(0.05, 0.6, dist));
    wispyCorona *= (0.9 + 0.1 * sin(uTime * 2.0 + dist * 8.0));
    finalColor += vColor * wispyCorona;

    float starAlpha = min(halo + core + wispyCorona, 1.0) * vIntensity;
    gl_FragColor = vec4(finalColor, starAlpha);
  }
`;
