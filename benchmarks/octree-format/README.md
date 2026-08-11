# STAR Octree Format Benchmark

This small Node.js tool compares local STAR v1 and v2 artifacts through the
same index parser and traversal used by `@found-in-space/star-octree-provider`.
It runs deterministic point-path probes from 1 pc to 20 kpc by default and
reports file/index size, bounded range I/O, traversal work, path depth, and v2
terminal hit rate.

The tool reads only the 192-byte bootstrap block and required OSHR index
shards. It summarizes payload byte lengths and v2 star counts from node records
but never reads or decompresses payload bodies, so multi-gigabyte octrees are
safe to inspect.

```sh
npm run bench:octree -- \
  v1=/path/to/stars.octree \
  v2=/path/to/stars-v2.octree
```

Useful focused probes:

```sh
npm run bench:octree -- \
  v1=/path/to/stars.octree \
  v2=/path/to/stars-v2.octree \
  --point 0,0,0 \
  --point 8.6,0,0
```

Raw output defaults to `benchmarks/octree-format/.runs/latest.json`; pass
`--no-json` to suppress it or `--json PATH` to choose another destination.
Timing includes local filesystem and operating-system cache effects. Repeat or
reverse input order before treating small timing differences as meaningful.
