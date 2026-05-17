// @ts-nocheck
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildJourneyVideoFfmpegArgs,
  createJourneyVideoOverlayBlocks,
  createJourneyVideoRenderMetadata,
  normalizeJourneyVideoLayout,
  normalizeJourneyVideoRenderProfile,
} from './export.js';

const HOST = '127.0.0.1';
const PORT = 4337;
const SERVER_READY_TIMEOUT_MS = 90_000;
const PAGE_READY_TIMEOUT_MS = 180_000;
const RENDER_PAGE_PATH = '/packages/journey-video/examples/render/index.html';
const BROWSER_IDS = new Set(['webkit', 'chromium', 'firefox']);

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(packageRoot, '../..');

/**
 * @param {string[]} rawArgs
 */
export function normalizeJourneyVideoCliOptions(rawArgs = process.argv.slice(2)) {
  const parsed = {
    mode: 'preview',
    layout: null,
    fps: null,
    seconds: null,
    frames: null,
    browser: null,
    crf: null,
    journeyPath: null,
    outputDir: null,
    pageUrl: null,
    retainFrames: null,
    serverCwd: null,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg?.startsWith('--')) {
      throw new Error(`Unexpected positional argument "${arg}".`);
    }
    const [name, inlineValue] = arg.slice(2).split('=');
    if (name === 'discard-frames') {
      parsed.retainFrames = false;
      continue;
    }
    const flagValue = inlineValue ?? rawArgs[index + 1];
    if (inlineValue == null) {
      if (flagValue == null || String(flagValue).startsWith('--')) {
        throw new Error(`Option --${name} requires a value.`);
      }
      index += 1;
    }
    const value = flagValue;
    if (name === 'mode') parsed.mode = value;
    else if (name === 'layout') parsed.layout = value;
    else if (name === 'fps') parsed.fps = positiveNumber(value, '--fps');
    else if (name === 'seconds') parsed.seconds = positiveNumber(value, '--seconds');
    else if (name === 'frames') parsed.frames = positiveInteger(value, '--frames');
    else if (name === 'browser') {
      if (!BROWSER_IDS.has(String(value))) throw new Error(`Invalid --browser "${value}".`);
      parsed.browser = value;
    } else if (name === 'crf') parsed.crf = positiveNumber(value, '--crf');
    else if (name === 'journey') parsed.journeyPath = value;
    else if (name === 'output-dir') parsed.outputDir = value;
    else if (name === 'page-url') parsed.pageUrl = value;
    else if (name === 'server-cwd') parsed.serverCwd = value;
    else if (name === 'retain-frames') parsed.retainFrames = value !== '0' && value !== 'false';
    else throw new Error(`Unknown option --${name}`);
  }
  const profile = normalizeJourneyVideoRenderProfile({
    mode: parsed.mode,
    ...(parsed.layout ? { layout: parsed.layout } : {}),
    ...(parsed.fps ? { fps: parsed.fps } : {}),
    ...(parsed.seconds ? { seconds: parsed.seconds } : {}),
    ...(parsed.frames ? { frameCount: parsed.frames } : {}),
    ...(parsed.browser ? { browser: parsed.browser } : {}),
    ...(parsed.crf != null ? { crf: parsed.crf } : {}),
    ...(parsed.retainFrames != null ? { retainFrames: parsed.retainFrames } : {}),
  });
  const journeyPath = parsed.journeyPath
    ? path.resolve(process.cwd(), parsed.journeyPath)
    : path.resolve(packageRoot, 'examples/radio-bubble/radio-bubble-journey.json');
  const outputDir = path.resolve(
    process.cwd(),
    parsed.outputDir ?? path.join('video-output', 'journey-video', `${profile.mode}-${profile.layout.id}-${profile.fps}fps`),
  );
  return {
    profile,
    journeyPath,
    outputDir,
    pageUrl: parsed.pageUrl,
    serverCwd: parsed.serverCwd ? path.resolve(process.cwd(), parsed.serverCwd) : workspaceRoot,
  };
}

