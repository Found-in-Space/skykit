# Agent Instructions

## JavaScript / Node.js Project

- Runtime: plain ES modules (`"type": "module"`).
- Alpha library code lives in workspace packages under `packages/`.
- Package entry points are plain `src/index.js` files with hand-written `.d.ts`
  contracts.
- Use `three` as a peer dependency for reusable renderer/runtime packages unless
  a package is explicitly application-only.

## Alpha Package Direction

Alpha SkyKit is a package-first teaching toolkit, not a monolithic viewer. New
work should identify the smallest reusable boundary that makes lessons clearer:
data providers stream products, product packages interpret domain data, renderers
consume products, `spatial` owns dependency-free navigation/coordinate language,
SkyKit XR owns WebXR-specific embodiment/input/rays, touch-os owns surfaces, and
core `@found-in-space/skykit` composes those pieces through public plugin/action
hooks. Avoid hidden wrapper layers, string-based factory registries, or "just
one more helper" packages unless they remove real lesson code and have a durable
boundary.

The goal is hackable clarity: a learner should be able to build from small,
explicit pieces, replace any part with their own implementation, and understand
which frame of reference an action uses. Prefer semantic actions such as
`skykit:ship.move.forward` over fake keypresses or private controller calls;
prefer app-owned plugins for creative layers; keep high-throughput star data on
product streams rather than event buses; and preserve old PoC behavior only by
rewriting it into the alpha package shape, never by importing old internals.

- Core `skykit` is a slim teaching/composition toolkit built from focused
  `@found-in-space/*` modules.
- Prefer focused workspace packages under `packages/` for reusable capabilities.
  Use core `skykit` for composition helpers, teaching examples, and demo glue.
- Keep package boundaries clear:
  - shared star tree identity and cell interpretation belongs in `star-trees`.
  - star interpretation belongs in star-specific packages.
  - renderer adapters consume products/stores rather than owning data loading.
  - spatial owns shared coordinates, targets, poses, routes, and navigation.
  - SkyKit XR owns WebXR embodiment/input/rays/sessions, not star rendering or
    panels.
  - touch-os owns visual surfaces, panels, HUDs, and forwarded surface input.
- Do not fold sidecars, ephemerides, kinematics, H-alpha maps, galaxy models, or
  renderer-specific logic into the star octree provider. Those remain separate
  product/provider lanes that applications compose.
- Shared star strategy interfaces and bundled strategy implementations live in
  `@found-in-space/star-trees`; the star-octree provider consumes ordinary
  `StarCellStrategy` objects without string registries or strategy-name
  dispatch.
- Do not create wrapper packages or string registries unless a new boundary is
  clearly justified by the learning path.
- Follow `docs/alpha-rules.md`: alpha work is a clean rewrite into the package
  shape, with old implementation details preserved by git history rather than
  repeated in live docs.
- Use `docs/package-learning-architecture.md` when deciding which lesson a new
  feature should unlock.

## Current Package Map

- `@found-in-space/spatial`: dependency-free coordinates, poses, routes,
  target resolution, smooth paths, timed pose tracks, materialized preload
  hints, smooth navigation, orbit, look-at, and motion helpers.
- `@found-in-space/journey`: authored scene graphs, timed journey evaluators,
  cue/track evaluation, and retiming helpers built on spatial.
- `@found-in-space/journey-video`: standalone alpha journey video editor,
  editor state/import/export helpers, and deterministic export tooling.
- `@found-in-space/star-trees`: star tree identities, cell stores, iteration, and math.
- `@found-in-space/star-octree-provider`: octree loading, provider planning,
  streaming, payload decode, and star cell emission against shared strategies.
- `@found-in-space/meta-sidecar-provider`: metadata facts keyed by star refs.
- `@found-in-space/star-map-canvas`: 2D starmap rendering.
- `@found-in-space/three-star-field`: Three.js star cell renderer and picking.
- `@found-in-space/hr-diagram`: HR diagram model, Canvas fallback, WebGL renderer,
  and optional touch-os surface adapter.
- `@found-in-space/anchored-image`: anchored image manifests, solving, and
  Canvas2D/Three.js adapters.
- `@found-in-space/skykit`: plugin-first composition and teaching helpers.
  `@found-in-space/skykit/xr` is the optional WebXR subpath for rig/input/body,
  rays, session, and depth helpers.
- `@found-in-space/experimental-structure-layers`: experimental H-alpha/dust
  preservation package, not stable core.

## Release And Versioning

- The repository root is a private workspace shell and should not be published.
- Workspace packages should be versioned independently, not forced to share one
  lockstep version.
- During alpha, prefer coordinated release batches: publish the changed packages
  together, update internal dependency ranges together, and write one human
  release note for the batch.
- Use Changesets for package releases once release tooling is added. A changeset
  should be committed with meaningful package changes and should name the
  package(s), semver bump(s), and short release note.
- `@found-in-space/skykit` is the beginner-facing compatibility anchor: learners
  can install SkyKit and get a compatible set of focused modules, while the
  focused modules still keep their own versions.
- Keep `@found-in-space/experimental-structure-layers` out of normal stable
  release expectations unless the user explicitly decides to publish it.

## Standard Commands

- Install dependencies: `npm install`
- Run tests: `node --test`
- Run tests in watch mode: `node --test --watch`
- Workspace typecheck: `npm run typecheck`
- Dev server: `npm run dev`
- Build demos: `npm run build`

## Documentation

- `docs/alpha-rules.md`: alpha rewrite and package-boundary rules.
- `docs/package-learning-architecture.md`: current teaching path and lessons.
- `docs/star-octree-provider.md`: provider/strategy/planner/session semantics.
- `docs/star-map-canvas.md`: Canvas2D starmap package contract.
- `docs/anchored-image.md`: anchored image package contract.
- `docs/skykit-core-composition.md`: core SkyKit composition contract.
- `docs/xr-architecture.md`: spatial navigation and SkyKit XR subpath
  boundaries.
- `docs/journey-architecture.md`: shared journey/runtime/editor boundary.

## WebXR And Scene Graph Constraints

See `docs/xr-architecture.md` for the full spatial/WebXR boundary. Critical
rules:

1. Never mutate the WebXR camera directly for headset orientation.
2. XR scene graphs must keep scene content roots and the spaceship/navigation
   root distinct.
3. Use separate roots for origin-pinned content, observer-centric content, and
   scale-banded context layers.
4. Observer-centric layers follow observer translation without inheriting
   ship/head rotation.
5. Controller visuals and ray sources belong inside XR-owned mount roots.
6. Motion helpers consume a scale profile; data packages do not own physical
   meter-scale policy.

## Examples

- Package examples should teach direct package usage.
- `packages/skykit/examples/` should teach composition: viewer, provider,
  renderer, controls, status/debug, and small custom plugins.
- Root demos are transition sandboxes. Prefer package examples for new learning
  material unless the user explicitly asks to work on a root demo.
- New package examples and public package code should use
  `StarObjectRef` for star identity and `createStarCellKey()` for cell
  keys. Do not introduce public IDs based on octree storage details such as
  `nodeKey`, `shardOffset`, `nodeIndex`, `payloadOffset`, or `payloadLength`.
