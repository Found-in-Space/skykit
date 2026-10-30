import { createThreeUIEnvironment } from '@found-in-space/touch-os/hosts/three';
import { createSkykitInteractionPlugin } from '@found-in-space/skykit/interaction';

/** The same TouchOS content can be mounted on a canvas or a spatial host panel. */
export async function mountTouchPreview(browser, controls, subscribe, canvas) {
  const environment = createThreeUIEnvironment({ parent: browser.viewer.scene });
  let unsubscribe = () => {};
  try {
    const panel = environment.mountPanel({ id: 'journey-touch-preview', canvas,
      content: controls.render, surface: { width: 480, height: 640 },
      bind: output => { controls.handleOutput(output); } });
    unsubscribe = subscribe(() => panel.setContent(controls.render()));
    const remove = await browser.install(createSkykitInteractionPlugin({ id: 'journey-touch-preview', environment }));
    return async () => { unsubscribe(); await remove(); environment.dispose(); };
  } catch (error) { unsubscribe(); environment.dispose(); throw error; }
}
