import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXPECTED_VERSION = '0.3.0';
const EXPECTED_PEER_RANGE = '>=0.3.0 <0.4.0';
const PACKAGE_NAME = '@found-in-space/touch-os';
const EXPECTED_TARBALL = 'https://registry.npmjs.org/@found-in-space/touch-os/-/touch-os-0.3.0.tgz';
const rootDir = process.cwd();

if (String(process.env.TOUCH_OS_LOCAL_PATH ?? '').trim()) {
  fail('TOUCH_OS_LOCAL_PATH must be unset for installed-package verification.');
}

const skykitManifest = readJson('packages/skykit/package.json');
const hrDiagramManifest = readJson('packages/hr-diagram/package.json');
const examplesManifest = readJson('apps/examples/package.json');
const lock = readJson('package-lock.json');

assertEqual(
  'packages/skykit devDependency',
  skykitManifest.devDependencies?.[PACKAGE_NAME],
  EXPECTED_VERSION,
);
assertEqual(
  'packages/hr-diagram devDependency',
  hrDiagramManifest.devDependencies?.[PACKAGE_NAME],
  EXPECTED_VERSION,
);
assertEqual(
  'apps/examples dependency',
  examplesManifest.dependencies?.[PACKAGE_NAME],
  EXPECTED_VERSION,
);
assertEqual(
  'packages/skykit peerDependency',
  skykitManifest.peerDependencies?.[PACKAGE_NAME],
  EXPECTED_PEER_RANGE,
);
assertEqual(
  'packages/hr-diagram peerDependency',
  hrDiagramManifest.peerDependencies?.[PACKAGE_NAME],
  EXPECTED_PEER_RANGE,
);

const lockEntry = lock.packages?.[`node_modules/${PACKAGE_NAME}`];
assertEqual('package-lock installed version', lockEntry?.version, EXPECTED_VERSION);
assertEqual('package-lock registry tarball', lockEntry?.resolved, EXPECTED_TARBALL);

for (const configPath of ['vite.config.js', 'apps/examples/vite.config.js']) {
  const config = (await import(pathToFileURL(path.join(rootDir, configPath)).href)).default;
  const aliases = config?.resolve?.alias ?? [];
  const localAliases = Array.isArray(aliases)
    ? aliases.filter((alias) => String(alias?.find ?? '').startsWith(PACKAGE_NAME))
    : Object.keys(aliases).filter((find) => find.startsWith(PACKAGE_NAME));
  if (localAliases.length > 0) {
    fail(`${configPath} enables a touch-os alias during installed-package verification.`);
  }
}

let entryPath;
try {
  entryPath = fileURLToPath(import.meta.resolve(PACKAGE_NAME));
} catch (error) {
  fail(`cannot resolve ${PACKAGE_NAME}: ${error instanceof Error ? error.message : String(error)}`);
}

const packageRoot = findPackageRoot(entryPath);
const packageManifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
assertEqual('resolved package name', packageManifest.name, PACKAGE_NAME);
assertEqual('resolved installed version', packageManifest.version, EXPECTED_VERSION);
if (lstatSync(packageRoot).isSymbolicLink()) {
  fail(`${PACKAGE_NAME} resolves through a symlink instead of the installed registry package.`);
}

const expectedRoot = realpathSync(
  path.join(rootDir, 'node_modules', '@found-in-space', 'touch-os'),
);
if (realpathSync(packageRoot) !== expectedRoot) {
  fail(`${PACKAGE_NAME} resolved outside the root npm install: ${packageRoot}`);
}

console.log(`${PACKAGE_NAME} version: ${packageManifest.version}`);
console.log(`${PACKAGE_NAME} entry: ${entryPath}`);
console.log(`${PACKAGE_NAME} lockfile source: ${lockEntry.resolved}`);
console.log('Vite resolution: installed package (no local touch-os aliases)');

function findPackageRoot(entry) {
  let current = path.dirname(entry);
  while (true) {
    const manifestPath = path.join(current, 'package.json');
    if (existsSync(manifestPath)) return current;
    const parent = path.dirname(current);
    if (parent === current) fail(`could not find package.json above ${entry}`);
    current = parent;
  }
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.join(rootDir, filePath), 'utf8'));
}

function fail(message) {
  console.error(`touch-os resolution check failed: ${message}`);
  process.exit(1);
}
