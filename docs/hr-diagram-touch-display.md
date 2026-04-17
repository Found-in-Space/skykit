# HR Diagram Touch Display Control

## Purpose

This document describes how to implement `createHRDiagramControl()` — a custom control type for the SkyKit touch display system that renders a live Hertzsprung–Russell diagram into the canvas-backed panel UI.

The existing `HRDiagramRenderer` (in `src/hr-diagram/hr-diagram-renderer.js`) is a standalone WebGL renderer that owns its own canvas, Three.js scene, and orthographic camera. That design works well for the dedicated demo page, but it cannot be embedded inside the touch display because the touch display is a single 2D canvas (`CanvasRenderingContext2D`), not a WebGL surface.

The goal here is to re-implement the star-plotting step in pure 2D canvas so the HR diagram can be:

- shown on any `SceneTouchDisplayController` panel (desktop, XR tablet, ship panel, etc.)
- composed alongside other controls (toggles, ranges, galaxy-map, star info) on the same panel
- driven by the same data the star-field layer already produces, without a second WebGL context

---

## Background: the touch display control system

### How `createTouchDisplay` works

`createTouchDisplay(options)` (in `src/ui/touch-display.js`) manages a single `HTMLCanvasElement` and draws everything onto it with a `CanvasRenderingContext2D`.  Items are stacked vertically; each item has a `type` string that maps to a control in the **registry**.

The default registry contains: `button`, `toggle`, `range`, `display`.  The registry is extended by passing a `controls` map in `displayOptions`:

```js
createSceneTouchDisplayController({
  displayOptions: {
    controls: {
      'hr-diagram': createHRDiagramControl(),
    },
  },
  items: [
    { id: 'hr', type: 'hr-diagram', value: null },
  ],
});
```

### Control type interface

Each entry in the registry must implement this interface:

```ts
interface ControlType {
  // Required. Returns the pixel height this item occupies in the panel.
  getHeight(item: Item, api: DisplayApi): number;

  // Required. Draws the control into `ctx` inside the bounding rect.
  render(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    item: Item,
    state: { isHovered: boolean; isPressed: boolean; hoveredTargetType: string | null },
    env: { theme: Theme; layout: Layout; width: number; height: number }
  ): void;

  // Optional. Hit-test: return a target descriptor if `pointer` falls inside
  // a clickable region, or null/undefined.
  resolveTarget?(item, rect, pointer: { u, v, px, py }, api): Target | null;

  // Optional. Called once on initial press.
  activate?(runtime: DisplayApi, target: Target, pointer): void;

  // Optional. Called every frame while the pointer is held and moving (for sliders).
  pressMove?(runtime: DisplayApi, target: Target, pointer): void;
}
```

The `rect` coordinates are in canvas pixel space (top-left origin).  `pointer.px / pointer.py` are also pixel coordinates; `pointer.u / pointer.v` are 0–1 normalised UV (v=1 at top, v=0 at bottom).

The galaxy-map control (`src/ui/galaxy-map-control.js`) is the only existing custom control and it implements only `getHeight` and `render` (it is read-only).  The HR diagram control should start the same way — no interactive sub-targets needed initially.

### Item value contract

The item's `.value` property is the data payload the control reads at render time.  For the galaxy-map, `buildGalaxyMapValue()` packages observer/selected positions and scale hints into a plain object that `render()` reads.

For the HR diagram the value should carry pre-processed star data:

```ts
interface HRDiagramValue {
  // Parallel typed arrays directly from the star geometry buffer attributes.
  // All three must be the same length or the value is ignored.
  positions: Float32Array;    // x,y,z interleaved, in scene units (pc × 0.001)
  teffLog8:  Uint8Array;      // temperature encoded as log8 (see decoding below)
  magAbs:    Float32Array;    // absolute magnitude per star

  // How many entries in the arrays are valid (rest is unused allocation).
  starCount: number;

  // Observer position in scene units, used for modes 0 and 2.
  observerX: number;
  observerY: number;
  observerZ: number;

  // Display mode: 0=mag-limited  1=volume-complete  2=frustum (see below).
  mode: number;

  // Apparent magnitude cut-off for modes 0 and 2.
  appMagLimit: number;

  // Optional: view-projection matrix (16-element array, column-major) for mode 2.
  viewProjection?: number[];
}
```

