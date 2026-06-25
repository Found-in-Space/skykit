import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

const DEFAULT_RELOCATIONS = [
  {
    label: 'Free Roam',
    from: 'apps/examples/free-roam/index.html',
    to: 'examples/free-roam/index.html',
    route: 'examples/free-roam/',
    description: 'Streamed stars and constellation art',
    group: 'examples',
  },
  {
    label: 'VR Viewer',
    from: 'apps/examples/vr-viewer/index.html',
    to: 'examples/vr-viewer/index.html',
    route: 'examples/vr-viewer/',
    description: 'Turnkey package preset with app-owned layers',
    group: 'examples',
  },
  {
    label: 'XR Free Roam',
    from: 'apps/examples/xr-free-roam/index.html',
    to: 'examples/xr-free-roam/index.html',
    route: 'examples/xr-free-roam/',
    description: 'WebXR navigation and panels',
    group: 'examples',
  },
  {
    label: 'Legacy Dust Roam',
    from: 'demos/dust-roam.html',
    to: 'legacy/dust-roam/index.html',
    route: 'legacy/dust-roam/',
    description: 'Porting reference for the old dust runtime',
    group: 'legacy',
  },
  {
    label: 'Legacy H-alpha Volume',
    from: 'demos/h-alpha-volume.html',
    to: 'legacy/h-alpha-volume/index.html',
    route: 'legacy/h-alpha-volume/',
    description: 'Porting reference for the old H-alpha runtime',
    group: 'legacy',
  },
];

export function normalizePublicBase(input) {
  const value = String(input ?? '').trim();
  if (!value || value === './' || value === '/') {
    return value || './';
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value.endsWith('/') ? value : `${value}/`;
  }
  const pathBase = value.replace(/^\/+|\/+$/g, '');
  return pathBase ? `/${pathBase}/` : '/';
}

export function joinPublicUrl(publicBase, route) {
  const base = normalizePublicBase(publicBase);
  const cleanRoute = String(route ?? '').replace(/^\/+/, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) {
    return new URL(cleanRoute, base).href;
  }
  return `${base}${cleanRoute}`;
}

export function sourceToDocsRoute(sourceRelative) {
  const normalized = normalizeSlashes(sourceRelative).replace(/^\.\//, '');
  const docsMatch = /^docs\/([^/]+)\.md$/u.exec(normalized);
  if (docsMatch) {
    return `docs/${docsMatch[1]}/`;
  }
  const packageMatch = /^packages\/([^/]+)\/README\.md$/u.exec(normalized);
  if (packageMatch) {
    return `docs/packages/${packageMatch[1]}/`;
  }
  return null;
}

export function rewriteMarkdownLinks(html, sourceRelative, publicBase) {
  return html.replace(/\bhref=(["'])([^"']+)\1/gu, (match, quote, href) => {
    const rewritten = rewriteMarkdownHref(href, sourceRelative, publicBase);
    if (rewritten === href) {
      return match;
    }
    return `href=${quote}${escapeAttribute(rewritten)}${quote}`;
  });
}

export function createRedirectPage(targetUrl, title = 'Redirecting') {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="refresh" content="0; url=${escapeAttribute(targetUrl)}" />
    <link rel="canonical" href="${escapeAttribute(targetUrl)}" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <p>Redirecting to <a href="${escapeAttribute(targetUrl)}">${escapeHtml(targetUrl)}</a>.</p>
  </body>
</html>
`;
}

export function buildPagesArtifact(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const rootDir = path.resolve(projectRoot, options.rootDir ?? 'dist');
  const publicBase = normalizePublicBase(options.publicBase ?? process.env.SKYKIT_PUBLIC_BASE ?? './');
  const relocations = options.relocations ?? DEFAULT_RELOCATIONS;

  for (const relocation of relocations) {
    copyRelocatedPage(rootDir, publicBase, relocation);
  }

  writeListingPage({
    rootDir,
    publicBase,
    route: 'examples/',
    title: 'SkyKit Examples',
    intro: 'Alpha examples that compose the current SkyKit package set.',
    links: relocations.filter((entry) => entry.group === 'examples'),
  });

  writeListingPage({
    rootDir,
    publicBase,
    route: 'legacy/',
    title: 'SkyKit Legacy References',
    intro: 'Older runtime sandboxes kept available as porting references.',
    links: relocations.filter((entry) => entry.group === 'legacy'),
  });

  writeDocs(projectRoot, rootDir, publicBase);
}

function copyRelocatedPage(rootDir, publicBase, relocation) {
  const sourcePath = path.join(rootDir, relocation.from);
  const destinationPath = path.join(rootDir, relocation.to);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing built page for relocation: ${relocation.from}`);
  }

  ensureDirectory(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
  fs.writeFileSync(
    sourcePath,
    createRedirectPage(joinPublicUrl(publicBase, relocation.route), `${relocation.label} moved`),
  );
}

function writeDocs(projectRoot, rootDir, publicBase) {
  const entries = collectDocEntries(projectRoot);
  for (const entry of entries) {
    const markdown = fs.readFileSync(path.join(projectRoot, entry.source), 'utf8');
    const body = rewriteMarkdownLinks(marked.parse(markdown), entry.source, publicBase);
    writeHtml(
      rootDir,
      `${entry.route}index.html`,
      createPageShell({
        publicBase,
        title: entry.title,
        intro: entry.groupLabel,
        body: `<article class="markdown-body">${body}</article>`,
        active: 'docs',
        navEntries: entries,
      }),
    );
  }

  const technicalLinks = entries.filter((entry) => entry.group === 'technical');
  const packageLinks = entries.filter((entry) => entry.group === 'package');
  const body = `<section class="docs-index">
    ${createLinkSection('Technical Documentation', technicalLinks, publicBase)}
    ${createLinkSection('Package README Files', packageLinks, publicBase)}
  </section>`;

  writeHtml(
    rootDir,
    'docs/index.html',
    createPageShell({
      publicBase,
      title: 'SkyKit Technical Documentation',
      intro: 'Implementation truth for the current workspace on main.',
      body,
      active: 'docs',
      navEntries: entries,
    }),
  );
}

function collectDocEntries(projectRoot) {
  const docsDirectory = path.join(projectRoot, 'docs');
  const technicalEntries = fs.readdirSync(docsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const source = normalizeSlashes(path.join('docs', entry.name));
      return createDocEntry(projectRoot, source, 'technical', 'Technical Documentation');
    });

  const packagesDirectory = path.join(projectRoot, 'packages');
  const packageEntries = fs.readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => normalizeSlashes(path.join('packages', entry.name, 'README.md')))
    .filter((source) => fs.existsSync(path.join(projectRoot, source)))
    .map((source) => createDocEntry(projectRoot, source, 'package', 'Package README'));

  return [...technicalEntries, ...packageEntries].sort((left, right) => {
    if (left.group !== right.group) {
      return left.group === 'technical' ? -1 : 1;
    }
    return left.title.localeCompare(right.title);
  });
}

