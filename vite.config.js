import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localTouchOsAliases = createLocalTouchOsAliases(
  process.env.TOUCH_OS_LOCAL_PATH,
);

const publicBase = normalizePublicBase(process.env.SKYKIT_PUBLIC_BASE ?? './');

const siteChrome = `
  <!-- 100% privacy-first analytics -->
  <script data-collect-dnt="true" async src="https://scripts.simpleanalyticscdn.com/latest.js"></script>
  <noscript><img src="https://queue.simpleanalyticscdn.com/noscript.gif?collect-dnt=true" alt="" referrerpolicy="no-referrer-when-downgrade" /></noscript>
  <footer class="fis-made-by-kaj" aria-label="Site credit">
    Made with <span aria-hidden="true">❤️</span> by <a href="https://k-si.com/">Kaj</a>
  </footer>
  <style>
    .fis-made-by-kaj {
      position: fixed; left: max(0.5rem, env(safe-area-inset-left)); bottom: max(0.5rem, env(safe-area-inset-bottom)); z-index: 2147483647;
      box-sizing: border-box; max-width: calc(100vw - 1rem); margin: 0; padding: 0.28rem 0.52rem; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 999px;
      color: rgba(255, 255, 255, 0.72); background: rgba(5, 8, 12, 0.76); box-shadow: 0 0.25rem 1rem rgba(0, 0, 0, 0.24);
      font: 500 0.72rem/1.35 system-ui, sans-serif; letter-spacing: 0.01em; white-space: nowrap; backdrop-filter: blur(8px); pointer-events: none;
    }
    .fis-made-by-kaj a { color: #9fbcff; text-decoration: none; pointer-events: auto; }
    .fis-made-by-kaj a:hover, .fis-made-by-kaj a:focus-visible { text-decoration: underline; }
    @media (max-width: 30rem) {
      .fis-made-by-kaj { top: max(0.5rem, env(safe-area-inset-top)); right: max(0.5rem, env(safe-area-inset-right)); bottom: auto; left: auto; }
    }
  </style>
`;

function analyticsAndCreditPlugin() {
  return {
    name: 'found-in-space-analytics-and-credit',
    transformIndexHtml(html) {
      return html.replace(/<\/body>/i, `${siteChrome}</body>`);
    },
  };
}

function normalizePublicBase(input) {
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

function createLocalTouchOsAliases(input) {
  const requestedPath = String(input ?? '').trim();
  if (!requestedPath) return [];

  const localTouchOsPath = path.resolve(__dirname, requestedPath);
  const rootEntry = path.join(localTouchOsPath, 'src/index.ts');
  const threeEntry = path.join(localTouchOsPath, 'src/hosts/three.ts');
  if (!fs.existsSync(rootEntry) || !fs.existsSync(threeEntry)) {
    throw new Error(
      `TOUCH_OS_LOCAL_PATH does not point to a touch-os source checkout: ${localTouchOsPath}`,
    );
  }

  console.warn(
    `[skykit] TOUCH_OS_LOCAL_PATH enabled; using local touch-os source at ${localTouchOsPath}`,
  );
  return [
    {
      find: '@found-in-space/touch-os/hosts/three',
      replacement: threeEntry,
    },
    {
      find: '@found-in-space/touch-os',
      replacement: rootEntry,
    },
  ];
}

export default defineConfig({
  base: publicBase,
  plugins: [analyticsAndCreditPlugin()],
  resolve: {
    alias: localTouchOsAliases,
  },
  optimizeDeps: localTouchOsAliases.length > 0
    ? {
        exclude: [
          '@found-in-space/touch-os',
          '@found-in-space/touch-os/hosts/three',
        ],
      }
    : undefined,
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        skykitFreeRoam: path.resolve(__dirname, 'apps/examples/free-roam/index.html'),
        skykitXrFreeRoam: path.resolve(__dirname, 'apps/examples/xr-free-roam/index.html'),
        spatialExamples: path.resolve(__dirname, 'packages/spatial/examples/index.html'),
        spatialCoordinatesAim: path.resolve(__dirname, 'packages/spatial/examples/coordinates-aim/index.html'),
        spatialRoutesOrbits: path.resolve(__dirname, 'packages/spatial/examples/routes-orbits/index.html'),
        spatialPathsTransitions: path.resolve(__dirname, 'packages/spatial/examples/paths-transitions/index.html'),
        spatialMotionAutomation: path.resolve(__dirname, 'packages/spatial/examples/motion-automation/index.html'),
        dustRoam: path.resolve(__dirname, 'demos/dust-roam.html'),
        hAlphaVolume: path.resolve(__dirname, 'demos/h-alpha-volume.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
