#!/usr/bin/env node

import { parseArgs } from 'node:util';
import {
  DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  DEFAULT_PAYLOAD_MAX_GAP_BYTES,
} from '../src/services/octree/octree-file-service.js';
import {
  DEFAULT_FOUND_IN_SPACE_OCTREE_URL,
  deriveMetaOctreeUrlFromRenderUrl,
} from '../src/found-in-space-dataset.js';
import { diagnoseObserverShellSelection } from '../src/diagnostics/observer-shell-diagnostic.js';

function parsePoint(value) {
  const parts = String(value ?? '').split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new TypeError(`Invalid --point "${value}", expected X,Y,Z`);
  }
  return {
    x: parts[0],
    y: parts[1],
    z: parts[2],
  };
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    point: {
      type: 'string',
      default: '0,0,0',
    },
    magnitude: {
      type: 'string',
      default: '6.5',
    },
    radius: {
      type: 'string',
      default: '10',
    },
    nearest: {
      type: 'string',
      default: '10',
    },
    'meta-octree': {
      type: 'string',
    },
    'skip-sidecar-meta': {
      type: 'boolean',
      default: false,
    },
    'max-level': {
      type: 'string',
    },
    'payload-max-gap-bytes': {
      type: 'string',
      default: String(DEFAULT_PAYLOAD_MAX_GAP_BYTES),
    },
    'payload-max-batch-bytes': {
      type: 'string',
      default: String(DEFAULT_PAYLOAD_MAX_BATCH_BYTES),
    },
    'skip-payload-decode': {
      type: 'boolean',
      default: false,
    },
  },
});

const octreeUrl = positionals[0] ?? DEFAULT_FOUND_IN_SPACE_OCTREE_URL;
const metaUrl = values['meta-octree'] ?? deriveMetaOctreeUrlFromRenderUrl(octreeUrl);

const report = await diagnoseObserverShellSelection({
  octreeUrl,
  metaUrl,
  observerPc: parsePoint(values.point),
  mDesired: Number(values.magnitude),
  radiusPc: Number(values.radius),
  nearestN: Number(values.nearest),
  includeSidecarMeta: !values['skip-sidecar-meta'],
  maxLevel: values['max-level'] == null ? null : Number(values['max-level']),
  payloadMaxGapBytes: Number(values['payload-max-gap-bytes']),
  payloadMaxBatchBytes: Number(values['payload-max-batch-bytes']),
  decodePayloads: !values['skip-payload-decode'],
});

console.log(JSON.stringify(report, null, 2));