function createDocEntry(projectRoot, source, group, groupLabel) {
  const route = sourceToDocsRoute(source);
  if (!route) {
    throw new Error(`No docs route for ${source}`);
  }
  const markdown = fs.readFileSync(path.join(projectRoot, source), 'utf8');
  return {
    source,
    route,
    group,
    groupLabel,
    title: readMarkdownTitle(markdown, source),
  };
}

function writeListingPage({ rootDir, publicBase, route, title, intro, links }) {
  const body = `<section class="link-list">
    ${links.map((entry) => `<a href="${escapeAttribute(joinPublicUrl(publicBase, entry.route))}">
      <strong>${escapeHtml(entry.label)}</strong>
      <span>${escapeHtml(entry.description)}</span>
    </a>`).join('\n')}
  </section>`;

  writeHtml(
    rootDir,
    `${route}index.html`,
    createPageShell({ publicBase, title, intro, body, active: route.replace(/\/$/u, '') }),
  );
}

function createLinkSection(title, entries, publicBase) {
  return `<section>
    <h2>${escapeHtml(title)}</h2>
    <ul>
      ${entries.map((entry) => `<li><a href="${escapeAttribute(joinPublicUrl(publicBase, entry.route))}">${escapeHtml(entry.title)}</a></li>`).join('\n')}
    </ul>
  </section>`;
}

