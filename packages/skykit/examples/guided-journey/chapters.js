import { defineGuidedJourney } from '@found-in-space/guided-journey';

// Authored ICRS/parsec viewpoints. Cluster centres match the existing cluster
// tour; observer offsets are illustrative viewing choices, not measurements.
export const stellarJourney = defineGuidedJourney({
  id: 'stellar-neighbourhood',
  title: 'A few steps through the stars',
  transition: { durationSecs: 4 },
  chapters: [
    { id: 'home', title: 'The solar neighbourhood', scene: {
      view: { limitingMagnitude: 7.5 },
      camera: { kind: 'pose', observerPc: { x: 8, y: 0, z: 0 }, lookAt: { targetPc: { x: 0, y: 0, z: 0 } } },
    } },
    { id: 'hyades', title: 'The Hyades', scene: {
      camera: { kind: 'pose', observerPc: { x: 32.574, y: 42.316, z: 13.963 },
        lookAt: { targetPc: { x: 17.574, y: 42.316, z: 13.963 } } },
    } },
    { id: 'pleiades', title: 'The Pleiades', scene: {
      camera: { kind: 'pose', observerPc: { x: 92.379, y: 103.162, z: 55.161 },
        lookAt: { targetPc: { x: 67.379, y: 103.162, z: 55.161 } } },
    } },
  ],
});
