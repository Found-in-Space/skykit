import * as THREE from 'three';

const CONSTELLATION_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONSTELLATION_FRAGMENT = `
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

function normalizeNonEmptyString(value) {
  if (value instanceof URL) {
    return value.href;
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function invert3(matrix) {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-10) {
    return null;
  }

  return [
    [(e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant],
    [(f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant],
    [(d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant],
  ];
}

function multiplyMatrixVector(matrix, values) {
  return [
    matrix[0][0] * values[0] + matrix[0][1] * values[1] + matrix[0][2] * values[2],
    matrix[1][0] * values[0] + matrix[1][1] * values[1] + matrix[1][2] * values[2],
    matrix[2][0] * values[0] + matrix[2][1] * values[1] + matrix[2][2] * values[2],
  ];
}

function normalizeDirection([x, y, z]) {
  const radius = Math.hypot(x, y, z) || 1;
  return [x / radius, y / radius, z / radius];
}

function resolveAnchorDirection(anchor) {
  const direction = Array.isArray(anchor?.direction) ? anchor.direction : null;
  return direction && direction.length === 3 ? direction : null;
}

function solveAffineMap(anchors, transformDirection) {
  const matrix = [
    [1, anchors[0].pos[0], anchors[0].pos[1]],
    [1, anchors[1].pos[0], anchors[1].pos[1]],
    [1, anchors[2].pos[0], anchors[2].pos[1]],
  ];
  const directions = anchors.map((anchor) => {
    const direction = resolveAnchorDirection(anchor);
    if (!direction) {
      return null;
    }
    return transformDirection(direction[0], direction[1], direction[2]);
  });
  if (directions.some((direction) => direction == null)) {
    return null;
  }

  const inverse = invert3(matrix);
  if (!inverse) {
    return null;
  }

  const coefficients = [
    multiplyMatrixVector(inverse, directions.map((direction) => direction[0])),
    multiplyMatrixVector(inverse, directions.map((direction) => direction[1])),
    multiplyMatrixVector(inverse, directions.map((direction) => direction[2])),
  ];

  return (u, v) => [
    coefficients[0][0] + coefficients[0][1] * u + coefficients[0][2] * v,
    coefficients[1][0] + coefficients[1][1] * u + coefficients[1][2] * v,
    coefficients[2][0] + coefficients[2][1] * u + coefficients[2][2] * v,
  ];
}

function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function matchesFilter(constellation, options) {
  if (typeof options.filter === 'function') {
    return options.filter(constellation);
  }

  if (!Array.isArray(options.iauFilter) || options.iauFilter.length === 0) {
    return true;
  }

  return options.iauFilter.includes(constellation.iau);
}

function resolveAssetBaseUrl(options, manifest) {
  const explicitBaseUrl = normalizeNonEmptyString(options.baseUrl);
  if (explicitBaseUrl) {
    return explicitBaseUrl;
  }

  const manifestBaseUrl = normalizeNonEmptyString(manifest?.assetBaseUrl);
  if (manifestBaseUrl) {
    return manifestBaseUrl;
  }

  const manifestUrl = normalizeNonEmptyString(options.manifestUrl);
  if (!manifestUrl) {
    return null;
  }

  try {
    return new URL('.', manifestUrl).href;
  } catch {
    return null;
  }
}

function resolveImageUrl(constellation, assetBaseUrl) {
  const explicitUrl = normalizeNonEmptyString(constellation?.image?.url);
  if (explicitUrl) {
    return explicitUrl;
  }

  const file = normalizeNonEmptyString(constellation?.image?.file);
  if (!file) {
    return null;
  }

  if (!assetBaseUrl) {
    return file;
  }

  try {
    return new URL(file, assetBaseUrl).href;
  } catch {
    return `${assetBaseUrl.replace(/\/?$/, '/')}${file.replace(/^\//, '')}`;
  }
}

