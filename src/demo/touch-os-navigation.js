import {
  createButton,
  createDPad,
  createDockLayout,
  createHoldButton,
  createSection,
} from '@found-in-space/touch-os';

export function createNavigationTouchOsRoot(options = {}) {
  const {
    id = 'navigation-hud',
    title = 'SkyKit',
    overviewChildren = [],
    statusChildren = [],
    actionChildren = [],
  } = options;

  return createDockLayout(id, {
    padding: 0,
    topLeft: {
      maxWidth: 340,
      child: createSection(`${id}-overview`, {
        title,
        backgroundColor: '#0f1b2d',
        children: overviewChildren,
      }),
    },
    topRight: {
      maxWidth: 260,
      child: createSection(`${id}-actions`, {
        title: 'Actions',
        backgroundColor: '#0f1b2d',
        children: actionChildren,
      }),
    },
    bottomLeft: {
      maxWidth: 240,
      child: createSection(`${id}-move`, {
        title: 'Move',
        backgroundColor: '#0f1b2d',
        children: [
          createDPad(`${id}-move-dpad`, {
            up: createMovementAction('KeyW', 'Fwd'),
            down: createMovementAction('KeyS', 'Back'),
            left: createMovementAction('KeyA', 'Left'),
            right: createMovementAction('KeyD', 'Right'),
          }),
        ],
      }),
    },
    bottomRight: {
      maxWidth: 240,
      child: createSection(`${id}-status`, {
        title: 'Status',
        backgroundColor: '#0f1b2d',
        children: [
          createHoldButton(`${id}-move-up`, {
            label: 'Up',
            actionId: 'movement.key',
            startPayload: { code: 'KeyQ', active: true },
            stopPayload: { code: 'KeyQ', active: false },
          }),
          createHoldButton(`${id}-move-down`, {
            label: 'Down',
            actionId: 'movement.key',
            startPayload: { code: 'KeyE', active: true },
            stopPayload: { code: 'KeyE', active: false },
          }),
          ...statusChildren,
        ],
      }),
    },
  });
}

export function createTouchOsFullscreenButton(id, options = {}) {
  return createButton(id, {
    label: options.label ?? 'Fullscreen',
    actionId: 'viewer.fullscreen',
  });
}

export function handleNavigationTouchOsOutput(output, options = {}) {
  if (output?.type !== 'action') {
    return false;
  }

  const { cameraController, fullscreenTarget } = options;
  const payload = output.payload ?? {};

  if (output.actionId === 'movement.key') {
    const code = payload.code;
    if (typeof code !== 'string' || !cameraController) {
      return true;
    }

    if (payload.active === false) {
      cameraController.simulateKeyUp(code);
    } else {
      cameraController.simulateKeyDown(code);
    }
    return true;
  }

  if (output.actionId === 'viewer.fullscreen') {
    const mount = fullscreenTarget ?? null;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      mount?.requestFullscreen?.();
    }
    return true;
  }

  return false;
}

function createMovementAction(code, label) {
  return {
    label,
    actionId: 'movement.key',
    startPayload: { code, active: true },
    stopPayload: { code, active: false },
  };
}
