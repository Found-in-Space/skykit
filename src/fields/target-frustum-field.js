import * as THREE from 'three';
import { DEFAULT_MAG_LIMIT } from '../layers/star-field-materials.js';
import {
  createEmptySelectionStats,
  evaluateMagnitudeShell,
  normalizePoint,
  resolveNumberSpec,
  resolvePointSpec,
  selectOctreeNodes,
} from './octree-selection.js';

const DEFAULT_OBSERVER_PC = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_VERTICAL_FOV_DEG = 40;
const DEFAULT_OVERSCAN_DEG = 8;
const DEFAULT_TARGET_RADIUS_PC = 96;
const DEFAULT_PRELOAD_DISTANCE_PC = 0;
const DEFAULT_NEAR_PC = 0.01;

const WORLD_UP = new THREE.Vector3(0, 0, 1);
const FALLBACK_UP = new THREE.Vector3(0, 1, 0);

function clampFovDegrees(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(170, Math.max(1, value));
}

function compareFrustumNodes(left, right) {
  if (left.level !== right.level) {
    return left.level - right.level;
  }
  if ((left.forwardDistancePc ?? 0) !== (right.forwardDistancePc ?? 0)) {
    return (left.forwardDistancePc ?? 0) - (right.forwardDistancePc ?? 0);
  }
  if ((left.distancePc ?? 0) !== (right.distancePc ?? 0)) {
    return (left.distancePc ?? 0) - (right.distancePc ?? 0);
  }
  return (left.nodeKey ?? '').localeCompare(right.nodeKey ?? '');
}

