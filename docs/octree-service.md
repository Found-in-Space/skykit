# Sprint 1 Implementation Spec: Star Octree Provider Service

## 1. Goal

Build a focused **Star Octree Provider Service** that extracts the current star-octree loading, decoding, streaming, caching, and snapshot logic into an encapsulated provider API.

This sprint should **not** attempt the full SkyKit object-layer kernel or global message bus. It should create the first concrete provider boundary that future architecture can build on.

The provider should support two modes:

```txt
1. One-shot explicit request
   provider.streamObjectBatches({ nodes, ... })

2. Live provider session
   const session = provider.createSession(...)
   session.updateNodes(nodes)
   session.deltas()
```

The live session model is the important architectural step. The provider service owns shared source/cache state. The provider session owns one consumer’s current working set, navigation-related demand state, products, and stream lifecycle.

---

## 2. Current-code basis

Current SkyKit already contains most of the lower-level functionality needed for this sprint.

`DatasetSession` already owns dataset identity, named caches, service instances, sidecar descriptors, and render-service construction. It exposes cache sizes and service snapshots through `describe()`. 

`RenderOctreeService` already wraps the lower-level octree file service and exposes methods such as `ensureBootstrap()`, `ensureRootShard()`, `loadShard()`, `fetchNodePayloadBatchProgressive()`, `resolveNodeByLevelMorton()`, `decodePayload()`, and `describe()`. 

`OctreeFileService` already implements range requests, header parsing, shard parsing, shard prefetch, payload range batching, gzip decompression, persistent cache reads, progressive payload batch callbacks, and detailed statistics counters. 

The current `StarFieldLayer` already does the downstream operation we want to formalize: fetch selected node payloads progressively, decode them into typed arrays, concatenate `positions`, `teffLog8`, and `magAbs`, then commit those arrays into geometry. 

Sprint 1 should wrap that existing capability into a provider/session API without rewriting the renderer.

---

## 3. Non-goals

This sprint must **not**:

```txt
- rewrite ViewerRuntime
- rewrite StarFieldLayer
- implement the full object-layer kernel
- implement the global message bus
- implement workers
- implement WASM
- implement sidecar fact providers
- change current demos
- move all selection logic into the provider
- introduce Three.js objects into provider products
- introduce Touch OS concepts
```

This sprint is about a clean provider/session boundary for the current star octree.

---

## 4. Architectural boundary

### 4.1 Provider service

The provider service is long-lived and shared.

```txt
StarOctreeProviderService
  owns source access, bootstrap, shard/payload caches, decode helpers,
  provider-level stats, memory accounting, and provider snapshots.
```

It should **not** own current camera state, current app state, renderer state, UI state, XR state, or labels.

### 4.2 Provider session

The provider session is per consumer or per live working set.

```txt
StarOctreeProviderSession
  owns one consumer’s selected nodes, latest provider-relevant view state,
  active requests, product stream, retained products, stale products,
  and session snapshot.
```

Navigation updates should go to the **session**, not the service.

### 4.3 Why this split matters

Two renderers may share one provider service but use different sessions:

```txt
same provider:
  shared bootstrap
  shared shard cache
  shared payload cache
  shared decoded cache, later

different sessions:
  different observer state
  different magnitude limit
  different selected nodes
  different products
  different stream lifecycle
```

---

## 5. Proposed source layout

Preferred layout:

```txt
src/providers/
  star-octree/
    index.js
    index.d.ts
    star-octree-provider-service.js
    star-octree-provider-session.js
    star-octree-products.js
    star-octree-queue.js
    __tests__/
      star-octree-provider-service.test.js
      star-octree-provider-session.test.js
      star-octree-products.test.js
```

Alternative if we want to stay closer to current structure:

```txt
src/services/octree/star-octree-provider-service.js
src/services/octree/star-octree-provider-session.js
```

I recommend `src/providers/star-octree/` because the long-term architecture is provider-oriented.

---

## 6. Public API

### 6.1 Creation

```js
import { createStarOctreeProviderService } from '@found-in-space/skykit/providers/star-octree';

const provider = createStarOctreeProviderService({
  datasetSession,
});
```

Also allow:

```js
const provider = createStarOctreeProviderService({
  session,
});
```

where `session` is an existing `DatasetSession`.

### 6.2 Provider service API

