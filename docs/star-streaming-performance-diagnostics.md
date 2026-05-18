# Star Streaming Performance Diagnostics

## Purpose

This is a handoff document for diagnosing performance and visual stability in
the SkyKit streaming star stack.

The issue was noticed while testing the website radio-bubble journey, but the
radio bubble mesh and journey content are not the suspected cause. Treat this
as a provider/session/planner/renderer diagnostic that can affect any viewer
using streaming stars.

The current user-visible symptoms are:

- Stars can be slow to appear on first visit or first large movement.
- During fast observer motion, star rendering can become very jerky.
- Stars may appear doubled.
- Free roam currently looks better than the journey viewer, so use it as a
  control case rather than proof that the stack is healthy.

## Current Local Context

Repository locations:

- SkyKit: `/Users/kws/work/fis/skykit`
- Website: `/Users/kws/work/fis/website`

Typical website dev command already used:

```sh
cd /Users/kws/work/fis/website
SKYKIT_LOCAL_PATH=../skykit npm run dev -- --host 127.0.0.1 --port 4328
```

Useful comparison routes:

```txt
http://127.0.0.1:4328/learn/topic/radio-bubble/
http://127.0.0.1:4328/examples/free-roam/
```

Current uncommitted SkyKit changes at time of writing:

- `packages/star-octree-provider/src/star-octree-observer-shell.js`
- `packages/star-octree-provider/src/star-octree-provider-session.js`
- `packages/star-octree-provider/src/__tests__/star-octree-traversal.test.js`
- `packages/star-octree-provider/src/__tests__/star-octree-provider-session.test.js`

Current uncommitted website change:

- `src/scripts/radio-bubble-viewer.js`

## Current Viewer Settings Worth Comparing

The journey viewer currently uses:

- `createStreamingStarsPlugin()`
- `createStarOctreeProviderService({ url: OCTREE_DEFAULT, persistentCache: 'on' })`
- `createObserverShellStrategy()`
- no `demandThresholds`

Free roam also uses persistent cache and observer-shell loading, but may differ
in observer motion, update cadence, and renderer/session churn. Compare those
differences before changing strategy code.

## Recent Changes Relevant To This Problem

### 1. Observer-shell radius changed from half-cell to full-cell width

`loadRadiusForMagnitudeShell()` now returns:

```js
halfSize * 2 * 10 ** ((limitingMagnitude - indexMagnitude) / 5)
```

This was changed because a real dataset diagnostic found visible stars missing
between shell products. A concrete missing example had a star visible at the
next observer position, but its octree node was pruned because the selection
radius used half the cell size. The intended rule is still brightness-based:
index magnitude plus the extent of the complete octree cell.

Do not reintroduce a fixed-distance padding/margin in observer-shell selection.
Future optimisation should use magnitude shells/bands, not arbitrary distance
margins.

### 2. Session replacement ordering was changed

`star-octree-provider-session.js` used to emit `product-stale` and
`product-remove` for excluded products before loading replacement products.
That caused visible chunks to disappear while replacements were still loading.

It now keeps old products alive until replacement loading has completed, then
emits stale/remove.

This may be the current source of doubled stars.

## Leading Hypothesis: Deferred Removal Causes Temporary Duplicate Stars

The current session replacement logic works at product granularity, but demand
changes are at cell granularity.

Consider this sequence:

- Old product contains cells `A + B`.
- New demand contains cells `B + C`.
- The old product is not fully retained because `A` is no longer demanded.
- The session marks the whole old product for later removal.
- Since `B` was inside a product marked for removal, `B` is also scheduled to be
  loaded again.
- While replacement products stream in, the old `A + B` product remains visible.
- When the new `B` product arrives before old `A + B` is removed, `B` is visible
  twice.

If streaming produces many products over multiple frames, this duplicate window
may last long enough to be obvious. It can also increase GPU buffer work and
make motion jerky.

This is especially plausible during fast observer motion because:

- The observer-shell demand changes frequently.
- The shell can contain hundreds of thousands of stars.
- Full-cell shell selection increased correct product sizes.
- Payload-range batching can put retained and excluded cells in the same product.

## Other Plausible Contributors

### Excessive per-frame replanning

With no `demandThresholds`, `updateView()` can queue demand planning on every
SkyKit view change. This is correct but may be expensive.

Do not fix this by adding a fixed movement threshold directly to shell
visibility. The planned optimisation is magnitude-banded shells:

- very bright/near shell refreshes frequently
- medium shell refreshes less often
- dim/far shell refreshes rarely

That keeps refresh policy tied to brightness/visibility rather than arbitrary
distance.

### Renderer remove/upsert cost

Inspect `three-star-field` delta application. If `product-remove` causes large
buffer rebuilds and this happens repeatedly during fast motion, jerk can come
from renderer-side array churn even if provider planning is correct.

Look for:

- full representation rebuilds on each upsert/remove
- repeated allocation of large typed arrays
- non-incremental geometry attribute replacement
- remove/upsert pairs arriving in bursts

### Product batching shape

`streamObjectProducts()` uses payload-range batching by default. A product can
contain multiple cells. This improves network efficiency but makes partial
retention harder. If product-level lifecycle is too coarse, partial overlap can
produce either flicker or duplicates depending on removal timing.

Possible directions to investigate:

