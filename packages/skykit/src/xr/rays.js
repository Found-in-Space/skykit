import {
  applySpatialQuaternion,
  cloneSpatialVector3,
  SPATIAL_LOCAL_FORWARD,
  normalizeSpatialDirection,
  normalizeSpatialPose,
} from '@found-in-space/spatial';
import { poseFromSkykitXrPose, poseFromViewer } from './body.js';

/**
 * @param {import('../xr.d.ts').SkykitXrRaySourceOptions} [options]
 * @returns {import('../xr.d.ts').SkykitXrRaySource}
 */
export function createSkykitXrRaySource(options = {}) {
  const id = options.id ?? `found-in-space-xr-ray:${options.kind ?? 'target-ray'}`;
  const kind = options.kind ?? 'target-ray';
  const handedness = options.handedness ?? null;
  const length = options.length ?? null;
  const customGetRay = options.getRay;
  /** @type {import('../xr.d.ts').SkykitXrRay | null} */
  let lastRay = null;
  let disposed = false;

  return {
    id,
    getRay,
    getSnapshot,
    dispose,
  };

  /**
   * @param {import('../xr.d.ts').SkykitXrRayContext} context
   */
  function getRay(context = {}) {
    assertActive();
    if (typeof customGetRay === 'function') {
      lastRay = normalizeRay(customGetRay(context), { id, kind, handedness, length });
      return lastRay ? cloneRay(lastRay) : null;
    }
    if (kind === 'head-gaze') {
      const pose = context.body?.head
        ?? (context.frame && context.referenceSpace
          ? poseFromViewer(context.frame.getViewerPose?.(context.referenceSpace))
          : null);
      lastRay = poseToRay(pose, { id, kind, handedness: null, length });
      return lastRay ? cloneRay(lastRay) : null;
    }
    if (kind === 'ship-forward') {
      const pose = context.rig?.getNavigationPose?.()
        ?? context.body?.ship
        ?? normalizeSpatialPose({});
      lastRay = poseToRay(pose, { id, kind, handedness: null, length });
      return lastRay ? cloneRay(lastRay) : null;
    }
    if (kind === 'grip' || kind === 'target-ray') {
      lastRay = controllerRay(context, {
        id,
        kind,
        handedness,
        length,
        space: kind === 'grip' ? 'gripSpace' : 'targetRaySpace',
      });
      return lastRay ? cloneRay(lastRay) : null;
    }
    lastRay = null;
    return null;
  }

  function getSnapshot() {
    return {
      id,
      kind,
      handedness,
      disposed,
      lastRay: lastRay ? cloneRay(lastRay) : null,
    };
  }

  function dispose() {
    disposed = true;
    lastRay = null;
  }

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitXrRaySource has been disposed.');
    }
  }
}

/**
 * @param {import('../xr.d.ts').SkykitXrRayContext} context
 * @param {{ id: string; kind: string; handedness: string | null; length: number | null; space: 'gripSpace' | 'targetRaySpace' }} options
 */
function controllerRay(context, options) {
  const frame = context.frame;
  const referenceSpace = context.referenceSpace;
  const inputSources = Array.from(context.inputSources ?? context.session?.inputSources ?? []);
  if (!frame || !referenceSpace) return null;
  for (const source of inputSources) {
    const input = /** @type {{ handedness?: string; gripSpace?: unknown; targetRaySpace?: unknown }} */ (source);
    if (options.handedness && input.handedness !== options.handedness) continue;
    const space = input[options.space];
    if (!space || typeof frame.getPose !== 'function') continue;
    const pose = poseFromSkykitXrPose(frame.getPose(space, referenceSpace));
    const ray = poseToRay(pose, {
      id: options.id,
      kind: options.kind,
      handedness: input.handedness ?? null,
      length: options.length,
    });
    if (ray) {
      return ray;
    }
  }
  return null;
}

/**
 * @param {import('../xr.d.ts').SkykitXrPose | null} pose
 * @param {{ id: string; kind: string; handedness: string | null; length: number | null }} options
 */
function poseToRay(pose, options) {
  if (!pose) return null;
  return {
    id: options.id,
    kind: options.kind,
    handedness: options.handedness,
    origin: cloneSpatialVector3(pose.observerPc),
    direction: normalizeSpatialDirection(applySpatialQuaternion(SPATIAL_LOCAL_FORWARD, pose.orientationIcrs)),
    length: options.length,
  };
}

/**
 * @param {unknown} ray
 * @param {{ id: string; kind: string; handedness: string | null; length: number | null }} fallback
 */
export function normalizeRay(ray, fallback) {
  if (!ray || typeof ray !== 'object') {
    return null;
  }
  const candidate = /** @type {{ origin?: unknown; direction?: unknown; length?: unknown; id?: unknown; kind?: unknown; handedness?: unknown }} */ (ray);
  if (!candidate.origin || !candidate.direction) {
    return null;
  }
  return {
    id: typeof candidate.id === 'string' ? candidate.id : fallback.id,
    kind: typeof candidate.kind === 'string' ? candidate.kind : fallback.kind,
    handedness: typeof candidate.handedness === 'string' ? candidate.handedness : fallback.handedness,
    origin: normalizeSpatialPose({ observerPc: candidate.origin }).observerPc,
    direction: normalizeSpatialDirection(normalizeSpatialPose({ observerPc: candidate.direction }).observerPc),
    length: Number.isFinite(Number(candidate.length)) ? Number(candidate.length) : fallback.length,
  };
}

/**
 * @param {import('../xr.d.ts').SkykitXrRay} ray
 */
export function cloneRay(ray) {
  return {
    id: ray.id,
    kind: ray.kind,
    handedness: ray.handedness,
    origin: cloneSpatialVector3(ray.origin),
    direction: cloneSpatialVector3(ray.direction),
    length: ray.length,
  };
}
