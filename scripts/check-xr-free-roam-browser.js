import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.join(rootDir, 'apps/examples');
const server = await createServer({
  root: examplesDir,
  configFile: path.join(examplesDir, 'vite.config.js'),
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
  },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unable to resolve the xr-free-roam smoke-test server port.');
  }
  console.log(`xr-free-roam smoke server listening on 127.0.0.1:${address.port}`);

  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader'],
  });
  console.log('xr-free-roam smoke browser launched');
  for (const deviceScaleFactor of [1, 2]) {
    console.log(`xr-free-roam smoke checking DPR ${deviceScaleFactor}`);
    await verifyDeviceScaleFactor(browser, address.port, deviceScaleFactor);
  }
  console.log('xr-free-roam browser smoke passed at DPR 1 and DPR 2');
} finally {
  await browser?.close();
  await server.close();
}

async function verifyDeviceScaleFactor(activeBrowser, port, deviceScaleFactor) {
  const context = await activeBrowser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Non-local requests are intentionally aborted below to keep this fixture
    // deterministic. Chromium reports those injected failures as console
    // resource errors; application-authored console errors still fail.
    if (text.startsWith('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT')) return;
    consoleErrors.push(text);
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?\/)/, (route) => route.abort('blockedbyclient'));

  try {
    await page.goto(`http://127.0.0.1:${port}/xr-free-roam/?skykit-test=1`, {
      waitUntil: 'domcontentloaded',
    });
    try {
      await page.waitForFunction(() => (
        document.documentElement.dataset.xrFreeRoamTestReady === 'true'
        && globalThis.__SKYKIT_XR_FREE_ROAM_TEST__?.ready === true
      ), null, { timeout: 30_000 });
    } catch (error) {
      console.error(`xr-free-roam DPR ${deviceScaleFactor} page text:\n${await page.locator('body').innerText()}`);
      console.error(`xr-free-roam DPR ${deviceScaleFactor} page errors:`, pageErrors);
      console.error(`xr-free-roam DPR ${deviceScaleFactor} console errors:`, consoleErrors);
      throw error;
    }
    console.log(`xr-free-roam smoke ready at DPR ${deviceScaleFactor}`);

    const ids = await page.evaluate(() => globalThis.__SKYKIT_XR_FREE_ROAM_TEST__.appIds);
    const actions = await page.evaluate(() => globalThis.__SKYKIT_XR_FREE_ROAM_TEST__.actions);
    const initial = await snapshot(page);
    assert.equal(initial.devicePixelRatio, deviceScaleFactor);
    assert.ok(initial.canvas?.width >= 420, `DPR ${deviceScaleFactor}: panel canvas width`);
    assert.ok(initial.canvas?.height >= 560, `DPR ${deviceScaleFactor}: panel canvas height`);

    await call(page, 'openApp', ids.target);
    const selected = await call(page, 'selectSun');
    assert.equal(selected.selectedLabel, 'Sun');
    assert.equal(selected.actionCounts[actions.selectSun], 1);

    const flown = await call(page, 'flyToSelected');
    assert.equal(flown.actionCounts[actions.goSelected], 1);

    await call(page, 'openApp', ids.rendering);
    await call(page, 'openApp', ids.hrDiagram);
    const geometry = await page.evaluate(() => globalThis.__SKYKIT_XR_FREE_ROAM_TEST__.hrGeometry());
    assert.ok(geometry.viewport, `DPR ${deviceScaleFactor}: HR viewport is available`);
    const viewportAspect = geometry.viewport.width / geometry.viewport.height;
    assert.ok(
      Math.abs(viewportAspect - geometry.sourceAspectRatio) < 0.01,
      `DPR ${deviceScaleFactor}: HR viewport preserves its 1.6 source aspect`,
    );
    assert.ok(
      geometry.viewport.width < geometry.frame.width || geometry.viewport.height < geometry.frame.height,
      `DPR ${deviceScaleFactor}: HR viewport is letterboxed inside its frame`,
    );

    await call(page, 'openApp', ids.testInput);
    const holding = await call(page, 'startHold');
    assert.equal(holding.holdPressed, true);
    const cleared = await call(page, 'simulateTrackingLoss');
    assert.equal(cleared.holdPressed, false);
    const holdEvents = cleared.actionEvents.filter((event) => event.id === actions.testHold);
    assert.deepEqual(holdEvents.map((event) => event.type), ['action/press', 'action/release']);
    assert.equal(holdEvents[0].source, holdEvents[1].source);

    await call(page, 'setPanelVisible', false);
    const shown = await call(page, 'setPanelVisible', true);
    assert.equal(shown.panelVisible, true);

    await call(page, 'openApp', ids.hrDiagram);
    await call(page, 'openApp', ids.target);
    await call(page, 'openApp', ids.hrDiagram);
    assert.deepEqual(pageErrors, [], `DPR ${deviceScaleFactor}: no page errors`);
    assert.deepEqual(consoleErrors, [], `DPR ${deviceScaleFactor}: no console errors`);
  } finally {
    await context.close();
  }
}

function call(page, method, argument) {
  return page.evaluate(
    async ({ method: methodName, argument: value }) => (
      globalThis.__SKYKIT_XR_FREE_ROAM_TEST__[methodName](value)
    ),
    { method, argument },
  );
}

function snapshot(page) {
  return page.evaluate(() => globalThis.__SKYKIT_XR_FREE_ROAM_TEST__.snapshot());
}
