# Website Journey Benchmark POC Findings

Run date: 2026-05-21

This note records the first directional old-vs-new website journey benchmark.
It is not intended to be statistically rigorous. The goal is to provide a
quick guardrail for whether preloading changes are improving or regressing the
journey experience, and to point at the next thing worth optimizing.

## Run Context

- Benchmark artifact: `benchmarks/star-planner/.runs/latest-journey-browser.json`
- Benchmark command:
  `npm run bench:journey -- --target old=http://127.0.0.1:4323 --target new=http://127.0.0.1:4322 --timeout-ms 180000`
- Chromium: `148.0.7778.96`
- Old website: detached `origin/main`, commit `56e4574`
- New website: `feature/skykit-alpha-parallax`, commit `338dc2f`
- SkyKit sources used by new website: commit `480b13f` plus local alpha edits

The reported numbers are from the second pass, after both dev servers had
already optimized dependencies. A first cold dev-server pass produced a Vite
optimizer 504 on old HR and was discarded for comparison.

## Scenarios

- `clusters-hyades-to-omega-cen`: visit star clusters, settle at Hyades, then
  click Omega Centauri and sample the 9 second travel window.
- `hr-ngc752-to-omega-cen`: visit HR diagram, settle at NGC 752, then click
  Omega Centauri and sample the 15 second travel window.

`blankTravelRatio` is the share of samples in the travel window that failed the
visibility threshold. Lower is better. `timeToFirstVisibleMs` is measured after
the Omega Centauri click. Old website runs do not expose the same SkyKit
internal counters, so old readiness is visual/screenshot based; new HR also has
SkyKit session/debug counters.

## Results

| Journey | Target | blank travel | first visible | arrival visible | resources | frame misses | long tasks |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| clusters Hyades -> omega Cen | old | 0% | 0.81s | yes | 93 | 117 | 24 |
| clusters Hyades -> omega Cen | new | 0% | 1.31s | yes | 224 | 215 | 122 |
| HR NGC 752 -> omega Cen | old | 0% | 0.85s | yes | 250 | 236 | 19 |
| HR NGC 752 -> omega Cen | new | 66.7% | 9.81s | yes | 174 | 429 | 57 |

New HR arrival looked technically visible by the benchmark threshold, but the
internal counters show it was not ready:

| New HR counter at arrival | Value |
| --- | ---: |
| arrival star count | 65 |
| desired cells | 633 |
| current cells | 1 |
| in-flight cells | 634 |
| active work items | 2 |
| final sample star count | 319 |
| final sample in-flight cells | 620 |

## Experiment Log

This section records directional follow-up runs after the first old-vs-new
comparison. These are not five-sigma benchmark claims. They are a lab notebook
for what changed, whether the journey moved in the right direction, and what
the counters imply should be optimized next.

### 1. Website Authored HR Omega Centauri Prewarm

Change:

- Added website-only HR preload hints for the authored NGC 752 -> Omega
  Centauri route in `website/src/scripts/hr-diagram-viewer.js`.
- Built path corridor hints with `buildTravelVolumeRequests()` from the
  authored orbit-transfer path.
- Added a lower-priority destination/orbit sphere.
- Wired journey `onPreloadHints` to
  `createSkykitStarPreloadRequestsFromSpatialHints()` and
  `provider.warmCells()`.
- Added website-side dedupe, in-flight tracking, and cancellation for inactive
  hints.
- Kept generic provider/tree APIs unchanged.

Verification:

- `node --check src/scripts/hr-diagram-viewer.js`
- `SKYKIT_LOCAL_PATH=../skykit TOUCH_OS_LOCAL_PATH=../touch-os npm run build`
- `npm run bench:journey -- --target current=http://127.0.0.1:4322 --timeout-ms 180000`

Directional result:

| Metric | Before authored prewarm | After authored prewarm |
| --- | ---: | ---: |
| HR blank travel | 66.7% | 69.8% |
| HR first visible | 9.81s | 10.42s |
| HR arrival stars | 65 | 2463 |
| HR arrival current / desired cells | 1 / 633 | 146 / 631 |
| HR arrival in-flight cells | 634 | 514 |

Finding:

The authored prewarm reached the provider caches and materially improved
arrival readiness, but it did not improve visual continuity. That means route
geometry was not the main remaining blocker. The more likely gap was between
"warm data exists" and "current cells are emitted/rendered early enough."

### 2. Generic Warm-To-Current Promotion

Change:

- Added memory-only decoded cache lookup in the provider pipeline.
- Added `readCachedCellsForEntries()` so decoded warm cells can be materialized
  without payload fetch or decode scheduling.
- Wired provider sessions to promote cache-ready desired cells into current
  `stars/cells-upsert` deltas.
- Allowed cache promotion for cells already marked in-flight by a cold current
  load.