/** @param {import('./export-node.d.ts').RunJourneyVideoExportOptions} options */
export async function runJourneyVideoExport(options = {}) {
  const profile = normalizeJourneyVideoRenderProfile(options.profile ?? {});
  const journeyPath = path.resolve(process.cwd(), options.journeyPath ?? path.join(packageRoot, 'examples/radio-bubble/radio-bubble-journey.json'));
  const outputDir = path.resolve(process.cwd(), options.outputDir ?? path.join('video-output', 'journey-video', `${profile.mode}-${profile.layout.id}-${profile.fps}fps`));
  const framesDir = path.join(outputDir, 'frames', 'sky');
  const overlaysDir = path.join(outputDir, 'overlays');
  const videoPath = path.join(outputDir, options.videoFilename ?? `journey-video-${profile.layout.id}-${profile.mode}.mp4`);
  const pageUrl = options.pageUrl ?? `http://${HOST}:${PORT}${RENDER_PAGE_PATH}`;
  const journey = JSON.parse(await readFile(journeyPath, 'utf8'));
  const overlayBlocks = createJourneyVideoOverlayBlocks(journey);
  const server = options.pageUrl ? null : startViteServer(options.serverCwd ?? workspaceRoot);
  let browser = null;
  try {
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });
    await mkdir(overlaysDir, { recursive: true });
    if (server) await waitForServer(pageUrl, server);

    const playwright = await loadPlaywright(profile.browser);
    browser = await playwright[profile.browser].launch({
      headless: true,
      ...(profile.browser === 'chromium' ? { args: ['--disable-dev-shm-usage'] } : {}),
    });
    const page = await browser.newPage({
      viewport: { width: profile.layout.width, height: profile.layout.height },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(PAGE_READY_TIMEOUT_MS);
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__journeyVideoExport), null, { timeout: PAGE_READY_TIMEOUT_MS });
    await page.evaluate((input) => window.__journeyVideoExport.configure(input), {
      journey,
      profile,
      preserveDrawingBuffer: true,
    });
    await page.waitForFunction(() => window.__journeyVideoExport.getStatus().readyState !== 'loading', null, { timeout: PAGE_READY_TIMEOUT_MS });
    const status = await page.evaluate(() => window.__journeyVideoExport.getStatus());
    if (status.readyState !== 'ready') {
      throw new Error(`Journey video render page failed: ${status.error ?? 'unknown error'}`);
    }

    const overlayAssets = [];
    for (let index = 0; index < overlayBlocks.length; index += 1) {
      const block = overlayBlocks[index];
      const result = await page.evaluate((entry) => window.__journeyVideoExport.renderOverlayBlock(entry), block);
      const assetPath = path.join(overlaysDir, `${String(index + 1).padStart(3, '0')}-${safeName(block.id)}.png`);
      await writeDataUrl(result.dataUrl, assetPath);
      overlayAssets.push({ ...block, assetPath });
    }

    const frameEntries = [];
    for (let frameIndex = 1; frameIndex <= profile.frameCount; frameIndex += 1) {
      const timeSecs = (frameIndex - 1) / profile.fps;
      const startedAt = performance.now();
      const result = await page.evaluate(
        (input) => window.__journeyVideoExport.captureSkyFrame(input),
        { frameIndex, timeSecs },
      );
      const framePath = path.join(framesDir, `frame-${String(frameIndex).padStart(6, '0')}.png`);
      await writeDataUrl(result.dataUrl, framePath);
      frameEntries.push({
        frameIndex,
        timeSecs,
        wallMs: Math.round((performance.now() - startedAt) * 10) / 10,
        stats: result.stats,
        artifact: {
          width: result.width,
          height: result.height,
          type: result.type,
          size: result.size,
        },
      });
    }

    const ffmpegArgs = buildJourneyVideoFfmpegArgs({
      profile,
      skyFramePattern: path.join(framesDir, 'frame-%06d.png'),
      overlayBlocks: overlayAssets,
      outputPath: videoPath,
    });
    await runChecked('ffmpeg', ffmpegArgs, { cwd: process.cwd() });
    const videoInfo = await stat(videoPath);
    const canvasInfo = await page.evaluate(() => window.__journeyVideoExport.getCanvasInfo());
    const finalStatus = await page.evaluate(() => window.__journeyVideoExport.getStatus());
    const metadata = createJourneyVideoRenderMetadata({
      journey: {
        path: path.relative(process.cwd(), journeyPath),
        format: journey.format,
        id: journey.id ?? null,
        title: journey.title ?? null,
      },
      profile,
      pageUrl,
      output: {
        outputDir: path.relative(process.cwd(), outputDir),
        videoPath: path.relative(process.cwd(), videoPath),
        videoSizeBytes: videoInfo.size,
        framesDir: path.relative(process.cwd(), framesDir),
        overlaysDir: path.relative(process.cwd(), overlaysDir),
      },
      overlayBlocks: overlayAssets.map((block) => ({
        ...block,
        assetPath: path.relative(process.cwd(), block.assetPath),
      })),
      frameCount: frameEntries.length,
      frames: frameEntries,
      canvasInfo,
      status: finalStatus,
      ffmpeg: { args: ffmpegArgs },
    });
    const metadataPath = path.join(outputDir, 'render-metadata.json');
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    if (profile.retainFrames === false) {
      await rm(path.join(outputDir, 'frames'), { recursive: true, force: true });
    }
    await page.evaluate(() => window.__journeyVideoExport.dispose());
    await browser.close();
    browser = null;
    return {
      outputDir,
      videoPath,
      metadataPath,
      metadata,
    };
  } finally {
    if (browser) await browser.close().catch(() => null);
    if (server) await stopProcess(server.child);
  }
}

