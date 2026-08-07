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
const threeLines = [
  { runtime: '0.170.0', types: '0.170.0' },
  { runtime: '0.185.1', types: '0.185.4' },
];
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

  for (const threeLine of threeLines) {
    verifyOrdinaryRoots(workspaceTarballs, threeLine);
    verifyOptionalSubpaths(workspaceTarballs, threeLine);
  }

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

function verifyOrdinaryRoots(workspaceTarballs, threeLine) {
  const { runtime: threeVersion, types: threeTypesVersion } = threeLine;
  const consumerDir = createConsumer(`ordinary-roots-three-${threeVersion}`);
  install(consumerDir, [
    '--omit=optional',
    ...workspaceTarballs,
    `three@${threeVersion}`,
    `@types/three@${threeTypesVersion}`,
  ]);

  writeFileSync(path.join(consumerDir, 'check.mjs'), `
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as THREE from 'three';

const touchOsRoot = path.join(process.cwd(), 'node_modules', '@found-in-space', 'touch-os');
if (existsSync(touchOsRoot)) {
  throw new Error('ordinary-root consumer unexpectedly installed touch-os');
}

const { createObject3dLayer } = await import('@found-in-space/skykit');
const { createThreeStarField } = await import('@found-in-space/three-star-field');
const { createHrDiagramRenderer } = await import('@found-in-space/hr-diagram');
const { createAnchoredImageMeshObject } = await import('@found-in-space/anchored-image/three');

const material = new THREE.PointsMaterial();
const field = createThreeStarField({ materialProfile: material });
assert.ok(field.object3d instanceof THREE.Group);
assert.ok(field.object3d.children[0] instanceof THREE.Points);
assert.equal(field.object3d.children[0].material, material);
assert.ok(field.object3d.children[0].material instanceof THREE.Material);

const profileMaterial = new THREE.PointsMaterial();
const haloMaterial = new THREE.PointsMaterial();
const profileField = createThreeStarField({
  materialProfile: {
    material: profileMaterial,
    haloMaterial,
    updateUniforms() {},
  },
});
assert.equal(profileField.object3d.children[0].material, profileMaterial);
assert.equal(profileField.object3d.children[1].material, haloMaterial);

const hrScene = new THREE.Scene();
const hrCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
const hr = createHrDiagramRenderer({ scene: hrScene, camera: hrCamera });
assert.equal(hr.scene, hrScene);
assert.equal(hr.camera, hrCamera);
assert.ok(hr.material instanceof THREE.ShaderMaterial);

const texture = new THREE.Texture();
const imageObject = createAnchoredImageMeshObject({
  image: { id: 'packed-image', groupId: 'packed-group', attribution: null, metadata: {} },
  vertices: [
    { target: { kind: 'direction', x: 1, y: 0, z: 0 }, uv: { u: 0, v: 0 } },
    { target: { kind: 'direction', x: 0, y: 1, z: 0 }, uv: { u: 1, v: 0 } },
    { target: { kind: 'direction', x: 0, y: 0, z: 1 }, uv: { u: 0, v: 1 } },
  ],
  triangles: [[0, 1, 2]],
}, { texture });
assert.ok(imageObject instanceof THREE.Mesh);
assert.equal(imageObject.material.uniforms.map.value, texture);

const nativeObject = new THREE.Object3D();
const originContentRoot = new THREE.Group();
const layer = createObject3dLayer({ object3d: nativeObject });
layer.attach({
  roots: {
    originContentRoot,
    observerContentRoot: new THREE.Group(),
    navigationRoot: new THREE.Group(),
    scaleBandedContentRoots: new Map(),
  },
});
assert.equal(originContentRoot.children[0], nativeObject);

const rootRequire = createRequire(import.meta.url);
const rootThreeEntry = realpathSync(rootRequire.resolve('three'));
for (const packageName of [
  '@found-in-space/skykit',
  '@found-in-space/three-star-field',
  '@found-in-space/hr-diagram',
  '@found-in-space/anchored-image/three',
]) {
  const packageEntry = rootRequire.resolve(packageName);
  const packageRequire = createRequire(packageEntry);
  assert.equal(
    realpathSync(packageRequire.resolve('three')),
    rootThreeEntry,
    \`\${packageName} resolved a second Three.js runtime\`,
  );
}

field.dispose();
profileField.dispose();
hr.dispose();
imageObject.geometry.dispose();
imageObject.material.dispose();
texture.dispose();
console.log('ordinary packed roots exchanged native Three.js objects with three ${threeVersion}');
  `);
  run('node', ['check.mjs'], consumerDir);

  writeFileSync(path.join(consumerDir, 'check.ts'), `
import * as THREE from 'three';
import { createObject3dLayer } from '@found-in-space/skykit';
import { createThreeStarField } from '@found-in-space/three-star-field';
import { createHrDiagramRenderer } from '@found-in-space/hr-diagram';
import { createAnchoredImageMeshObject } from '@found-in-space/anchored-image/three';

const object3d = new THREE.Object3D();
const layer = createObject3dLayer({ object3d });
const field = createThreeStarField({ materialProfile: new THREE.PointsMaterial() });
const hr = createHrDiagramRenderer({
  scene: new THREE.Scene(),
  camera: new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1),
});
void [layer, field, hr, createAnchoredImageMeshObject];
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
  assertSingleThreeVersion(consumerDir, threeVersion);
}

function verifyOptionalSubpaths(workspaceTarballs, threeLine) {
  const { runtime: threeVersion, types: threeTypesVersion } = threeLine;
  const consumerDir = createConsumer(`optional-subpaths-three-${threeVersion}`);
  install(consumerDir, [
    ...workspaceTarballs,
    '@found-in-space/touch-os@0.3.0',
    `three@${threeVersion}`,
    `@types/three@${threeTypesVersion}`,
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
  assertSingleThreeVersion(consumerDir, threeVersion);

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

function assertSingleThreeVersion(consumerDir, expectedVersion) {
  const result = run('npm', ['ls', 'three', '--all', '--json'], consumerDir, { capture: true });
  const tree = JSON.parse(result.stdout);
  const versions = new Set();
  visitDependencies(tree.dependencies);

  if (versions.size !== 1 || !versions.has(expectedVersion)) {
    throw new Error(
      `expected only three@${expectedVersion}, received ${JSON.stringify([...versions])}`,
    );
  }

  function visitDependencies(dependencies) {
    for (const [name, dependency] of Object.entries(dependencies ?? {})) {
      if (name === 'three' && typeof dependency?.version === 'string') {
        versions.add(dependency.version);
      }
      visitDependencies(dependency?.dependencies);
    }
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
