import * as THREE from 'three';
import {
  loadAnchoredImageManifest,
  normalizeDirection,
  solveAnchoredImageMesh,
} from './index.js';

/**
 * @typedef {import('./index.js').AnchoredImage} AnchoredImage
 * @typedef {import('./index.js').AnchoredImageAnchorTarget} AnchoredImageAnchorTarget
 * @typedef {import('./index.js').AnchoredImageMesh} AnchoredImageMesh
 */

export const ANCHORED_IMAGE_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ANCHORED_IMAGE_FRAGMENT_SHADER = `
  uniform sampler2D map;
  uniform float opacity;
  uniform float cutoff;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(map, vUv);
    float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    if (lum < cutoff) discard;
    gl_FragColor = vec4(tex.rgb, opacity);
  }
`;

export function createAnchoredImageMeshObject(mesh, options = {}) {
  if (!mesh) {
    throw new TypeError('createAnchoredImageMeshObject() requires an AnchoredImageMesh.');
  }
  if (!options.texture) {
    throw new TypeError('createAnchoredImageMeshObject() requires options.texture.');
  }

  const vertices = [];
  const uvs = [];
  const index = normalizeNonNegativeInteger(options.index, 0);
  const radius = normalizePositiveNumber(options.radius, 8)
    * (1 + index * normalizeFiniteNumber(options.radiusOffset, 0.00015));

  for (const vertex of mesh.vertices) {
    const position = targetToPosition(vertex.target, {
      ...options,
      radius,
    });
    if (!position) {
      throw new Error(`Anchored image "${mesh.image.id}" contains an unsupported target.`);
    }
    vertices.push(position[0], position[1], position[2]);
    uvs.push(vertex.uv.u, vertex.uv.v);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(mesh.triangles.flat());

  const material = new THREE.ShaderMaterial({
    vertexShader: options.vertexShader ?? ANCHORED_IMAGE_VERTEX_SHADER,
    fragmentShader: options.fragmentShader ?? ANCHORED_IMAGE_FRAGMENT_SHADER,
    uniforms: {
      map: { value: options.texture },
      opacity: { value: normalizeFiniteNumber(options.opacity, 0.22) },
      cutoff: { value: normalizeFiniteNumber(options.cutoff, 0.08) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -index * 0.5,
    polygonOffsetUnits: -index,
  });

  const object = new THREE.Mesh(geometry, material);
  object.renderOrder = normalizeFiniteNumber(options.renderOrder, -1);
  object.name = `${options.namePrefix ?? 'anchored-image'}-${mesh.image.groupId ?? mesh.image.id ?? index}`;
  object.userData.anchoredImage = {
    id: mesh.image.id,
    groupId: mesh.image.groupId ?? null,
    label: mesh.image.label ?? null,
    attribution: mesh.image.attribution,
    metadata: mesh.image.metadata ?? {},
  };
  return object;
}

export async function createAnchoredImageGroup(options = {}) {
  const textureLoader = options.textureLoader ?? new THREE.TextureLoader();
  const skipTextureErrors = options.skipTextureErrors === true;
  const onTextureError = typeof options.onTextureError === 'function' ? options.onTextureError : null;
  const manifest = await loadAnchoredImageManifest(options);

  const images = manifest.images
    .filter((image) => image.image.anchors.length >= 3)
    .filter((image) => matchesFilter(image, options));

  const textureResults = await Promise.all(images.map(async (image) => {
    if (!image.image.src) {
      throw new Error(`Anchored image "${image.id}" has no image URL`);
    }
    try {
      return {
        ok: true,
        texture: await loadTexture(textureLoader, image.image.src),
      };
    } catch (error) {
      if (!skipTextureErrors) {
        throw error;
      }
      onTextureError?.({
        image,
        imageUrl: image.image.src,
        error,
      });
      return {
        ok: false,
        texture: null,
      };
    }
  }));

  const objects = images
    .map((image, index) => {
      const texture = textureResults[index]?.texture;
      if (!textureResults[index]?.ok || !texture) {
        return null;
      }
      const mesh = solveAnchoredImageMesh(image, {
        subdivisions: options.subdivisions,
      });
      return mesh
        ? createAnchoredImageMeshObject(mesh, {
          ...options,
          texture,
          index,
        })
        : null;
    })
    .filter(Boolean);

  const group = new THREE.Group();
  group.name = options.id ?? options.name ?? 'anchored-image-group';
  for (const object of objects) {
    group.add(object);
  }

  const dispose = () => {
    for (const object of objects) {
      disposeAnchoredImageObject(object);
    }
    group.clear();
  };

  group.userData.anchoredImage = {
    meshCount: objects.length,
    dispose,
    source: {
      manifestId: manifest.id ?? null,
      manifestUrl: normalizeNonEmptyString(options.manifestUrl),
      assetBaseUrl: manifest.assetBaseUrl ?? null,
    },
  };

  return group;
}

export function disposeAnchoredImageObject(object) {
  if (!object) {
    return;
  }
  object.geometry?.dispose?.();
  const material = object.material;
  if (Array.isArray(material)) {
    for (const item of material) {
      disposeMaterial(item);
    }
  } else {
    disposeMaterial(material);
  }
}

function disposeMaterial(material) {
  const texture = material?.uniforms?.map?.value;
  texture?.dispose?.();
  material?.dispose?.();
}

function targetToPosition(target, options) {
  if (target.kind === 'direction') {
    const transformDirection = typeof options.transformDirection === 'function'
      ? options.transformDirection
      : identityTransform;
    const vector = transformDirection(target.x, target.y, target.z, target);
    const direction = normalizeDirection(vector);
    return direction
      ? [
        direction[0] * options.radius,
        direction[1] * options.radius,
        direction[2] * options.radius,
      ]
      : null;
  }

  if (target.kind === 'position') {
    const transformPosition = typeof options.transformPosition === 'function'
      ? options.transformPosition
      : identityPositionTransform;
    const vector = transformPosition(target.x, target.y, target.z, target);
    const position = arrayOrVec3(vector);
    const scale = normalizeFiniteNumber(options.positionScale, 1);
    return position
      ? [position[0] * scale, position[1] * scale, position[2] * scale]
      : null;
  }

  return null;
}

function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function matchesFilter(image, options) {
  if (typeof options.filter === 'function') {
    return options.filter(image);
  }

  if (Array.isArray(options.groupFilter) && options.groupFilter.length > 0) {
    return options.groupFilter.includes(image.groupId);
  }

  return true;
}

function identityTransform(x, y, z) {
  return [x, y, z];
}

function identityPositionTransform(x, y, z) {
  return [x, y, z];
}

function arrayOrVec3(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    const z = Number(value[2]);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? [x, y, z]
      : null;
  }
  if (value && typeof value === 'object') {
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? [x, y, z]
      : null;
  }
  return null;
}

function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : fallback;
}

function normalizeNonEmptyString(value) {
  if (value instanceof URL) {
    return value.href;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
