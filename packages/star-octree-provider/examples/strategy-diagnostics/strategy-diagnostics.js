import {
  combineStarOctreeStrategies,
  createObserverShellStrategy,
  createPathVolumeStrategy,
  createSphereVolumeStrategy,
  createStarOctreeProviderService,
  createTargetFrustumStrategy,
  withMotionLookahead,
} from '@found-in-space/star-octree-provider';

const STAR_OCTREE_URL =
  'https://d1kwci8ql2abxm.cloudfront.net/c56103e6-ad4c-41f9-be06-048b48ec632b/stars.octree';
const provider = createStarOctreeProviderService({ url: STAR_OCTREE_URL });
const status = document.querySelector('[data-status]');
const results = document.querySelector('[data-results]');
const log = document.querySelector('[data-log]');

const observer = { x: 0, y: 0, z: 0 };
const sphere = createSphereVolumeStrategy({ centerPc: { x: 8, y: 0, z: -10 }, radiusPc: 8 });
const path = createPathVolumeStrategy({
  pointsPc: [observer, { x: 20, y: 0, z: -20 }, { x: 35, y: 6, z: -45 }],
  radiusPc: 4,
});

const cases = [
  ['observer-shell', createObserverShellStrategy(), { observerPc: observer, limitingMagnitude: 4.5 }],
  ['target-frustum', createTargetFrustumStrategy({ verticalFovDeg: 32 }), {
    observerPc: observer,
    targetPc: { x: 18, y: 0, z: -30 },
    limitingMagnitude: 6.5,
    aspectRatio: 1.6,
  }],
  ['sphere-volume', sphere, {}],
  ['path-volume', path, {}],
  ['motion-lookahead', withMotionLookahead(createObserverShellStrategy()), {
    observerPc: observer,
    limitingMagnitude: 4.5,
    motion: { velocityPcPerSec: { x: 12, y: 0, z: -6 }, lookaheadSecs: 4 },
  }],
  ['composite union', combineStarOctreeStrategies([sphere, path]), {}],
];

document.querySelector('[data-run]').addEventListener('click', run);

async function run() {
  results.textContent = '';
  log.textContent = '';
  status.textContent = 'running...';

  for (const [name, strategy, view] of cases) {
    const inspection = await provider.inspectDemand({ strategy, view });
    const fetched = await fetchPayloadSummary(strategy, view);
    results.appendChild(row(name, inspection, fetched));
    log.textContent += `${name}\n${JSON.stringify(inspection.metadata ?? {}, null, 2)}\n\n`;
  }

  status.textContent = 'complete';
}

async function fetchPayloadSummary(strategy, view) {
  const summary = { nodes: 0, bytes: 0 };
  for await (const event of provider.streamPayloads({ strategy, view })) {
    if (event.type === 'payload/progress') {
      summary.nodes = event.loadedNodes;
      summary.bytes = event.loadedBytes ?? summary.bytes;
    }
  }
  return summary;
}

function row(name, inspection, fetched) {
  const tr = document.createElement('tr');
  const pruned = inspection.metadata?.prunedNodeCount ?? '-';
  const levels = `${inspection.counts.minLevel ?? '-'}-${inspection.counts.maxLevel ?? '-'}`;
  for (const value of [
    name,
    inspection.counts.currentNodeCount,
    pruned,
    inspection.counts.prefetchNodeCount,
    levels,
    fetched.nodes,
    fetched.bytes,
  ]) {
    const td = document.createElement('td');
    td.textContent = String(value);
    tr.appendChild(td);
  }
  return tr;
}
