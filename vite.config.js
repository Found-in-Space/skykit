import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localTouchOsPath = path.resolve(
  __dirname,
  process.env.TOUCH_OS_LOCAL_PATH ?? '../touch-os',
);
const localTouchOsAliases = fs.existsSync(path.join(localTouchOsPath, 'src/index.ts'))
  ? [
      {
        find: '@found-in-space/touch-os/hosts/three',
        replacement: path.join(localTouchOsPath, 'src/hosts/three.ts'),
      },
      {
        find: '@found-in-space/touch-os',
        replacement: path.join(localTouchOsPath, 'src/index.ts'),
      },
    ]
  : [];

const publicBase = normalizePublicBase(process.env.SKYKIT_PUBLIC_BASE ?? './');

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

export default defineConfig({
  base: publicBase,
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