- Added a short generic promotion pulse while current demand is incomplete so
  external `warmCells()` completions can be pulled into the active session.
- Added non-overlap stale current load aborts.
- Added demand counters for cached current hits, cold current loads, stale load
  aborts, and stale cell drops.
- Updated the browser journey benchmark to extract those counters and
  current/desired ratios.
- Fixed the HR viewer initialization race that previously emitted
  `Cannot access 'viewer' before initialization`.

Verification:

- `node --test packages/star-octree-provider/src/__tests__/*.test.js packages/skykit/src/__tests__/skykit.test.js`
- `npm run typecheck`
- `node --check src/scripts/hr-diagram-viewer.js`
- `SKYKIT_LOCAL_PATH=../skykit TOUCH_OS_LOCAL_PATH=../touch-os npm run build`

The provider/session tests confirmed the generic mechanics:

- warmed decoded cells can be materialized without new fetches
- cached desired cells emit before delayed cold loads
- cached cells can promote entries already marked in-flight
- incomplete demand polls warm cache while cold work remains in-flight
- non-overlapping current loads abort on a new demand plan

Benchmark notes:

Several current-only browser runs were noisy. One pass caught Vite dependency
re-optimization on the cluster page and was discarded. Before the HR lifecycle
fix, HR still emitted `Cannot access 'viewer' before initialization`. After the
fix, the clean warmed pass was:

| Journey | blank travel | first visible | arrival visible | arrival current / desired | arrival in-flight | final current / desired | final in-flight | final cached hits |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| clusters Hyades -> omega Cen | 100% | 12.00s | no | n/a | n/a | n/a | n/a | n/a |
| HR NGC 752 -> omega Cen | 100% | 16.82s | no | 0 / 0 | 0 | 87 / 619 | 532 | 87 |

Finding:

The generic provider change is mechanically useful but was not a journey
performance win in this run. The final HR counters prove that warmed decoded
cells can now become current via the generic promotion path (`87` cached
current hits), but those hits arrived too late for the authored travel window.
At arrival the active HR session reported no desired cells, so this run points
upstream of render assembly: the destination demand was not current at the
moment the benchmark calls arrival.

The stale-load abort counter stayed at `0`, which suggests the active cold work
still overlaps enough with new demand that the current non-overlap abort policy
does not fire. If in-flight cells remain high after route timing is fixed, the
next generic provider optimization is probably bounded/chunked current loads so
stale portions can be cancelled more precisely.

The cluster benchmark also regressed to fully blank in these current-only
runs. Because clusters do not expose the same SkyKit debug counters and were
previously visually acceptable, this should be treated as a benchmark or route
health issue to investigate before using cluster numbers as an efficiency
gate again.

Decision:

Keep the generic warm-to-current changes as enabling infrastructure, but do
not count them as a performance improvement yet. The next optimization should
focus on website/journey warm timing and current-demand arrival semantics:
prewarm must complete before or during the authored travel envelope, and the
session must have destination demand active by arrival.

## Findings

The old hardcoded HR preloader is materially better for the long Omega
Centauri journey. In the measured run it kept the HR route visually populated
through the whole transition, while the new alpha HR path was blank for roughly
two thirds of the travel window and did not show useful stars until almost 10
seconds after the click.

The new HR path appears to be chasing live/current demand rather than arriving
from warmed route data. At arrival it had only 1 current cell out of 633 desired
cells, with 634 cells still in flight. Even by the final sample it still had
620 cells in flight. This matches the observed backlog/stale-request behavior.

The new cluster route is visually acceptable in this run, but it is much
heavier than old main: more than twice the resource count, almost twice the
frame misses, and roughly five times the long tasks. That may be fine if the
new architecture is doing more useful work, but it is a strong signal to watch
request count, batching, decode cost, and churn while adding prewarming.

The original new HR run also emitted:

```text
Cannot access 'viewer' before initialization
```

That was later fixed during the generic warm-to-current experiment by queuing
HR scene state until the viewer exists. It is useful historical context because
early benchmark runs with that error should be treated as noisy.

## Learnings So Far

Journey performance should be judged by route usefulness, not by chapter
completion. The important question for these lessons is whether the viewer is
populated during the authored travel envelope and whether the destination is
ready by arrival. A benchmark that only waits for the final scene to become
current would miss the main failure mode.

Visual continuity and loader readiness are related but distinct. The cluster
route can stay visually acceptable while still doing much more work than the
old implementation. HR, by contrast, exposes the loader backlog directly
because the destination volume needs a specific population before the lesson
feels correct. We should track both user-visible blankness and internal
readiness.

The old HR preloader's advantage is probably not the hardcoded implementation
itself. The useful idea is that it warms the authored path and destination
before the user gets there. The new alpha architecture should preserve that
behavior through strategy-owned preload requests rather than by moving journey
knowledge into the octree loader.

