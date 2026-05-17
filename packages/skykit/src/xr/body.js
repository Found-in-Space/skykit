import {
  applyQuaternion,
  clonePose,
  cloneQuaternion,
  cloneVector3,
  IDENTITY_QUATERNION,
  LOCAL_FORWARD,
  normalizePose,
} from '@found-in-space/spatial';

/**
 * @param {import('../xr.d.ts').CreateSkykitXrBodyTrackerOptions} [options]
 * @returns {import('../xr.d.ts').SkykitXrBodyTracker}
 */
export function createSkykitXrBodyTracker(options = {}) {
  const id = options.id ?? 'found-in-space-xr-body';
  /** @type {import('../xr.d.ts').SkykitXrBodyModel} */
  let body = {
    head: null,
    leftHand: null,
    rightHand: null,
    ship: normalizePose(options.shipPose ?? {}),
    torso: null,
  };
  let disposed = false;

  return {
    id,
    update,
    getBody,
    getSnapshot,
    dispose,
  };

  /**
   * @param {import('../xr.d.ts').SkykitXrBodyUpdateContext} context
   */
  function update(context = {}) {
    assertActive();
    const frame = context.frame;
    const referenceSpace = context.referenceSpace;
    const session = context.session;
    const inputSources = Array.from(context.inputSources ?? session?.inputSources ?? []);
    const head = frame && referenceSpace && typeof frame.getViewerPose === 'function'
      ? poseFromViewer(frame.getViewerPose(referenceSpace))
      : null;
    /** @type {import('../xr.d.ts').SkykitXrBodyModel} */
    const nextBody = {
      head,
      leftHand: null,
      rightHand: null,
      ship: context.shipPose
        ? normalizePose(context.shipPose)
        : context.rig?.getNavigationPose?.() ?? clonePose(body.ship),
      torso: null,
    };

    for (const source of inputSources) {
      const hand = source?.handedness;
      if (hand !== 'left' && hand !== 'right') continue;
      const gripPose = frame && referenceSpace && source.gripSpace
        ? poseFromSkykitXrPose(frame.getPose(source.gripSpace, referenceSpace))
        : null;
      const targetRayPose = frame && referenceSpace && source.targetRaySpace
        ? poseFromSkykitXrPose(frame.getPose(source.targetRaySpace, referenceSpace))
        : null;
      const handPose = {
        handedness: hand,
        grip: gripPose,
        targetRay: targetRayPose,
        buttons: source.gamepad?.buttons?.length ?? 0,
        axes: source.gamepad?.axes?.length ?? 0,
      };
      if (hand === 'left') {
        nextBody.leftHand = handPose;
        writeObjectPose(context.rig?.leftHandRoot, gripPose ?? targetRayPose);
      } else {
        nextBody.rightHand = handPose;
        writeObjectPose(context.rig?.rightHandRoot, gripPose ?? targetRayPose);
      }
    }

    if (context.rig && context.shipPose) {
      context.rig.setNavigationPose(nextBody.ship);
    }

    body = nextBody;
    return getBody();
  }

  function getBody() {
    return cloneBody(body);
  }

  function getSnapshot() {
    return {
      id,
      disposed,
      body: cloneBody(body),
    };
  }

  function dispose() {
    disposed = true;
    body = {
      head: null,
      leftHand: null,
      rightHand: null,
      ship: normalizePose({}),
      torso: null,
    };
  }

  function assertActive() {
    if (disposed) {
      throw new Error('SkykitXrBodyTracker has been disposed.');
    }
  }
}

/**
 * @param {unknown} xrViewerPose
 */
export function poseFromViewer(xrViewerPose) {
  const pose = xrViewerPose && typeof xrViewerPose === 'object'
    ? /** @type {{ transform?: unknown; views?: Array<{ transform?: unknown }> }} */ (xrViewerPose)
    : null;
  if (!pose) return null;
  return poseFromTransform(pose.transform ?? pose.views?.[0]?.transform);
}

/**
 * @param {unknown} xrPose
 */
export function poseFromSkykitXrPose(xrPose) {
  const pose = xrPose && typeof xrPose === 'object'
    ? /** @type {{ transform?: unknown }} */ (xrPose)
    : null;
  return poseFromTransform(pose?.transform);
}

/**
 * @param {unknown} transform
 */
export function poseFromTransform(transform) {
  if (!transform || typeof transform !== 'object') {
    return null;
  }
  const t = /** @type {{ position?: unknown; orientation?: unknown }} */ (transform);
  if (!t.position && !t.orientation) {
    return null;
  }
  return normalizePose({
    position: t.position,
    orientation: t.orientation ?? IDENTITY_QUATERNION,
  });
}

/**
 * @param {unknown} object
 * @param {import('../xr.d.ts').SkykitXrPose | null} pose
 */
function writeObjectPose(object, pose) {
  if (!object || !pose) return;
  const target = /** @type {{ position?: { set: (x: number, y: number, z: number) => void }; quaternion?: { set: (x: number, y: number, z: number, w: number) => void } }} */ (object);
  target.position?.set(pose.position.x, pose.position.y, pose.position.z);
  target.quaternion?.set(
    pose.orientation.x,
    pose.orientation.y,
    pose.orientation.z,
    pose.orientation.w,
  );
}

/**
 * @param {import('../xr.d.ts').SkykitXrPose} pose
 */
export function forwardFromPose(pose) {
  return applyQuaternion(LOCAL_FORWARD, pose.orientation);
}

/**
 * @param {import('../xr.d.ts').SkykitXrBodyModel} body
 */
function cloneBody(body) {
  return {
    head: body.head ? clonePose(body.head) : null,
    leftHand: body.leftHand ? cloneHand(body.leftHand) : null,
    rightHand: body.rightHand ? cloneHand(body.rightHand) : null,
    ship: clonePose(body.ship),
    torso: body.torso ? clonePose(body.torso) : null,
  };
}

/**
 * @param {import('../xr.d.ts').SkykitXrHandPose} hand
 */
function cloneHand(hand) {
  return {
    handedness: hand.handedness,
    grip: hand.grip ? clonePose(hand.grip) : null,
    targetRay: hand.targetRay ? clonePose(hand.targetRay) : null,
    buttons: hand.buttons,
    axes: hand.axes,
  };
}

export { clonePose, cloneQuaternion, cloneVector3 };
