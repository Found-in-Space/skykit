let workerJobCounter = 0;

async function gunzipWithDecompressionStream(compressed) {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(new Uint8Array(compressed));
  await writer.close();

  const reader = stream.readable.getReader();
  const chunks = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

let nodeGunzipSync = null;

async function getNodeGunzipSync() {
  if (nodeGunzipSync) return nodeGunzipSync;
  const zlib = await import('node:zlib');
  nodeGunzipSync = zlib.gunzipSync;
  return nodeGunzipSync;
}

async function decodeGzip(compressed) {
  if (typeof DecompressionStream === 'function') {
    return gunzipWithDecompressionStream(compressed);
  }
  const gunzipSync = await getNodeGunzipSync();
  const decoded = gunzipSync(new Uint8Array(compressed));
  return decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
}

self.addEventListener('message', async (event) => {
  const message = event.data ?? {};
  if (message.type !== 'decode') return;

  const jobId = message.id ?? ++workerJobCounter;
  try {
    const decoded = await decodeGzip(message.buffer);
    self.postMessage({
      type: 'decoded',
      id: jobId,
      buffer: decoded.buffer,
    }, [decoded.buffer]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