Passing `null` or `undefined` as the value is valid and should render an empty plot with axes only.

---

## The HR diagram in brief

The Hertzsprung–Russell diagram plots:

- **X axis** — stellar surface temperature (K), hot stars on the left, cool on the right.  The axis is **logarithmic** spanning roughly 2 500 K (cool, red M-dwarfs) to 40 000 K (hot, blue O-stars).
- **Y axis** — absolute magnitude (intrinsic brightness), bright (negative) at top, faint (positive) at bottom.  The plotted range is typically −6 to +17.

Every star in the dataset has two encoded attributes that supply these values:
- `teff_log8` — an 8-bit unsigned integer encoding log₁₀(T_eff) (see decoding formula below)
- `magAbs` — a 32-bit float, the absolute magnitude

The main visible structures are:
- The **main sequence** — a diagonal band running from hot-bright (upper-left) to cool-faint (lower-right)
- **Giant/supergiant branch** — bright stars scattered upper-right
- **White dwarfs** — faint hot stars lower-left

---

## Implementation plan

### File location

`src/ui/hr-diagram-control.js`

Export `createHRDiagramControl(options?)` as a named export.

Add to `src/index.js`:

```js
export { createHRDiagramControl } from './ui/hr-diagram-control.js';
```

### Default constants

```js
const DEFAULT_COOL_K      = 2500;
const DEFAULT_HOT_K       = 40000;
const DEFAULT_MIN_MAG     = -6;
const DEFAULT_MAX_MAG     = 17;
const DEFAULT_MARGIN_PX   = 28;    // inner margin around the plot area
const DEFAULT_HEIGHT      = 220;   // pixel height the control occupies in the panel
const SCENE_SCALE         = 0.001; // 1 parsec = 0.001 Three.js world units

// Temperature ticks to draw on the X axis
const TEMP_TICKS = [3000, 5000, 8000, 15000, 30000];
const MAG_TICK_STEP = 4; // every 4 magnitudes (panel is smaller than the standalone demo)
```

### Axis mapping functions

These are the same formulas used by the WebGL vertex shader and the existing 2D axis-drawing code, just expressed as plain JS functions:

```js
// Map a temperature in Kelvin → canvas X pixel (hot=left, cool=right).
function tempToX(tempK, width, margin, coolK, hotK) {
  const minLogT = Math.log10(coolK);
  const maxLogT = Math.log10(hotK);
  const logT  = Math.log10(Math.max(coolK, Math.min(hotK, tempK)));
  const tNorm = (logT - minLogT) / (maxLogT - minLogT);
  // tNorm=0 → hot end (left side after flip), tNorm=1 → cool end (right side)
  return width - margin - tNorm * (width - 2 * margin);
}

// Map absolute magnitude → canvas Y pixel (bright=top, faint=bottom).
function magToY(mag, height, margin, minMag, maxMag) {
  const mNorm = Math.max(0, Math.min(1, (mag - minMag) / (maxMag - minMag)));
  return margin + mNorm * (height - 2 * margin);
}
```

### Temperature decoding

The `teff_log8` attribute is a uint8 (0–255) that encodes log₁₀(T_eff) non-linearly.  The formula (from the existing vertex shader) is:

```js
function decodeTeff(log8Byte) {
  const log8 = log8Byte / 255; // normalise to 0..1
  if (log8 >= 0.996) return 5800; // exact solar temperature sentinel
  return 2000 * Math.pow(25, log8);
}
```

This gives values from ~2 000 K (log8=0) up to ~40 000 K (log8 near 1), with 5 800 K (Sun) clamped at the top sentinel.

### Star colour from temperature

Each star should be drawn in its approximate blackbody colour.  This is the same Tanner approximation used in the shader, ported to JS:

