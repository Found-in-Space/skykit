import * as THREE from 'three';
import {
  getHaTiledVolumeBrickBounds,
  loadHaTiledVolume,
} from '../dust/load-ha-tiled-volume.js';
import { SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_RAYMARCH_STEPS = 48;
const DEFAULT_GAIN = 7.0;
const DEFAULT_THRESHOLD = 0.02;
const DEFAULT_OPACITY = 0.85;
const DEFAULT_INITIAL_REQUEST_BRICKS_PER_UPDATE = 8;
const DEFAULT_FINAL_REQUEST_BRICKS_PER_UPDATE = 8;
const DEFAULT_INITIAL_UPLOAD_BRICKS_PER_UPDATE = 2;
const DEFAULT_FINAL_UPLOAD_BRICKS_PER_UPDATE = 1;
const DEFAULT_INITIAL_BATCH_MAX_BRICKS = 8;
const DEFAULT_FINAL_BATCH_MAX_BRICKS = 1;
const DEFAULT_MAX_RESIDENT_BRICKS = 128;
const DEFAULT_MAX_INFLIGHT_REQUESTS = 8;

function identityTransform(x, y, z) {
  return [x, y, z];
}

function normalizePositiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeFiniteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function maybeNotify(callback, payload) {
  if (typeof callback === 'function') {
    callback(payload);
  }
}

function createVolumePlacement(bounds, volumeToSceneTransform) {
  const extX = (bounds.maxX - bounds.minX) * SCALE;
  const extY = (bounds.maxY - bounds.minY) * SCALE;
  const extZ = (bounds.maxZ - bounds.minZ) * SCALE;
  const cenGalX = (bounds.minX + bounds.maxX) / 2;
  const cenGalY = (bounds.minY + bounds.maxY) / 2;
  const cenGalZ = (bounds.minZ + bounds.maxZ) / 2;
  const basisX = volumeToSceneTransform(1, 0, 0).map((v) => v / SCALE);
  const basisY = volumeToSceneTransform(0, 1, 0).map((v) => v / SCALE);
  const basisZ = volumeToSceneTransform(0, 0, 1).map((v) => v / SCALE);
  const [cx, cy, cz] = volumeToSceneTransform(cenGalX, cenGalY, cenGalZ);

  const rotBasis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...basisX).normalize(),
    new THREE.Vector3(...basisY).normalize(),
    new THREE.Vector3(...basisZ).normalize(),
  );
  return {
    boxSize: new THREE.Vector3(extX, extY, extZ),
    position: new THREE.Vector3(cx, cy, cz),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(rotBasis),
  };
}

function createDisplayVolumeTexture(dimension) {
  const texture = new THREE.Data3DTexture(null, dimension, dimension, dimension);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.source.dataReady = false;
  texture.needsUpdate = true;
  return texture;
}

function createCpuVolumeTexture(data, dimension) {
  const texture = new THREE.Data3DTexture(data, dimension, dimension, dimension);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  return texture;
}

function upsampleBrickInteriorNearest(decoded, brick, targetSampleSize) {
  const sourceSampleSize = brick.sampleSize;
  const sourceTextureSize = brick.textureSampleSize ?? sourceSampleSize;
  const haloCells = brick.tileHaloCells ?? 0;
  const factor = targetSampleSize / sourceSampleSize;
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(
      `Cannot upscale ${brick.levelId}:${brick.slotIndex} from ${sourceSampleSize} to ${targetSampleSize}`,
    );
  }

  const out = new Uint8Array(targetSampleSize ** 3);
  const row = new Uint8Array(targetSampleSize);
  for (let z = 0; z < sourceSampleSize; z += 1) {
    for (let y = 0; y < sourceSampleSize; y += 1) {
      const srcRowOffset = (
        ((z + haloCells) * sourceTextureSize + (y + haloCells))
        * sourceTextureSize
        + haloCells
      );
      for (let x = 0; x < sourceSampleSize; x += 1) {
        row.fill(decoded[srcRowOffset + x], x * factor, (x + 1) * factor);
      }

      for (let zRep = 0; zRep < factor; zRep += 1) {
        const dstZ = z * factor + zRep;
        for (let yRep = 0; yRep < factor; yRep += 1) {
          const dstY = y * factor + yRep;
          out.set(row, (dstZ * targetSampleSize + dstY) * targetSampleSize);
        }
      }
    }
  }
  return out;
}

