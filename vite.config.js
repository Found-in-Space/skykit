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
        shared: path.resolve(__dirname, 'index-shared.html'),
        xr: path.resolve(__dirname, 'index-vr.html'),
      },
    },
  },
});