Live demand and journey prewarming need separate lifetimes. Live demand should
follow the current camera and cancel or demote stale work quickly. Journey warm
work should be tied to the authored route or destination and should survive
short-term camera churn, while still yielding scheduler capacity to current
visible work.

The Omega Centauri HR route is the best near-term sentinel. It is long enough
to expose path warming, distant enough to stress index/payload selection, and
large enough to reveal stale backlog at arrival. If this route improves, the
prewarming strategy is probably moving in the right direction.

The cluster route is a useful efficiency sentinel. Since it is visually less
fragile than HR, regressions there may show up first as resource count, frame
misses, long tasks, or excess churn rather than outright blankness.

The current benchmark needs only directional stability. We do not need formal
statistical confidence yet. A useful rule of thumb is that changes should not
make HR `blankTravelRatio`, HR `timeToFirstVisibleMs`, or HR arrival/final
`inFlightCellCount` materially worse, and should ideally reduce at least one of
them.

## API And Architecture Implications

The strategy API looks like the right architectural home for authored
prewarming. Strategies can describe "these cells will matter for this route"
without forcing the octree loader to know about HR diagrams, clusters, pizza
routes, or future object loaders.

The loader should stay responsible for generic execution: index shard warming,
payload fetch batching, decoded cache warming, cancellation, promotion, and
scheduler fairness. It should not contain journey-specific rules like "Omega
Centauri needs a wider arrival sphere."

The journey layer should emit semantic preload hints from known route geometry:
path corridors, destination spheres, orbit coverage, and possibly dwell-time
priority. Those hints should become warm strategies or warm requests that the
provider can execute generically.

For fast travel, prioritization should favor cells that are likely to remain
useful for longer over cells with high churn near the instantaneous camera.
That may require strategy output to carry loader-neutral scheduling hints such
as expected useful duration, deadline, or route segment, rather than only a
single distance-like priority score.

Render-array preloading should probably remain renderer-owned. The provider can
warm index shards, payloads, and decoded cell data; renderer-specific buffers or
draw arrays should be prepared by the renderer or a renderer-adjacent cache
keyed by semantic cell identity.

## Optimization Hints

The next alpha preloading work should focus on authored route warming rather
than relying only on live session prefetch. For Omega Centauri, the likely shape
is:

- warm a path corridor for the long travel leg
- warm an arrival/orbit sphere around the destination
- warm index shards and decoded payloads through `provider.warmCells()`
- keep route-warm work independent from transient view churn, while still
  yielding to true current work
- cancel, demote, or avoid stale live/current requests that are no longer
  useful for the current route

Useful instrumentation to add next:

- warm hit rate when a cell becomes current
- decoded cache hits/misses at live demand time
- stale current work count after a view/route change
- route-warm completion by authored segment
- per-cell source tag such as `warm`, `current`, `cache`, or `late-fetch`
- scheduler lane occupancy during route transitions
- current work cancelled or demoted because it became route-stale
- destination readiness at arrival, expressed as current cells over desired
  cells

Those counters would make the benchmark less dependent on visual inference and
would help distinguish "blank because nothing was warmed" from "blank because
render assembly or main-thread work is late."

## Reading Future Runs

For a quick pass/fail smell test:

- HR blank travel should trend toward `0%`.
- HR first visible should be early in the travel window, not near arrival.
- HR arrival `currentCellCount / desiredCellCount` should rise materially.
- HR final `inFlightCellCount` should not stay near the desired cell count.
- Cluster visible travel should remain near `100%`.
- Cluster resource count and long tasks should not grow while adding preloads.

If HR blankness improves but long tasks spike, the bottleneck may have moved
from data loading to decode or render assembly. If resource count drops but
arrival in-flight cells stay high, the planner may be selecting too much stale
current demand or failing to promote warmed cells. If old/new visual metrics are
close but new still has much higher frame misses, scheduler fairness and decode
parallelism are likely the next places to look.

This document should be updated with new benchmark runs whenever a prewarming
change lands, even if the run is informal. The value is the trend and the
debugging clue, not a perfect scorecard.

## How To Rerun

From the meta workspace:

```sh
# Current alpha website
cd website
SKYKIT_LOCAL_PATH=../skykit TOUCH_OS_LOCAL_PATH=../touch-os \
  npm run dev -- --host 127.0.0.1 --port 4322

# Old main worktree
cd ../_worktrees/website-main
npm run dev -- --host 127.0.0.1 --port 4323

# Benchmark
cd ../skykit
npm run bench:journey -- \
  --target old=http://127.0.0.1:4323 \
  --target new=http://127.0.0.1:4322 \
  --timeout-ms 180000
```

For trend tracking, compare these directional metrics first:

- HR `blankTravelRatio`
- HR `timeToFirstVisibleMs`
- HR arrival/final `inFlightCellCount`
- cluster `resourceCount`, `frameBudgetMisses`, and `longTaskCount`
