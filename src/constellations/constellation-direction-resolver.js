import {
  normalizeDirection,
  resolveAnchorDirection,
  solveAffineMap,
} from './constellation-math.js';

function normalizeDirectionInput(direction) {
  return Array.isArray(direction) && direction.length === 3
    ? normalizeDirection(direction)
    : null;
}

function identityTransform(x, y, z) {
  return [x, y, z];
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

function createEntry(constellation) {
  const size = Array.isArray(constellation?.image?.size) ? constellation.image.size : [512, 512];
  const [width, height] = size;
  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  const anchors = constellation?.image?.anchors?.slice(0, 3);
  if (!Array.isArray(anchors) || anchors.length < 3) {
    return null;
  }

  const dirAt = solveAffineMap(anchors, identityTransform);
  if (!dirAt) {
    return null;
  }

  const corners = [[0, 0], [width, 0], [width, height], [0, height]]
    .map(([u, v]) => normalizeDirection(dirAt(u, v)));

  const anchorDirections = anchors
    .map((anchor) => resolveAnchorDirection(anchor))
    .filter((value) => Array.isArray(value));
  if (anchorDirections.length < 3) {
    return null;
  }

  const centroid = normalizeDirection(anchorDirections.reduce(
    (sum, [x, y, z]) => [sum[0] + x, sum[1] + y, sum[2] + z],
    [0, 0, 0],
  ));

  return {
    iau: constellation?.iau ?? null,
    id: constellation?.id ?? null,
    name: constellation?.common_name ?? null,
    corners,
    centroid,
  };
}

function normalizeLookupKey(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function createSummary(constellation, entry) {
  return {
    iau: constellation?.iau ?? null,
    id: constellation?.id ?? null,
    name: constellation?.common_name ?? null,
    hasArt: Boolean(entry),
    centroidIcrs: entry?.centroid ?? null,
    centroidRaDec: entry ? toRaDec(entry.centroid) : null,
    cornersIcrs: entry?.corners ?? null,
    cornersRaDec: entry ? entry.corners.map((direction) => toRaDec(direction)) : null,
  };
}

export function toRaDec(icrsDirection) {
  const direction = normalizeDirectionInput(icrsDirection);
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

export function buildConstellationDirectionResolver(manifest) {
  const manifestConstellations = Array.isArray(manifest?.constellations) ? manifest.constellations : [];
  const entries = (manifest?.constellations ?? [])
    .map((constellation) => createEntry(constellation))
    .filter(Boolean);
  const entryByIau = new Map(entries.map((entry) => [entry.iau, entry]));
  const lookup = new Map();

  for (const constellation of manifestConstellations) {
    const summary = createSummary(constellation, entryByIau.get(constellation?.iau));
    const keys = [
      normalizeLookupKey(constellation?.iau),
      normalizeLookupKey(constellation?.id),
      normalizeLookupKey(constellation?.common_name?.english),
      normalizeLookupKey(constellation?.common_name?.native),
    ].filter(Boolean);
    for (const key of keys) {
      if (!lookup.has(key)) {
        lookup.set(key, summary);
      }
    }
  }

  function resolve(icrsDirection, currentIau = null) {
    const point = normalizeDirectionInput(icrsDirection);
    if (!point || entries.length === 0) {
      return null;
    }

    const inside = entries
      .map((entry) => ({ ...entry, score: dot(entry.centroid, point) }))
      .filter((entry) => entry.score > 0 && isInsideSphericalQuad(point, entry.corners));

    if (inside.length > 0) {
      if (currentIau) {
        const sticky = inside.find((entry) => entry.iau === currentIau);
        if (sticky) {
          return { iau: sticky.iau, id: sticky.id, score: sticky.score };
        }
      }

      const winner = inside.reduce((best, entry) => (entry.score > best.score ? entry : best), inside[0]);
      return { iau: winner.iau, id: winner.id, score: winner.score };
    }

    const closest = entries.reduce((best, entry) => {
      const score = dot(entry.centroid, point);
      if (!best || score > best.score) {
        return { ...entry, score };
      }
      return best;
    }, null);

    if (!closest) {
      return null;
    }

    return {
      iau: closest.iau,
      id: closest.id,
      score: closest.score,
    };
  }

  return {
    resolve,
    toRaDec,
    listConstellations() {
      return manifestConstellations.map((constellation) => (
        createSummary(constellation, entryByIau.get(constellation?.iau))
      ));
    },
    getConstellation(nameOrIau) {
      const key = normalizeLookupKey(nameOrIau);
      if (!key) {
        return null;
      }
      return lookup.get(key) ?? null;
    },
    getStats() {
      return {
        constellationCount: entries.length,
        listedConstellationCount: manifestConstellations.length,
      };
    },
  };
}