```js
function teffToRGB(tempK) {
  const t = Math.max(1000, Math.min(40000, tempK)) / 100;
  let r, g, b;

  r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);

  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.119568166;
  else         g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);

  if      (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else              b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));

  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
```

### Star visibility filtering

The control supports the same three modes as the WebGL renderer:

**Mode 1 — volume-complete** (simplest, no filtering):

Every star in the geometry is plotted.  No distance calculation needed.  This is the default when using `createVolumeHRLoader`, which has already applied a radius filter before producing the geometry.

**Mode 0 — magnitude-limited**:

Only stars whose computed *apparent* magnitude does not exceed `appMagLimit` are plotted.  The apparent magnitude formula (distance modulus):

```
m_apparent = magAbs + 5 * log10(distancePc) - 5
```

To compute `distancePc` from the star's scene-space position and the observer's scene-space position:

```js
const dx = positions[i*3]     - observerX;
const dy = positions[i*3 + 1] - observerY;
const dz = positions[i*3 + 2] - observerZ;
const distancePc = Math.sqrt(dx*dx + dy*dy + dz*dz) / SCENE_SCALE;
const mApp = magAbs + 5 * Math.log10(Math.max(distancePc, 0.001)) - 5;
if (mApp > appMagLimit) continue;
```

**Mode 2 — frustum**:

Same magnitude filter as mode 0, plus a clip-space test using the view-projection matrix:

```js
// Transform world position to clip space (homogeneous)
const vp = viewProjection; // 16-element array, column-major (THREE.Matrix4 .elements)
const cx = vp[0]*wx + vp[4]*wy + vp[8]*wz  + vp[12];
const cy = vp[1]*wx + vp[5]*wy + vp[9]*wz  + vp[13];
const cz = vp[2]*wx + vp[6]*wy + vp[10]*wz + vp[14];
const cw = vp[3]*wx + vp[7]*wy + vp[11]*wz + vp[15];

// Discard if behind camera or outside ±1.05 clip bounds
if (cz < 0 || Math.abs(cx) > cw * 1.05 || Math.abs(cy) > cw * 1.05) continue;
```

### Star drawing strategy

The 2D canvas does not have GPU-accelerated per-vertex rendering, so drawing one `arc()` call per star at full counts (50 000+) would be too slow.

**Recommended approach: accumulation buffer**

Use an `ImageData` buffer (a flat `Uint8ClampedArray` of RGBA bytes) to accumulate star brightness, then blit it to the canvas in one `putImageData` call.

```
plotWidth  = width  - 2 * margin   (canvas pixels)
plotHeight = height - 2 * margin   (canvas pixels)
```

For each visible star:

1. Decode its temperature → `teff` → map to `px` (0..plotWidth)
2. Map its `magAbs` → `py` (0..plotHeight)
3. Clamp to integer pixel coordinates within the plot area
4. Write RGBA into `imageData.data` at that pixel, additive:

```js
const idx = (py * plotWidth + px) * 4;
const [r, g, b] = teffToRGBComponents(teff); // returns [0..255, 0..255, 0..255]
// Additive accumulate, clamped to 255
data[idx]     = Math.min(255, data[idx]     + r * alpha);
data[idx + 1] = Math.min(255, data[idx + 1] + g * alpha);
data[idx + 2] = Math.min(255, data[idx + 2] + b * alpha);
data[idx + 3] = Math.min(255, data[idx + 3] + 180);
```

A fixed `alpha` of 0.5–0.6 (so `r * 0.55` etc.) matches the appearance of the WebGL version and means individual stars are semi-transparent while dense regions (main sequence) saturate to full brightness.

After iterating all stars: `ctx.putImageData(imageData, margin, margin)`.

**When star counts are low (< 2 000)**, a single `ctx.fillRect(px + margin, py + margin, 1, 1)` per star is fast enough and avoids allocating the `ImageData` buffer.  Choose the strategy based on `starCount`.

**Caching**: Only recompute the `ImageData` when the value changes (new geometry, mode change, or observer position change beyond a threshold).  Store the rendered `ImageData` on the control's internal state and skip re-computation if nothing has changed.