function getFullVolumeBounds(volume) {
  const world = volume.manifest.world_bounds_pc ?? volume.worldBoundsPc;
  return {
    minX: Math.min(world.x[0], world.x[1]),
    maxX: Math.max(world.x[0], world.x[1]),
    minY: Math.min(world.y[0], world.y[1]),
    maxY: Math.max(world.y[0], world.y[1]),
    minZ: Math.min(world.z[0], world.z[1]),
    maxZ: Math.max(world.z[0], world.z[1]),
  };
}

export function createHaTiledVolumeMaterial(options = {}) {
  const raymarchSteps = normalizePositiveInteger(
    options.raymarchSteps,
    DEFAULT_RAYMARCH_STEPS,
  );
  const fragmentShader = /* glsl */ `
    precision highp float;
    precision highp sampler3D;

    uniform sampler3D uVolume;
    uniform float uGain;
    uniform float uThreshold;
    uniform float uOpacity;
    uniform int uSteps;
    uniform mat4 uInvModelMatrix;
    uniform vec3 uBoxSize;
    uniform float uSceneScale;
    uniform float uReferenceLengthPc;

    in vec3 vWorldPos;
    out vec4 fragColor;

    void main() {
      vec3 localPos = (uInvModelMatrix * vec4(vWorldPos, 1.0)).xyz;
      vec3 localCam = (uInvModelMatrix * vec4(cameraPosition, 1.0)).xyz;
      vec3 rayDir = normalize(localPos - localCam);
      vec3 safeDir = mix(vec3(1e-5), rayDir, step(vec3(1e-5), abs(rayDir)));

      vec3 halfSize = uBoxSize * 0.5;
      vec3 tMin = (-halfSize - localCam) / safeDir;
      vec3 tMax = ( halfSize - localCam) / safeDir;
      vec3 t1 = min(tMin, tMax);
      vec3 t2 = max(tMin, tMax);
      float tNear = max(max(t1.x, t1.y), t1.z);
      float tFar = min(min(t2.x, t2.y), t2.z);

      if (tNear > tFar) discard;
      tNear = max(tNear, 0.0);

      float stepSize = (tFar - tNear) / float(uSteps);
      float stepSizePc = stepSize / max(uSceneScale, 1e-9);
      if (stepSize <= 0.0 || stepSizePc <= 0.0) discard;

      float emission = 0.0;
      for (int i = 0; i < ${raymarchSteps}; i++) {
        if (i >= uSteps) break;

        float t = tNear + (float(i) + 0.5) * stepSize;
        vec3 pos = localCam + rayDir * t;
        vec3 uvw = pos / uBoxSize + 0.5;
        float raw = texture(uVolume, uvw).r;
        emission += max(raw - uThreshold, 0.0) * stepSizePc;
      }

      float signal = 1.0 - exp(-emission * uGain / max(uReferenceLengthPc, 1e-6));
      if (signal <= 0.002) discard;

      vec3 dim = vec3(0.50, 0.03, 0.015);
      vec3 hot = vec3(1.0, 0.42, 0.12);
      vec3 color = mix(dim, hot, smoothstep(0.02, 0.75, signal));
      float alpha = clamp(signal * uOpacity, 0.0, 0.9);
      fragColor = vec4(color * signal * uOpacity, alpha);
    }
  `;
  const vertexShader = /* glsl */ `
    out vec3 vWorldPos;

    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms: {
      uVolume: { value: options.texture ?? null },
      uGain: { value: normalizeFiniteNumber(options.gain, DEFAULT_GAIN) },
      uThreshold: { value: normalizeFiniteNumber(options.threshold, DEFAULT_THRESHOLD) },
      uOpacity: { value: normalizeFiniteNumber(options.opacity, DEFAULT_OPACITY) },
      uSteps: { value: raymarchSteps },
      uInvModelMatrix: { value: new THREE.Matrix4() },
      uBoxSize: { value: new THREE.Vector3(1, 1, 1) },
      uSceneScale: { value: SCALE },
      uReferenceLengthPc: { value: 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    glslVersion: THREE.GLSL3,
  });
}

function buildVolumeMesh(service, texture, options) {
  const bounds = getFullVolumeBounds(service.volume);
  const placement = createVolumePlacement(bounds, options.volumeToSceneTransform);
  const referenceLengthPc = Math.max(
    service.volume.manifest.world_extent_pc.x,
    service.volume.manifest.world_extent_pc.y,
    service.volume.manifest.world_extent_pc.z,
  );
  const geometry = new THREE.BoxGeometry(
    placement.boxSize.x,
    placement.boxSize.y,
    placement.boxSize.z,
  );
  const material = createHaTiledVolumeMaterial({
    texture,
    gain: options.gain,
    threshold: options.threshold,
    opacity: options.opacity,
    raymarchSteps: options.raymarchSteps,
  });
  material.uniforms.uBoxSize.value.copy(placement.boxSize);
  material.uniforms.uSceneScale.value = SCALE;
  material.uniforms.uReferenceLengthPc.value = referenceLengthPc;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${options.id}-mesh`;
  mesh.position.copy(placement.position);
  mesh.quaternion.copy(placement.quaternion);
  mesh.userData.haTexture = texture;
  mesh.onBeforeRender = () => {
    material.uniforms.uInvModelMatrix.value.copy(mesh.matrixWorld).invert();
  };
  return mesh;
}

