---
"@found-in-space/three-star-field": minor
"@found-in-space/skykit": minor
"@found-in-space/hr-diagram": patch
---

Add optional interaction adapters for TouchOS 0.4: preserve the aggregate star
picker's angular policy and complete result in shared panel/scene arbitration;
bridge semantic WebXR selection and grip placement without per-panel input code.
The interaction subpaths require TouchOS 0.4.0-alpha.0 and pointer-events 6.6.32.
SkyKit and three-star-field declare the required 0.4 prerelease, so npm cannot
accept an incompatible 0.3 graph. The HR diagram retains its compatible 0.3
range and also admits 0.4. Private development roots prepare locked local
archives, and isolated consumers exercise the published package contracts.
