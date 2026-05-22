import {
  loadAnchoredImageManifest,
  solveAnchoredImageMesh,
} from './index.js';

/**
 * @typedef {import('./index.js').AnchoredImage} AnchoredImage
 * @typedef {import('./index.js').AnchoredImageAnchorTarget} AnchoredImageAnchorTarget
 * @typedef {import('./index.js').AnchoredImageManifest} AnchoredImageManifest
 * @typedef {import('./index.js').AnchoredImageMesh} AnchoredImageMesh
 * @typedef {import('./index.js').AnchoredImageMeshVertex} AnchoredImageMeshVertex
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {AnchoredImage} image
 * @param {object} [options]
 */
export function drawAnchoredImageCanvas(ctx, image, options = {}) {
  const mesh = solveAnchoredImageMesh(image, {
    subdivisions: options.subdivisions,
  });
  if (!mesh) {
    return {
      imageId: image?.id ?? null,
      drawnCount: 0,
      skippedCount: 1,
      triangleCount: 0,
      skippedImages: [image?.id ?? null],
    };
  }
  return drawAnchoredImageMeshCanvas(ctx, mesh, options);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {AnchoredImageMesh} mesh
 * @param {object} [options]
 */
export function drawAnchoredImageMeshCanvas(ctx, mesh, options = {}) {
  if (!ctx) {
    throw new TypeError('drawAnchoredImageMeshCanvas() requires a CanvasRenderingContext2D.');
  }
  if (!mesh) {
    throw new TypeError('drawAnchoredImageMeshCanvas() requires an AnchoredImageMesh.');
  }

  const projectTarget = options.projectTarget;
  if (typeof projectTarget !== 'function') {
    throw new TypeError('drawAnchoredImageMeshCanvas() requires options.projectTarget.');
  }

  const sourceImage = options.sourceImage ?? options.imageElement ?? options.image;
  if (!sourceImage) {
    return {
      imageId: mesh.image.id,
      drawnCount: 0,
      skippedCount: 1,
      triangleCount: mesh.triangles.length,
      skippedImages: [mesh.image.id],
    };
  }

  const previousAlpha = typeof ctx.globalAlpha === 'number' ? ctx.globalAlpha : 1;
  const opacity = clamp(normalizeFiniteNumber(options.opacity, 1), 0, 1);
  const wrapWidth = normalizePositiveNumber(options.wrapWidth, options.context?.width ?? 0);
  const sourceWidth = normalizePositiveNumber(options.sourceWidth, mesh.image.image.width);
  const sourceHeight = normalizePositiveNumber(options.sourceHeight, mesh.image.image.height);
  let drawnCount = 0;
  let skippedCount = 0;

  ctx.save?.();
  ctx.globalAlpha = previousAlpha * opacity;
  try {
    for (const triangle of mesh.triangles) {
      const vertices = triangle.map((index) => mesh.vertices[index]);
      const projected = vertices.map((vertex) => {
        const result = projectTarget(vertex.target, options.context ?? {}, vertex, mesh);
        if (!result || result.visible === false) {
          return null;
        }
        const x = Number(result.x);
        const y = Number(result.y);
        return Number.isFinite(x) && Number.isFinite(y)
          ? { x, y, depth: Number(result.depth ?? 0), wrapKey: result.wrapKey }
          : null;
      });
      if (projected.some((point) => point == null)) {
        skippedCount += 1;
        continue;
      }

      const source = vertices.map((vertex) => vertex.pixel);
      const variants = createWrappedVariants(projected, wrapWidth);
      for (const destination of variants) {
        drawImageTriangle(ctx, sourceImage, source, destination, sourceWidth, sourceHeight);
        drawnCount += 1;
      }
    }
  } finally {
    ctx.globalAlpha = previousAlpha;
    ctx.restore?.();
  }

  return {
    imageId: mesh.image.id,
    drawnCount,
    skippedCount,
    triangleCount: mesh.triangles.length,
    skippedImages: [],
  };
}

export function createAnchoredImageCanvasLayer(options = {}) {
  let manifest = null;
  let loadPromise = null;
  let loadError = null;
  let items = [];

  async function load(loadOptions = {}) {
    if (loadPromise) {
      return loadPromise;
    }

    loadPromise = (async () => {
      const nextManifest = await loadAnchoredImageManifest({
        ...options,
        ...loadOptions,
      });
      const images = nextManifest.images.filter((image) => matchesFilter(image, options));
      const loadedItems = [];
      for (const image of images) {
        const mesh = solveAnchoredImageMesh(image, {
          subdivisions: options.subdivisions,
        });
        if (!mesh) {
          continue;
        }
        try {
          const sourceImage = await loadCanvasImage(image.image.src, options);
          loadedItems.push({ image, mesh, sourceImage });
        } catch (error) {
          if (options.skipImageErrors !== true) {
            throw error;
          }
          options.onImageError?.({ image, imageUrl: image.image.src, error });
        }
      }
      manifest = nextManifest;
      items = loadedItems;
      loadError = null;
      return nextManifest;
    })().catch((error) => {
      loadError = error;
      loadPromise = null;
      throw error;
    });

    return loadPromise;
  }

  return {
    load,
    render(context = {}) {
      if (!loadPromise) {
        void load();
      }
      if (!manifest || items.length === 0) {
        return {
          drawnCount: 0,
          skippedCount: manifest?.images?.length ?? 0,
          imageCount: manifest?.images?.length ?? 0,
          loadedImageCount: items.length,
          pending: !manifest && !loadError,
          error: loadError ?? null,
        };
      }

      const ctx = context.ctx ?? options.ctx;
      const projectTarget = context.projectTarget ?? options.projectTarget;
      let drawnCount = 0;
      let skippedCount = 0;
      for (const item of items) {
        const result = drawAnchoredImageMeshCanvas(ctx, item.mesh, {
          ...options,
          ...context,
          sourceImage: item.sourceImage,
          projectTarget,
          context,
        });
        drawnCount += result.drawnCount;
        skippedCount += result.skippedCount;
      }
      return {
        drawnCount,
        skippedCount,
        imageCount: manifest.images.length,
        loadedImageCount: items.length,
        pending: false,
        error: null,
      };
    },
    getStats() {
      return {
        drawnCount: 0,
        skippedCount: 0,
        imageCount: manifest?.images?.length ?? 0,
        loadedImageCount: items.length,
        pending: Boolean(loadPromise && !manifest && !loadError),
        error: loadError ?? null,
      };
    },
    dispose() {
      manifest = null;
      loadPromise = null;
      loadError = null;
      items = [];
    },
  };
}

function drawImageTriangle(ctx, sourceImage, source, destination, sourceWidth, sourceHeight) {
  const matrix = sourceTriangleToDestinationTransform(source, destination);
  if (!matrix) {
    return;
  }

  ctx.save?.();
  try {
    ctx.beginPath?.();
    ctx.moveTo?.(destination[0].x, destination[0].y);
    ctx.lineTo?.(destination[1].x, destination[1].y);
    ctx.lineTo?.(destination[2].x, destination[2].y);
    ctx.closePath?.();
    ctx.clip?.();
    ctx.transform?.(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    ctx.drawImage?.(sourceImage, 0, 0, sourceWidth, sourceHeight);
  } finally {
    ctx.restore?.();
  }
}

function sourceTriangleToDestinationTransform(source, destination) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 1e-10) {
    return null;
  }

  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  return { a, b, c, d, e, f };
}

