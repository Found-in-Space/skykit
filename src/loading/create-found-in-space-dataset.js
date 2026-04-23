// @ts-check

import {
  createFoundInSpaceDatasetOptions,
  resolveFoundInSpaceDatasetOverrides,
} from '../found-in-space-dataset.js';
import { createDataset } from './create-dataset.js';

/**
 * Create a dataset handle for the standard Found in Space octree dataset.
 *
 * This packages the common helper pattern used across demos and website
 * consumers:
 *
 * - resolve URL overrides from the current location (unless disabled)
 * - create the standard Found in Space dataset options
 * - return a normal SkyKit dataset handle with explicit warmup methods
 *
 * @param {any} [options]
 */
export function createFoundInSpaceDataset(options = {}) {
  const {
    search = null,
    resolveOverrides = true,
    ...datasetOptions
  } = options ?? {};

  const overrides = resolveOverrides === false
    ? {}
    : resolveFoundInSpaceDatasetOverrides(search);

  return createDataset(createFoundInSpaceDatasetOptions({
    ...overrides,
    ...datasetOptions,
  }));
}