function disposeVolumeMesh(mesh) {
  mesh.geometry?.dispose?.();
  mesh.material?.uniforms?.uVolume?.value?.dispose?.();
  mesh.material?.dispose?.();
}

function minDistancePcToBounds(point, bounds) {
  const dx = point.x < bounds.minX
    ? bounds.minX - point.x
    : Math.max(0, point.x - bounds.maxX);
  const dy = point.y < bounds.minY
    ? bounds.minY - point.y
    : Math.max(0, point.y - bounds.maxY);
  const dz = point.z < bounds.minZ
    ? bounds.minZ - point.z
    : Math.max(0, point.z - bounds.maxZ);
  return Math.hypot(dx, dy, dz);
}

export function createHaTiledVolumeLayer(options = {}) {
  const group = new THREE.Group();
  group.name = options.id ?? 'h-alpha-tiled-volume-layer';

  const config = {
    id: group.name,
    manifestUrl: options.manifestUrl,
    initialLevelId: options.initialLevelId ?? null,
    finalLevelId: options.finalLevelId ?? null,
    volumeToSceneTransform: options.volumeToSceneTransform ?? identityTransform,
    sceneToVolumeTransform: options.sceneToVolumeTransform ?? identityTransform,
    raymarchSteps: normalizePositiveInteger(options.raymarchSteps, DEFAULT_RAYMARCH_STEPS),
    gain: normalizeFiniteNumber(options.gain, DEFAULT_GAIN),
    threshold: normalizeFiniteNumber(options.threshold, DEFAULT_THRESHOLD),
    opacity: normalizeFiniteNumber(options.opacity, DEFAULT_OPACITY),
    initialRequestBricksPerUpdate: normalizePositiveInteger(
      options.initialRequestBricksPerUpdate,
      DEFAULT_INITIAL_REQUEST_BRICKS_PER_UPDATE,
    ),
    finalRequestBricksPerUpdate: normalizePositiveInteger(
      options.finalRequestBricksPerUpdate,
      DEFAULT_FINAL_REQUEST_BRICKS_PER_UPDATE,
    ),
    initialUploadBricksPerUpdate: normalizePositiveInteger(
      options.initialUploadBricksPerUpdate,
      DEFAULT_INITIAL_UPLOAD_BRICKS_PER_UPDATE,
    ),
    finalUploadBricksPerUpdate: normalizePositiveInteger(
      options.finalUploadBricksPerUpdate,
      DEFAULT_FINAL_UPLOAD_BRICKS_PER_UPDATE,
    ),
    initialBatchMaxBricks: normalizePositiveInteger(
      options.initialBatchMaxBricks,
      DEFAULT_INITIAL_BATCH_MAX_BRICKS,
    ),
    finalBatchMaxBricks: normalizePositiveInteger(
      options.finalBatchMaxBricks,
      DEFAULT_FINAL_BATCH_MAX_BRICKS,
    ),
    maxResidentBricks: normalizePositiveInteger(
      options.maxResidentBricks,
      DEFAULT_MAX_RESIDENT_BRICKS,
    ),
    maxInflightRequests: normalizePositiveInteger(
      options.maxInflightRequests,
      DEFAULT_MAX_INFLIGHT_REQUESTS,
    ),
  };

  const cameraWorld = new THREE.Vector3();
  let service = null;
  let display = null;
  let lastContext = null;
  let disposed = false;
  let activeError = null;
  let status = 'idle';
  let volumeCameraPc = { x: 0, y: 0, z: 0 };
  let lastSelection = {
    requestBricks: [],
    initialReady: 0,
    finalReady: 0,
  };

  function setStatus(nextStatus) {
    if (status === nextStatus) return;
    status = nextStatus;
    maybeNotify(options.onStatus, status);
  }

  function makeStats() {
    const description = service?.describe?.() ?? null;
    const slotCount = service?.volume?.slotCount ?? 0;
    return {
      id: group.name,
      status,
      error: activeError,
      manifestUrl: service?.volume?.manifestUrl ?? config.manifestUrl ?? null,
      manifest: service?.volume?.manifest ?? null,
      initialLevel: service?.volume?.lowLevel ?? null,
      finalLevel: service?.volume?.highLevel ?? null,
      initialReady: lastSelection.initialReady,
      finalReady: lastSelection.finalReady,
      slotCount,
      displayDimension: display?.dimension ?? service?.volume?.highLevel?.dimension ?? 0,
      renderedVolumes: display?.mesh ? 1 : 0,
      cachedBricks: description?.cachedBricks ?? 0,
      inflightBricks: description?.inflightBricks ?? 0,
      requestStats: description?.stats ?? {},
      rangeCacheStats: description?.rangeCacheStats ?? {},
      uploadCount: display?.uploadCount ?? 0,
      uploadedBytes: display?.uploadedBytes ?? 0,
    };
  }

  function notifyStats() {
    maybeNotify(options.onStats, makeStats());
  }

  function getFullVolumeBoundsForService() {
    return service ? getFullVolumeBounds(service.volume) : null;
  }

  function createDisplayVolume() {
    const targetLevel = service.volume.highLevel;
    const texture = createDisplayVolumeTexture(targetLevel.dimension);
    const mesh = buildVolumeMesh(service, texture, config);
    const initialUploadedSlots = new Set();
    return {
      texture,
      mesh,
      level: targetLevel,
      dimension: targetLevel.dimension,
      slotSampleSize: targetLevel.sampleSize,
      initialUploadedSlots,
      finalUploadedSlots: targetLevel.id === service.volume.lowLevel.id
        ? initialUploadedSlots
        : new Set(),
      uploadCount: 0,
      uploadedBytes: 0,
    };
  }

  function updateCameraVolumePosition(context) {
    context.camera.getWorldPosition(cameraWorld);
    const [x, y, z] = config.sceneToVolumeTransform(
      cameraWorld.x,
      cameraWorld.y,
      cameraWorld.z,
    );
    volumeCameraPc = { x, y, z };
  }

  function sortByCameraDistance(bricks) {
    return [...bricks].sort((left, right) => {
      const leftDistance = minDistancePcToBounds(
        volumeCameraPc,
        getHaTiledVolumeBrickBounds(service.volume, left),
      );
      const rightDistance = minDistancePcToBounds(
        volumeCameraPc,
        getHaTiledVolumeBrickBounds(service.volume, right),
      );
      return leftDistance - rightDistance;
    });
  }

  function copyBrickToDisplayTexture(context, brick, decoded) {
    const renderer = context.renderer;
    if (typeof renderer?.copyTextureToTexture !== 'function') {
      throw new Error('WebGLRenderer.copyTextureToTexture is not available');
    }

    const targetSampleSize = display.slotSampleSize;
    const dstPosition = new THREE.Vector3(
      brick.gridX * targetSampleSize,
      brick.gridY * targetSampleSize,
      brick.gridZ * targetSampleSize,
    );
    let sourceData = decoded;
    let sourceDimension = brick.textureSampleSize ?? brick.sampleSize;
    let sourceRegion = null;

    if (brick.sampleSize === targetSampleSize) {
      const halo = brick.tileHaloCells ?? 0;
      sourceRegion = halo > 0
        ? new THREE.Box3(
          new THREE.Vector3(halo, halo, halo),
          new THREE.Vector3(
            halo + brick.sampleSize,
            halo + brick.sampleSize,
            halo + brick.sampleSize,
          ),
        )
        : null;
    } else {
      sourceData = upsampleBrickInteriorNearest(decoded, brick, targetSampleSize);
      sourceDimension = targetSampleSize;
    }

    const sourceTexture = createCpuVolumeTexture(sourceData, sourceDimension);
    renderer.copyTextureToTexture(
      sourceTexture,
      display.texture,
      sourceRegion,
      dstPosition,
    );
    sourceTexture.dispose();
    display.uploadCount += 1;
    display.uploadedBytes += targetSampleSize ** 3;
    return true;
  }

  function uploadDecodedBricksToDisplay(context) {
    if (!service || !display) {
      return { uploaded: 0, pending: 0 };
    }

    const { lowLevel, highLevel } = service.volume;
    let uploaded = 0;
    let pending = 0;

    for (const brick of highLevel.bricks) {
      if (display.finalUploadedSlots.has(brick.slotIndex)) continue;
      const decoded = service.getDecodedBrick(brick);
      if (!decoded) continue;
      if (uploaded >= config.finalUploadBricksPerUpdate) {
        pending += 1;
        continue;
      }
      copyBrickToDisplayTexture(context, brick, decoded);
      service.deleteDecodedBrick(brick);
      display.finalUploadedSlots.add(brick.slotIndex);
      uploaded += 1;
    }

    for (const brick of lowLevel.bricks) {
      if (
        display.initialUploadedSlots.has(brick.slotIndex)
        || display.finalUploadedSlots.has(brick.slotIndex)
      ) {
        continue;
      }
      const decoded = service.getDecodedBrick(brick);
      if (!decoded) continue;
      if (uploaded >= config.initialUploadBricksPerUpdate) {
        pending += 1;
        continue;
      }
      copyBrickToDisplayTexture(context, brick, decoded);
      service.deleteDecodedBrick(brick);
      display.initialUploadedSlots.add(brick.slotIndex);
      uploaded += 1;
    }

    return { uploaded, pending };
  }

  function chooseBricksToRequest() {
    if (!service || !display) return lastSelection;
    const { lowLevel, highLevel, slotCount } = service.volume;
    const requestBricks = [];
    const initialReady = display.initialUploadedSlots.size;
    const finalReady = display.finalUploadedSlots.size;

    if (initialReady < slotCount) {
      for (const brick of lowLevel.bricks) {
        if (requestBricks.length >= config.initialRequestBricksPerUpdate) break;
        if (
          display.initialUploadedSlots.has(brick.slotIndex)
          || display.finalUploadedSlots.has(brick.slotIndex)
          || service.hasDecodedBrick(brick)
          || service.isBrickInflight(brick)
        ) {
          continue;
        }
        requestBricks.push(brick);
      }
    } else if (finalReady < slotCount) {
      for (const brick of sortByCameraDistance(highLevel.bricks)) {
        if (requestBricks.length >= config.finalRequestBricksPerUpdate) break;
        if (
          display.finalUploadedSlots.has(brick.slotIndex)
          || service.hasDecodedBrick(brick)
          || service.isBrickInflight(brick)
        ) {
          continue;
        }
        requestBricks.push(brick);
      }
    }

    return { requestBricks, initialReady, finalReady };
  }

  function requestSelectedBricks() {
    if (!service) return [];
    const requestOptions = lastSelection.requestBricks[0]?.levelId === service.volume.lowLevel.id
      ? { maxBatchBricks: config.initialBatchMaxBricks }
      : { maxBatchBricks: config.finalBatchMaxBricks };
    return service.requestBricks(lastSelection.requestBricks, requestOptions);
  }

  function tick(context) {
    if (disposed || !service || !display) return;
    updateCameraVolumePosition(context);
    const uploadResult = uploadDecodedBricksToDisplay(context);
    lastSelection = chooseBricksToRequest();

    for (const promise of requestSelectedBricks()) {
      promise.then(() => {
        if (disposed) return;
        notifyStats();
        context.runtime.renderOnce();
      }).catch((error) => {
        activeError = error;
        setStatus('error');
        maybeNotify(options.onError, error);
      });
    }

    const { slotCount } = service.volume;
    if (lastSelection.initialReady < slotCount) {
      setStatus(`loading ${service.volume.lowLevel.id} ${lastSelection.initialReady}/${slotCount}`);
    } else if (lastSelection.finalReady < slotCount) {
      setStatus(`refining ${service.volume.highLevel.id} ${lastSelection.finalReady}/${slotCount}`);
    } else {
      setStatus(`${service.volume.highLevel.id} complete`);
    }
    notifyStats();
    if (uploadResult.uploaded > 0 || uploadResult.pending > 0) {
      context.runtime.renderOnce();
    }
  }

  const api = {
    id: group.name,
    group,
    getStats: makeStats,
    getService() {
      return service;
    },
    getDisplayVolume() {
      return display;
    },
    getBounds() {
      return getFullVolumeBoundsForService();
    },
    setMaterialState(nextState = {}) {
      config.gain = normalizeFiniteNumber(nextState.gain, config.gain);
      config.threshold = normalizeFiniteNumber(nextState.threshold, config.threshold);
      config.opacity = normalizeFiniteNumber(nextState.opacity, config.opacity);
      const material = display?.mesh?.material;
      if (material) {
        material.uniforms.uGain.value = config.gain;
        material.uniforms.uThreshold.value = config.threshold;
        material.uniforms.uOpacity.value = config.opacity;
      }
      if (lastContext) {
        lastContext.runtime.renderOnce();
      }
      notifyStats();
    },
    async attach(context) {
      lastContext = context;
      setStatus('loading tiled volume');
      service = await loadHaTiledVolume(config.manifestUrl, {
        lowLevelId: config.initialLevelId ?? undefined,
        highLevelId: config.finalLevelId ?? undefined,
        maxResidentBricks: config.maxResidentBricks,
        maxInflightRequests: config.maxInflightRequests,
        session: context.datasetSession,
      });
      if (service.volume.lowLevel.sampleSize > service.volume.highLevel.sampleSize) {
        throw new Error(
          `Initial H-alpha level ${service.volume.lowLevel.id} must be coarser than or equal to final level ${service.volume.highLevel.id}`,
        );
      }
      display = createDisplayVolume();
      group.add(display.mesh);
      context.contentRoot.add(group);
      notifyStats();
    },
    start(context) {
      lastContext = context;
      tick(context);
    },
    update(context) {
      lastContext = context;
      tick(context);
    },
    dispose(context) {
      disposed = true;
      if (display?.mesh) {
        disposeVolumeMesh(display.mesh);
      }
      group.clear();
      context.contentRoot.remove(group);
      display = null;
      service = null;
      notifyStats();
    },
  };

  return api;
}
