const DEFAULT_IMAGE_SIZE = Object.freeze([512, 512]);
const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
export const ANCHORED_IMAGE_MANIFEST_FORMAT = 'found-in-space/anchored-image-manifest@1';
export const ANCHORED_IMAGE_MANIFEST_SCHEMA_ID = 'https://schemas.found-in.space/anchored-image-manifest.v1.schema.json';

/**
 * @typedef {{ x: number, y: number, z: number }} Vec3
 * @typedef {{ x: number, y: number }} Vec2
 * @typedef {{ kind: 'direction', frame: 'icrs', x: number, y: number, z: number } | { kind: 'position', frame: 'icrs-pc', x: number, y: number, z: number }} AnchoredImageAnchorTarget
 * @typedef {{ pixel: Vec2, target: AnchoredImageAnchorTarget, metadata?: Record<string, unknown> }} AnchoredImageAnchor
 * @typedef {{ src: string, width: number, height: number, anchors: AnchoredImageAnchor[] }} AnchoredImageSource
 * @typedef {{ id: string, label?: string, groupId?: string, image: AnchoredImageSource, attribution?: unknown, metadata?: Record<string, unknown> }} AnchoredImage
 * @typedef {{ format: typeof ANCHORED_IMAGE_MANIFEST_FORMAT, id?: string, label?: string, assetBaseUrl?: string | null, images: AnchoredImage[], attribution?: unknown, metadata?: Record<string, unknown> }} AnchoredImageManifest
 * @typedef {{ image: AnchoredImage, targetKind: AnchoredImageAnchorTarget['kind'], targetFrame: AnchoredImageAnchorTarget['frame'], targetAt: (pixel: Vec2) => AnchoredImageAnchorTarget | null }} SolvedAnchoredImage
 * @typedef {{ pixel: Vec2, uv: { u: number, v: number }, target: AnchoredImageAnchorTarget }} AnchoredImageMeshVertex
 * @typedef {{ image: AnchoredImage, vertices: AnchoredImageMeshVertex[], triangles: Array<[number, number, number]> }} AnchoredImageMesh
 */

export function invert3(matrix) {
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

export function multiplyMatrixVector(matrix, values) {
  return [
    matrix[0][0] * values[0] + matrix[0][1] * values[1] + matrix[0][2] * values[2],
    matrix[1][0] * values[0] + matrix[1][1] * values[1] + matrix[1][2] * values[2],
    matrix[2][0] * values[0] + matrix[2][1] * values[1] + matrix[2][2] * values[2],
  ];
}

export function normalizeDirection(value) {
  const vector = arrayOrVec3(value);
  if (!vector) {
    return null;
  }
  const radius = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(radius > 0)) {
    return null;
  }
  return [vector[0] / radius, vector[1] / radius, vector[2] / radius];
}

export function resolveAnchorDirection(anchor) {
  if (!anchor) {
    return null;
  }
  const target = anchor.target;
  if (target?.kind === 'direction') {
    return [target.x, target.y, target.z];
  }
  return null;
}

export function normalizeAnchoredImageManifest(input, options = {}) {
  const source = isRecord(input) ? input : {};
  const rawImages = Array.isArray(source.images) ? source.images : [];

  const images = rawImages
    .map((image, index) => normalizeAnchoredImage(image, index))
    .filter(Boolean);

  return {
    format: ANCHORED_IMAGE_MANIFEST_FORMAT,
    ...(normalizeNonEmptyString(source.id) ? { id: normalizeNonEmptyString(source.id) } : {}),
    ...(normalizeLabel(source.label) ? { label: normalizeLabel(source.label) } : {}),
    assetBaseUrl: normalizeNonEmptyString(options.baseUrl)
      ?? normalizeNonEmptyString(source.assetBaseUrl)
      ?? null,
    images,
    ...(source.attribution !== undefined ? { attribution: source.attribution } : {}),
    metadata: {
      ...(isRecord(source.metadata) ? source.metadata : {}),
    },
  };
}

