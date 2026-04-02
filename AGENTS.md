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
- `camera-rig-controller.js` — desktop-only: `direct` / `inertial` movement and automation (`flyTo`, `orbit`, `lookAt`). No XR code.
- `xr-locomotion-controller.js` — XR-only: thumbstick locomotion, moves spaceship through the stationary universe. No desktop code.
- `xr-pick-controller.js` — XR-only: laser pointer and trigger-based star picking, visuals parented to xrOrigin. No desktop code.
- `pick-controller.js` — desktop-only: pointer click star picking with CSS highlight overlay. No XR code.
- Desktop and XR controllers are fully separate — they share `camera-rig.js` math but never mix input concerns.
- All orientation is quaternion-based to avoid gimbal lock.

### Rig factories

- `createDesktopRig(camera)` — flat rig: `contentRoot` and `navigationRoot` as scene siblings.
- `createXrRig(camera, options)` — spaceship rig: `contentRoot` (universe) and `navigationRoot` (spaceship) are siblings, same as desktop. Spaceship moves; universe stays at origin. `deck` → `xrOrigin` → camera hierarchy. Deck offset `(0, -eyeLevel, +forwardOffset)` is structural and static.
- `ViewerRuntime` accepts a `rig` option — desktop viewers omit it (default), XR viewers pass the XR rig.

### Documentation

- `docs/viewer-architecture.md` — core architecture: runtime, data services, layers, fields, controllers, embedding API.
- `docs/xr-architecture.md` — WebXR spaceship rig, scale conventions, input handling, depth planes, and XR-specific agent rules.

### WebXR & Camera Constraints (STRICT)

See `docs/xr-architecture.md` for the full spec. Desktop and XR are separate viewer instances with different rig topologies — there is no seamless transition between them. Critical rules:

1. **Never mutate the camera directly for VR orientation.** WebXR overrides `camera.rotation`, `camera.quaternion`, `camera.lookAt()`, and `camera.up`.
2. **Always use the spaceship rig for XR.** XR viewers must be created with the XR rig topology (universe and spaceship as siblings, with the deck/xrOrigin hierarchy inside the spaceship). Do not reuse the desktop rig.
3. **Parent controllers inside `xrOrigin` / `cameraMount`.** Controller visuals must be children of the XR origin group inside the spaceship. Never add them to the scene root.
4. **Keep the deck offset static.** The `deck` group position is set once at rig creation, not recalculated per frame from head pose.
5. **Use `starFieldScale` for XR scale, not `SCALE`.** The octree constant `SCALE` (0.001) is for the data pipeline. XR code reads `state.starFieldScale` (default 1.0 m/pc).

### Examples

- `node --test src/controllers/__tests__/camera-rig.test.js`
- `npm run dev` then open `http://localhost:5173/`
