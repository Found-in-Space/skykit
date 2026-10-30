import { createSkykitBrowser } from '@found-in-space/skykit/browser';
import { SKYKIT_ICRS_SPACE } from '@found-in-space/skykit';
import { createSkykitSequenceParticipant } from '@found-in-space/skykit/journey';
import { evaluateSpatialOrbit } from '@found-in-space/spatial';
import { createJourneySequencePlayer } from '@found-in-space/guided-journey/sequence';
import { mountSequenceControls } from '@found-in-space/guided-journey/dom';
import { createSequenceTouchControls } from '@found-in-space/guided-journey/touch-os';
import { mountTouchPreview } from '../guided-journey/touch-preview.js';

const orbit = { space: SKYKIT_ICRS_SPACE, center: { x: 17.574, y: 42.316, z: 13.963 },
  radius: 15, orbitNormal: { x: 0, y: 0, z: 1 }, angularSpeedRadPerSec: Math.PI / 20 };
const sequence = { durationSecs: 20, evaluate(timeSecs) {
  const sample = evaluateSpatialOrbit(orbit, timeSecs);
  return { pose: { space: sample.space, position: sample.position, orientation: sample.aim.orientation },
    caption: timeSecs < 10 ? 'Changing viewpoint reveals depth in the cluster.' : 'The camera moves; the catalogue positions stay fixed.' };
} };

async function main() {
  const browser = await createSkykitBrowser({ host: '#viewer', status: '#loading', mouseMode: 'look', autoDispose: false });
  const participant = createSkykitSequenceParticipant({ viewer: browser.viewer, navigation: browser.navigation });
  const player = createJourneySequencePlayer({ sequence, participant });
  const controls = mountSequenceControls({ root: document.querySelector('#controls'), player });
  const removePanel = await mountTouchPreview(browser,
    createSequenceTouchControls({ id: 'stellar-sequence', player }), player.subscribe,
    document.querySelector('#touch-controls'));
  const removeFrame = browser.viewer.addPart({ id: 'sequence-clock', priority: 1, update(frame) { player.update(frame.deltaSeconds); } });
  const caption = document.querySelector('#caption');
  caption.textContent = player.getSnapshot().frame.value.caption;
  const unsubscribe = player.subscribe(snapshot => { caption.textContent = snapshot.frame.value.caption; });
  const onVisibility = () => { if (document.hidden) player.pause(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', () => {
    document.removeEventListener('visibilitychange', onVisibility); unsubscribe(); removeFrame(); controls.destroy();
    void removePanel().finally(() => { player.dispose(); participant.dispose(); void browser.dispose(); });
  }, { once: true });
}
void main().catch(error => { document.querySelector('#loading').textContent = error.message; });