```ts
export interface StarOctreeProviderService {
  id: string;

  describe(): StarOctreeProviderDescriptor;

  getSnapshot(): StarOctreeProviderSnapshot;

  ensureBootstrap(): Promise<StarOctreeBootstrapProduct>;

  ensureRootShard(): Promise<StarOctreeRootShardProduct>;

  streamPayloads(
    request: StarOctreePayloadRequest
  ): AsyncIterable<StarOctreePayloadDelta>;

  streamObjectBatches(
    request: StarOctreeObjectBatchRequest
  ): AsyncIterable<StarOctreeProductDelta>;

  fetchObjectBatch(
    request: StarOctreeObjectBatchRequest
  ): Promise<StarObjectBatchProduct>;

  createSession(
    options?: StarOctreeSessionOptions
  ): StarOctreeProviderSession;

  cancel?(requestId: string): void;

  dispose(): void | Promise<void>;
}
```

### 6.3 Provider session API

```ts
export interface StarOctreeProviderSession {
  id: string;

  updateNodes(
    nodes: StarOctreeRuntimeNode[],
    options?: ExplicitNodeUpdateOptions
  ): StarOctreeViewReceipt;

  updateView(
    patch: StarOctreeViewPatch,
    options?: ViewUpdateOptions
  ): StarOctreeViewReceipt;

  subscribe(
    listener: (delta: StarOctreeProductDelta) => void
  ): () => void;

  deltas(): AsyncIterable<StarOctreeProductDelta>;

  getSnapshot(): StarOctreeSessionSnapshot;

  cancel(reason?: string): void;

  dispose(): void | Promise<void>;
}
```

Sprint 1 should implement `updateNodes()` fully.

`updateView()` should exist, store provider-relevant view state, and return a receipt. It does not need to perform provider-owned node selection yet unless there is time.

---

## 7. Provider descriptor

```ts
export interface StarOctreeProviderDescriptor {
  id: string;
  providerType: 'star-octree';

  datasetId?: string | null;
  datasetIdentitySource?: string | null;

  url?: string | null;

  produces: Array<'index' | 'object-batch'>;

  objectTypes: ['star'];

  attributes: Array<
    | 'position'
    | 'teffLog8'
    | 'magAbs'
    | 'objectRef'
    | 'pickMeta'
  >;

  capabilities: {
    progressive: true;
    cancellable: boolean;
    rangeRequestable: true;
    payloadBatching: true;
    persistentCache: boolean;
    decodedCache: boolean;
    borrowedBuffers: boolean;
    transferableBuffers: boolean;
    sessions: true;
  };

  limits: {
    memoryBudgetBytes?: number;
    maxInflightPayloadBatches?: number;
    payloadMaxGapBytes?: number;
    payloadMaxBatchBytes?: number;
  };
}
```

Initial values can be derived from the underlying `RenderOctreeService.describe()` / `OctreeFileService.describe()`.

---

## 8. Session options

```ts
export type StarOctreeFetchStrategy =
  | {
      kind: 'explicit-nodes';
    }
  | {
      kind: 'observer-shell';
      observerDistancePc?: number;
      maxLevel?: number;
      motionAdaptiveMaxLevel?: {
        lookaheadSecs: number;
        minLevel?: number;
      };
    }
  | {
      kind: 'target-frustum';
      verticalFovDeg?: number;
      overscanDeg?: number;
      nearPc?: number;
      farPc?: number;
      maxLevel?: number;
    }
  | {
      kind: 'custom';
      selectNodes: (
        context: StarOctreeSelectionContext
      ) => Promise<StarOctreeRuntimeNode[]> | StarOctreeRuntimeNode[];
    };

export interface StarOctreeSessionOptions {
  id?: string;

  strategy?: StarOctreeFetchStrategy;

  attributes?: Array<
    | 'position'
    | 'teffLog8'
    | 'magAbs'
    | 'objectRef'
    | 'pickMeta'
    | string
  >;

  /**
   * Compatibility mode.
   * Long-term, provider output should prefer canonical pc coordinates;
   * current renderer compatibility may use scene-scaled positions.
   */
  positionUnit?: 'scene' | 'pc';

  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
    retainPreviousUntilReplacement?: boolean;
    coarseFirst?: boolean;
  };

  memory?: {
    ownership?: 'borrowed' | 'copy' | 'transfer';
  };

  replanThresholds?: {
    observerDistancePc?: number;
    limitingMagnitudeDelta?: number;
    directionAngleDeg?: number;
    maxLevelDelta?: number;
  };
}
```

Default sprint-1 options:

```js
{
  strategy: { kind: 'explicit-nodes' },
  attributes: ['position', 'teffLog8', 'magAbs'],
  positionUnit: 'scene',
  streaming: {
    progressive: true,
    emitCachedFirst: true,
    retainPreviousUntilReplacement: true,
  },
  memory: {
    ownership: 'borrowed',
  },
}
```

