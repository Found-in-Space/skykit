export function identityIcrsToSceneTransform(x, y, z) {
  return [x, y, z];
}

export function identitySceneToIcrsTransform(x, y, z) {
  return [x, y, z];
}

function createOrientationFrame(targetPc) {
  if (
    !targetPc
    || !Number.isFinite(targetPc.x)
    || !Number.isFinite(targetPc.y)
    || !Number.isFinite(targetPc.z)
  ) {
    throw new TypeError('createIcrsToSceneYUpTransform() requires a finite targetPc');
  }

  const up = [0, 0, 1];
  const targetLength = Math.hypot(targetPc.x, targetPc.y, targetPc.z);
  if (!(targetLength > 0)) {
    throw new RangeError('createIcrsToSceneYUpTransform() requires a non-zero targetPc distance');
  }
  const forward = [targetPc.x / targetLength, targetPc.y / targetLength, targetPc.z / targetLength];
  let right = [
    up[1] * forward[2] - up[2] * forward[1],
    up[2] * forward[0] - up[0] * forward[2],
    up[0] * forward[1] - up[1] * forward[0],
  ];
  const rightLength = Math.hypot(right[0], right[1], right[2]);
  right = right.map((value) => value / rightLength);
  const forwardEq = [
    right[1] * up[2] - right[2] * up[1],
    right[2] * up[0] - right[0] * up[2],
    right[0] * up[1] - right[1] * up[0],
  ];

  return {
    right,
    up,
    forwardEq,
  };
}

export function createIcrsToSceneYUpTransform(targetPc) {
  const frame = createOrientationFrame(targetPc);

  return function icrsToSceneYUp(x, y, z) {
    return [
      -(x * frame.right[0] + y * frame.right[1] + z * frame.right[2]),
      x * frame.up[0] + y * frame.up[1] + z * frame.up[2],
      -(x * frame.forwardEq[0] + y * frame.forwardEq[1] + z * frame.forwardEq[2]),
    ];
  };
}

export function createSceneToIcrsYUpTransform(targetPc) {
  const frame = createOrientationFrame(targetPc);

  return function sceneToIcrsYUp(x, y, z) {
    return [
      -x * frame.right[0] + y * frame.up[0] - z * frame.forwardEq[0],
      -x * frame.right[1] + y * frame.up[1] - z * frame.forwardEq[1],
      -x * frame.right[2] + y * frame.up[2] - z * frame.forwardEq[2],
    ];
  };
}

export function createSceneOrientationTransforms(targetPc) {
  return {
    icrsToScene: createIcrsToSceneYUpTransform(targetPc),
    sceneToIcrs: createSceneToIcrsYUpTransform(targetPc),
  };
}
