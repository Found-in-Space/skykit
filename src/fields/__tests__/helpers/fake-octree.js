import { HAS_PAYLOAD } from '../../../services/octree/octree-file-service.js';

const ROOT_SHARD_OFFSET = 1;
const DEFAULT_ENTRY_NODES = Object.freeze([1, 0, 0, 0, 0, 0, 0, 0]);
const ALL_OCTANTS = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7]);

function createFakeShard({
  offset = ROOT_SHARD_OFFSET,
  parentGlobalDepth = -1,
  parentGridX = 0,
  parentGridY = 0,
  parentGridZ = 0,
  entryNodes = DEFAULT_ENTRY_NODES,
  nodes = [],
  frontierContinuations = {},
} = {}) {
  return {
    shardOffset: offset,
    hdr: {
      offset,
      nodeCount: nodes.length,
      parentGlobalDepth,
      parentGridX,
      parentGridY,
      parentGridZ,
      entryNodes: [...entryNodes],
      firstFrontierIndex: 0,
    },
    readNode(nodeIndex) {
      const record = nodes[nodeIndex - 1];
      if (!record) {
        throw new Error(`No fake node record for index ${nodeIndex}`);
      }
      return record;
    },
    readFrontierContinuation(nodeIndex) {
      return BigInt(frontierContinuations[nodeIndex] ?? 0);
    },
  };
}

export function createEightOctantFixture(options = {}) {
  const worldHalfSize = options.worldHalfSize ?? 100;
  const magLimit = options.magLimit ?? 6.5;
  const payloadOctants = Array.isArray(options.payloadOctants)
    ? [...options.payloadOctants].sort((left, right) => left - right)
    : [...ALL_OCTANTS];
  const payloadMask = payloadOctants.reduce((mask, octant) => mask | (1 << octant), 0);

  const rootNode = {
    firstChild: payloadOctants.length > 0 ? 2 : 0,
    localPath: 0,
    childMask: payloadMask,
    localDepth: 1,
    flags: 0,
    reserved: 0,
    payloadOffset: 0,
    payloadLength: 0,
  };

  const childNodes = payloadOctants.map((octant) => ({
    firstChild: 0,
    localPath: octant,
    childMask: 0,
    localDepth: 2,
    flags: HAS_PAYLOAD,
    reserved: 0,
    payloadOffset: 1000 + octant,
    payloadLength: 16,
  }));

  const rootShard = createFakeShard({
    nodes: [rootNode, ...childNodes],
  });

  const renderService = {
    async ensureBootstrapAndRootShard() {
      return {
        bootstrap,
        rootShard,
      };
    },
    async ensureRootShard() {
      return rootShard;
    },
    async loadShard(shardOffset) {
      if (shardOffset !== ROOT_SHARD_OFFSET) {
        throw new Error(`Unknown fake shard offset ${shardOffset}`);
      }
      return rootShard;
    },
  };

  const bootstrap = {
    header: {
      version: 1,
      indexOffset: ROOT_SHARD_OFFSET,
      indexLength: 0,
      worldCenterX: 0,
      worldCenterY: 0,
      worldCenterZ: 0,
      worldHalfSize,
      payloadRecordSize: 16,
      maxLevel: 1,
      magLimit,
    },
    rootShardOffset: ROOT_SHARD_OFFSET,
    worldHalfSize,
    magLimit,
    payloadRecordSize: 16,
  };

  const datasetSession = {
    async ensureRenderBootstrap() {
      return bootstrap;
    },
    getRenderService() {
      return renderService;
    },
  };

  return {
    bootstrap,
    datasetSession,
    renderService,
    rootShard,
    payloadOctants,
  };
}

export function createFieldTestContext(options = {}) {
  const fixture = createEightOctantFixture(options.fixture);

  return {
    datasetSession: fixture.datasetSession,
    state: {
      ...(options.state ?? {}),
    },
    size: options.size ?? { width: 1000, height: 1000 },
    camera: options.camera ?? { aspect: 1 },
    phase: options.phase ?? 'select',
    fixture,
  };
}

export function selectedOctantsForFixture(selection) {
  return (Array.isArray(selection?.nodes) ? selection.nodes : [])
    .map((node) => node.nodeIndex - 2)
    .sort((left, right) => left - right);
}
