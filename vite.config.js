import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localTouchOsPath = process.env.TOUCH_OS_LOCAL_PATH
  ? path.resolve(__dirname, process.env.TOUCH_OS_LOCAL_PATH)
  : null;
const localTouchOsAliases = localTouchOsPath && fs.existsSync(path.join(localTouchOsPath, 'src/index.ts'))
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
        skykitVrViewer: path.resolve(__dirname, 'apps/examples/vr-viewer/index.html'),
        skykitXrFreeRoam: path.resolve(__dirname, 'apps/examples/xr-free-roam/index.html'),
        dustRoam: path.resolve(__dirname, 'demos/dust-roam.html'),
        hAlphaVolume: path.resolve(__dirname, 'demos/h-alpha-volume.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
