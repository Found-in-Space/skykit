# Star Planner Benchmarks

Headless planner and scheduler benchmarks for the SkyKit alpha star-loading
contract.

The suite records the current implementation as a compact baseline for the open
Strategy/Planner API. It intentionally avoids real data network loading:
planner runs use synthetic semantic octree cells, and browser runs use a fake
bandwidth/decode model around the real scheduler.

## Commands

```sh
npm run bench:planner
npm run bench:browser
npm run bench:journey
npm run bench:baseline
npm run bench:compare
```

## Website Journey POC

The journey benchmark is a browser-level probe for comparing the actual website
journeys, especially the long omega Cen legs. It assumes the website servers are
already running and drives shared DOM controls on the cluster and HR diagram
pages.

Example setup from the meta workspace:

```sh
# Terminal 1: current alpha website
cd ../website
SKYKIT_LOCAL_PATH=../skykit TOUCH_OS_LOCAL_PATH=../touch-os \
  npm run dev -- --host 127.0.0.1 --port 4322

# Terminal 2: old main worktree
cd ../_worktrees/website-main
npm run dev -- --host 127.0.0.1 --port 4323

# Terminal 3: benchmark from skykit
cd ../skykit
npm run bench:journey -- \
  --target old=http://127.0.0.1:4323 \
  --target new=http://127.0.0.1:4322
```

You can also pass targets through the environment:

```sh
SKYKIT_JOURNEY_BENCH_TARGETS=old=http://127.0.0.1:4323,new=http://127.0.0.1:4322 \
  npm run bench:journey
```

The POC records continuous samples during:

- `hyades -> omega-cen` on `/learn/topic/star-clusters/`
- `ngc-752 -> omega-cen` on `/learn/topic/hr-diagram/`

It summarizes blank travel ratio, time to first visible stars, arrival
visibility, available SkyKit backlog counters, resource timings, frame misses,
and long tasks. Raw run artifacts are written to
`.runs/latest-journey-browser.json`.

The initial old-vs-new findings are recorded in
`reports/website-journey-poc.md`.

Tracked outputs live in:

- `baselines/current-alpha.json`
- `reports/current-alpha.md`

Raw run artifacts live under `.runs/` and are intentionally ignored.
