# Star Field Shader Requirements

## Context

SkyKit is a **free-roam** space viewer. The observer can be at Sol, at Proxima Centauri, next to Betelgeuse, or anywhere in between. There is no home position and no fixed reference frame for rendering. Stars range from absolute magnitude ~−8 (blue supergiants like Rigel) to ~+17 (faint red dwarfs like Proxima Centauri). The shader must produce correct, continuous visual results across this entire range **from any observer position**.

### The dynamic range problem

Apparent magnitude (`mApp`) is computed from absolute magnitude and distance:

    mApp = magAbs + 5 × log₁₀(dPc) − 5

In free-roam the observer encounters apparent magnitudes spanning **30+ magnitudes** — from the faintest loaded star (maybe mag +11) to a supergiant at close approach (mag −18). That is a flux ratio of ~10¹², mapped to 8-bit display output. A linear flux model cannot cover this range; the rendering model must work in **log-flux (magnitude) space**.

### Reference magnitudes

| Object / scenario | Apparent mag | Everyday comparison |
|---|---|---|
| Naked-eye limit (good conditions) | +6.5 | Faintest stars you can see with your eye |
| Polaris | +2.0 | Easy to spot |
| Vega | 0.0 | Bright star |
| Sirius | −1.5 | Brightest star in Earth's sky |
| Venus (max) | −4.6 | Unmistakably bright point |
| Full Moon | −12.7 | Lights up the landscape |
| Sun from Earth | −26.7 | Don't look at it |

## Core Principle

**Apparent magnitude is the only input that matters for rendering.** The shader computes `mApp` from absolute magnitude and distance. After that computation, raw distance must play **no further role** in brightness, size, or visibility decisions. Two stars with the same `mApp` must look identical regardless of whether one is a nearby red dwarf or a distant supergiant.

This rules out:
- Distance-interpolated magnitude limits (e.g., widening the mag limit for "nearby" stars).
- Distance-based size boosts, nearfield floors, or hyperlocal fades.
- Any logic that uses `dPc` directly after `mApp` has been computed.

## Requirements

### 1. No magnitude kill in the shader

A star that is in the geometry buffer must be renderable regardless of its apparent magnitude. The shader must not hard-zero stars because `mApp` exceeds a uniform like `uMagLimit`.

`DEFAULT_MAG_LIMIT` (6.5) controls **loading and octree selection** — what enters buffers. Once a star is in the buffer, the shader renders it. The faintest loaded stars should fade naturally through the brightness function, not be snipped by an `edgeFade` multiplier.

### 2. Luminance is a continuous function of mApp with no ceiling

Luminance (fragment brightness) must be a **continuous, monotonic** function of apparent magnitude. There must be no `clamp(..., 1.0)` or `luminance = 1.0` branch that collapses all bright stars to the same on-screen brightness.

A mag −15 star must look dramatically brighter than a mag −5 star. A mag −5 star must look dramatically brighter than a mag 0 star. A mag 0 star must look brighter than a mag +5 star. The curve must cover the full loaded range without plateauing.

### 3. Point size scales meaningfully with brightness

Point size must grow with brightness so that bright stars read correctly at a glance. A **safety cap** on point size is acceptable (GPU/screen limits) but must sit well above the range that normal constellation viewing uses — it should only engage for extreme close approach to very luminous stars.

### 4. Constellation recognition at any position

From any observer position, the relative brightnesses and sizes of distant stars must produce recognisable constellation patterns. The critical visual range for constellations is roughly mag −2 to +6.5 — this band must have enough luminance and size separation to be readable. See the Orion table below for concrete targets.

### 5. Faint nearby stars are visible

Proxima Centauri (absolute mag ~15.5) at 1.3 pc has apparent mag ~11. It must be **visible** — dim, but present — not discarded by a shader kill. At 0.1 pc its apparent mag is +5.5: a comfortable naked-eye star. The shader must render it appropriately at both distances (assuming it is in the buffer).

### 6. Bright stars get dramatically brighter when closer

The Sun (absolute mag ~4.83) at 0.1 pc has apparent mag ~−5.2 — about Venus brightness. At 0.01 pc it reaches ~−10.2 — quarter-Moon territory. At 0.001 pc: ~−15.2.

Supergiants are far more extreme. Betelgeuse (absolute mag ~−5.85) at 0.1 pc reaches mag ~−15.9 — brighter than the full Moon. These are real scenarios in free-roam. The shader must handle them, not plateau.

### 7. One magnitude-based model for desktop and XR

The same `f(mApp)` functions for luminance and size apply in both immersive and non-immersive views. No separate "VR nearfield hacks" or desktop-only `edgeFade`. The only difference between desktop and XR is the `uScale` uniform (world-units-per-parsec), which feeds into the `mApp` computation. Everything downstream is identical.

### 8. Halo pass follows the same rules

Halos must key off `mApp` directly (e.g., `mApp < haloMagThreshold`), not off a computed radius that has been distorted by distance hacks. The halo threshold must make sense for any observer position.

