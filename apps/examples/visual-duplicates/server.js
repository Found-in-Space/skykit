import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer as createViteServer } from 'vite';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const host = args.host ?? process.env.FIS_VIEWER_HOST ?? '0.0.0.0';
const port = parsePort(args.port ?? process.env.FIS_VIEWER_PORT ?? '4173');
const dataDirInput = args['data-dir'] ?? process.env.FIS_OCTREE_DATA_DIR;
if (!dataDirInput) {
  throw new Error('Provide --data-dir or set FIS_OCTREE_DATA_DIR.');
}
const dataDir = path.resolve(dataDirInput);

const dataFiles = new Map([
  ['/data/stars-v2.octree', fileDescriptor('stars-v2.octree', 'application/octet-stream')],
  [
    '/data/stars-v2.visual-duplicates.octree',
    fileDescriptor('stars-v2.visual-duplicates.octree', 'application/octet-stream'),
  ],
  [
    '/data/stars-v2.visual-duplicates.report.json',
    fileDescriptor('stars-v2.visual-duplicates.report.json', 'application/json; charset=utf-8'),
  ],
]);

await validateDataFiles();

const vite = await createViteServer({
  root: APP_DIR,
  publicDir: path.resolve(APP_DIR, '../../../public'),
  appType: 'spa',
  server: {
    allowedHosts: true,
    hmr: false,
    middlewareMode: true,
  },
});

const server = createHttpServer((request, response) => {
  void route(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    response.end('Internal server error\n');
  });
});

server.listen(port, host, () => {
  console.log(`Visual duplicates viewer: http://localhost:${port}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(
    `Tunnel command: kgrok connect octree-duplicates.dev.k-si.com ${port}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void shutdown();
  });
}

async function route(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(`${JSON.stringify({ ok: true, files: statusFiles() })}\n`);
    return;
  }

  const descriptor = dataFiles.get(url.pathname);
  if (descriptor) {
    await serveFile(request, response, descriptor);
    return;
  }

  vite.middlewares(request, response, (error) => {
    if (error) {
      vite.ssrFixStacktrace(error);
      console.error(error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      response.end('Vite middleware error\n');
    }
  });
}

async function serveFile(request, response, descriptor) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const range = parseRange(request.headers.range, descriptor.size);
  if (range === null && request.headers.range) {
    response.writeHead(416, {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${descriptor.size}`,
    });
    response.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? descriptor.size - 1;
  const status = range ? 206 : 200;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'Content-Length': String(end - start + 1),
    'Content-Type': descriptor.contentType,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${descriptor.size}` } : {}),
  };
  response.writeHead(status, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(descriptor.path, { start, end });
  stream.on('error', (error) => response.destroy(error));
  stream.pipe(response);
}

function parseRange(value, size) {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function fileDescriptor(fileName, contentType) {
  return {
    contentType,
    fileName,
    path: path.join(dataDir, fileName),
    size: 0,
  };
}

async function validateDataFiles() {
  for (const descriptor of dataFiles.values()) {
    const info = await stat(descriptor.path);
    if (!info.isFile()) {
      throw new Error(`Required data artifact is not a file: ${descriptor.path}`);
    }
    descriptor.size = info.size;
  }
}

function statusFiles() {
  return Object.fromEntries(
    [...dataFiles.entries()].map(([routePath, descriptor]) => [
      routePath,
      { fileName: descriptor.fileName, size: descriptor.size },
    ]),
  );
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const [name, inline] = value.slice(2).split('=', 2);
    const next = inline ?? values[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${name}`);
    }
    result[name] = next;
    if (inline === undefined) index += 1;
  }
  return result;
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}

async function shutdown() {
  await vite.close();
  server.close(() => process.exit(0));
}