### Axis drawing

After blitting the star data, draw the 2D overlay (axes, ticks, labels, star count) directly onto the same canvas context. This code can be adapted almost verbatim from `HRDiagramRenderer.drawAxes()`:

```js
function drawAxes(ctx, rect, opts) {
  const { x, y, w, h, margin, coolK, hotK, minMag, maxMag, starCount, theme } = opts;

  // Background for the plot area
  ctx.fillStyle = 'rgba(1, 6, 16, 0.88)';
  ctx.fillRect(x, y, w, h);

  // Plot border
  ctx.strokeStyle = 'rgba(242, 200, 121, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + margin, y + margin, w - margin*2, h - margin*2);

  // Temperature ticks (X axis, bottom)
  const minLogT = Math.log10(coolK);
  const maxLogT = Math.log10(hotK);
  ctx.fillStyle   = 'rgba(236, 238, 246, 0.45)';
  ctx.strokeStyle = 'rgba(236, 238, 246, 0.12)';
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const t of TEMP_TICKS) {
    if (t < coolK || t > hotK) continue;
    const tx = x + tempToX(t, w, margin, coolK, hotK, minLogT, maxLogT);
    ctx.beginPath();
    ctx.moveTo(tx, y + h - margin);
    ctx.lineTo(tx, y + h - margin + 3);
    ctx.stroke();
    ctx.fillText(t >= 1000 ? `${(t/1000)|0}k` : String(t), tx, y + h - margin + 12);
  }

  // Magnitude ticks (Y axis, left)
  ctx.textAlign = 'right';
  const magStart = Math.ceil(minMag / MAG_TICK_STEP) * MAG_TICK_STEP;
  for (let mag = magStart; mag <= maxMag; mag += MAG_TICK_STEP) {
    const ty = y + magToY(mag, h, margin, minMag, maxMag);
    ctx.beginPath();
    ctx.moveTo(x + margin - 3, ty);
    ctx.lineTo(x + margin, ty);
    ctx.stroke();
    ctx.fillText(String(mag), x + margin - 4, ty + 3);
  }

  // Axis labels
  ctx.textAlign = 'start';
  ctx.fillStyle = 'rgba(236, 238, 246, 0.6)';
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillText('Hot', x + margin + 2, y + h - margin + 12);
  ctx.fillText('Cool', x + w - margin - 22, y + h - margin + 12);

  // Rotated Y label ("Abs. mag")
  ctx.save();
  ctx.translate(x + 8, y + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Abs. mag', 0, 0);
  ctx.restore();

  // Star count badge
  if (starCount > 0) {
    ctx.fillStyle = 'rgba(159, 233, 255, 0.75)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${starCount.toLocaleString()} stars`, x + w - margin, y + margin - 4);
    ctx.textAlign = 'start';
  }
}
```

### Control factory

```js
export function createHRDiagramControl(options = {}) {
  const itemHeight = options.height ?? DEFAULT_HEIGHT;
  const coolK      = options.coolK  ?? DEFAULT_COOL_K;
  const hotK       = options.hotK   ?? DEFAULT_HOT_K;
  const minMag     = options.minMag ?? DEFAULT_MIN_MAG;
  const maxMag     = options.maxMag ?? DEFAULT_MAX_MAG;
  const margin     = options.margin ?? DEFAULT_MARGIN_PX;

  // Cached rendered star layer (invalidated when value changes)
  let cachedImageData = null;
  let cachedValue     = null;

  function renderStars(value, plotW, plotH) {
    const { positions, teffLog8, magAbs, starCount, mode,
            observerX, observerY, observerZ, appMagLimit, viewProjection } = value;

    const imageData = new ImageData(plotW, plotH);
    const data = imageData.data;
    const minLogT = Math.log10(coolK);
    const maxLogT = Math.log10(hotK);

    for (let i = 0; i < starCount; i++) {
      const wx = positions[i * 3];
      const wy = positions[i * 3 + 1];
      const wz = positions[i * 3 + 2];

      // --- Mode filtering ---
      if (mode === 0 || mode === 2) {
        const dx = wx - observerX;
        const dy = wy - observerY;
        const dz = wz - observerZ;
        const dPc = Math.sqrt(dx*dx + dy*dy + dz*dz) / SCENE_SCALE;
        const mApp = magAbs[i] + 5 * Math.log10(Math.max(dPc, 0.001)) - 5;
        if (mApp > appMagLimit) continue;

        if (mode === 2 && viewProjection) {
          const vp = viewProjection;
          const cx = vp[0]*wx + vp[4]*wy + vp[8]*wz  + vp[12];
          const cy = vp[1]*wx + vp[5]*wy + vp[9]*wz  + vp[13];
          const cz = vp[2]*wx + vp[6]*wy + vp[10]*wz + vp[14];
          const cw = vp[3]*wx + vp[7]*wy + vp[11]*wz + vp[15];
          if (cz < 0 || Math.abs(cx) > cw * 1.05 || Math.abs(cy) > cw * 1.05) continue;
        }
      }

      // --- Decode temperature → pixel position ---
      const log8 = teffLog8[i] / 255;
      const teff = log8 >= 0.996 ? 5800 : 2000 * Math.pow(25, log8);

      const logT  = Math.log10(Math.max(coolK, Math.min(hotK, teff)));
      const tNorm = (logT - minLogT) / (maxLogT - minLogT);
      const px    = Math.floor((1 - tNorm) * (plotW - 1)); // hot→left after inversion

      const mNorm = Math.max(0, Math.min(1, (magAbs[i] - minMag) / (maxMag - minMag)));
      const py    = Math.floor(mNorm * (plotH - 1));

      if (px < 0 || px >= plotW || py < 0 || py >= plotH) continue;

      // --- Blackbody colour ---
      const t100 = Math.max(10, Math.min(400, teff / 100));
      const r = t100 <= 66 ? 255 : 329.698727446 * Math.pow(t100 - 60, -0.1332047592);
      const g = t100 <= 66
        ? 99.4708025861 * Math.log(t100) - 161.119568166
        : 288.1221695283 * Math.pow(t100 - 60, -0.0755148492);
      const b = t100 >= 66 ? 255 : t100 <= 19 ? 0
        : 138.5177312231 * Math.log(t100 - 10) - 305.0447927307;

      const idx = (py * plotW + px) * 4;
      data[idx]     = Math.min(255, data[idx]     + Math.max(0, r) * 0.55);
      data[idx + 1] = Math.min(255, data[idx + 1] + Math.max(0, g) * 0.55);
      data[idx + 2] = Math.min(255, data[idx + 2] + Math.max(0, b) * 0.55);
      data[idx + 3] = Math.min(255, data[idx + 3] + 180);
    }

    return imageData;
  }

  return {
    getHeight() {
      return itemHeight;
    },

    render(ctx, rect, item, _state, _env) {
      const { x, y, w, h } = rect;
      const value = item.value;

      // Draw background
      ctx.fillStyle = 'rgba(1, 6, 16, 0.88)';
      ctx.fillRect(x, y, w, h);

      const plotW = w - margin * 2;
      const plotH = h - margin * 2;
      if (plotW < 1 || plotH < 1) return;

      // Draw star accumulation layer (cached)
      if (value && value !== cachedValue) {
        cachedValue     = value;
        cachedImageData = renderStars(value, plotW, plotH);
      }

      if (cachedImageData) {
        ctx.putImageData(cachedImageData, x + margin, y + margin);
      }

      // Draw axes on top
      drawAxes(ctx, rect, {
        x, y, w, h, margin, coolK, hotK, minMag, maxMag,
        starCount: value?.starCount ?? 0,
      });
    },
  };
}
```

---

## Wiring into a viewer

### Building the value object

The consumer (viewer overlay or controller callback) builds the value from the star-field layer's committed geometry and the current observer position:

```js
function buildHRValue(geometry, starCount, observerPc, mode, appMagLimit, vpMatrix) {
  if (!geometry) return null;
  return {
    positions:    geometry.attributes.position.array,
    teffLog8:     geometry.attributes.teff_log8.array,
    magAbs:       geometry.attributes.magAbs.array,
    starCount,
    observerX:    observerPc.x * SCALE,
    observerY:    observerPc.y * SCALE,
    observerZ:    observerPc.z * SCALE,
    mode,
    appMagLimit,
    // For mode 2 only: vpMatrix.elements (THREE.Matrix4)
    viewProjection: mode === 2 ? Array.from(vpMatrix.elements) : undefined,
  };
}
```

The value object should be a new reference every time the geometry, mode, or observer position changes significantly — the control uses reference equality to decide whether to recompute the cached `ImageData`.

**Important**: the typed arrays (`positions`, `teffLog8`, `magAbs`) are views into the geometry's buffer attribute — they are not copied.  This is intentional for performance.  The control must not mutate them.

### Setting the item value

```js
// In the overlay's update() callback, or in the star-field layer's onCommit():
tablet.setItemValue('hr', buildHRValue(geometry, starCount, observerPc, mode, magLimit));
```

### Using with `VolumeHRLoader` (mode 1)

```js
const result = await volumeLoader.load({ observerPc, maxRadiusPc: 25 });
if (result) {
  tablet.setItemValue('hr', buildHRValue(
    result.geometry, result.starCount, observerPc, 1, 6.5
  ));
}
```

### Full touch display example

```js
import { createSceneTouchDisplayController, createHRDiagramControl } from '../index.js';