---

## 9. View patch shape

```ts
export interface StarOctreeViewPatch {
  observerPc?: { x: number; y: number; z: number };

  /**
   * Alias accepted for current SkyKit naming.
   */
  mDesired?: number;

  /**
   * Preferred provider-session naming.
   */
  limitingMagnitude?: number;

  targetPc?: { x: number; y: number; z: number };

  directionIcrs?: { x: number; y: number; z: number };

  verticalFovDeg?: number;
  aspectRatio?: number;
  nearPc?: number;
  farPc?: number;
  maxLevel?: number;
  preloadDistancePc?: number;

  motion?: {
    velocityPcPerSec?: { x: number; y: number; z: number };
    speedPcPerSec?: number;
    lookaheadSecs?: number;
  };

  params?: Record<string, unknown>;
}

export interface ViewUpdateOptions {
  replan?: 'auto' | 'force' | 'suppress';
  reason?: string;
}
```

Sprint 1 behavior:

```txt
updateView()
  - normalizes and stores provider-relevant view state
  - increments viewRevision
  - decides whether a managed strategy can replan
  - for explicit-nodes strategy, usually returns replan: 'skipped'
  - emits no data by itself unless strategy implementation supports selection
```

---

## 10. View receipt

```ts
export interface StarOctreeViewReceipt {
  sessionId: string;

  viewRevision: number;
  demandRevision: number;

  replan: 'skipped' | 'scheduled' | 'forced';

  reasons: Array<
    | 'initial'
    | 'nodes-changed'
    | 'observer-distance'
    | 'limiting-magnitude'
    | 'strategy'
    | 'view-volume'
    | 'max-level'
    | 'manual'
    | 'unsupported-strategy'
  >;
}
```

Example:

```js
const receipt = session.updateView({
  observerPc,
  limitingMagnitude: 6.5,
});

if (receipt.replan === 'skipped') {
  // No new fetch needed.
}
```

---

## 11. Explicit node update

```ts
export interface ExplicitNodeUpdateOptions {
  reason?: string;
  retainPreviousUntilReplacement?: boolean;
  cancelInflight?: boolean;
}

session.updateNodes(nodes, {
  reason: 'selection/changed',
  retainPreviousUntilReplacement: true,
});
```

Expected behavior:

```txt
1. Normalize node list.
2. Compute selection signature.
3. If signature unchanged, return skipped receipt.
4. Increment demandRevision.
5. Cancel old volatile in-flight request if configured.
6. Start progressive object-batch stream.
7. Emit product deltas as batches arrive.
8. Mark old products stale or retain according to session policy.
```

This is the most important sprint-1 behavior.

---

## 12. Request shapes

### 12.1 Object batch request

```ts
export interface StarOctreeObjectBatchRequest {
  id?: string;

  nodes: StarOctreeRuntimeNode[];

  viewRevision?: number;
  demandRevision?: number;

  attributes?: Array<
    | 'position'
    | 'teffLog8'
    | 'magAbs'
    | 'objectRef'
    | 'pickMeta'
    | string
  >;

  positionUnit?: 'scene' | 'pc';

  streaming?: {
    progressive?: boolean;
    batchMode?: 'payload-range' | 'node';
    emitCachedFirst?: boolean;
    retainOrder?: boolean;
  };

  memory?: {
    ownership?: 'borrowed' | 'copy' | 'transfer';
  };

  signal?: AbortSignal;
}
```

### 12.2 Payload request

```ts
export interface StarOctreePayloadRequest {
  id?: string;
  nodes: StarOctreeRuntimeNode[];

  streaming?: {
    progressive?: boolean;
    emitCachedFirst?: boolean;
  };

  signal?: AbortSignal;
}
```

---

## 13. Runtime node shape

Use the current runtime node shape from `RenderOctreeService`.

```ts
export interface StarOctreeRuntimeNode {
  nodeKey: string;

  centerX: number;
  centerY: number;
  centerZ: number;
  halfSize: number;

  level: number;
  gridX: number;
  gridY: number;
  gridZ: number;

  flags: number;
  childMask: number;

  payloadOffset: number;
  payloadLength: number;

  firstChild: number;
  localDepth: number;
  localPath: number;

  shardOffset: number;
  nodeIndex: number;
}
```

The current `RenderOctreeService` builds these runtime nodes from shard records and node geometry. 

---

## 14. Product shapes