/** @param {string[]} [rawArgs] */
export async function runJourneyVideoCli(rawArgs = process.argv.slice(2)) {
  const options = normalizeJourneyVideoCliOptions(rawArgs);
  const result = await runJourneyVideoExport(options);
  console.log(`[journey-video] wrote ${path.relative(process.cwd(), result.videoPath)}`);
  console.log(`[journey-video] wrote ${path.relative(process.cwd(), result.metadataPath)}`);
  return result;
}

/** @param {string} browserId */
async function loadPlaywright(browserId) {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(
      `Playwright is required for journey video export but is optional for editor usage. Install it explicitly with npm install -D playwright@1.60.0, then install browsers with npm run video:install-browsers --workspace @found-in-space/journey-video or npx playwright install ${browserId}.\n\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** @param {string} cwd */
function startViteServer(cwd) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const log = [];
  const child = spawn(npmCommand, ['run', 'dev', '--', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => appendLog(log, chunk));
  child.stderr.on('data', (chunk) => appendLog(log, chunk));
  return { child, log };
}

async function waitForServer(pageUrl, server) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    if (server.child.exitCode != null) {
      throw createProcessError('vite dev', [], server.child.exitCode, server.log);
    }
    try {
      const response = await fetch(pageUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${pageUrl}. Last error: ${lastError?.message ?? 'unknown'}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit').catch(() => null),
    sleep(5_000).then(() => {
      if (child.exitCode == null) child.kill('SIGKILL');
    }),
  ]);
}

/** @param {string} command @param {string[]} args @param {object} [options] */
async function runChecked(command, args, options = {}) {
  const log = [];
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    ...options,
  });
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    appendLog(log, chunk);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    appendLog(log, chunk);
  });
  const [code] = await Promise.race([
    once(child, 'exit'),
    once(child, 'error').then(([error]) => {
      if (error?.code === 'ENOENT') {
        throw new Error(`${command} was not found on PATH. Install ffmpeg and try again.`);
      }
      throw error;
    }),
  ]);
  if (code !== 0) {
    throw createProcessError(command, args, code, log);
  }
}

/** @param {string[]} log @param {Buffer | string} chunk */
function appendLog(log, chunk) {
  for (const line of chunk.toString().split(/\r?\n/u)) {
    if (line.trim()) log.push(line);
  }
  while (log.length > 80) log.shift();
}

function createProcessError(command, args, code, log) {
  const tail = log.length ? `\n\nLast process output:\n${log.join('\n')}` : '';
  return new Error(`${command} ${args.join(' ')} exited with code ${code}.${tail}`);
}

async function writeDataUrl(dataUrl, outputPath) {
  const [, base64 = ''] = String(dataUrl).split(',');
  await writeFile(outputPath, Buffer.from(base64, 'base64'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** @param {unknown} value @param {string} label */
function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid ${label} "${value}".`);
  return number;
}

/** @param {unknown} value @param {string} label */
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid ${label} "${value}".`);
  return number;
}

/** @param {string} value */
function safeName(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]+/gu, '-').replace(/^-|-$/gu, '') || 'overlay';
}
