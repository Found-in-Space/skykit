import {
  lstatSync,
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
  const filename = report[0]?.filename;
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
await import('@found-in-space/hr-diagram');
console.log('ordinary SkyKit and HR roots imported without touch-os');
  `);
  run('node', ['check.mjs'], consumerDir);
}

function verifyOptionalSubpaths(workspaceTarballs) {
  const consumerDir = createConsumer('optional-subpaths');
  install(consumerDir, [
    ...workspaceTarballs,
    '@found-in-space/touch-os@0.3.0',
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
if (manifest.version !== '0.3.0') {
  throw new Error(\`expected touch-os 0.3.0, received \${String(manifest.version)}\`);
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
  if (manifest.version !== '0.3.0') {
    throw new Error(`packed consumer installed touch-os ${String(manifest.version)}`);
  }
  if (!realpathSync(packageRoot).startsWith(realpathSync(consumerDir) + path.sep)) {
    throw new Error(`touch-os resolved outside the packed consumer: ${packageRoot}`);
  }
  const lock = JSON.parse(readFileSync(path.join(consumerDir, 'package-lock.json'), 'utf8'));
  const lockEntry = lock.packages?.['node_modules/@found-in-space/touch-os'];
  const expectedRegistryTarball = 'https://registry.npmjs.org/@found-in-space/touch-os/-/touch-os-0.3.0.tgz';
  if (lockEntry?.version !== '0.3.0' || lockEntry?.resolved !== expectedRegistryTarball) {
    throw new Error(
      `packed consumer did not resolve registry touch-os 0.3.0: ${JSON.stringify(lockEntry)}`,
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
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: withoutLocalTouchOsOverride(process.env),
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
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
