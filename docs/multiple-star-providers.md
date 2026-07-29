# Multiple Star Providers

Status: accepted direction; implementation planned

## Motivation

SkyKit sessions need to compose stars from sources with different scale,
authority, and storage:

- a high-throughput Gaia/Hipparcos octree;
- a small published reference catalog, such as the optional Sun entry;
- authored scenario objects, such as the faint star used by the Astrophage
  demo; and
- application or user-created session objects.

These objects should participate in rendering, picking, labels, selection, and
navigation without being physically merged into one catalog build. The Sun is
the first public reference case: the core stellar octree excludes it, while an
application may load a published solar reference, define its own Sun, or omit
the object entirely.

## Direction

Multiple star providers are a first-order composition use case.

The octree provider remains responsible only for octree loading, planning,
streaming, and its own live cell state. Static or authored objects must not
become special cases inside `@found-in-space/star-octree-provider`.

A small/static provider should emit the shared star product shapes owned by
`@found-in-space/star-trees`. SkyKit composition should be able to attach more
than one provider lane to the same renderer or to separate renderers. Providers
do not need to share storage, planning, or update strategies.

The first implementation should preserve these rules:

1. Provider identity is retained on every delta and object reference.
2. Live cell or object keys are provider-qualified before they enter a shared
   store or renderer.
3. Providers are independently enabled, disabled, styled, and disposed.
4. No cross-provider deduplication, replacement, or shadowing happens
   implicitly.
5. Any shadow/replace policy is explicit application configuration and records
   both identities.
6. Picking and metadata results report the provider and dataset that supplied
   the object.
7. High-throughput data continues to use provider streams rather than the
   SkyKit event bus.
8. Static providers do not need to invent octree cells or transport details
   merely to satisfy an octree-specific API.

## Identity Work

The current octree identity is:

```text
providerId + datasetId + level + mortonCode + ordinal
```

That remains valid for octree objects. Static providers also need a stable
provider-qualified object identity, but should not fabricate Morton coordinates
or ordinals. The shared `StarObjectRef` contract should be generalized only as
far as an active static-provider implementation requires.

The composition layer must never key shared state by `cellKey` or `source_id`
alone. Equal local keys from two providers are allowed and remain distinct
unless an application installs an explicit resolution rule.

## Sun Reference

The core octree defines positions relative to the solar origin but contains no
Sun row. A solar-reference provider may expose the published Found in Space Sun
entry at the optional session-origin placement.

Navigation such as "Fly to Sun" continues to target the coordinate origin
directly. It does not depend on the provider being installed or the Sun object
being visible.

The solar provider is ordinary application composition:

```text
external octree provider
  + optional solar-reference static provider
  + optional scenario/session providers
  -> shared or layered star renderers
```

Applications remain free to replace the published solar rendering, supply
different physical or visual values, or omit it.

## Package Boundary

Do not add a generic provider registry or closed provider-kind switch.

- `star-trees` owns shared star data and identity contracts.
- `star-octree-provider` owns only octree-backed delivery.
- a reusable static provider should be a focused package once an active
  consumer establishes the smallest useful boundary;
- `three-star-field`, `star-map-canvas`, and other renderers consume
  provider-qualified products; and
- SkyKit supplies thin, explicit composition helpers and teaching examples.

The existing Astrophage scenario injection should inform the first
static-provider extraction instead of being preserved as a second private
mechanism.

## Initial Acceptance Criteria

The first supported multiple-provider example should demonstrate:

- one octree provider and one static provider visible simultaneously;
- the static provider adding both a published-reference object and an authored
  scenario object;
- provider-qualified picking and labels;
- independent visibility and styling;
- deterministic disposal without removing another provider's objects; and
- origin navigation working with the solar provider disabled.
