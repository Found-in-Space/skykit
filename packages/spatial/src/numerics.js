

export const EPSILON = 1e-9;

export const DEFAULT_SAMPLE_STEP_SECS = 1 / 60;

export function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function finiteRequiredNumber(value, label) {
  if (typeof value !== 'number') throw new TypeError(`${label} must be a number.`);
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number.`);
  return value;
}

export function positiveFiniteNumber(value, label) {
  const number = finiteRequiredNumber(value, label);
  if (!(number > 0)) throw new RangeError(`${label} must be greater than zero.`);
  return number;
}

export function nonNegativeFiniteNumber(value, label) {
  const number = finiteRequiredNumber(value, label);
  if (number < 0) throw new RangeError(`${label} must be non-negative.`);
  return number;
}

export function finiteNumberInRange(value, min, max, label) {
  const number = finiteRequiredNumber(value, label);
  if (number < min || number > max) throw new RangeError(`${label} must be between ${min} and ${max}.`);
  return number;
}

export function finiteTime(value) {
  return nonNegativeFiniteNumber(value, 'timeSecs');
}

export function positiveIntegerRequired(value, label) {
  const number = positiveFiniteNumber(value, label);
  if (!Number.isInteger(number)) throw new RangeError(`${label} must be an integer.`);
  return number;
}

export function nonNegativeIntegerRequired(value, label) {
  const number = nonNegativeFiniteNumber(value, label);
  if (!Number.isInteger(number)) throw new RangeError(`${label} must be an integer.`);
  return number;
}

export function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function positiveInteger(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function withTimingDurationConstraints(output, input) {
  const minDurationSecs = input.minDurationSecs !== undefined
    ? nonNegativeFiniteNumber(input.minDurationSecs, 'minDurationSecs')
    : undefined;
  const maxDurationSecs = input.maxDurationSecs !== undefined
    ? nonNegativeFiniteNumber(input.maxDurationSecs, 'maxDurationSecs')
    : undefined;
  if (minDurationSecs !== undefined && maxDurationSecs !== undefined && minDurationSecs > maxDurationSecs) {
    throw new RangeError('minDurationSecs cannot be greater than maxDurationSecs.');
  }
  return {
    ...output,
    ...(minDurationSecs !== undefined ? { minDurationSecs } : {}),
    ...(maxDurationSecs !== undefined ? { maxDurationSecs } : {}),
  };
}

export function nearlyEqual(left, right, tolerance = 1e-6) {
  return left === right || Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right)) * tolerance;
}

export function timingDistanceNearlyEqual(left, right, referenceScale = 0) {
  if (left === right) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  const floatingPointTolerance = Number.EPSILON * 32 * Math.abs(referenceScale);
  return Math.abs(left - right) <= Math.max(scale * 1e-9, floatingPointTolerance);
}

export function timingTimeNearlyEqual(left, right) {
  if (left === right) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return scale > 0 && Math.abs(left - right) <= scale * 1e-12;
}

export function timingScalarNearlyEqual(left, right) {
  if (left === right) return true;
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return scale > 0 && Math.abs(left - right) <= scale * 1e-7;
}

export function degreesToRadians(degrees) {
  return degrees * Math.PI / 180;
}

export function radiansToDegrees(radians) {
  return radians * 180 / Math.PI;
}

export function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function compareTime(a, b) {
  return a.timeSecs - b.timeSecs;
}

export function warning(code, message, metadata) {
  return { code, severity: 'warning', message, ...(metadata ? { metadata } : {}) };
}

export function copySource(input) {
  return input.source !== undefined ? { source: input.source } : {};
}

export function isVectorLike(input) {
  return Boolean(input && typeof input === 'object' && 'x' in input && 'y' in input && 'z' in input);
}

export function isDestinationLike(input) {
  return Boolean(input && typeof input === 'object' && 'center' in input && !('position' in input));
}
