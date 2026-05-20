import { createStarCellKey, encodeMorton3D } from '@found-in-space/star-trees';

export const FIXTURE_NAMES = Object.freeze([
  'uniform',
  'clustered',
  'sparse',
  'boundary-heavy',
]);

const WORLD_HALF_SIZE_PC = 256;
const STAR_HAS_PAYLOAD = 1;

/**
 * @param {string} name
 */
export function createSyntheticFixture(name) {
  switch (name) {
    case 'uniform':
      return createFixture(name, {
        levels: [1, 2, 3, 4],
        includeCell: () => true,
        density: ({ level }) => 1 + level * 0.2,
      });
    case 'clustered':
      return createFixture(name, {
        levels: [2, 3, 4, 5],
        includeCell: ({ center }) => {
          const leftCluster = distance(center, { x: -72, y: 28, z: -32 }) < 86;
          const rightCluster = distance(center, { x: 88, y: -36, z: 54 }) < 72;
          return leftCluster || rightCluster;
        },
        density: ({ center }) => 1.5 + 6 / (1 + distance(center, { x: -72, y: 28, z: -32 }) / 20),
      });
    case 'sparse':
      return createFixture(name, {
        levels: [2, 3, 4, 5],
        includeCell: ({ gridX, gridY, gridZ, level }) =>
          ((gridX * 17 + gridY * 31 + gridZ * 43 + level * 7) % 23) < 3,
        density: () => 0.7,
      });
    case 'boundary-heavy':
      return createFixture(name, {
        levels: [2, 3, 4, 5],
        includeCell: ({ center, halfSize }) =>
          Math.abs(center.x) <= halfSize * 2.5 ||
          Math.abs(center.y) <= halfSize * 2.5 ||
          Math.abs(center.z) <= halfSize * 1.5,
        density: ({ center }) => 1 + (Math.abs(center.x) < 32 ? 2 : 0),
      });
    default:
      throw new TypeError(`Unknown synthetic star planner fixture: ${name}`);
  }
}

/**
 * @param {string} name
 * @param {{
 *   levels: number[];
 *   includeCell(input: {
 *     level: number;
 *     gridX: number;
 *     gridY: number;
 *     gridZ: number;
 *     center: { x: number; y: number; z: number };
 *     halfSize: number;
 *   }): boolean;
 *   density(input: {
 *     level: number;
 *     gridX: number;
 *     gridY: number;
 *     gridZ: number;
 *     center: { x: number; y: number; z: number };
 *     halfSize: number;
 *   }): number;
 * }} options
 */
function createFixture(name, options) {
  const nodes = [];
  for (const level of options.levels) {
    const axisCount = 2 ** level;
    const cellSize = (WORLD_HALF_SIZE_PC * 2) / axisCount;
    const halfSize = cellSize / 2;
    for (let gridX = 0; gridX < axisCount; gridX += 1) {
      for (let gridY = 0; gridY < axisCount; gridY += 1) {
        for (let gridZ = 0; gridZ < axisCount; gridZ += 1) {
          const center = {
            x: -WORLD_HALF_SIZE_PC + halfSize + gridX * cellSize,
            y: -WORLD_HALF_SIZE_PC + halfSize + gridY * cellSize,
            z: -WORLD_HALF_SIZE_PC + halfSize + gridZ * cellSize,
          };
          const input = { level, gridX, gridY, gridZ, center, halfSize };
          if (!options.includeCell(input)) continue;
          const mortonCode = encodeMorton3D(gridX, gridY, gridZ, level).toString();
          const density = Math.max(0.1, options.density(input));
          const starCount = Math.max(1, Math.round(density * (1 + level)));
          nodes.push({
            nodeKey: `${level}:${mortonCode}`,
            mortonCode,
            centerX: round(center.x, 6),
            centerY: round(center.y, 6),
            centerZ: round(center.z, 6),
            halfSize: round(halfSize, 6),
            level,
            gridX,
            gridY,
            gridZ,
            flags: STAR_HAS_PAYLOAD,
            childMask: 0,
            payloadOffset: nodes.length * 256,
            payloadLength: 128 + starCount * 24,
            firstChild: 0,
            localDepth: 0,
            localPath: 0,
            shardOffset: 0,
            nodeIndex: nodes.length,
            syntheticStarCount: starCount,
            cellKey: createStarCellKey(level, mortonCode),
          });
        }
      }
    }
  }

  return {
    name,
    worldHalfSizePc: WORLD_HALF_SIZE_PC,
    nodes,
    summary: {
      nodeCount: nodes.length,
      payloadBytes: nodes.reduce((sum, node) => sum + node.payloadLength, 0),
      starCount: nodes.reduce((sum, node) => sum + node.syntheticStarCount, 0),
      levels: Array.from(new Set(nodes.map((node) => node.level))).sort((a, b) => a - b),
    },
  };
}

/**
 * @param {{ x: number; y: number; z: number }} left
 * @param {{ x: number; y: number; z: number }} right
 */
function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

/**
 * @param {number} value
 * @param {number} precision
 */
function round(value, precision) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