export function createTargetFrustumField(options = {}) {
  const id = options.id ?? 'target-frustum-field';
  const frustumCamera = new THREE.PerspectiveCamera();
  const frustum = new THREE.Frustum();
  const projectionMatrix = new THREE.Matrix4();
  const observerVector = new THREE.Vector3();
  const targetVector = new THREE.Vector3();
  const forwardVector = new THREE.Vector3();
  const upVector = new THREE.Vector3();
  const box = new THREE.Box3();
  const boxMin = new THREE.Vector3();
  const boxMax = new THREE.Vector3();

  let lastStats = {
    strategy: id,
    observerPc: normalizePoint(DEFAULT_OBSERVER_PC),
    targetPc: null,
    mDesired: null,
    mIndex: null,
    verticalFovDeg: DEFAULT_VERTICAL_FOV_DEG,
    overscanDeg: DEFAULT_OVERSCAN_DEG,
    farPc: null,
    ...createEmptySelectionStats(),
  };

  return {
    id,
    getStats() {
      return {
        ...lastStats,
        observerPc: normalizePoint(lastStats.observerPc),
        targetPc: normalizePoint(lastStats.targetPc),
      };
    },
    async selectNodes(context) {
      if (!context.datasetSession) {
        lastStats = {
          strategy: id,
          observerPc: normalizePoint(DEFAULT_OBSERVER_PC),
          targetPc: null,
          mDesired: null,
          mIndex: null,
          verticalFovDeg: DEFAULT_VERTICAL_FOV_DEG,
          overscanDeg: DEFAULT_OVERSCAN_DEG,
          farPc: null,
          ...createEmptySelectionStats(),
        };
        return {
          strategy: id,
          nodes: [],
          meta: {
            note: 'No dataset session is attached to the runtime.',
          },
        };
      }

      const observerPc = resolvePointSpec(
        options.observerPc,
        context,
        normalizePoint(context.state?.observerPc, DEFAULT_OBSERVER_PC),
      ) ?? normalizePoint(DEFAULT_OBSERVER_PC);
      const targetPc = resolvePointSpec(
        options.targetPc,
        context,
        normalizePoint(context.state?.targetPc, null),
      );

      if (!targetPc) {
        lastStats = {
          strategy: id,
          observerPc: normalizePoint(observerPc),
          targetPc: null,
          mDesired: null,
          mIndex: null,
          verticalFovDeg: DEFAULT_VERTICAL_FOV_DEG,
          overscanDeg: DEFAULT_OVERSCAN_DEG,
          farPc: null,
          ...createEmptySelectionStats(),
        };
        return {
          strategy: id,
          nodes: [],
          meta: {
            note: 'TargetFrustumField requires a targetPc value.',
            observerPc: normalizePoint(observerPc),
          },
        };
      }

      const verticalFovDeg = clampFovDegrees(
        resolveNumberSpec(options.verticalFovDeg, context, DEFAULT_VERTICAL_FOV_DEG),
        DEFAULT_VERTICAL_FOV_DEG,
      );
      const requestedMDesired = Number.isFinite(context.state?.mDesired)
        ? Number(context.state.mDesired)
        : DEFAULT_MAG_LIMIT;
      const overscanDeg = Math.max(
        0,
        resolveNumberSpec(options.overscanDeg, context, DEFAULT_OVERSCAN_DEG) ?? DEFAULT_OVERSCAN_DEG,
      );
      const targetRadiusPc = Math.max(
        0,
        resolveNumberSpec(options.targetRadiusPc, context, DEFAULT_TARGET_RADIUS_PC) ?? DEFAULT_TARGET_RADIUS_PC,
      );
      const preloadDistancePc = Math.max(
        0,
        resolveNumberSpec(options.preloadDistancePc, context, DEFAULT_PRELOAD_DISTANCE_PC)
          ?? DEFAULT_PRELOAD_DISTANCE_PC,
      );
      const nearPc = Math.max(
        0.001,
        resolveNumberSpec(options.nearPc, context, DEFAULT_NEAR_PC) ?? DEFAULT_NEAR_PC,
      );
      const aspectRatio = Math.max(
        0.0001,
        resolveNumberSpec(
          options.aspectRatio,
          context,
          context.size?.width > 0 && context.size?.height > 0
            ? context.size.width / context.size.height
            : context.camera?.aspect ?? 1,
        ) ?? 1,
      );

      observerVector.set(observerPc.x, observerPc.y, observerPc.z);
      targetVector.set(targetPc.x, targetPc.y, targetPc.z);
      forwardVector.subVectors(targetVector, observerVector);

      const targetDistancePc = forwardVector.length();
      if (!(targetDistancePc > 0)) {
        lastStats = {
          strategy: id,
          observerPc: normalizePoint(observerPc),
          targetPc: normalizePoint(targetPc),
          mDesired: requestedMDesired,
          mIndex: null,
          verticalFovDeg,
          overscanDeg,
          farPc: null,
          ...createEmptySelectionStats(),
        };
        return {
          strategy: id,
          nodes: [],
          meta: {
            note: 'TargetFrustumField targetPc must differ from observerPc.',
            observerPc: normalizePoint(observerPc),
            targetPc: normalizePoint(targetPc),
          },
        };
      }

      forwardVector.normalize();
      upVector.copy(Math.abs(forwardVector.dot(WORLD_UP)) > 0.98 ? FALLBACK_UP : WORLD_UP);

      const explicitFarPc = resolveNumberSpec(options.farPc, context, null);
      const farPc = Math.max(
        nearPc + 0.001,
        explicitFarPc ?? (targetDistancePc + targetRadiusPc + preloadDistancePc),
      );

      frustumCamera.fov = Math.min(170, verticalFovDeg + overscanDeg * 2);
      frustumCamera.aspect = aspectRatio;
      frustumCamera.near = nearPc;
      frustumCamera.far = farPc;
      frustumCamera.position.copy(observerVector);
      frustumCamera.up.copy(upVector);
      frustumCamera.lookAt(targetVector);
      frustumCamera.updateProjectionMatrix();
      frustumCamera.updateMatrixWorld(true);

      projectionMatrix.multiplyMatrices(
        frustumCamera.projectionMatrix,
        frustumCamera.matrixWorldInverse,
      );
      frustum.setFromProjectionMatrix(projectionMatrix);

      const result = await selectOctreeNodes(context, {
        maxLevel: options.maxLevel,
        predicate(node, helper) {
          box.min.copy(boxMin.set(node.bounds.minX, node.bounds.minY, node.bounds.minZ));
          box.max.copy(boxMax.set(node.bounds.maxX, node.bounds.maxY, node.bounds.maxZ));

          const shell = evaluateMagnitudeShell(
            observerPc,
            node.geom,
            requestedMDesired,
            helper.bootstrap.header.magLimit,
          );
          const intersectsFrustum = frustum.intersectsBox(box);

          if (!intersectsFrustum || !shell.inMagnitudeShell) {
            return { include: false };
          }

          return {
            include: true,
            meta: {
              ...shell,
              forwardDistancePc: (
                (node.geom.centerX - observerPc.x) * forwardVector.x
                + (node.geom.centerY - observerPc.y) * forwardVector.y
                + (node.geom.centerZ - observerPc.z) * forwardVector.z
              ),
              intersectsFrustum,
            },
          };
        },
        sortNodes: compareFrustumNodes,
      });

      const mIndex = result.bootstrap?.header?.magLimit ?? null;
      lastStats = {
        strategy: id,
        observerPc: normalizePoint(observerPc),
        targetPc: normalizePoint(targetPc),
        mDesired: requestedMDesired,
        mIndex,
        verticalFovDeg,
        overscanDeg,
        farPc,
        ...result.stats,
      };

      return {
        strategy: id,
        nodes: result.nodes,
        meta: {
          note: options.note ?? 'Target-locked frustum selection with the same magnitude shell plus an extra directional prune.',
          observerPc: normalizePoint(observerPc),
          targetPc: normalizePoint(targetPc),
          targetDistancePc,
          mDesired: requestedMDesired,
          mIndex,
          verticalFovDeg,
          overscanDeg,
          targetRadiusPc,
          preloadDistancePc,
          nearPc,
          farPc,
          aspectRatio,
          ...result.stats,
        },
      };
    },
  };
}
