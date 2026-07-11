import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const examplesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(examplesRoot, '../../..');
const pageNames = [
  'coordinates-aim',
  'routes-orbits',
  'paths-transitions',
  'motion-automation',
];

test('spatial labs are direct-package examples with complete local entry points', () => {
  const hub = read(path.join(examplesRoot, 'index.html'));

  for (const pageName of pageNames) {
    const directory = path.join(examplesRoot, pageName);
    const html = read(path.join(directory, 'index.html'));
    const scriptPath = path.join(directory, `${pageName}.js`);
    const script = read(scriptPath);

    assert.match(hub, new RegExp(`packages/spatial/examples/${pageName}/index\\.html`));
    assert.match(html, /href="\.\.\/shared\.css"/);
    assert.match(html, new RegExp(`src="\\./${pageName}\\.js"`));
    assert.match(script, /from ['"]@found-in-space\/spatial['"]/);
    assert.doesNotMatch(script, /@found-in-space\/skykit|from ['"]three['"]|https?:\/\//);
  }
});

test('root Pages build and artifact checks include every spatial lab', () => {
  const viteConfig = read(path.join(workspaceRoot, 'vite.config.js'));
  const workflow = read(path.join(workspaceRoot, '.github/workflows/deploy-github-pages.yml'));
  const rootIndex = read(path.join(workspaceRoot, 'index.html'));

  assert.match(viteConfig, /packages\/spatial\/examples\/index\.html/);
  assert.match(workflow, /dist\/packages\/spatial\/examples\/index\.html/);
  assert.match(rootIndex, /packages\/spatial\/examples\/index\.html/);

  for (const pageName of pageNames) {
    const publicPath = `packages/spatial/examples/${pageName}/index.html`;
    assert.match(viteConfig, new RegExp(escapePattern(publicPath)));
    assert.match(workflow, new RegExp(escapePattern(`dist/${publicPath}`)));
  }
});

function read(file) {
  assert.equal(fs.existsSync(file), true, `expected example file ${path.relative(workspaceRoot, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
