import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRedirectPage,
  joinPublicUrl,
  normalizePublicBase,
  rewriteMarkdownLinks,
  sourceToDocsRoute,
} from '../pages-artifact.js';

test('normalizePublicBase returns deployment-safe bases', () => {
  assert.equal(normalizePublicBase('skykit'), '/skykit/');
  assert.equal(normalizePublicBase('/skykit/'), '/skykit/');
  assert.equal(normalizePublicBase('https://foundin.space/skykit'), 'https://foundin.space/skykit/');
  assert.equal(normalizePublicBase('./'), './');
});

test('joinPublicUrl appends routes to normalized bases', () => {
  assert.equal(joinPublicUrl('/skykit/', 'examples/free-roam/'), '/skykit/examples/free-roam/');
  assert.equal(
    joinPublicUrl('https://foundin.space/skykit/', 'docs/xr-architecture/'),
    'https://foundin.space/skykit/docs/xr-architecture/',
  );
});

test('sourceToDocsRoute maps repository markdown sources to public docs routes', () => {
  assert.equal(sourceToDocsRoute('docs/xr-architecture.md'), 'docs/xr-architecture/');
  assert.equal(sourceToDocsRoute('packages/skykit/README.md'), 'docs/packages/skykit/');
  assert.equal(sourceToDocsRoute('README.md'), null);
});

test('rewriteMarkdownLinks rewrites local markdown links and leaves external links alone', () => {
  const html = [
    '<a href="./alpha-rules.md">Alpha</a>',
    '<a href="../packages/skykit/README.md#viewer">SkyKit</a>',
    '<a href="#purpose">Purpose</a>',
    '<a href="https://example.test/readme.md">External</a>',
  ].join('');

  assert.equal(
    rewriteMarkdownLinks(html, 'docs/skykit-core-composition.md', '/skykit/'),
    [
      '<a href="/skykit/docs/alpha-rules/">Alpha</a>',
      '<a href="/skykit/docs/packages/skykit/#viewer">SkyKit</a>',
      '<a href="#purpose">Purpose</a>',
      '<a href="https://example.test/readme.md">External</a>',
    ].join(''),
  );
});

test('createRedirectPage creates canonical meta refresh markup', () => {
  const html = createRedirectPage('/skykit/examples/free-roam/', 'Free Roam moved');

  assert.match(html, /<title>Free Roam moved<\/title>/u);
  assert.match(html, /http-equiv="refresh" content="0; url=\/skykit\/examples\/free-roam\/"/u);
  assert.match(html, /<link rel="canonical" href="\/skykit\/examples\/free-roam\/" \/>/u);
});
