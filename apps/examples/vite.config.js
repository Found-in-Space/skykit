import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localTouchOsPath = path.resolve(
  __dirname,
  process.env.TOUCH_OS_LOCAL_PATH ?? '../../../touch-os',
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
        vrViewer: path.resolve(__dirname, 'vr-viewer/index.html'),
        xrFreeRoam: path.resolve(__dirname, 'xr-free-roam/index.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
