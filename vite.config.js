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
        galaxyMap: path.resolve(__dirname, 'demos/galaxy-map.html'),
        flyOrbit: path.resolve(__dirname, 'demos/fly-orbit.html'),
        shared: path.resolve(__dirname, 'demos/shared-session.html'),
        xr: path.resolve(__dirname, 'demos/xr-free-roam.html'),
        parallaxDebug: path.resolve(__dirname, 'demos/parallax-debug.html'),
        shaderTuning: path.resolve(__dirname, 'demos/shader-tuning.html'),
        hrDiagram: path.resolve(__dirname, 'demos/hr-diagram.html'),
        hrDiagramTouch: path.resolve(__dirname, 'demos/hr-diagram-touch.html'),
        radioBubble: path.resolve(__dirname, 'demos/radio-bubble.html'),
        clusters: path.resolve(__dirname, 'demos/clusters.html'),
        dataShape: path.resolve(__dirname, 'demos/data-shape.html'),
        dustRoam: path.resolve(__dirname, 'demos/dust-roam.html'),
        hAlphaVolume: path.resolve(__dirname, 'demos/h-alpha-volume.html'),
        skykitFreeRoamLesson: path.resolve(
          __dirname,
          'packages/skykit/examples/free-roam-lesson/index.html',
        ),
        skykitCustomObjectLayer: path.resolve(
          __dirname,
          'packages/skykit/examples/custom-object-layer/index.html',
        ),
        skykitNavigationAutomation: path.resolve(
          __dirname,
          'packages/skykit/examples/navigation-automation/index.html',
        ),
        starOctreeProviderMinimalStream: path.resolve(
          __dirname,
          'packages/star-octree-provider/examples/minimal-stream/index.html',
        ),
        starOctreeProviderNearestVisible: path.resolve(
          __dirname,
          'packages/star-octree-provider/examples/nearest-visible/index.html',
        ),
        starOctreeProviderCanvasStarMap: path.resolve(
          __dirname,
          'packages/star-octree-provider/examples/canvas-star-map/index.html',
        ),
        starOctreeProviderStrategyDiagnostics: path.resolve(
          __dirname,
          'packages/star-octree-provider/examples/strategy-diagnostics/index.html',
        ),
        starOctreeProviderSharedSession: path.resolve(
          __dirname,
          'packages/star-octree-provider/examples/shared-session/index.html',
        ),
        starMapCanvasUseCases: path.resolve(
          __dirname,
          'packages/star-map-canvas/examples/use-cases/index.html',
        ),
        threeStarFieldShaderTuning: path.resolve(
          __dirname,
          'packages/three-star-field/examples/shader-tuning/index.html',
        ),
        hrDiagramMinimal: path.resolve(
          __dirname,
          'packages/hr-diagram/examples/minimal-hr/index.html',
        ),
        hrDiagramVolume: path.resolve(
          __dirname,
          'packages/hr-diagram/examples/volume-hr/index.html',
        ),
        journeyVideoEditor: path.resolve(
          __dirname,
          'packages/journey-video/examples/editor/index.html',
        ),
        journeyVideoRender: path.resolve(
          __dirname,
          'packages/journey-video/examples/render/index.html',
        ),
      },
    },
  },
  server: {
    allowedHosts: true,
  },
});
