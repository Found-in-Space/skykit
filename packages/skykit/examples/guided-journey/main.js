import { createSkykitBrowser } from '@found-in-space/skykit/browser';
import { createSkykitJourneyDriver } from '@found-in-space/skykit/journey';
import { createGuidedJourneyController } from '@found-in-space/guided-journey';
import { mountJourneyControls } from '@found-in-space/guided-journey/dom';
import { stellarJourney as definition } from './chapters.js';

async function main() {
  const browser = await createSkykitBrowser({ host: '#viewer', status: '#loading', mouseMode: 'look', autoDispose: false,
    lookAt: { targetPc: { x: 17.574, y: 42.316, z: 13.963 } } });
  const driver = createSkykitJourneyDriver({ viewer: browser.viewer, navigation: browser.navigation });
  const journey = createGuidedJourneyController({ definition, driver });
  const controls = mountJourneyControls({ root: document.querySelector('#journey'), definition, journey });
  journey.start();

  window.addEventListener('pagehide', () => {
    controls.destroy();
    void journey.dispose().finally(() => { driver.dispose(); void browser.dispose(); });
  }, { once: true });
}

void main().catch(error => { document.querySelector('#loading').textContent = error.message; });
