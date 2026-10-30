import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Usage: node scripts/stage-interaction-development.mjs /path/to/touch-os [/path/to/pas-de-geant]');
const touchRoot = path.resolve(process.argv[2]);
const geantRoot = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const temporary = mkdtempSync(path.join(tmpdir(), 'fis-interaction-staging-'));
const env = { ...process.env, npm_config_cache: process.env.npm_config_cache ?? path.join(root, '.cache', 'npm') };
function run(command, args, cwd) { execFileSync(command, args, { cwd, env, stdio: 'inherit' }); }
function pack(directory) {
  const output = path.join(temporary, 'pack.json'), fd = openSync(output, 'w');
  try { execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: directory, env, stdio: ['ignore', fd, 'inherit'] }); }
  finally { closeSync(fd); }
  const result = JSON.parse(readFileSync(output, 'utf8'));
  const [entry] = Array.isArray(result) ? result : Object.values(result);
  return path.join(temporary, entry.filename);
}
function save(repository, name, tarball) {
  const directory = path.join(repository, '.packages'); mkdirSync(directory, { recursive: true });
  copyFileSync(tarball, path.join(directory, `${name}.tgz`));
}
function install(repository, names) {
  // Explicit file arguments refresh integrity even when a development tarball keeps its version.
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--fund=false', '--save-dev',
    ...names.map(name => `@found-in-space/${name}@file:.packages/${name}.tgz`)], repository);
}
try {
  if (!existsSync(path.join(touchRoot, 'node_modules', 'typescript'))) run('npm', ['ci', '--ignore-scripts', '--no-audit', '--fund=false'], touchRoot);
  run('npm', ['run', 'build'], touchRoot);
  const touch = pack(touchRoot); save(root, 'touch-os', touch);
  install(root, ['touch-os']);
  if (geantRoot) {
    save(geantRoot, 'touch-os', touch);
    for (const name of ['guided-journey', 'skykit', 'three-star-field', 'hr-diagram']) save(geantRoot, name, pack(path.join(root, 'packages', name)));
    const voiceRoot = path.join(path.dirname(root), 'voice-os');
    if (!existsSync(path.join(voiceRoot, 'node_modules', 'typescript'))) run('npm', ['ci', '--ignore-scripts', '--no-audit', '--fund=false'], voiceRoot);
    run('npm', ['run', 'build'], voiceRoot);
    save(geantRoot, 'voice-os', pack(voiceRoot));
    install(geantRoot, ['guided-journey', 'touch-os', 'skykit', 'three-star-field', 'hr-diagram', 'voice-os']);
  }
  console.log('Installed packed prereleases through npm; manifests and lockfiles describe the actual dependency graph.');
  console.log('Keep .packages for npm ci. Re-run preparation after producer changes. Public package dependencies use exact release versions.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
