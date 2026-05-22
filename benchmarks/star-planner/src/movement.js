export const MOVEMENT_SCENARIOS = Object.freeze([
  'stationary',
  'slow-drift',
  'cruise',
  'fast-transit',
  'sudden-turn',
  'oscillation',
  'teleport',
]);

const FRAME_COUNT = 12;
const TICK_SECS = 1;

/**
 * @param {string} name
 */
export function createMovementScenario(name) {
  const frames = [];
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    frames.push(createFrame(name, index));
  }
  return {
    name,
    tickSecs: TICK_SECS,
    frames: frames.map((frame, index) => ({
      ...frame,
      velocityPcPerSec: index === 0
        ? { x: 0, y: 0, z: 0 }
        : vectorScale(vectorSubtract(frame.observerPc, frames[index - 1].observerPc), 1 / TICK_SECS),
      pathPreviewPc: createPathPreview(frames, index),
    })),
  };
}

/**
 * @param {string} name
 * @param {number} index
 */
function createFrame(name, index) {
  const t = index / Math.max(1, FRAME_COUNT - 1);
  let observerPc;
  switch (name) {
    case 'stationary':
      observerPc = { x: 0, y: 0, z: 0 };
      break;
    case 'slow-drift':
      observerPc = { x: -24 + index * 4, y: 6, z: -8 };
      break;
    case 'cruise':
      observerPc = { x: -96 + index * 18, y: 18, z: -40 + index * 3 };
      break;
    case 'fast-transit':
      observerPc = { x: -180 + index * 38, y: -40 + index * 7, z: 60 - index * 6 };
      break;
    case 'sudden-turn':
      observerPc = index < FRAME_COUNT / 2
        ? { x: -88 + index * 16, y: -24, z: -48 }
        : { x: 8, y: -24 + (index - FRAME_COUNT / 2) * 20, z: -48 + (index - FRAME_COUNT / 2) * 8 };
      break;
    case 'oscillation':
      observerPc = {
        x: Math.sin(t * Math.PI * 2.2) * 96,
        y: Math.cos(t * Math.PI * 1.6) * 42,
        z: Math.cos(t * Math.PI * 2.2) * 64,
      };
      break;
    case 'teleport':
      observerPc = index < FRAME_COUNT / 2
        ? { x: -120 + index * 4, y: 0, z: 24 }
        : { x: 118 + (index - FRAME_COUNT / 2) * 5, y: -86, z: -92 };
      break;
    default:
      throw new TypeError(`Unknown star planner movement scenario: ${name}`);
  }
  const targetPc = {
    x: observerPc.x + 96,
    y: observerPc.y + (name === 'sudden-turn' && index >= FRAME_COUNT / 2 ? 80 : 8),
    z: observerPc.z - 32,
  };
  return {
    index,
    observerPc: roundVector(observerPc),
    targetPc: roundVector(targetPc),
    limitingMagnitude: 8.5,
    mDesired: 8.5,
  };
}

/**
 * @param {Array<{ observerPc: { x: number; y: number; z: number } }>} frames
 * @param {number} index
 */
function createPathPreview(frames, index) {
  const points = [];
  const maxIndex = Math.min(frames.length - 1, index + 3);
  for (let i = index; i <= maxIndex; i += 1) {
    points.push(roundVector(frames[i].observerPc));
  }
  while (points.length < 2) {
    points.push({ ...points[0] });
  }
  return points;
}

/**
 * @param {{ x: number; y: number; z: number }} value
 */
function roundVector(value) {
  return {
    x: round(value.x),
    y: round(value.y),
    z: round(value.z),
  };
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function vectorSubtract(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

/**
 * @param {{ x: number; y: number; z: number }} value
 * @param {number} scale
 */
function vectorScale(value, scale) {
  return roundVector({
    x: value.x * scale,
    y: value.y * scale,
    z: value.z * scale,
  });
}

/**
 * @param {number} value
 */
function round(value) {
  return Math.round(value * 1000) / 1000;
}
