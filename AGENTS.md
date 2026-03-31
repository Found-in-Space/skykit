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
- To add a new demo: create `demos/<name>.html` (link `shared.css`), add a `<script type="module">` pointing at a new entry in `src/demo/`, register the HTML file in `vite.config.js` under `rollupOptions.input`, and add a link in `index.html`.

### Controllers

- `camera-rig.js` — pure camera state and quaternion math, no input or DOM.
- `camera-rig-controller.js` — single unified controller replacing the old per-mode controllers. Supports `direct` / `inertial` movement, `targetLock` parallax mode, XR locomotion, and automation (`flyTo`, `orbit`, `lookAt`).
- All orientation is quaternion-based to avoid gimbal lock.

### Examples

- `node --test src/controllers/__tests__/camera-rig.test.js`
- `npm run dev` then open `http://localhost:5173/`
