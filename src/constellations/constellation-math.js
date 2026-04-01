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

export function normalizeDirection([x, y, z]) {
  const radius = Math.hypot(x, y, z) || 1;
  return [x / radius, y / radius, z / radius];
}

export function resolveAnchorDirection(anchor) {
  const direction = Array.isArray(anchor?.direction) ? anchor.direction : null;
  return direction && direction.length === 3 ? direction : null;
}

export function solveAffineMap(anchors, transformDirection) {
  const matrix = [
    [1, anchors[0].pos[0], anchors[0].pos[1]],
    [1, anchors[1].pos[0], anchors[1].pos[1]],
    [1, anchors[2].pos[0], anchors[2].pos[1]],
  ];
  const directions = anchors.map((anchor) => {
    const direction = resolveAnchorDirection(anchor);
    if (!direction) {
      return null;
    }
    return transformDirection(direction[0], direction[1], direction[2]);
  });
  if (directions.some((direction) => direction == null)) {
    return null;
  }

  const inverse = invert3(matrix);
  if (!inverse) {
    return null;
  }

  const coefficients = [
    multiplyMatrixVector(inverse, directions.map((direction) => direction[0])),
    multiplyMatrixVector(inverse, directions.map((direction) => direction[1])),
    multiplyMatrixVector(inverse, directions.map((direction) => direction[2])),
  ];

  return (u, v) => [
    coefficients[0][0] + coefficients[0][1] * u + coefficients[0][2] * v,
    coefficients[1][0] + coefficients[1][1] * u + coefficients[1][2] * v,
    coefficients[2][0] + coefficients[2][1] * u + coefficients[2][2] * v,
  ];
}
