---
"@found-in-space/guided-journey": minor
"@found-in-space/skykit": minor
---

Add a renderer-independent guided chapter controller with scoped lifecycle,
latest-wins activation and terminal operation outcomes. SkyKit exposes awaitable
pose transitions, a browser navigation handle and a journey driver that preserves
the live view during interruption. A stellar example shares its controller,
controls and conformance fixture with the Pas de Géant Earth example.

Add the optional shared sequence player and SkyKit participant: presentation
seconds, explicit live rejoin, pause/seek/rate controls, separate arrival and
playback-end outcomes, and final-frame acknowledgement. Deterministic evaluators
remain domain-owned, with no Studio dependency.
