import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        freeRoam: path.resolve(__dirname, 'demos/free-roam.html'),
        shared: path.resolve(__dirname, 'demos/shared-session.html'),
        xr: path.resolve(__dirname, 'demos/xr-free-roam.html'),
        parallaxDebug: path.resolve(__dirname, 'demos/parallax-debug.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