### 14.1 Bootstrap product

```ts
export interface StarOctreeBootstrapProduct {
  productType: 'index';
  indexKind: 'star-octree-bootstrap';

  providerId: string;

  datasetId?: string | null;
  datasetIdentitySource?: string | null;

  header: {
    version: number;
    indexOffset: number;
    indexLength: number;
    worldCenterX: number;
    worldCenterY: number;
    worldCenterZ: number;
    worldHalfSize: number;
    payloadRecordSize: number;
    maxLevel: number;
    magLimit: number;
  };

  completeness: {
    phase: 'complete';
    stable: true;
  };
}
```

### 14.2 Root shard product

```ts
export interface StarOctreeRootShardProduct {
  productType: 'index';
  indexKind: 'star-octree-root-shard';

  providerId: string;

  rootShardOffset: number;

  completeness: {
    phase: 'complete';
    stable: true;
  };

  metadata?: Record<string, unknown>;
}
```

### 14.3 Object batch product

```ts
export interface StarObjectBatchProduct {
  productType: 'object-batch';

  id: string;
  providerId: string;

  layerId: 'stars';
  objectType: 'star';

  requestId: string;
  sessionId?: string;

  viewRevision?: number;
  demandRevision?: number;

  count: number;

  nodes: Array<{
    nodeKey: string;
    level: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
    halfSize: number;
    count: number;
    offset: number;
  }>;

  coordinates: {
    primary: {
      name: 'position';
      frame: 'icrs';
      representation: 'cartesian3';
      units: ['pc', 'pc', 'pc'] | ['scene', 'scene', 'scene'];
      stride: 3;
      components: Float32Array;
    };
  };

  attributes: {
    teffLog8?: {
      name: 'teffLog8';
      kind: 'number';
      values: Uint8Array;
    };

    magAbs?: {
      name: 'magAbs';
      kind: 'number';
      unit: 'mag';
      values: Float32Array;
    };
  };

  refs?: CanonicalObjectRef[];

  pickMeta?: Array<{
    nodeKey: string;
    ordinal: number;
    level: number;
    gridX: number;
    gridY: number;
    gridZ: number;
    centerX: number;
    centerY: number;
    centerZ: number;
  }>;

  completeness: {
    phase: 'coarse' | 'partial' | 'complete' | 'stale';
    stable: boolean;
    loadedObjects: number;
    loadedNodes: number;
    totalNodes?: number;
  };

  memory: {
    ownership: 'borrowed' | 'copy' | 'transfer';
    bytes: number;
  };

  metadata?: Record<string, unknown>;
}
```

---

## 15. Delta shapes

### 15.1 Payload deltas

```ts
export type StarOctreePayloadDelta =
  | {
      type: 'payload/batch';
      requestId: string;
      providerId: string;
      sessionId?: string;

      entries: Array<{
        node: StarOctreeRuntimeNode;
        buffer: ArrayBuffer;
      }>;

      cached?: boolean;

      completeness: {
        phase: 'partial' | 'complete';
      };
    }
  | {
      type: 'payload/progress';
      requestId: string;
      providerId: string;
      sessionId?: string;

      loadedNodes: number;
      totalNodes: number;
      loadedBytes?: number;
    }
  | {
      type: 'payload/complete';
      requestId: string;
      providerId: string;
      sessionId?: string;
    }
  | {
      type: 'payload/error';
      requestId: string;
      providerId: string;
      sessionId?: string;

      error: {
        message: string;
        code?: string;
      };
    };
```

### 15.2 Product deltas

```ts
export type StarOctreeProductDelta =
  | {
      type: 'data/product-upsert';
      requestId: string;
      providerId: string;
      sessionId?: string;
      product: StarObjectBatchProduct;
    }
  | {
      type: 'data/product-stale';
      providerId: string;
      sessionId?: string;
      productId: string;
      reason?: string;
    }
  | {
      type: 'data/product-remove';
      providerId: string;
      sessionId?: string;
      productId: string;
      reason?: string;
    }
  | {
      type: 'data/product-complete';
      requestId: string;
      providerId: string;
      sessionId?: string;
      productId: string;
      completeness: StarObjectBatchProduct['completeness'];
    }
  | {
      type: 'data/product-error';
      requestId: string;
      providerId: string;
      sessionId?: string;

      error: {
        message: string;
        code?: string;
      };
    };
```

---

## 16. Session snapshot

