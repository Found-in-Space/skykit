// Match the current viewer convention: 1 parsec = 0.001 Three.js world units (octree / desktop).
export const SCALE = 0.001;

/** XR / immersive: world meters per parsec after contentRoot scale (1 = walk 1 m ≈ move 1 pc). Tunable via viewer state `starFieldScale`. */
export const DEFAULT_METERS_PER_PARSEC = 1.0;

/** XR (`local-floor`): Sun / star-field origin height above the floor (m), ~standing eye level (matches copc-viewer `DEMO_EYE_LEVEL_M`). */
export const XR_SUN_EYE_LEVEL_M = 1.6;

/**
 * XR: shift the Sun along **horizontal** view forward so it sits slightly in front of the observer (m).
 * Equivalent to a short step back from the nominal solar origin for comfort.
 */
export const XR_SUN_FORWARD_OFFSET_M = 0.5;