export function resolveAnchoredImageAssets(manifest, options = {}) {
  const normalized = normalizeAnchoredImageManifest(manifest, options);
  const assetBaseUrl = resolveAssetBaseUrl(options, normalized);
  return {
    ...normalized,
    assetBaseUrl,
    images: normalized.images.map((image) => ({
      ...image,
      image: {
        ...image.image,
        src: resolveAssetUrl(image.image.src, assetBaseUrl),
      },
    })),
  };
}

export async function loadAnchoredImageManifest(options = {}) {
  if (options.manifest && typeof options.manifest === 'object') {
    return resolveAnchoredImageAssets(options.manifest, options);
  }

  const manifestUrl = normalizeNonEmptyString(options.manifestUrl);
  if (!manifestUrl) {
    throw new Error('Anchored image loading requires a manifest object or manifestUrl');
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Anchored image loading requires fetch or options.fetchImpl');
  }

  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${manifestUrl}: ${response.status}`);
  }

  const manifest = await response.json();
  return resolveAnchoredImageAssets(manifest, {
    ...options,
    manifestUrl,
  });
}

export function solveAffineMap(anchors, transformTarget = identityTransform) {
  const firstThree = Array.isArray(anchors) ? anchors.slice(0, 3) : [];
  if (firstThree.length < 3) {
    return null;
  }

  const matrix = firstThree.map((anchor) => {
    const pixel = normalizePixel(anchor?.pixel);
    return pixel ? [1, pixel.x, pixel.y] : null;
  });
  if (matrix.some((row) => row == null)) {
    return null;
  }

  const targets = firstThree.map((anchor) => {
    const target = normalizeAnchorTarget(anchor?.target);
    if (!target) {
      return null;
    }
    return transformTarget(target.x, target.y, target.z, target);
  });
  if (targets.some((target) => !Array.isArray(target) || target.length !== 3)) {
    return null;
  }

  const inverse = invert3(matrix);
  if (!inverse) {
    return null;
  }

  const coefficients = [
    multiplyMatrixVector(inverse, targets.map((target) => target[0])),
    multiplyMatrixVector(inverse, targets.map((target) => target[1])),
    multiplyMatrixVector(inverse, targets.map((target) => target[2])),
  ];

  return (u, v) => [
    coefficients[0][0] + coefficients[0][1] * u + coefficients[0][2] * v,
    coefficients[1][0] + coefficients[1][1] * u + coefficients[1][2] * v,
    coefficients[2][0] + coefficients[2][1] * u + coefficients[2][2] * v,
  ];
}

export function solveAnchoredImage(image, options = {}) {
  const normalized = normalizeAnchoredImage(image, 0);
  if (!normalized) {
    return null;
  }

  const anchors = normalized.image.anchors.slice(0, 3);
  if (anchors.length < 3) {
    return null;
  }

  const targetKind = anchors[0].target.kind;
  const targetFrame = anchors[0].target.frame;
  if (anchors.some((anchor) => anchor.target.kind !== targetKind || anchor.target.frame !== targetFrame)) {
    return null;
  }

  const transformTarget = typeof options.transformTarget === 'function'
    ? options.transformTarget
    : identityTransform;
  const targetAtVector = solveAffineMap(anchors, transformTarget);
  if (!targetAtVector) {
    return null;
  }

  return {
    image: normalized,
    targetKind,
    targetFrame,
    targetAt(pixel) {
      const point = normalizePixel(pixel);
      if (!point) {
        return null;
      }
      const vector = targetAtVector(point.x, point.y);
      if (targetKind === 'direction') {
        const direction = normalizeDirection(vector);
        return direction
          ? { kind: 'direction', frame: 'icrs', x: direction[0], y: direction[1], z: direction[2] }
          : null;
      }
      return { kind: 'position', frame: 'icrs-pc', x: vector[0], y: vector[1], z: vector[2] };
    },
  };
}

export function solveAnchoredImageMesh(image, options = {}) {
  const solved = solveAnchoredImage(image, options);
  if (!solved) {
    return null;
  }

  const width = solved.image.image.width;
  const height = solved.image.image.height;
  const subdivisions = normalizeSubdivisions(options.subdivisions, 1);

  if (subdivisions <= 1) {
    const corners = [[0, 0], [width, 0], [width, height], [0, height]];
    const vertices = corners.map(([x, y]) => createMeshVertex(solved, x, y)).filter(Boolean);
    if (vertices.length !== 4) {
      return null;
    }
    return {
      image: solved.image,
      vertices,
      triangles: [[0, 1, 2], [0, 2, 3]],
    };
  }

  const vertices = [];
  for (let row = 0; row <= subdivisions; row += 1) {
    for (let column = 0; column <= subdivisions; column += 1) {
      const pixelX = width * (column / subdivisions);
      const pixelY = height * (row / subdivisions);
      const vertex = createMeshVertex(solved, pixelX, pixelY);
      if (!vertex) {
        return null;
      }
      vertices.push(vertex);
    }
  }

  const triangles = [];
  const stride = subdivisions + 1;
  for (let row = 0; row < subdivisions; row += 1) {
    for (let column = 0; column < subdivisions; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      triangles.push([topLeft, topRight, bottomRight], [topLeft, bottomRight, bottomLeft]);
    }
  }

  return {
    image: solved.image,
    vertices,
    triangles,
  };
}

export function buildAnchoredImageDirectionResolver(manifestInput) {
  const manifest = normalizeAnchoredImageManifest(manifestInput);
  const entries = manifest.images
    .map((image) => createDirectionEntry(image))
    .filter(Boolean);
  const entryByImageId = new Map(entries.map((entry) => [entry.image.id, entry]));
  const lookup = new Map();

  for (const image of manifest.images) {
    const entry = entryByImageId.get(image.id);
    const summary = createImageSummary(image, entry);
    const keys = [
      image.id,
      image.groupId,
      image.label,
    ].map(normalizeLookupKey).filter(Boolean);
    for (const key of keys) {
      if (!lookup.has(key)) {
        lookup.set(key, summary);
      }
    }
  }

  function resolve(icrsDirection, currentGroupId = null) {
    const point = normalizeDirection(icrsDirection);
    if (!point || entries.length === 0) {
      return null;
    }

    const inside = entries
      .map((entry) => ({ ...entry, score: dot(entry.centroid, point) }))
      .filter((entry) => entry.score > 0 && isInsideSphericalQuad(point, entry.corners));

    if (inside.length > 0) {
      if (currentGroupId) {
        const sticky = inside.find((entry) => entry.image.groupId === currentGroupId || entry.image.id === currentGroupId);
        if (sticky) {
          return createResolveResult(sticky, sticky.score);
        }
      }
      const winner = inside.reduce((best, entry) => (entry.score > best.score ? entry : best), inside[0]);
      return createResolveResult(winner, winner.score);
    }

    const closest = entries.reduce((best, entry) => {
      const score = dot(entry.centroid, point);
      if (!best || score > best.score) {
        return { ...entry, score };
      }
      return best;
    }, null);

    return closest ? createResolveResult(closest, closest.score) : null;
  }

  return {
    resolve,
    toRaDec,
    listImages() {
      return manifest.images.map((image) => createImageSummary(image, entryByImageId.get(image.id)));
    },
    getImage(keyOrLabel) {
      const key = normalizeLookupKey(keyOrLabel);
      return key ? lookup.get(key) ?? null : null;
    },
    getStats() {
      return {
        imageCount: entries.length,
        listedImageCount: manifest.images.length,
      };
    },
  };
}

export function icrsDirectionToTargetPc(icrsDirection, distancePc, observerPc = DEFAULT_OBSERVER_PC) {
  const direction = normalizeDirection(icrsDirection);
  if (!direction) {
    return null;
  }
  if (!Number.isFinite(distancePc) || distancePc <= 0) {
    return null;
  }
  const ox = Number.isFinite(observerPc?.x) ? observerPc.x : 0;
  const oy = Number.isFinite(observerPc?.y) ? observerPc.y : 0;
  const oz = Number.isFinite(observerPc?.z) ? observerPc.z : 0;
  const [dx, dy, dz] = direction;
  return {
    x: ox + dx * distancePc,
    y: oy + dy * distancePc,
    z: oz + dz * distancePc,
  };
}

export function toRaDec(icrsDirection) {
  const direction = normalizeDirection(icrsDirection);
  if (!direction) {
    return null;
  }

  const [x, y, z] = direction;
  const raRawDeg = Math.atan2(y, x) * (180 / Math.PI);
  const raDeg = (raRawDeg + 360) % 360;
  const decDeg = Math.asin(Math.max(-1, Math.min(1, z))) * (180 / Math.PI);
  return {
    raDeg,
    raHours: raDeg / 15,
    decDeg,
  };
}

function createMeshVertex(solved, pixelX, pixelY) {
  const target = solved.targetAt({ x: pixelX, y: pixelY });
  if (!target) {
    return null;
  }
  return {
    pixel: { x: pixelX, y: pixelY },
    uv: {
      u: pixelX / solved.image.image.width,
      v: 1 - pixelY / solved.image.image.height,
    },
    target,
  };
}

function normalizeAnchoredImage(input, index) {
  if (!isRecord(input)) {
    return null;
  }

  const imageRecord = isRecord(input.image) ? input.image : {};
  const size = normalizeImageSize(imageRecord);
  const anchors = (Array.isArray(imageRecord.anchors) ? imageRecord.anchors : [])
    .map(normalizeAnchor)
    .filter(Boolean);
  const id = normalizeNonEmptyString(input.id) ?? `anchored-image-${index}`;
  const label = normalizeLabel(input.label);
  const groupId = normalizeNonEmptyString(input.groupId) ?? undefined;

  return {
    id,
    ...(label ? { label } : {}),
    ...(groupId ? { groupId } : {}),
    image: {
      src: normalizeNonEmptyString(imageRecord.src) ?? '',
      width: size[0],
      height: size[1],
      anchors,
    },
    ...(input.attribution !== undefined ? { attribution: input.attribution } : {}),
    metadata: {
      ...(isRecord(input.metadata) ? input.metadata : {}),
    },
  };
}

function normalizeAnchor(input) {
  if (!isRecord(input)) {
    return null;
  }
  const pixel = normalizePixel(input.pixel ?? input.pos);
  const target = normalizeAnchorTarget(input.target ?? input);
  if (!pixel || !target) {
    return null;
  }
  return {
    pixel,
    target,
    metadata: {
      ...(isRecord(input.metadata) ? input.metadata : {}),
    },
  };
}

function normalizeAnchorTarget(input) {
  if (!isRecord(input)) {
    return null;
  }

  if (input.kind === 'direction') {
    const vector = readTargetVector(input);
    if (!vector) {
      return null;
    }
    return { kind: 'direction', frame: 'icrs', x: vector.x, y: vector.y, z: vector.z };
  }

  if (input.kind === 'position') {
    const vector = readTargetVector(input);
    if (!vector) {
      return null;
    }
    return { kind: 'position', frame: 'icrs-pc', x: vector.x, y: vector.y, z: vector.z };
  }

  return null;
}

function readTargetVector(input) {
  const vector = arrayOrVec3(input);
  if (vector) {
    return { x: vector[0], y: vector[1], z: vector[2] };
  }
  return null;
}

function normalizePixel(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (isRecord(value)) {
    const x = Number(value.x);
    const y = Number(value.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  return null;
}

function normalizeImageSize(imageRecord) {
  const width = Number(imageRecord.width);
  const height = Number(imageRecord.height);
  return width > 0 && height > 0 ? [width, height] : [...DEFAULT_IMAGE_SIZE];
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
  if (isRecord(value)) {
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
      ? [x, y, z]
      : null;
  }
  return null;
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

function resolveAssetUrl(src, assetBaseUrl) {
  const value = normalizeNonEmptyString(src);
  if (!value) {
    return '';
  }
  if (!assetBaseUrl) {
    return value;
  }
  try {
    return new URL(value, assetBaseUrl).href;
  } catch {
    return `${assetBaseUrl.replace(/\/?$/, '/')}${value.replace(/^\//, '')}`;
  }
}

function createDirectionEntry(image) {
  const solved = solveAnchoredImage(image);
  if (!solved || solved.targetKind !== 'direction') {
    return null;
  }

  const width = solved.image.image.width;
  const height = solved.image.image.height;
  const cornerTargets = [[0, 0], [width, 0], [width, height], [0, height]]
    .map(([x, y]) => solved.targetAt({ x, y }))
    .filter((target) => target?.kind === 'direction');
  if (cornerTargets.length !== 4) {
    return null;
  }
  const corners = cornerTargets.map((target) => [target.x, target.y, target.z]);
  const topCenter = solved.targetAt({ x: width * 0.5, y: 0 });
  const bottomCenter = solved.targetAt({ x: width * 0.5, y: height });
  const anchorDirections = solved.image.image.anchors
    .slice(0, 3)
    .map((anchor) => normalizeDirection([anchor.target.x, anchor.target.y, anchor.target.z]))
    .filter(Boolean);
  if (anchorDirections.length < 3 || topCenter?.kind !== 'direction' || bottomCenter?.kind !== 'direction') {
    return null;
  }

  const centroid = normalizeDirection(anchorDirections.reduce(
    (sum, [x, y, z]) => [sum[0] + x, sum[1] + y, sum[2] + z],
    [0, 0, 0],
  ));
  if (!centroid) {
    return null;
  }

  const imageUpRaw = [
    topCenter.x - bottomCenter.x,
    topCenter.y - bottomCenter.y,
    topCenter.z - bottomCenter.z,
  ];
  const imageUp = normalizeDirection(imageUpRaw);

  return {
    image: solved.image,
    corners,
    centroid,
    imageUp,
  };
}

function createImageSummary(image, entry) {
  return {
    imageId: image.id,
    groupId: image.groupId ?? null,
    label: image.label ?? null,
    id: image.id,
    hasArt: Boolean(entry),
    centroidIcrs: entry?.centroid ?? null,
    imageUpIcrs: entry?.imageUp ?? null,
    cornersIcrs: entry?.corners ?? null,
    attribution: image.attribution,
    metadata: image.metadata ?? {},
  };
}

function createResolveResult(entry, score) {
  return {
    imageId: entry.image.id,
    groupId: entry.image.groupId ?? null,
    label: entry.image.label ?? null,
    id: entry.image.id,
    score,
  };
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function isInsideSphericalQuad(point, corners, epsilon = 1e-8) {
  let hasPositive = false;
  let hasNegative = false;

  for (let index = 0; index < corners.length; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    const sign = dot(cross(a, b), point);
    if (sign > epsilon) hasPositive = true;
    if (sign < -epsilon) hasNegative = true;
    if (hasPositive && hasNegative) {
      return false;
    }
  }

  return true;
}

function normalizeLookupKey(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function normalizeLabel(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (isRecord(value)) {
    return normalizeNonEmptyString(value.english)
      ?? normalizeNonEmptyString(value.native)
      ?? null;
  }
  return null;
}

function normalizeNonEmptyString(value) {
  if (value instanceof URL) {
    return value.href;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeSubdivisions(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.max(1, Math.floor(number))
    : fallback;
}

function identityTransform(x, y, z) {
  return [x, y, z];
}

function isRecord(value) {
  return value !== null && typeof value === 'object';
}