```ts
export interface StarOctreeSessionSnapshot {
  id: string;

  strategy: StarOctreeFetchStrategy;

  view: {
    revision: number;

    observerPc?: { x: number; y: number; z: number };
    limitingMagnitude?: number;
    targetPc?: { x: number; y: number; z: number };

    maxLevel?: number;
  };

  demand: {
    revision: number;

    status:
      | 'idle'
      | 'planning'
      | 'loading'
      | 'streaming'
      | 'complete'
      | 'stale'
      | 'cancelled'
      | 'failed'
      | 'disposed';

    selectedNodeCount: number;
    retainedProductCount: number;
    activeRequestCount: number;
  };

  products: Array<{
    productId: string;
    nodeCount: number;
    starCount: number;
    phase: 'coarse' | 'partial' | 'complete' | 'stale';
    bytes: number;
  }>;

  memory: {
    liveBytes: number;
    borrowedBytes: number;
    evictableBytes: number;
  };

  lastReasons: string[];

  lastError?: string | null;
}
```

---

## 17. Provider snapshot

```ts
export interface StarOctreeProviderSnapshot {
  id: string;
  providerType: 'star-octree';

  dataset: {
    datasetId?: string | null;
    identitySource?: string | null;
    url?: string | null;
    bootstrapReady: boolean;
    rootShardReady: boolean;
  };

  cache: {
    bootstrapHeaders: number;
    shardHeaders: number;
    payloads: number;
    decodedPayloads?: number;
    products?: number;
  };

  sessions: Array<{
    id: string;
    status: StarOctreeSessionSnapshot['demand']['status'];
    selectedNodeCount: number;
    activeRequestCount: number;
    productCount: number;
    liveBytes: number;
  }>;

  requests: Array<{
    requestId: string;
    sessionId?: string;

    status:
      | 'queued'
      | 'fetching'
      | 'decoding'
      | 'streaming'
      | 'complete'
      | 'cancelled'
      | 'failed';

    nodeCount?: number;
    bytesRequested?: number;
    startedAtMs?: number;
    completedAtMs?: number;
  }>;

  memory: {
    budgetBytes?: number;
    usedBytes?: number;
    rawPayloadBytes?: number;
    decodedPayloadBytes?: number;
    liveProductBytes?: number;
    borrowedBytes?: number;
    evictableBytes?: number;
  };

  stats: {
    rangeRequests: number;
    bytesRequested: number;
    payloadBatchRequests: number;
    payloadNodesFetched: number;
    payloadCacheHits: number;
    shardCacheHits: number;
    headerCacheHits: number;
    persistentCacheHits: number;
    fetchTimeMs: number;
  };
}
```

---

## 18. Implementation details

### 18.1 Async queue helper

Because current `fetchNodePayloadBatchProgressive()` uses callbacks, create a small async queue.

```js
export function createAsyncQueue() {
  const values = [];
  const waiters = [];
  let closed = false;
  let error = null;

  function push(value) {
    if (closed) return;

    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      values.push(value);
    }
  }

  function close() {
    closed = true;

    while (waiters.length) {
      waiters.shift().resolve({ value: undefined, done: true });
    }
  }

  function fail(nextError) {
    error = nextError;
    closed = true;

    while (waiters.length) {
      waiters.shift().reject(nextError);
    }
  }

  return {
    push,
    close,
    fail,

    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (values.length) {
          yield values.shift();
          continue;
        }

        if (error) {
          throw error;
        }

        if (closed) {
          return;
        }

        const next = await new Promise((resolve, reject) => {
          waiters.push({ resolve, reject });
        });

        if (next.done) {
          return;
        }

        yield next.value;
      }
    },
  };
}
```

### 18.2 `streamPayloads()`

Wrap the existing progressive fetch.

Pseudo-code:

```js
async function* streamPayloads(request) {
  const requestId = request.id ?? createRequestId('payload');
  const queue = createAsyncQueue();

  registerRequest(requestId, {
    status: 'fetching',
    nodeCount: request.nodes.length,
  });

  const finalPromise = renderService.fetchNodePayloadBatchProgressive(request.nodes, {
    onBatch(entries) {
      queue.push({
        type: 'payload/batch',
        requestId,
        providerId,
        entries,
        completeness: { phase: 'partial' },
      });
    },
  });

  finalPromise
    .then(() => {
      queue.push({
        type: 'payload/complete',
        requestId,
        providerId,
      });
      completeRequest(requestId);
      queue.close();
    })
    .catch((error) => {
      failRequest(requestId, error);
      queue.push({
        type: 'payload/error',
        requestId,
        providerId,
        error: { message: error.message ?? String(error) },
      });
      queue.close();
    });

  yield* queue;
}
```

