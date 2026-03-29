export const DEFAULT_FOUND_IN_SPACE_OCTREE_URL = 'https://foundinspace.s3.eu-central-1.amazonaws.com/stars.octree';
export const DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL = 'https://foundinspace.s3.eu-central-1.amazonaws.com/stars.meta.octree';

function normalizeNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function deriveMetaOctreeUrlFromRenderUrl(renderUrl) {
  const normalizedUrl = normalizeNonEmptyString(renderUrl);
  if (!normalizedUrl) {
    return DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL;
  }

  if (normalizedUrl === DEFAULT_FOUND_IN_SPACE_OCTREE_URL) {
    return DEFAULT_FOUND_IN_SPACE_META_OCTREE_URL;
  }

  const queryIndex = normalizedUrl.indexOf('?');
  const base = queryIndex >= 0 ? normalizedUrl.slice(0, queryIndex) : normalizedUrl;
  const query = queryIndex >= 0 ? normalizedUrl.slice(queryIndex) : '';
  const slashIndex = base.lastIndexOf('/');
  const directory = slashIndex >= 0 ? base.slice(0, slashIndex + 1) : '';
  const fileName = slashIndex >= 0 ? base.slice(slashIndex + 1) : base;
  const dotIndex = fileName.lastIndexOf('.');

  if (dotIndex < 0) {
    return `${directory}${fileName}.meta.octree${query}`;
  }

  return `${directory}${fileName.slice(0, dotIndex)}.meta${fileName.slice(dotIndex)}${query}`;
}

export function resolveFoundInSpaceDatasetOverrides(search = null) {
  const searchValue = typeof search === 'string'
    ? search
    : globalThis.location?.search ?? '';
  const params = new URLSearchParams(searchValue);
  const octreeUrl = normalizeNonEmptyString(params.get('octreeUrl'));
  const metaUrl = normalizeNonEmptyString(params.get('metaUrl') ?? params.get('metaOctreeUrl'));

  return {
    ...(octreeUrl ? { octreeUrl } : {}),
    ...(metaUrl ? { metaUrl } : {}),
  };
}

export function createFoundInSpaceDatasetOptions(options = {}) {
  const {
    id = 'found-in-space-dataset',
    octreeUrl,
    metaUrl,
    sidecars,
    capabilities,
    ...rest
  } = options;
  const resolvedOctreeUrl = normalizeNonEmptyString(octreeUrl) ?? DEFAULT_FOUND_IN_SPACE_OCTREE_URL;
  const nextSidecars = sidecars && typeof sidecars === 'object' ? { ...sidecars } : {};
  const nextMetaSidecar = nextSidecars.meta && typeof nextSidecars.meta === 'object'
    ? { ...nextSidecars.meta }
    : {};
  const resolvedMetaUrl = normalizeNonEmptyString(metaUrl)
    ?? normalizeNonEmptyString(nextMetaSidecar.url)
    ?? deriveMetaOctreeUrlFromRenderUrl(resolvedOctreeUrl);

  return {
    ...rest,
    id,
    octreeUrl: resolvedOctreeUrl,
    sidecars: {
      ...nextSidecars,
      meta: {
        ...nextMetaSidecar,
        url: resolvedMetaUrl,
      },
    },
    ...(capabilities && typeof capabilities === 'object'
      ? { capabilities: { ...capabilities } }
      : capabilities != null
        ? { capabilities }
        : {}),
  };
}
