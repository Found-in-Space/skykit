---
"@found-in-space/skykit": patch
---

Allow the renderer's native XR session-end handler to complete before detaching
any remaining session. This prevents Three.js session cleanup from reading a
session that SkyKit has already cleared, while retaining explicit-exit cleanup.