### 18.3 Decode entries into one product

```js
function createStarObjectBatchProduct({
  providerId,
  sessionId,
  requestId,
  entries,
  attributes,
  positionUnit,
  viewRevision,
  demandRevision,
}) {
  const decodedSegments = [];

  let totalCount = 0;

  for (const { node, buffer } of entries) {
    const decoded = renderService.decodePayload(buffer, node);

    decodedSegments.push({ node, decoded });
    totalCount += decoded.count;
  }

  const positions = new Float32Array(totalCount * 3);
  const teffLog8 = attributes.includes('teffLog8')
    ? new Uint8Array(totalCount)
    : null;
  const magAbs = attributes.includes('magAbs')
    ? new Float32Array(totalCount)
    : null;

  const nodes = [];
  const pickMeta = attributes.includes('pickMeta') ? [] : null;

  let offset = 0;

  for (const { node, decoded } of decodedSegments) {
    const segmentPositions = positionUnit === 'pc'
      ? scenePositionsToPc(decoded.positions)
      : decoded.positions;

    positions.set(segmentPositions, offset * 3);

    if (teffLog8) teffLog8.set(decoded.teffLog8, offset);
    if (magAbs) magAbs.set(decoded.magAbs, offset);

    nodes.push({
      nodeKey: node.nodeKey,
      level: node.level,
      gridX: node.gridX,
      gridY: node.gridY,
      gridZ: node.gridZ,
      centerX: node.centerX,
      centerY: node.centerY,
      centerZ: node.centerZ,
      halfSize: node.halfSize,
      count: decoded.count,
      offset,
    });

    if (pickMeta) {
      for (let ordinal = 0; ordinal < decoded.count; ordinal += 1) {
        pickMeta.push({
          nodeKey: node.nodeKey,
          ordinal,
          level: node.level,
          gridX: node.gridX,
          gridY: node.gridY,
          gridZ: node.gridZ,
          centerX: node.centerX,
          centerY: node.centerY,
          centerZ: node.centerZ,
        });
      }
    }

    offset += decoded.count;
  }

  return {
    productType: 'object-batch',
    id: createProductId(requestId),
    providerId,
    sessionId,
    layerId: 'stars',
    objectType: 'star',
    requestId,
    viewRevision,
    demandRevision,
    count: totalCount,
    nodes,
    coordinates: {
      primary: {
        name: 'position',
        frame: 'icrs',
        representation: 'cartesian3',
        units: positionUnit === 'pc'
          ? ['pc', 'pc', 'pc']
          : ['scene', 'scene', 'scene'],
        stride: 3,
        components: positions,
      },
    },
    attributes: {
      ...(teffLog8 ? { teffLog8: { name: 'teffLog8', kind: 'number', values: teffLog8 } } : {}),
      ...(magAbs ? { magAbs: { name: 'magAbs', kind: 'number', unit: 'mag', values: magAbs } } : {}),
    },
    ...(pickMeta ? { pickMeta } : {}),
    completeness: {
      phase: 'partial',
      stable: true,
      loadedObjects: totalCount,
      loadedNodes: entries.length,
    },
    memory: {
      ownership: 'borrowed',
      bytes: positions.byteLength
        + (teffLog8?.byteLength ?? 0)
        + (magAbs?.byteLength ?? 0),
    },
  };
}
```

### 18.4 Session `updateNodes()`

Pseudo-flow:

```js
function updateNodes(nodes, options = {}) {
  assertActive();

  const normalizedNodes = normalizeNodes(nodes);
  const signature = createNodeSignature(normalizedNodes);

  viewRevision += 1;

  if (signature === currentNodeSignature && options.reason !== 'manual') {
    return {
      sessionId,
      viewRevision,
      demandRevision,
      replan: 'skipped',
      reasons: [],
    };
  }

  demandRevision += 1;
  currentNodeSignature = signature;
  currentNodes = normalizedNodes;

  if (options.cancelInflight !== false) {
    cancelActiveRequests('nodes-changed');
  }

  if (sessionOptions.streaming?.retainPreviousUntilReplacement) {
    markCurrentProductsStaleButRetained();
  } else {
    removeCurrentProducts();
  }

  startObjectBatchStream({
    nodes: normalizedNodes,
    viewRevision,
    demandRevision,
    reason: options.reason ?? 'nodes-changed',
  });

  return {
    sessionId,
    viewRevision,
    demandRevision,
    replan: 'scheduled',
    reasons: ['nodes-changed'],
  };
}
```

### 18.5 Session deltas

