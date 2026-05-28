import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const lock = readJson('package-lock.json');
const rootManifest = readJson('package.json');
const lockPackages = lock.packages ?? {};
const errors = [];

comparePackageEntry('', rootManifest, lockPackages['']);

for (const dirent of readdirSync(path.join(rootDir, 'packages'), { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const manifestPath = path.join('packages', dirent.name, 'package.json');
  if (!exists(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  comparePackageEntry(path.join('packages', dirent.name), manifest, lockPackages[path.join('packages', dirent.name)]);
}

if (errors.length > 0) {
  console.error('package-lock.json is out of sync with workspace package manifests:');
  for (const error of errors) console.error(`- ${error}`);
  console.error('\nRun: npm run release:lockfile');
  process.exit(1);
}

function comparePackageEntry(lockKey, manifest, lockEntry) {
  const label = lockKey || '.';
  if (!lockEntry) {
    errors.push(`${label}: missing package-lock entry`);
    return;
  }

  compareValue(label, 'name', manifest.name, lockEntry.name);
  compareValue(label, 'version', manifest.version, lockEntry.version);
  compareObject(label, 'workspaces', manifest.workspaces, lockEntry.workspaces);
  compareObject(label, 'dependencies', manifest.dependencies, lockEntry.dependencies);
  compareObject(label, 'devDependencies', manifest.devDependencies, lockEntry.devDependencies);
  compareObject(label, 'optionalDependencies', manifest.optionalDependencies, lockEntry.optionalDependencies);
  compareObject(label, 'peerDependencies', manifest.peerDependencies, lockEntry.peerDependencies);
  compareObject(label, 'peerDependenciesMeta', manifest.peerDependenciesMeta, lockEntry.peerDependenciesMeta);
}

function compareValue(label, field, expected, actual) {
  if (expected !== actual) {
    errors.push(`${label}: ${field} is ${format(actual)}, expected ${format(expected)}`);
  }
}

function compareObject(label, field, expected, actual) {
  if (stableStringify(emptyToUndefined(expected)) !== stableStringify(emptyToUndefined(actual))) {
    errors.push(`${label}: ${field} does not match package.json`);
  }
}

function emptyToUndefined(value) {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  if (typeof value === 'object') return Object.keys(value).length > 0 ? value : undefined;
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, next]) => [key, sortJson(next)]),
  );
}

function format(value) {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

function exists(filePath) {
  try {
    return statSync(path.join(rootDir, filePath)).isFile();
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.join(rootDir, filePath), 'utf8'));
}
