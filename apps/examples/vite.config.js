import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localTouchOsAliases = createLocalTouchOsAliases(
  process.env.TOUCH_OS_LOCAL_PATH,
);

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
    `[skykit-examples] TOUCH_OS_LOCAL_PATH enabled; using local touch-os source at ${localTouchOsPath}`,
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
  base: './',
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
        freeRoam: path.resolve(__dirname, 'free-roam/index.html'),
        xrFreeRoam: path.resolve(__dirname, 'xr-free-roam/index.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