The session should have its own async queue and listener set.

```js
session.subscribe(listener)
session.deltas()
```

Both should receive the same deltas.

---

## 19. Memory policy for sprint 1

Use simple same-thread semantics.

```txt
ownership: 'borrowed'
```

Rules:

```txt
- Provider/session emits typed arrays.
- Provider/session must not mutate emitted arrays.
- Consumer may use arrays directly.
- Provider/session may mark products stale/remove them, but no lease mechanism yet.
- Worker transfer is not implemented in sprint 1.
```

Add metadata now:

```ts
memory: {
  ownership: 'borrowed',
  bytes,
}
```

Future memory modes:

```txt
copy      for safety or small products
transfer  for worker-to-main
shared    for SharedArrayBuffer/WASM pools
```

Do not implement those in sprint 1.

---

## 20. Position units

Current octree decode produces scene-scaled positions using `SCALE`, not raw parsec positions. `decodeStarPayload()` multiplies decoded world positions by `SCALE`. 

Sprint 1 should make this explicit.

Default:

```js
positionUnit: 'scene'
```

because current renderer compatibility matters.

Optional:

```js
positionUnit: 'pc'
```

implemented by dividing scene positions by `SCALE`.

Long-term, provider products should probably prefer canonical parsec coordinates, and presentation/adapters should transform into render units. But sprint 1 should avoid breaking existing rendering assumptions.

---

## 21. Sidecars in sprint 1

Sidecars are out of scope.

The provider should not resolve names, identifiers, or metadata.

Reason:

```txt
StarOctreeProviderService
  → bulk object-batch products

MetaSidecarProviderService
  → fact-batch products
```

The current `MetaSidecarService` is already a distinct service with compatibility validation and cell lookup behavior. It should become a separate provider in Sprint 2, not be folded into this provider. 

---

## 22. Testing plan

### 22.1 Unit tests with fake render service

Avoid live network tests.

Mock:

```txt
ensureBootstrap()
ensureRootShard()
fetchNodePayloadBatchProgressive()
decodePayload()
describe()
```

Test fixture:

```js
const nodeA = { nodeKey: '1:1', payloadLength: 16, ... };
const nodeB = { nodeKey: '1:2', payloadLength: 16, ... };

decodePayload(buffer, nodeA) => {
  positions: Float32Array([1, 2, 3]),
  teffLog8: Uint8Array([128]),
  magAbs: Float32Array([4.5]),
  count: 1,
}
```

### 22.2 Provider tests

Test:

```txt
- provider.describe() returns expected capabilities
- provider.getSnapshot() reports dataset/cache/request state
- ensureBootstrap() returns bootstrap product
- ensureRootShard() returns root shard product
- streamPayloads() emits payload/batch then payload/complete
- streamObjectBatches() emits data/product-upsert
- fetchObjectBatch() merges progressive products into one product
- errors produce data/product-error
```

### 22.3 Session tests

Test:

```txt
- createSession() returns independent session
- session.updateNodes(nodes) schedules stream
- session.deltas() yields product deltas
- session.subscribe() receives same deltas
- repeated updateNodes(same nodes) skips replan
- updateNodes(new nodes) increments demandRevision
- updateView() stores view state
- session.getSnapshot() reports status/products/memory
- session.cancel() stops active stream
- session.dispose() clears listeners/queue and marks disposed
```

### 22.4 Product shape tests

Test:

```txt
- positions are Float32Array
- teffLog8 is Uint8Array when requested
- magAbs is Float32Array when requested
- omitted attributes are omitted
- node metadata offsets are correct
- memory.bytes equals sum of emitted arrays
- positionUnit 'pc' converts from scene units
```

---

## 23. Acceptance criteria

Sprint 1 is done when:

1. `createStarOctreeProviderService()` exists.
2. It wraps an existing `DatasetSession` / `RenderOctreeService`.
3. `ensureBootstrap()` returns a bootstrap product.
4. `ensureRootShard()` returns a root-shard product.
5. `streamObjectBatches({ nodes })` progressively emits `data/product-upsert` deltas.
6. `fetchObjectBatch({ nodes })` returns a merged `StarObjectBatchProduct`.
7. `createSession()` exists.
8. `session.updateNodes(nodes)` triggers progressive product deltas.
9. `session.updateView(patch)` stores provider-relevant view state and returns a receipt.
10. `provider.getSnapshot()` reports cache/request/session/stats state.
11. `session.getSnapshot()` reports view/demand/product/memory state.
12. No Three.js object is emitted by the provider.
13. No sidecar metadata is resolved by the star provider.
14. Existing viewer behavior remains unchanged.
15. Existing tests still pass.
16. New tests cover provider, session, product shape, and error handling.