const panel = createSceneTouchDisplayController({
  title: 'SkyKit',
  items: [
    { id: 'hr', type: 'hr-diagram', value: null },
    {
      id: 'hr-mode',
      type: 'range',
      label: 'Mode',
      min: 0, max: 2, step: 1,
      value: 1,
      formatValue: (v) => ['Mag-limited', 'Volume', 'Frustum'][v] ?? String(v),
    },
    { id: 'hr-radius', type: 'range', label: 'Radius (pc)', min: 5, max: 100, step: 5, value: 25 },
  ],
  displayOptions: {
    controls: {
      'hr-diagram': createHRDiagramControl({ height: 220 }),
    },
  },
  mouseControls: true,
  parent: 'cameraMount',
  // ... placement options
  onChange(id, value) {
    if (id === 'hr-mode')   setMode(Number(value));
    if (id === 'hr-radius') setRadius(Number(value));
  },
});
```

---

## Performance notes

| Star count | Recommended strategy |
|---|---|
| 0 – 2 000 | `fillRect(1, 1)` per star — simpler, no allocation |
| 2 000 – 200 000 | `ImageData` accumulation buffer, recomputed only on value change |
| 200 000+ | Consider a 2× downsampled plot buffer (half the pixel dimensions), blit with `drawImage` upscaling; or pre-bin stars by T_eff bucket on the data side |

At the default panel resolution (400 px wide, 220 px item height), the plot area is roughly 344 × 164 = ~56 000 pixels, so even 100 000 stars with simple per-pixel writes takes only a few milliseconds in practice.

The geometry typed arrays are reused across frames via reference equality on the value object — no copying occurs unless the volume loader produces new data or the mode changes.

---

## Relationship to the existing WebGL renderer

`HRDiagramRenderer` in `src/hr-diagram/hr-diagram-renderer.js` is the authoritative standalone implementation.  It should not be modified to support touch displays.  The 2D canvas control is a parallel implementation for the panel context; both are valid consumers of the same geometry data.  Key differences:

| Aspect | `HRDiagramRenderer` (WebGL) | `createHRDiagramControl` (2D canvas) |
|---|---|---|
| Rendering | GPU shader, per-vertex | CPU, ImageData accumulation |
| Canvas ownership | Owns two canvases (axes + GL) | Shared panel canvas |
| Compositing | Overlaid absolute-position div | Inline in vertical item stack |
| Resize | Explicit `resize()` call | Driven by `getHeight()` + rect |
| Context | Standalone demo page | Any touch display / XR tablet |
| Star count ceiling | GPU-limited (millions) | ~200 000 comfortably |
