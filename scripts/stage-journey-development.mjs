import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Usage: node scripts/stage-journey-development.mjs /path/to/pas-de-geant [--pack-only]');
const consumer = path.resolve(process.argv[2]);
const temporary = mkdtempSync(path.join(tmpdir(), 'fis-journey-staging-'));
const env = { ...process.env, npm_config_cache: path.join(root, '.cache', 'npm') };
try {
  const output = path.join(temporary, 'pack.json');
  const descriptor = openSync(output, 'w');
  try {
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
      cwd: path.join(root, 'packages/guided-journey'), env, stdio: ['ignore', descriptor, 'inherit'],
    });
  } finally { closeSync(descriptor); }
  const metadata = JSON.parse(readFileSync(output, 'utf8'));
  const archive = (Array.isArray(metadata) ? metadata : Object.values(metadata))[0];
  mkdirSync(path.join(consumer, '.packages'), { recursive: true });
  copyFileSync(path.join(temporary, archive.filename), path.join(consumer, '.packages/guided-journey.tgz'));
  if (process.argv.includes('--pack-only')) {
    console.log('Packed the shared journey package; dependency installation is left to the caller.');
  } else {
    execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--fund=false', '--save-dev',
    '@found-in-space/guided-journey@file:.packages/guided-journey.tgz'], { cwd: consumer, env, stdio: 'inherit' });
    const require = createRequire(path.join(consumer, 'package.json'));
    const source = path.join(root, 'packages/guided-journey');
    const installedRoot = path.dirname(path.dirname(require.resolve('@found-in-space/guided-journey')));
    const identity = createHash('sha256');
    for (const file of readdirSync(source, { recursive: true }).filter(file => /\.(?:js|ts)$/.test(file) && !file.includes('__tests__')).sort()) {
      const local = readFileSync(path.join(source, file));
      if (!local.equals(readFileSync(path.join(installedRoot, file)))) throw new Error(`Installed journey file differs: ${file}`);
      identity.update(file).update('\0').update(local).update('\0');
    }
    console.log(`Shared journey runtime/types/fixtures SHA-256: ${identity.digest('hex')}`);
    console.log('Installed one packed controller source through npm. This is development staging, not a public package release.');
  }
} finally { rmSync(temporary, { recursive: true, force: true }); }
