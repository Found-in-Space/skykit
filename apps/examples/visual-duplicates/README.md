# STAR v2 visual-duplicates flight test

This is a dataset-specific configuration of SkyKit's normal XR free-roam app.
It keeps the standard preflight, touch-os tablet, rendering controls, HR
diagram, constellation art, navigation, picking, and WebXR session behavior.
The observer starts at the Sun and the only scene addition is an overlay built
from the local `visual-duplicates` sidecar.

One Node process serves the Vite-transformed project and the local
render/sidecar files from the same origin. Octree requests support HTTP byte
ranges, including the 20 GiB STAR v2 render artifact.

## Run locally

From the SkyKit repository root:

```bash
npm run dev:visual-duplicates -- --data-dir /path/to/products
```

Open <http://localhost:4173>. The data directory is required so the diagnostic
does not depend on a machine-specific path. Supply it on the command line as
shown above, or use:

```bash
FIS_OCTREE_DATA_DIR=/path/to/products npm run dev:visual-duplicates
```

The optional `--port` and `--host` arguments can also be set with
`FIS_VIEWER_PORT` and `FIS_VIEWER_HOST`.

## Publish temporarily with kgrok

Keep the Node server running, then start the tunnel in a second terminal:

```bash
kgrok connect octree-duplicates.dev.k-si.com 4173
```

Open `https://octree-duplicates.dev.k-si.com` in the headset. Both project and
data traffic use that HTTPS origin, so WebXR has a secure context and no CORS
configuration is required.

The hostname is only a suggested diagnostic name; replace it if a different
`*.dev.k-si.com` name has been allocated.

## What it tests

- the real descriptor-bearing STAR v2 octree;
- the real sparse `visual-duplicates` sidecar and parent UUID validation;
- the standard SkyKit XR free-roam experience starting at the Sun;
- automatic decoration of Gaia and HIP members in the live star-cell stream;
- one byte per rendered star encodes its duplicate role (`1` Gaia, `2` HIP),
  patched directly into the existing GPU geometry when sidecar cells arrive;
- a shader-only cyan/amber shine that uses the normal SkyKit observer and
  limiting-magnitude uniforms inside the existing star draw, with no extra
  point-cloud pass, movement-time CPU filtering, or marker geometry rebuild;
- one background fetch of the 1.9 MiB sparse sidecar plus a concurrency-limited
  cell decode queue, so sidecar work does not block the render loop;
- XR free-roam navigation over HTTPS.
