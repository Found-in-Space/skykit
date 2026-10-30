---
"@found-in-space/guided-journey": minor
"@found-in-space/skykit": patch
---

Add an optional TouchOS presentation adapter for shared chapters and sequence
playback. It borrows the existing controller/player, preserves explicit rejoin,
pause/cancel and seek semantics, and shares status presentation with DOM controls.
The headless entrypoints remain independent of TouchOS and graphics libraries.
The stellar chapter and sequence examples include canvas previews of the panels.
