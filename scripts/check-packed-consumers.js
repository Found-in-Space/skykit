import {
  lstatSync,
  openSync, closeSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'skykit-packed-consumers-'));
const packDir = path.join(tempRoot, 'packs');
mkdirSync(packDir);

try {
  const workspaceTarballs = [
    'packages/guided-journey',
    'packages/anchored-image',
    'packages/hr-diagram',
    'packages/meta-sidecar-provider',
    'packages/skykit',
    'packages/spatial',
    'packages/star-octree-provider',
    'packages/star-trees',
    'packages/three-star-field',
  ].map(packWorkspace);

  verifyOrdinaryRoots(workspaceTarballs);
  verifyOptionalSubpaths(workspaceTarballs);

  console.log('Packed-consumer checks passed.');
} finally {
  if (process.env.SKYKIT_KEEP_PACKED_CONSUMERS === '1') {
    console.log(`Packed-consumer fixtures retained at ${tempRoot}`);
  } else {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function packWorkspace(relativePath) {
  const result = run(
    'npm',
    ['pack', path.join(rootDir, relativePath), '--pack-destination', packDir, '--json'],
    rootDir,
    { capture: true },
  );
  const report = JSON.parse(result.stdout);
  const filename = (Array.isArray(report) ? report : Object.values(report))[0]?.filename;
  if (!filename) throw new Error(`npm pack did not report a tarball for ${relativePath}`);
  return path.join(packDir, filename);
}

function verifyOrdinaryRoots(workspaceTarballs) {
  const consumerDir = createConsumer('ordinary-roots');
  install(consumerDir, [
    '--omit=optional',
    ...workspaceTarballs,
    'three@0.170.0',
  ]);

  writeFileSync(path.join(consumerDir, 'check.mjs'), `
import { existsSync } from 'node:fs';
import path from 'node:path';

const touchOsRoot = path.join(process.cwd(), 'node_modules', '@found-in-space', 'touch-os');
if (existsSync(touchOsRoot)) {
  throw new Error('ordinary-root consumer unexpectedly installed touch-os');
}

await import('@found-in-space/skykit');
await import('@found-in-space/guided-journey');
await import('@found-in-space/skykit/journey');
await import('@found-in-space/hr-diagram');
console.log('ordinary SkyKit and HR roots imported without touch-os');

const spatial = await import('@found-in-space/spatial');
const skykit = await import('@found-in-space/skykit');
const { createSkykitJourneyDriver, createSkykitSequenceParticipant } = await import('@found-in-space/skykit/journey');
const { createJourneySequencePlayer } = await import('@found-in-space/guided-journey/sequence');
const { exerciseJourneyDriver } = await import('@found-in-space/guided-journey/testing');
const space = { frameId: 'packed:physical', metersPerUnit: 1 };
const route = spatial.buildSpatialPolylineRoute({ space,
  points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }],
  travel: { kind: 'polyline', timing: { kind: 'constantSpeed', speedUnitsPerSec: 10 } },
});
if (spatial.evaluateSpatialRoute(route, 2).position.x !== 20) {
  throw new Error('packed spatial modules did not evaluate a physical route');
}
const renderer = { render() {}, setSize() {}, dispose() {} };
const navigation = skykit.createSkykitNavigationPlugin();
const viewer = await skykit.createSkykitViewer({ renderer,
  plugins: [navigation],
});
await viewer.actions.invoke(skykit.SKYKIT_ACTIONS.navigation.flyTo, {
  targetPc: { x: 10, y: 0, z: 0 }, durationSecs: 2,
});
viewer.update(1);
viewer.update(0);
if (!(viewer.getViewState().observerPc.x > 0)) {
  throw new Error('packed SkyKit did not bridge its parsec view into contextual navigation');
}
await exerciseJourneyDriver({ driver: createSkykitJourneyDriver({ viewer, navigation }),
  scenes: [0, 1, 2].map(x => ({ camera: { observerPc: { x, y: 0, z: 0 } } })),
  async advance() { for (let i = 0; i < 30; i++) await Promise.resolve();
    viewer.frame(0); viewer.frame(.2); viewer.frame(0);
    for (let i = 0; i < 30; i++) await Promise.resolve(); },
});
const participant = createSkykitSequenceParticipant({ viewer, navigation, durationSecs: 0 });
const player = createJourneySequencePlayer({ participant, sequence: { durationSecs: 1,
  evaluate(timeSecs) { return { pose: spatial.normalizeSpatialPose({ space: skykit.SKYKIT_ICRS_SPACE, position: { x: timeSecs, y: 0, z: 0 } }) }; },
} });
const arrival = player.join();
for (let i = 0; i < 30; i++) await Promise.resolve();
viewer.frame(0); viewer.frame(0); await arrival.finished;
const ended = player.play(); player.update(1); viewer.frame(0);
if ((await ended.finished).status !== 'completed' || viewer.getViewState().observerPc.x !== 1) throw new Error('Packed sequence did not reach its applied final sample.');
player.dispose(); participant.dispose();
await viewer.dispose();
console.log('packed spatial modules and SkyKit navigation evaluated without workspace links');
  `);
  run('node', ['check.mjs'], consumerDir);
}

function verifyOptionalSubpaths(workspaceTarballs) {
  const consumerDir = createConsumer('optional-subpaths');
  install(consumerDir, [
    ...workspaceTarballs,
    path.join(rootDir, '.packages/touch-os.tgz'),
    '@pmndrs/pointer-events@6.6.32',
    'three@0.170.0',
  ]);

  writeFileSync(path.join(consumerDir, 'check.mjs'), `
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

await import('@found-in-space/skykit/touch-os');
await import('@found-in-space/hr-diagram/touch-os');
await import('@found-in-space/touch-os');
await import('@found-in-space/touch-os/hosts/three');

const packageRoot = path.join(process.cwd(), 'node_modules', '@found-in-space', 'touch-os');
const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
if (manifest.version !== '0.4.0-alpha.0') {
  throw new Error(\`expected touch-os 0.4.0-alpha.0, received \${String(manifest.version)}\`);
}
if (lstatSync(packageRoot).isSymbolicLink()) {
  throw new Error('touch-os resolved through a workspace or sibling symlink');
}
const entryPath = new URL(import.meta.resolve('@found-in-space/touch-os'));
const expectedPrefix = realpathSync(packageRoot) + path.sep;
const resolvedEntry = realpathSync(entryPath);
if (!resolvedEntry.startsWith(expectedPrefix)) {
  throw new Error(\`touch-os entry resolved outside the packed consumer: \${resolvedEntry}\`);
}
console.log(\`optional subpaths imported with touch-os \${manifest.version} from \${resolvedEntry}\`);
  `);
  run('node', ['check.mjs'], consumerDir);

  writeFileSync(path.join(consumerDir, 'check.ts'), `
import type { DisplayNode } from '@found-in-space/touch-os';
import {
  createTouchOsPanelPlugin,
  type TouchOsActionOutputMode,
} from '@found-in-space/skykit/touch-os';
import { createHrDiagramEmbeddedSurfaceNode } from '@found-in-space/hr-diagram/touch-os';
import { normalizeSpatialPose, buildSpatialPolylineRoute } from '@found-in-space/spatial';

const space = { frameId: 'packed:physical', metersPerUnit: 1 };
const pose = normalizeSpatialPose({ space });
buildSpatialPolylineRoute({ space, points: [pose.position],
  travel: { kind: 'polyline', timing: { kind: 'duration', durationSecs: 1 } },
});
// @ts-expect-error Spatial poses use their declared coordinate context.
normalizeSpatialPose({ observerPc: { x: 0, y: 0, z: 0 } });

declare const root: DisplayNode;
const actionOutputMode: TouchOsActionOutputMode = 'app-actions';
const panel = createTouchOsPanelPlugin({ root, actionOutputMode });
const hrNode = createHrDiagramEmbeddedSurfaceNode({
  componentId: 'packed-consumer:hr',
  sourceId: 'packed-consumer:hr-source',
  title: 'Packed HR diagram',
  preserveAspectRatio: true,
});
void [panel, hrNode];
`);
  run(process.execPath, [
    path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    'check.ts',
  ], consumerDir);

  const packageRoot = path.join(
    consumerDir,
    'node_modules',
    '@found-in-space',
    'touch-os',
  );
  if (lstatSync(packageRoot).isSymbolicLink()) {
    throw new Error(`touch-os was installed as a symlink: ${packageRoot}`);
  }
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.version !== '0.4.0-alpha.0') {
    throw new Error(`packed consumer installed touch-os ${String(manifest.version)}`);
  }
  if (!realpathSync(packageRoot).startsWith(realpathSync(consumerDir) + path.sep)) {
    throw new Error(`touch-os resolved outside the packed consumer: ${packageRoot}`);
  }
  const lock = JSON.parse(readFileSync(path.join(consumerDir, 'package-lock.json'), 'utf8'));
  const lockEntry = lock.packages?.['node_modules/@found-in-space/touch-os'];
  const preparedTarball = path.join(rootDir, '.packages/touch-os.tgz');
  const resolvedTarball = lockEntry?.resolved?.startsWith('file:') ? path.resolve(consumerDir, lockEntry.resolved.slice(5)) : '';
  if (lockEntry?.version !== '0.4.0-alpha.0' || resolvedTarball !== preparedTarball) {
    throw new Error(
      `packed consumer did not resolve the prepared touch-os package 0.4.0-alpha.0: ${JSON.stringify(lockEntry)}`,
    );
  }
}

function createConsumer(name) {
  const consumerDir = path.join(tempRoot, name);
  mkdirSync(consumerDir);
  writeFileSync(path.join(consumerDir, 'package.json'), JSON.stringify({
    name: `skykit-${name}-consumer`,
    private: true,
    type: 'module',
  }, null, 2));
  return consumerDir;
}

function install(consumerDir, specs) {
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--fund=false',
    ...specs,
  ], consumerDir);
}

function run(command, args, cwd, options = {}) {
  const log = path.join(tempRoot, 'command-output.txt');
  const fd = options.capture ? openSync(log, 'w') : undefined;
  let result;
  try { result = spawnSync(command, args, {
    cwd, encoding: 'utf8', env: withoutLocalTouchOsOverride(process.env),
    stdio: options.capture ? ['ignore', fd, 'inherit'] : 'inherit',
  }); } finally { if (fd !== undefined) closeSync(fd); }
  if (options.capture) result.stdout = readFileSync(log, 'utf8');
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`);
  }
  return result;
}

function withoutLocalTouchOsOverride(env) {
  const next = { ...env };
  delete next.TOUCH_OS_LOCAL_PATH;
  return next;
}
