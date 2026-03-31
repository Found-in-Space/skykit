# Agent Instructions

## JavaScript / Node.js project

- Runtime: plain ES modules (`"type": "module"`).
- No build step for library code — `src/index.js` is the package entry point.
- Dependency on `three` (THREE.js).

### Standard commands

- Install dependencies: `npm install`
- Run tests: `node --test`
- Run tests in watch mode: `node --test --watch`
- Dev server (Vite): `npm run dev`
- Build demos: `npm run build`

### Demo pages

- Demo HTML lives in `demos/`.
- All demo pages link `demos/shared.css` for common styles — add page-specific CSS inline only when needed.
- `index.html` at the project root is the demo directory page with links to each demo.
- To add a new demo: create `demos/<name>.html` (link `shared.css`), add a `<script type="module">` pointing at a new entry in `src/demo/`, register the HTML file in `vite.config.js` under `rollupOptions.input`, and add a link in `index.html`. Example automation demo: `demos/fly-orbit.html` + `src/demo/fly-orbit.js`.

### Star rendering

- Default apparent magnitude limit is **6.5** — the naked-eye limit under good conditions.
- `DEFAULT_MAG_LIMIT = 6.5` in `src/layers/star-field-materials.js` is the source of truth.
- Magnitude scale: lower = brighter (Vega ≈ 0, Sirius ≈ −1.4, faintest naked-eye ≈ +6.5).
- Scene scale: 1 parsec = 0.001 Three.js world units (`SCALE` in `src/services/octree/scene-scale.js`).

### Controllers

- `camera-rig.js` — pure camera state and quaternion math, no input or DOM.
- `camera-rig-controller.js` — single unified controller replacing the old per-mode controllers. Supports `direct` / `inertial` movement, `targetLock` parallax mode, XR locomotion, and automation (`flyTo`, `orbit`, `lookAt`).
- All orientation is quaternion-based to avoid gimbal lock.

### Examples

- `node --test src/controllers/__tests__/camera-rig.test.js`
- `npm run dev` then open `http://localhost:5173/`
