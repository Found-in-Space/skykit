#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runOctreeFormatSuite } from './suite.js';

const DEFAULT_JSON_PATH = 'benchmarks/octree-format/.runs/latest.json';

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(createHelp());
    process.exitCode = 0;
  } else {
    const suite = await runOctreeFormatSuite(options.octrees, options.benchmark);
    console.log(createConsoleReport(suite));
    if (options.jsonPath) {
      await mkdir(path.dirname(options.jsonPath), { recursive: true });
      await writeFile(options.jsonPath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
      console.log(`\nRaw report: ${options.jsonPath}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error('\nRun with --help for usage.');
  process.exitCode = 1;
}

/** @param {string[]} args */
function parseArguments(args) {
  const octrees = [];
  const points = [];
  const benchmark = {};
  let jsonPath = DEFAULT_JSON_PATH;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--no-json') {
      jsonPath = null;
      continue;
    }
    if (argument === '--octree') {
      octrees.push(parseOctreeSpec(requireValue(args, ++index, '--octree'), octrees.length));
      continue;
    }
    if (argument === '--samples') {
      benchmark.sampleCount = parsePositiveInteger(requireValue(args, ++index, '--samples'), '--samples');
      continue;
    }
    if (argument === '--min-radius-pc') {
      benchmark.minRadiusPc = parsePositiveNumber(requireValue(args, ++index, '--min-radius-pc'), '--min-radius-pc');
      continue;
    }
    if (argument === '--max-radius-pc') {
      benchmark.maxRadiusPc = parsePositiveNumber(requireValue(args, ++index, '--max-radius-pc'), '--max-radius-pc');
      continue;
    }
    if (argument === '--point') {
      points.push(parsePoint(requireValue(args, ++index, '--point')));
      continue;
    }
    if (argument === '--json') {
      jsonPath = requireValue(args, ++index, '--json');
      continue;
    }
    if (argument.startsWith('-')) {
      throw new Error(`Unknown option ${argument}`);
    }
    octrees.push(parseOctreeSpec(argument, octrees.length));
  }

  if (!help && octrees.length === 0) {
    throw new Error('Provide at least one octree as label=/path/to/stars.octree');
  }
  if (points.length > 0) benchmark.points = points;

  return { help, octrees, benchmark, jsonPath };
}

/** @param {string} value @param {number} index */
function parseOctreeSpec(value, index) {
  const separator = value.indexOf('=');
  if (separator < 1 || separator === value.length - 1) {
    return { label: `octree-${index + 1}`, path: value };
  }
  return {
    label: value.slice(0, separator),
    path: value.slice(separator + 1),
  };
}

/** @param {string} value */
function parsePoint(value) {
  const coordinates = value.split(',').map(Number);
  if (coordinates.length !== 3 || !coordinates.every(Number.isFinite)) {
    throw new Error(`--point must be x,y,z in parsecs, got ${value}`);
  }
  return { x: coordinates[0], y: coordinates[1], z: coordinates[2] };
}

/** @param {string[]} args @param {number} index @param {string} option */
function requireValue(args, index, option) {
  const value = args[index];
  if (value == null) throw new Error(`${option} requires a value`);
  return value;
}

/** @param {string} value @param {string} option */
function parsePositiveInteger(value, option) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${option} must be a positive integer`);
  }
  return number;
}

/** @param {string} value @param {string} option */
function parsePositiveNumber(value, option) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${option} must be a positive number`);
  }
  return number;
}

/** @param {Awaited<ReturnType<typeof runOctreeFormatSuite>>} suite */
function createConsoleReport(suite) {
  const lines = [
    'STAR octree format benchmark (index-only point-path probes)',
    '',
    createTable(
      ['label', 'ver', 'file', 'index', 'queries', 'query ms', 'read', 'nodes/q', 'depth', 'terminal'],
      suite.results.map((result) => [
        result.label,
        String(result.formatVersion),
        formatBytes(result.file.bytes),
        formatBytes(result.file.indexBytes),
        String(result.queries.count),
        formatNumber(result.timings.queryMs),
        formatBytes(result.io.bytesRead),
        formatNumber(result.queries.inspectedNodes.mean),
        formatNumber(result.queries.deepestLevel.mean),
        formatPercent(result.queries.terminalQueryFraction),
      ]),
    ),
  ];

  for (const comparison of suite.comparisons) {
    lines.push(
      '',
      `${comparison.candidate} / ${comparison.baseline}: ` +
        `file ${formatRatio(comparison.ratios.fileBytes)}, ` +
        `index ${formatRatio(comparison.ratios.indexBytes)}, ` +
        `read ${formatRatio(comparison.ratios.bytesRead)}, ` +
        `inspected nodes ${formatRatio(comparison.ratios.inspectedNodes)}, ` +
        `query time ${formatRatio(comparison.ratios.queryMs)}`,
    );
  }

  lines.push('', 'Payloads were not read or decompressed.');
  return lines.join('\n');
}

/** @param {string[]} headers @param {string[][]} rows */
function createTable(headers, rows) {
  const widths = headers.map((header, column) => Math.max(
    header.length,
    ...rows.map((row) => row[column].length),
  ));
  const line = (row) => row
    .map((value, column) => value.padEnd(widths[column]))
    .join('  ')
    .trimEnd();
  return [
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map(line),
  ].join('\n');
}

/** @param {number} bytes */
function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

/** @param {number | null} value */
function formatRatio(value) {
  return value == null ? 'n/a' : `${value.toFixed(3)}x`;
}

/** @param {number | null} value */
function formatNumber(value) {
  return value == null ? 'n/a' : value.toFixed(2);
}

/** @param {number} value */
function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function createHelp() {
  return `Usage:
  npm run bench:octree -- v1=/path/to/stars.octree v2=/path/to/stars-v2.octree [options]

Options:
  --octree LABEL=PATH   Add an octree (may be repeated)
  --samples N           Deterministic generated point probes (default: 32)
  --min-radius-pc N     Smallest generated radius (default: 1)
  --max-radius-pc N     Largest generated radius (default: 20000)
  --point X,Y,Z         Use an explicit parsec point (may be repeated)
  --json PATH           Raw JSON output path
  --no-json             Do not write a JSON report
  --help                Show this help

The tool performs bounded index-only path traversals. It never reads or
decompresses star payload ranges.`;
}