---

## 24. Example usage

### 24.1 One-shot explicit node stream

```js
const provider = createStarOctreeProviderService({
  datasetSession,
});

await provider.ensureBootstrap();
await provider.ensureRootShard();

for await (const delta of provider.streamObjectBatches({
  nodes,
  positionUnit: 'scene',
  attributes: ['position', 'teffLog8', 'magAbs'],
  streaming: {
    progressive: true,
    emitCachedFirst: true,
  },
})) {
  if (delta.type === 'data/product-upsert') {
    const product = delta.product;

    const positions = product.coordinates.primary.components;
    const teffLog8 = product.attributes.teffLog8.values;
    const magAbs = product.attributes.magAbs.values;

    renderer.applyStarProduct(product);
  }
}
```

### 24.2 Live session with explicit nodes

```js
const provider = createStarOctreeProviderService({
  datasetSession,
});

const session = provider.createSession({
  id: 'main-stars',

  strategy: {
    kind: 'explicit-nodes',
  },

  positionUnit: 'scene',

  attributes: ['position', 'teffLog8', 'magAbs'],

  streaming: {
    progressive: true,
    emitCachedFirst: true,
    retainPreviousUntilReplacement: true,
  },
});

session.subscribe((delta) => {
  if (delta.type !== 'data/product-upsert') {
    return;
  }

  renderer.applyStarProduct(delta.product);
});

session.updateNodes(nodes, {
  reason: 'selection/changed',
});
```

### 24.3 Navigation state stored on session

```js
session.updateView({
  observerPc,
  limitingMagnitude: 6.5,
  motion: {
    speedPcPerSec: 12,
    lookaheadSecs: 3,
  },
});
```

In sprint 1, this does not need to reselect nodes for explicit-node strategy. It prepares the API for managed selection in a later sprint.

---

## 25. Migration path after sprint 1

### Sprint 2: Meta sidecar provider

```txt
MetaSidecarProviderService
  accepts pickMeta or CanonicalObjectRef
  emits FactBatchProduct
```

Current `MetaSidecarService` already validates sidecar compatibility and resolves entries from pick metadata. 

### Sprint 3: StarFieldLayer adapter

Update `StarFieldLayer` to consume `StarObjectBatchProduct` rather than directly owning all fetch/decode steps.

Current:

```txt
StarFieldLayer
  fetch payloads
  decode payloads
  assemble arrays
  create geometry
```

Future:

```txt
StarOctreeProviderSession
  fetch/decode/assemble products

StarFieldLayer or Three adapter
  products → geometry
```

### Sprint 4: Managed observer-shell strategy

Move star node selection into session strategy:

```js
provider.createSession({
  strategy: {
    kind: 'observer-shell',
  },
});
```

Then:

```js
session.updateView({
  observerPc,
  limitingMagnitude,
});
```

triggers selection and streaming.

### Sprint 5: Message bus wrapper

Wrap provider/session deltas into the larger SkyKit bus protocol.

---

## 26. Key design decisions

### Decision 1: Provider service plus provider sessions

Use both.

```txt
provider service = shared source/cache/memory
provider session = one live demand/working set
```

### Decision 2: Navigation goes to session, not provider

Do not push arbitrary app state to the provider service.

Use:

```js
session.updateView(...)
```

not:

```js
provider.updateState(...)
```

### Decision 3: Explicit nodes first

Sprint 1 should not move all selection into the provider.

Start with:

```js
session.updateNodes(nodes)
```

because current SkyKit already has selection fields and refresh policy.

### Decision 4: Products, not renderer objects

Emit:

```txt
StarObjectBatchProduct
```

not:

```txt
THREE.BufferGeometry
```

### Decision 5: Sidecars are separate providers

Do not fold sidecars into the star provider.

### Decision 6: Borrowed buffers for sprint 1

Use direct typed arrays with `ownership: 'borrowed'`.

Add transfer/shared ownership later.

---

## 27. Summary

Sprint 1 should produce a concrete, reusable provider boundary:

```txt
StarOctreeProviderService
  shared source/cache/memory/snapshot

StarOctreeProviderSession
  live selected-node working set and product stream

StarObjectBatchProduct
  typed arrays + node metadata + completeness + memory metadata
```

This gives SkyKit an immediately useful data service while also establishing the architecture needed for the later bus, object layers, sidecars, workers, and renderer adapters.
