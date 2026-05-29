# Meta Sidecar Provider

Status: current alpha package.

Alpha metadata sidecar provider for Found in Space datasets.

This package is intentionally separate from `@found-in-space/star-octree-provider`.
It consumes canonical object references emitted by star cells and resolves
sidecar-backed metadata without adding label lookup behavior to the star
provider itself.

Sidecar inputs use the public star identity:

```txt
datasetId + level + mortonCode + ordinal
```

The provider reads a URL-backed Stage 03 `meta` sidecar octree. It validates the
sidecar descriptor against the active render dataset id, traverses internally by
semantic `{ level, mortonCode }`, then returns the decoded JSON metadata row for
an object ref or the full decoded JSON row array for a cell ref.

The provider is intentionally schema-neutral. It does not interpret fields such
as `proper_name`, `flamsteed`, `HIP`, or `Gaia`, and it does not choose display
labels. Applications own that policy. The helper
`metaSidecarEntryDisplayFields()` only normalizes the common fields into a
convenient display bundle.

Public lookups must not depend on octree storage fields such as `nodeKey`,
`shardOffset`, `nodeIndex`, `payloadOffset`, or `payloadLength`.

```js
import {
  META_SIDECAR_DEFAULT,
  createMetaSidecarProviderService,
  metaSidecarEntryDisplayFields,
} from '@found-in-space/meta-sidecar-provider';

const provider = createMetaSidecarProviderService({
  url: META_SIDECAR_DEFAULT,
  parentDatasetId: 'c56103e6-ad4c-41f9-be06-048b48ec632b',
});

const meta = await provider.getMeta({
  datasetId: 'c56103e6-ad4c-41f9-be06-048b48ec632b',
  level: 1,
  mortonCode: '5',
  ordinal: 0,
});

const cellRows = await provider.getMetaCell({
  datasetId: 'c56103e6-ad4c-41f9-be06-048b48ec632b',
  level: 1,
  mortonCode: '5',
});

const fields = metaSidecarEntryDisplayFields(meta);
console.log(fields.primaryLabel);
```

Use `deriveMetaSidecarUrlFromRenderUrl()` when an app starts from the star
octree URL and wants the matching default metadata sidecar URL.
