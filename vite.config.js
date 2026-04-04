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
        flyOrbit: path.resolve(__dirname, 'demos/fly-orbit.html'),
        shared: path.resolve(__dirname, 'demos/shared-session.html'),
        xr: path.resolve(__dirname, 'demos/xr-free-roam.html'),
        parallaxDebug: path.resolve(__dirname, 'demos/parallax-debug.html'),
        shaderTuning: path.resolve(__dirname, 'demos/shader-tuning.html'),
        hrDiagram: path.resolve(__dirname, 'demos/hr-diagram.html'),
        radioBubble: path.resolve(__dirname, 'demos/radio-bubble.html'),
        clusters: path.resolve(__dirname, 'demos/clusters.html'),
        dataShape: path.resolve(__dirname, 'demos/data-shape.html'),
        dustMap: path.resolve(__dirname, 'demos/dust-map.html'),
        dustRoam: path.resolve(__dirname, 'demos/dust-roam.html'),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
