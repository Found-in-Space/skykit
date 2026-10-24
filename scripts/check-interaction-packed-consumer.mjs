import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const touchTarball = process.argv[2];
const geantRoot = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
if (!touchTarball) throw new Error('Usage: node scripts/check-interaction-packed-consumer.mjs touch-os.tgz [../pas-de-geant]');
const temporary = mkdtempSync(path.join(tmpdir(), 'fis-interaction-consumer-'));
const packDir = path.join(temporary, 'packs'), consumer = path.join(temporary, 'consumer');
mkdirSync(packDir); mkdirSync(consumer);
function run(command, args, cwd, captureErrors = false) {
  const output = path.join(temporary, 'command-output.txt'), fd = openSync(output, 'w');
  try { execFileSync(command, args, { cwd, stdio: ['ignore', fd, captureErrors ? fd : 'inherit'],
    timeout: 120_000, env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? path.join(temporary, 'cache') } }); }
  catch (error) { if (!captureErrors) process.stderr.write(readFileSync(output, 'utf8')); throw error; }
  finally { closeSync(fd); }
  return readFileSync(output, 'utf8');
}
function pack(directory) {
  const result = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], directory));
  const [entry] = Array.isArray(result) ? result : Object.values(result);
  return path.join(packDir, entry.filename);
}
function fixture(source, target, replacements) {
  let code = readFileSync(source, 'utf8');
  for (const [from, to] of replacements) code = code.replaceAll(from, to);
  writeFileSync(path.join(consumer, target), code);
  process.stdout.write(run(process.execPath, [target], consumer));
}
try {
  const tarballs = [path.resolve(touchTarball)];
  for (const dir of readdirSync(path.join(root, 'packages'))) tarballs.push(pack(path.join(root, 'packages', dir)));
  tarballs.push(pack(path.join(root, 'node_modules', 'three')));
  tarballs.push(pack(path.join(root, 'node_modules', '@pmndrs', 'pointer-events')));
  if (geantRoot) {
    process.stdout.write(run('npm', ['run', 'build'], geantRoot));
    tarballs.push(pack(path.join(geantRoot, 'packages', 'pas-de-geant')));
    tarballs.push(pack(path.join(geantRoot, 'node_modules', 'astronomy-engine')));
  }
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'fis-packed-interaction-acceptance', private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--fund=false', '--offline', ...tarballs, '@types/three@0.180.0'], consumer);
  // npm must solve the published manifests without overrides, source aliases or legacy peer resolution.
  run('npm', ['ls', '--all'], consumer);
  fixture(path.join(root, 'packages/three-star-field/src/__tests__/interaction.test.js'), 'star-interaction.test.mjs', [
    ["from '../index.js'", "from '@found-in-space/three-star-field'"], ["from '../interaction.js'", "from '@found-in-space/three-star-field/interaction'"]
  ]);
  fixture(path.join(root, 'packages/skykit/src/__tests__/interaction.test.js'), 'skykit-interaction.test.mjs', [
    ["from '../interaction.js'", "from '@found-in-space/skykit/interaction'"]
  ]);
  if (geantRoot) fixture(path.join(geantRoot, 'scripts/fixtures/interaction-consumer.mjs'), 'geant-interaction.mjs', []);
  const types = `import { createSkykitInteractionInput } from '@found-in-space/skykit/interaction';
import { createThreeUIEnvironment } from '@found-in-space/touch-os/hosts/three';
import type * as THREE from 'three';
export function compose(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const input = createSkykitInteractionInput({ renderer, origin: scene });
  const ui = createThreeUIEnvironment({ parent: scene, inputs: [input], ownsInputs: true });
  ui.update({ timestamp: 1 }); ui.dispose();
}
`;
  writeFileSync(path.join(consumer, 'consumer.ts'), types);
  // Runtime packages, declarations and external Three.js types all come from npm installation.
  run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.ts'], consumer);
  const installed = JSON.parse(readFileSync(path.join(consumer, 'node_modules/@found-in-space/touch-os/package.json'), 'utf8'));
  assert.equal(installed.version, '0.4.0-alpha.0');
  // An incompatible peer must fail installation or npm's installed-graph validation.
  // Some npm versions warn on optional peers during install but reject them in npm ls.
  const incompatible = path.join(temporary, 'incompatible'); mkdirSync(incompatible);
  writeFileSync(path.join(incompatible, 'package.json'), JSON.stringify({ name: '@found-in-space/touch-os', version: '0.3.0', type: 'module' }));
  const oldTouch = pack(incompatible), rejected = path.join(temporary, 'rejected'); mkdirSync(rejected);
  writeFileSync(path.join(rejected, 'package.json'), JSON.stringify({ name: 'incompatible-consumer', private: true }));
  assert.throws(() => { run('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--fund=false', '--strict-peer-deps', oldTouch,
    ...tarballs.filter(file => /found-in-space-(three-star-field|star-trees|spatial)-|^three-/.test(path.basename(file)))], rejected, true); run('npm', ['ls', '--all'], rejected, true); }, 'TouchOS 0.3 must not produce a valid dependency graph');
  assert.match(readFileSync(path.join(temporary, 'command-output.txt'), 'utf8'), /ERESOLVE|ELSPROBLEMS/, 'The old peer must be rejected for a dependency conflict');
  console.log('Packed interaction behavior, shared dependency graph, external TypeScript and incompatible-peer rejection passed.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