function buildConstellationMesh(constellation, texture, options) {
  const size = Array.isArray(constellation.image?.size) ? constellation.image.size : [512, 512];
  const [width, height] = size;
  const anchors = constellation.image?.anchors?.slice(0, 3);
  if (!anchors || anchors.length < 3) {
    return null;
  }

  const dirAt = solveAffineMap(anchors, options.transformDirection);
  if (!dirAt) {
    return null;
  }

  const corners = [[0, 0], [width, 0], [width, height], [0, height]];
  const vertices = [];
  const uvs = [];
  const radius = (options.radius ?? 8) * (1 + options.index * 0.00015);

  for (const [pixelX, pixelY] of corners) {
    const direction = normalizeDirection(dirAt(pixelX, pixelY));
    vertices.push(direction[0] * radius, direction[1] * radius, direction[2] * radius);
    uvs.push(pixelX / width, 1 - pixelY / height);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const material = new THREE.ShaderMaterial({
    vertexShader: CONSTELLATION_VERTEX,
    fragmentShader: CONSTELLATION_FRAGMENT,
    uniforms: {
      map: { value: texture },
      opacity: { value: options.opacity ?? 0.22 },
      cutoff: { value: options.cutoff ?? 0.08 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -options.index * 0.5,
    polygonOffsetUnits: -options.index,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.name = `constellation-art-${constellation.iau ?? constellation.id ?? options.index}`;
  return mesh;
}

export async function loadConstellationArtManifest(options = {}) {
  if (options.manifest && typeof options.manifest === 'object') {
    return options.manifest;
  }

  const manifestUrl = normalizeNonEmptyString(options.manifestUrl);
  if (!manifestUrl) {
    throw new Error('Constellation art requires a manifest object or manifestUrl');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${manifestUrl}: ${response.status}`);
  }

  return response.json();
}

export async function createConstellationArtGroup(options = {}) {
  const textureLoader = options.textureLoader ?? new THREE.TextureLoader();
  const transformDirection = options.transformDirection ?? ((x, y, z) => [x, y, z]);
  const manifest = await loadConstellationArtManifest(options);
  const assetBaseUrl = resolveAssetBaseUrl(options, manifest);

  const constellations = (manifest?.constellations ?? [])
    .filter((constellation) => {
      const anchors = constellation?.image?.anchors;
      return Array.isArray(anchors) && anchors.length >= 3;
    })
    .filter((constellation) => matchesFilter(constellation, options));

  const textureUrls = constellations.map((constellation) => resolveImageUrl(constellation, assetBaseUrl));
  const textures = await Promise.all(
    constellations.map((constellation, index) => {
      if (!textureUrls[index]) {
        throw new Error(`Constellation "${constellation.id ?? constellation.iau ?? index}" has no image URL`);
      }
      return loadTexture(textureLoader, textureUrls[index]);
    }),
  );

  const meshes = constellations
    .map((constellation, index) => buildConstellationMesh(constellation, textures[index], {
      transformDirection,
      radius: options.radius ?? 8,
      opacity: options.opacity ?? 0.22,
      cutoff: options.cutoff ?? 0.08,
      index,
    }))
    .filter(Boolean);

  const group = new THREE.Group();
  group.name = options.id ?? options.name ?? 'constellation-art-group';
  for (const mesh of meshes) {
    group.add(mesh);
  }

  const dispose = () => {
    for (const mesh of meshes) {
      mesh.geometry?.dispose();
      if (mesh.material?.uniforms?.map?.value) {
        mesh.material.uniforms.map.value.dispose();
      }
      mesh.material?.dispose?.();
    }
    group.clear();
  };

  group.userData.constellationArt = {
    meshCount: meshes.length,
    dispose,
    source: {
      manifestId: manifest?.id ?? null,
      manifestUrl: normalizeNonEmptyString(options.manifestUrl),
      assetBaseUrl,
    },
  };

  return group;
}

export function disposeConstellationArtGroup(group) {
  group?.userData?.constellationArt?.dispose?.();
}
