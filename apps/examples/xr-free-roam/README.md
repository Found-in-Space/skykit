# XR Free Roam Example

This repository example is the touch-os/XR integration fixture. Its normal
install and Vite build resolve published `@found-in-space/touch-os@0.3.0` from
`node_modules`; the presence of a sibling touch-os checkout does not change that
resolution. `TOUCH_OS_LOCAL_PATH` is an explicit co-development override, not a
release or conformance path.

The tablet uses `actionOutputMode: 'app-actions'`. App-change events synchronize
example-owned astronomy state, while app-action commands run once through
registered SkyKit actions. Its right-hand input uses the public
SkyKit-frame-aware pointer adapter and is cleared immediately when tracking,
the target ray, or the XR session disappears. The HR texture is presented by a
caller-created optional touch-os root with explicit panel metrics and preserved
aspect ratio; panel texture anisotropy is configured through driver options.

## Browser Test Mode

Open `xr-free-roam/?skykit-test=1` for the deterministic non-XR smoke fixture.
Wait until
`document.documentElement.dataset.xrFreeRoamTestReady === "true"`, then use
`globalThis.__SKYKIT_XR_FREE_ROAM_TEST__`. The test API exposes app and action
IDs plus panel-frame-synchronized operations for opening apps, selecting Sun,
flying to the selected target, starting a held action, simulating tracking loss,
toggling panel visibility, reading HR geometry, and taking diagnostic snapshots.

The mode mounts the tablet at a synthetic head-anchored pose and drives a
browser-test pointer through normal panel frames. It does not emulate a native
`XRSession`, reference-space changes, headset/controller tracking,
runtime-selected controller profiles, compositor behavior, or headset
rendering. Fake-XR unit tests cover deterministic lifecycle and loss/re-entry
cases; a WebXR-capable browser and device/runtime are still needed for
end-to-end immersive verification.

The automated smoke runner blocks non-local network requests so astronomy data
availability cannot make the UI assertions flaky. It ignores only Chromium's
corresponding blocked-resource diagnostic; page exceptions and
application-authored console errors still fail the check.
