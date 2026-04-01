#!/usr/bin/env node

import { parseArgs } from 'node:util';
import {
  DEFAULT_PAYLOAD_MAX_BATCH_BYTES,
  DEFAULT_PAYLOAD_MAX_GAP_BYTES,
} from '../src/services/octree/octree-file-service.js';
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

const octreeUrl = positionals[0];
if (!octreeUrl) {
  throw new TypeError('Usage: node scripts/observer-shell-diagnostic.mjs <octree-url> [--point X,Y,Z] [--magnitude 6.5]');
}

const report = await diagnoseObserverShellSelection({
  octreeUrl,
  observerPc: parsePoint(values.point),
  mDesired: Number(values.magnitude),
  maxLevel: values['max-level'] == null ? null : Number(values['max-level']),
  payloadMaxGapBytes: Number(values['payload-max-gap-bytes']),
  payloadMaxBatchBytes: Number(values['payload-max-batch-bytes']),
  decodePayloads: !values['skip-payload-decode'],
});

console.log(JSON.stringify(report, null, 2));