function createPageShell({ publicBase, title, intro, body, active, navEntries = [] }) {
  const nav = [
    { key: 'home', label: 'Home', href: joinPublicUrl(publicBase, '') },
    { key: 'docs', label: 'Docs', href: joinPublicUrl(publicBase, 'docs/') },
    { key: 'examples', label: 'Examples', href: joinPublicUrl(publicBase, 'examples/') },
    { key: 'legacy', label: 'Legacy', href: joinPublicUrl(publicBase, 'legacy/') },
  ];

  const docsNav = navEntries.length > 0
    ? `<aside class="page-nav" aria-label="Documentation pages">
        <p>Technical Documentation</p>
        ${navEntries.map((entry) => `<a href="${escapeAttribute(joinPublicUrl(publicBase, entry.route))}">${escapeHtml(entry.title)}</a>`).join('\n')}
      </aside>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #071017;
        --panel: #0f1b25;
        --line: #314252;
        --text: #f5f7fb;
        --muted: #aab8c7;
        --accent: #79d3ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font: 16px/1.65 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      a { color: var(--accent); }
      .site-header {
        border-bottom: 1px solid var(--line);
        background: rgba(7, 16, 23, 0.96);
      }
      .site-header__inner,
      .page {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
      }
      .site-header__inner {
        display: flex;
        align-items: center;
        gap: 24px;
        min-height: 64px;
      }
      .brand {
        color: var(--text);
        font-weight: 700;
        text-decoration: none;
      }
      .top-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-left: auto;
      }
      .top-nav a {
        min-height: 36px;
        padding: 6px 10px;
        border-radius: 6px;
        color: var(--muted);
        text-decoration: none;
      }
      .top-nav a[aria-current="page"],
      .top-nav a:hover {
        color: var(--text);
        background: #142434;
      }
      .page {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 28px;
        padding: 40px 0 64px;
      }
      .page--with-nav {
        grid-template-columns: 260px minmax(0, 1fr);
      }
      .page-nav {
        align-self: start;
        position: sticky;
        top: 24px;
        display: grid;
        gap: 6px;
        padding-right: 16px;
      }
      .page-nav p {
        margin: 0 0 8px;
        color: var(--muted);
        font-size: 0.82rem;
        font-weight: 700;
        text-transform: uppercase;
      }
      .page-nav a {
        padding: 5px 0;
        color: var(--muted);
        text-decoration: none;
      }
      .page-nav a:hover { color: var(--text); }
      main { min-width: 0; }
      h1 {
        margin: 0 0 8px;
        font-size: clamp(2rem, 6vw, 3.1rem);
        line-height: 1.1;
      }
      .intro {
        margin: 0 0 32px;
        color: var(--muted);
      }
      .link-list {
        display: grid;
        gap: 12px;
      }
      .link-list a {
        display: grid;
        gap: 4px;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        color: var(--text);
        text-decoration: none;
      }
      .link-list a:hover { border-color: var(--accent); }
      .link-list span,
      .markdown-body {
        color: var(--muted);
      }
      .markdown-body {
        max-width: 82ch;
      }
      .markdown-body h1,
      .markdown-body h2,
      .markdown-body h3 {
        color: var(--text);
        line-height: 1.25;
      }
      .markdown-body pre {
        overflow-x: auto;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #02060a;
      }
      .markdown-body code {
        color: #dbeafe;
      }
      .markdown-body :not(pre) > code {
        padding: 0.1em 0.3em;
        border-radius: 4px;
        background: #162636;
      }
      .docs-index {
        display: grid;
        gap: 28px;
      }
      @media (max-width: 760px) {
        .site-header__inner {
          align-items: flex-start;
          flex-direction: column;
          gap: 8px;
          padding: 14px 0;
        }
        .top-nav { margin-left: 0; }
        .page--with-nav {
          grid-template-columns: minmax(0, 1fr);
        }
        .page-nav {
          position: static;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="${escapeAttribute(joinPublicUrl(publicBase, ''))}">SkyKit</a>
        <nav class="top-nav" aria-label="Primary">
          ${nav.map((item) => `<a href="${escapeAttribute(item.href)}"${item.key === active ? ' aria-current="page"' : ''}>${escapeHtml(item.label)}</a>`).join('\n')}
        </nav>
      </div>
    </header>
    <div class="page${docsNav ? ' page--with-nav' : ''}">
      ${docsNav}
      <main>
        <h1>${escapeHtml(title)}</h1>
        <p class="intro">${escapeHtml(intro)}</p>
        ${body}
      </main>
    </div>
  </body>
</html>
`;
}

function writeHtml(rootDir, relativePath, html) {
  const outputPath = path.join(rootDir, relativePath);
  ensureDirectory(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html);
}

function rewriteMarkdownHref(href, sourceRelative, publicBase) {
  if (isExternalHref(href)) {
    return href;
  }

  const [targetPath, hash = ''] = href.split('#');
  if (!targetPath) {
    return href;
  }

  const sourceDirectory = path.dirname(sourceRelative);
  const resolved = normalizeSlashes(path.normalize(path.join(sourceDirectory, targetPath)));
  const route = sourceToDocsRoute(resolved);
  if (!route) {
    return href;
  }

  return `${joinPublicUrl(publicBase, route)}${hash ? `#${hash}` : ''}`;
}

function readMarkdownTitle(markdown, fallbackSource) {
  const match = /^#\s+(.+)$/mu.exec(markdown);
  if (match) {
    return stripMarkdownInline(match[1].trim());
  }
  return path.basename(fallbackSource, path.extname(fallbackSource));
}

function stripMarkdownInline(value) {
  return value
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[*_~]/gu, '');
}

function isExternalHref(href) {
  return href.startsWith('#') ||
    href.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(href);
}

function normalizeSlashes(value) {
  return String(value).replace(/\\/gu, '/');
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