function createWrappedVariants(points, wrapWidth) {
  if (!(wrapWidth > 0)) {
    return [points];
  }

  const unwrapped = unwrapTriangle(points, wrapWidth);
  const variants = [unwrapped];
  const xs = unwrapped.map((point) => point.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  if (minX < 0) {
    variants.push(unwrapped.map((point) => ({ ...point, x: point.x + wrapWidth })));
  }
  if (maxX > wrapWidth) {
    variants.push(unwrapped.map((point) => ({ ...point, x: point.x - wrapWidth })));
  }
  return variants;
}

function unwrapTriangle(points, wrapWidth) {
  const [first, ...rest] = points;
  return [
    first,
    ...rest.map((point) => {
      let x = point.x;
      const delta = x - first.x;
      if (delta > wrapWidth * 0.5) {
        x -= wrapWidth;
      } else if (delta < -wrapWidth * 0.5) {
        x += wrapWidth;
      }
      return { ...point, x };
    }),
  ];
}

async function loadCanvasImage(src, options) {
  if (typeof options.imageLoader === 'function') {
    return options.imageLoader(src);
  }
  if (typeof Image === 'undefined') {
    throw new Error('Anchored image canvas loading requires options.imageLoader outside a browser.');
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image ${src}`));
    image.src = src;
  });
}

function matchesFilter(image, options) {
  if (typeof options.filter === 'function') {
    return options.filter(image);
  }
  if (!Array.isArray(options.groupFilter) || options.groupFilter.length === 0) {
    return true;
  }
  return options.groupFilter.includes(image.groupId);
}

function normalizeFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
