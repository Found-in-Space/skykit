/**
 * @typedef {import('@found-in-space/star-products').CanonicalObjectRef} CanonicalObjectRef
 * @typedef {import('./index.d.ts').MetaSidecarEntry} MetaSidecarEntry
 * @typedef {import('./index.d.ts').MetaSidecarFactProduct} MetaSidecarFactProduct
 * @typedef {import('./index.d.ts').MetaSidecarProviderDescriptor} MetaSidecarProviderDescriptor
 * @typedef {import('./index.d.ts').MetaSidecarProviderService} MetaSidecarProviderService
 * @typedef {import('./index.d.ts').MetaSidecarProviderServiceOptions} MetaSidecarProviderServiceOptions
 * @typedef {import('./index.d.ts').MetaSidecarProviderSnapshot} MetaSidecarProviderSnapshot
 */

export const ERR_META_SIDECAR_PARENT_MISMATCH =
  'ERR_META_SIDECAR_PARENT_MISMATCH';

let nextProviderId = 1;

/**
 * @param {MetaSidecarProviderServiceOptions} options
 * @returns {MetaSidecarProviderService}
 */
export function createMetaSidecarProviderService(options) {
  validateOptions(options);

  const providerId = options.id ?? `meta-sidecar-provider-${nextProviderId}`;
  nextProviderId += 1;
  const parentDatasetId = options.parentDatasetId.trim();
  const sidecarKind = options.sidecarKind ?? 'meta';
  const sidecarId = options.sidecarId ?? null;
  /** @type {Map<string, MetaSidecarEntry[]>} */
  const cells = new Map(Object.entries(options.entries ?? {}));
  let disposed = false;
  let resolvedFacts = 0;
  let missingFacts = 0;
  let parentMismatches = 0;

  return {
    get id() {
      return providerId;
    },

    describe() {
      assertActive();
      return {
        id: providerId,
        providerType: 'meta-sidecar',
        parentDatasetId,
        sidecarId,
        sidecarKind,
        produces: ['fact-batch'],
      };
    },

    getSnapshot() {
      return {
        id: providerId,
        providerType: 'meta-sidecar',
        parentDatasetId,
        sidecarId,
        cache: {
          cells: cells.size,
        },
        stats: {
          resolvedFacts,
          missingFacts,
          parentMismatches,
        },
      };
    },

    async resolveFacts(ref) {
      assertActive();
      const normalized = normalizeRef(ref);
      assertParentDataset(normalized);

      const entries = cells.get(normalized.nodeKey);
      const entry = entries?.[normalized.ordinal];
      if (!entry) {
        missingFacts += 1;
        return null;
      }

      resolvedFacts += 1;
      return {
        productType: 'fact-batch',
        providerId,
        parentDatasetId,
        sidecarId,
        objectRef: normalized,
        facts: {
          ...metaEntryDisplayFields(entry),
          primaryLabel: primaryLabelFromEntry(entry),
        },
        raw: entry,
      };
    },

    async resolvePrimaryLabel(ref) {
      const facts = await this.resolveFacts(ref);
      return facts?.facts.primaryLabel ?? '';
    },

    dispose() {
      disposed = true;
      cells.clear();
    },
  };

  function assertActive() {
    if (disposed) {
      throw new Error(`Meta sidecar provider "${providerId}" is disposed.`);
    }
  }

  /**
   * @param {CanonicalObjectRef} ref
   */
  function assertParentDataset(ref) {
    if (!ref.datasetId || ref.datasetId === parentDatasetId) {
      return;
    }

    parentMismatches += 1;
    const error = new Error('Meta sidecar parent dataset does not match object reference.');
    throw Object.assign(error, {
      code: ERR_META_SIDECAR_PARENT_MISMATCH,
    });
  }
}

/**
 * @param {MetaSidecarProviderServiceOptions} options
 */
function validateOptions(options) {
  if (!options || typeof options.parentDatasetId !== 'string' || !options.parentDatasetId.trim()) {
    throw new TypeError('createMetaSidecarProviderService() requires parentDatasetId.');
  }
}

/**
 * @param {unknown} ref
 * @returns {CanonicalObjectRef}
 */
function normalizeRef(ref) {
  if (!ref || typeof ref !== 'object') {
    throw new TypeError('Meta sidecar facts require an object reference.');
  }

  const candidate = /** @type {Partial<CanonicalObjectRef>} */ (ref);
  const nodeKey = typeof candidate.nodeKey === 'string' ? candidate.nodeKey : '';
  const ordinal = Number(candidate.ordinal);
  if (!nodeKey || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new TypeError('Meta sidecar object reference requires nodeKey and non-negative ordinal.');
  }

  return {
    datasetId: candidate.datasetId ?? null,
    nodeKey,
    ordinal,
  };
}

/**
 * @param {unknown} value
 */
function normalizeMetaString(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return String(value).trim();
}

/**
 * @param {unknown} bayer
 * @param {unknown} constellation
 */
function bayerAlreadyEndsWithConstellation(bayer, constellation) {
  const b = normalizeMetaString(bayer);
  const c = normalizeMetaString(constellation);
  if (!b || !c) {
    return false;
  }
  const lowerBayer = b.toLowerCase();
  const lowerConstellation = c.toLowerCase();
  if (!lowerBayer.endsWith(lowerConstellation)) {
    return false;
  }
  if (lowerBayer.length === lowerConstellation.length) {
    return true;
  }
  const separator = b[b.length - c.length - 1];
  return separator === ' ' || separator === '-';
}

/**
 * @param {MetaSidecarEntry} entry
 */
export function formatBayerDesignation(entry) {
  const bayer = normalizeMetaString(entry.bayer);
  if (!bayer) {
    return '';
  }
  const constellation = normalizeMetaString(entry.constellation);
  if (!constellation || bayerAlreadyEndsWithConstellation(bayer, constellation)) {
    return bayer;
  }
  return `${bayer} ${constellation}`;
}

/**
 * @param {MetaSidecarEntry} entry
 */
export function metaEntryDisplayFields(entry) {
  const source = normalizeMetaString(entry.source).toLowerCase();
  const sourceId = normalizeMetaString(entry.source_id);

  return {
    properName: normalizeMetaString(entry.proper_name),
    bayer: formatBayerDesignation(entry),
    hd: normalizeMetaString(entry.hd),
    hip: normalizeMetaString(entry.hip_id) ||
      (source === 'hip' && sourceId ? sourceId : ''),
    gaia: normalizeMetaString(entry.gaia_source_id) ||
      (source === 'gaia' && sourceId ? sourceId : ''),
  };
}

/**
 * @param {MetaSidecarEntry} entry
 */
function primaryLabelFromEntry(entry) {
  const fields = metaEntryDisplayFields(entry);
  if (fields.properName) return fields.properName;
  if (fields.bayer) return fields.bayer;
  if (fields.hd) return `HD ${fields.hd}`;
  if (fields.hip) return `HIP ${fields.hip}`;
  if (fields.gaia) return `Gaia ${fields.gaia}`;
  if (entry.source != null && entry.source_id != null) {
    return `${entry.source} ${entry.source_id}`;
  }
  return '';
}
