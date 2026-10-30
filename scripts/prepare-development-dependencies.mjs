import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const revision = 'a18e75b71727bdd71cfe95b1d456b0ca625ad606';
const target = path.join(root, '.packages', 'touch-os.tgz');
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const expected = lock.packages['node_modules/@found-in-space/touch-os'].integrity;
const integrity = file => `sha512-${createHash('sha512').update(readFileSync(file)).digest('base64')}`;
const temporary = mkdtempSync(path.join(tmpdir(), 'skykit-development-dependencies-'));
const source = path.join(temporary, 'touch-os');
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, stdio: 'inherit', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});

try {
  mkdirSync(source);
  run('git', ['init', '--quiet'], source);
  run('git', ['remote', 'add', 'origin', 'https://github.com/Found-in-Space/touch-os.git'], source);
  run('git', ['fetch', '--quiet', '--depth=1', '--no-tags', 'origin', revision], source);
  run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], source);
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--fund=false'], source);
  run('npm', ['run', 'build'], source);
  const [packed] = JSON.parse(execFileSync('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', temporary,
  ], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const archive = path.join(temporary, packed.filename);
  if (integrity(archive) !== expected) {
    throw new Error('The pinned TouchOS build does not match package-lock.json; review source and archive identity before updating the lock.');
  }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(archive, target);
  console.log(`Prepared TouchOS ${revision} with the recorded archive integrity.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