- track retained cells inside partially retained products
- split replacement/removal by cell rather than product
- emit a representation transaction with atomic old/remove and new/upsert
- use node-level batching for high-motion sessions if payload-range batches
  produce visible partial-overlap artifacts

Do not assume node-level batching is the right final answer; measure first.

## Diagnostics To Run

### 1. Log live session deltas during fast observer motion

Add temporary instrumentation around the provider session or the streaming star
layer.

Capture per delta:

- timestamp
- delta type
- product id
- product node keys
- product star count
- current product count
- active work item count
- demand revision
- view revision

The key question: do `data/product-upsert` events for replacement cells arrive
long before `data/product-remove` events for old overlapping products?

### 2. Detect overlapping cells across live products

At each `representation-current`, or once per second while moving, inspect the
session snapshot and/or renderer store.

Report:

- number of live products
- number of live cell keys
- duplicate live cell keys
- duplicate star refs if `objectRef` is available

If live products contain duplicate cell keys, that strongly supports the
deferred-removal hypothesis.

If cell keys are unique but stars still appear doubled, inspect renderer object
identity and buffer disposal.

### 3. Compare two viewers

Compare the journey viewer that exposes the issue with free roam over a 10
second interval.

Measure:

- calls to `session.updateView()`
- receipts by demand status: `queued`, `unchanged`, `forced`, `suppressed`
- demand plans completed
- upserts/removes emitted
- product count min/max
- star count min/max
- main-thread long tasks if measurable

Free roam working well is a useful control. The difference may be motion speed,
not provider correctness.

### 4. Measure product churn rather than only FPS

Headless FPS checks previously looked acceptable, but the user-visible issue is
chunk flicker/doubling/jerk. Prioritise product churn metrics:

- products loaded per second
- products removed per second
- stars inserted per second
- stars removed per second
- largest single upsert star count
- largest single remove star count
- time spent in provider planning
- time spent decoding
- time spent in renderer delta application

### 5. Re-run exactness diagnostic after any planner change

A useful real-dataset diagnostic sampled observer positions along a fast path
and checked whether stars visible from the previous product at the next observer
position were present in the next product.

After the full-cell-width fix, this reported zero missing visible stars for
sample positions such as:

- `r8 -> r29`
- `r29 -> r44`
- `r44 -> r57`
- `r57 -> r100`
- `r100 -> r175`

Keep this kind of check around. It catches real visibility regressions that FPS
measurements miss.

## Tests Already Passing

Recent targeted checks passed:

```sh
cd /Users/kws/work/fis/skykit
node --test packages/star-octree-provider/src/__tests__/star-octree-traversal.test.js \
  packages/star-octree-provider/src/__tests__/star-octree-provider-session.test.js \
  packages/star-octree-provider/src/__tests__/star-octree-target-frustum.test.js
```

The broader provider suite also passed:

```sh
node --test packages/star-octree-provider/src/__tests__/*.test.js
```

Result at the time:

- 70 passed
- 1 skipped public-octree integration
- 0 failed

## Things Not To Do As A First Fix

- Do not switch the affected viewer to a static sphere volume as a quick
  performance fix. The intended strategy is observer-shell.
- Do not add fixed spatial padding/margins to shell visibility. Refresh
  optimisation should be magnitude-band based.
- Do not turn off star loading.
- Do not remove the observer-shell strategy because another viewer happens to
  look better.
- Do not treat HTTP/browser cache alone as the performance answer; cache helps
  network and decode reuse, but product churn can still overload the renderer.

## Useful Next Experiments

### Experiment A: Atomic Replacement

Prototype a session mode where removal of old products and upsert of
replacement products is emitted as an atomic representation change, or where
the renderer applies a batch of deltas in one frame.

Success criteria:

- no live duplicate cell keys
- no blank gap
- lower visual jerk

### Experiment B: Cell-Level Retention For Partially Retained Products

Instead of treating a partially retained product as wholly removed, represent
retained cells explicitly.

Questions:

- Can a product be split logically without copying large buffers?
- Can renderer hide/remove only excluded cells?
- Is the added complexity worth it versus different batching?

### Experiment C: Node Batch Mode For High-Motion Viewers

Temporarily force node-level batching for the affected viewer and compare:

- duplicate cell windows
- jerk
- network request count
- decoded cache hits
- renderer buffer churn

This may reduce partial-overlap artifacts at the cost of more products. Measure
before keeping it.

### Experiment D: Magnitude-Banded Observer Shell

Design the real shell/onion optimisation:

- partition demand into magnitude bands
- each band has a refresh cadence based on how quickly stars in that band can
  change visibility under observer motion
- bright/near bands update most often
- dim/far bands update less often

This is likely the correct long-term strategy for fast journeys, but it is
larger than a tactical bug fix.

## Suggested First Task For A Fresh Agent

Start with instrumentation, not refactoring:

1. Add temporary duplicate-cell detection in the live session or streaming star
   layer.
2. Reproduce fast observer motion in the affected viewer.
3. Confirm whether duplicate live cells/products occur.
4. Measure time between replacement upsert and old product remove.
5. If confirmed, prototype an atomic replacement or renderer-side batched delta
   application and compare.

The fresh agent should report whether the primary issue is:

- provider planner exactness
- session lifecycle ordering
- renderer delta application cost
- product batching granularity
- viewer motion causing pathological update cadence

Avoid guessing based on FPS alone.
