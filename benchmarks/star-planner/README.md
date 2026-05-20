# Star Planner Benchmarks

Headless planner and scheduler benchmarks for the SkyKit alpha star-loading
contract.

The suite records the current implementation as a compact baseline while the
Strategy/Planner API is being separated. It intentionally avoids real data
network loading: planner runs use synthetic semantic octree cells, and browser
runs use a fake bandwidth/decode model around the real scheduler.

## Commands

```sh
npm run bench:planner
npm run bench:browser
npm run bench:baseline
npm run bench:compare
```

Tracked outputs live in:

- `baselines/current-alpha.json`
- `reports/current-alpha.md`

Raw run artifacts live under `.runs/` and are intentionally ignored.