### 9. Multiple rendering passes are acceptable

The shader does not have to handle the full dynamic range in a single point-sprite pass. Possible strategies:

- **Dominant-star effect**: when one star's `mApp` is extreme (say < −10), dim the rest of the field and/or apply a full-screen glow. The observer is only ever close to one star at a time (or a close binary). This is a separate pass or post-effect, not a complication of the main point shader.
- **Separate halo pass**: already exists. Should follow the same `f(mApp)` logic.
- **Corona/glow pass**: a full-screen radial glow centered on the dominant star, triggered by extreme brightness. This sells the "blazing sun" effect better than making a point sprite enormous.

## The challenge illustrated

### Constellation stars from any position (distant view)

These stars are hundreds of parsecs away. Moving a few parsecs doesn't change their apparent magnitudes. This is the regime the shader spends most of its time in.

| Star | Abs Mag | Typical distance (pc) | mApp | Expected rendering |
|---|---|---|---|---|
| Rigel | −7.84 | ~265 | +0.13 | Bright, prominent |
| Betelgeuse | −5.85 | ~200 | +0.42 | Bright, reddish |
| Bellatrix | −2.78 | ~77 | +1.64 | Medium-bright |
| Alnilam (belt) | −6.89 | ~410 | +1.69 | Medium-bright |
| Alnitak (belt) | −6.0 | ~225 | +1.77 | Medium-bright |
| Saiph | −6.1 | ~198 | +2.09 | Medium |
| Mintaka (belt) | −5.1 | ~380 | +2.23 | Medium |
| Polaris | −3.6 | ~130 | +2.0 | Medium |
| Typical mag +5 star | — | — | +5.0 | Dim, clearly present |
| Naked-eye limit star | — | — | +6.5 | Just barely visible |

The three belt stars must read as a **similar-brightness triplet**. Rigel and Betelgeuse must be clearly brighter. This relative structure must hold from any observer position.

### The Sun at various distances

| Distance | mApp | Comparison | Expected rendering |
|---|---|---|---|
| 10 pc | +4.83 | Faint naked-eye star | Small, dim point |
| 1 pc | −0.17 | ≈ Vega | Bright star |
| 0.1 pc | −5.17 | ≈ Venus | Very prominent point, halo |
| 0.01 pc | −10.17 | ≈ Quarter Moon | Dominant, strong halo/glow |
| 0.001 pc | −15.17 | > Full Moon | Overwhelming, full-screen glow |

### Supergiants at close approach

These are the extreme cases. The observer has flown to within 0.1 pc of a supergiant — a real free-roam scenario.

| Star | Abs Mag | mApp at 0.1 pc | Comparison | Expected rendering |
|---|---|---|---|---|
| Rigel | −7.84 | −17.84 | ~50× full Moon | Maximum intensity, dominant glow |
| Alnilam | −6.89 | −16.89 | ~20× full Moon | Maximum intensity, dominant glow |
| Betelgeuse | −5.85 | −15.85 | ~10× full Moon | Maximum intensity, dominant glow |
| Mintaka | −5.1 | −15.1 | ~5× full Moon | Maximum intensity, dominant glow |
| Sun | +4.83 | −5.17 | ≈ Venus | Very bright point, halo |

Note the contrast: the Sun at 0.1 pc is "Venus-bright" while Betelgeuse at the same distance is "10× full Moon". Supergiants are intrinsically **10+ magnitudes** brighter than the Sun. The point-sprite pass alone cannot sell the supergiant experience — this is where a dominant-star glow pass earns its keep.

### Faint stars at close approach

| Star | Abs Mag | Distance | mApp | Expected rendering |
|---|---|---|---|---|
| Proxima Cen | +15.5 | 1.3 pc | +11.1 | Dim but present |
| Proxima Cen | +15.5 | 0.1 pc | +5.5 | Comfortable naked-eye star |
| Proxima Cen | +15.5 | 0.01 pc | +0.5 | Bright (≈ Betelgeuse from Earth) |
| Barnard's Star | +13.2 | 1.8 pc | +9.5 | Very dim but present |
| Barnard's Star | +13.2 | 0.1 pc | +3.2 | Medium (like a belt star) |

These stars are faint intrinsically but become normal-looking stars at close range. The shader must not treat them differently from any other star at the same apparent magnitude.

## Non-requirements

- Photometrically accurate radiometry (HDR tonemapping, real SI units). The target is **perceptually convincing**, not lab-accurate.
- Resolved stellar disks. Even Betelgeuse (~900 solar radii) at 0.1 pc subtends ~1.4 arcminutes — effectively a point source. Disk rendering is not needed.
- Mandatory bloom or full-screen post passes for the base case. The point + halo path should produce a credible sky. A dominant-star glow pass is a bonus for extreme close approach, not a prerequisite.

## Related Code

- `src/layers/star-field-materials.js` — shader profile implementations (VR, tuned, cartoon)
- `src/demo/shader-tuning.html` — lab-style grid at fixed distance for tuning uniforms (not a substitute for free-roam travel tests)
