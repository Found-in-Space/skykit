import * as THREE from 'three';

export const HA_PREVIEW_HEADER_BYTES = 48;
export const DEFAULT_MCCALLUM_HA_PREVIEW_URL = '/previews/mccallum2025/ha_preview_625pc_256.bin';
export const MCCALLUM_HA_LEVEL_URLS = Object.freeze({
  l0: '/previews/mccallum2025/levels/ha_l0_1024.bin',
  l1: '/previews/mccallum2025/levels/ha_l1_512.bin',
  l2: '/previews/mccallum2025/levels/ha_l2_256.bin',
  l3: '/previews/mccallum2025/levels/ha_l3_128.bin',
  l4: '/previews/mccallum2025/levels/ha_l4_64.bin',
  l5: '/previews/mccallum2025/levels/ha_l5_32.bin',
  l6: '/previews/mccallum2025/levels/ha_l6_16.bin',
});

export function resolveHaPreviewUrl(search = null) {
  const searchValue = typeof search === 'string'
    ? search
    : globalThis.location?.search ?? '';
  const params = new URLSearchParams(searchValue);
  const explicitUrl = params.get('haUrl')?.trim();
  if (explicitUrl) return explicitUrl;
  const level = params.get('haLevel')?.trim().toLowerCase();
  return MCCALLUM_HA_LEVEL_URLS[level] || DEFAULT_MCCALLUM_HA_PREVIEW_URL;
}

/**
 * Parse a dense uint8 H-alpha preview volume.
 *
 * Header layout matches pipeline-dust's 48-byte dense preview header:
 * uint32 nx, ny, nz; float32 scalarMax; float32 min/max XYZ; two reserved uint32.
 *
 * @param {ArrayBuffer} buf
 * @param {{ sourceUrl?: string }} options
 */
export function parseHaPreviewVolumeBuffer(buf, options = {}) {
  if (buf.byteLength >= 1 && new Uint8Array(buf)[0] === 0x3c) {
    throw new Error(
      `Response for ${options.sourceUrl ?? 'H-alpha preview'} looks like HTML (starts with '<'), not a dense preview volume`,
    );
  }
  if (buf.byteLength < HA_PREVIEW_HEADER_BYTES) {
    throw new Error(
      `File too small for H-alpha preview header (${buf.byteLength} < ${HA_PREVIEW_HEADER_BYTES})`,
    );
  }

  const dv = new DataView(buf);
  const nx = dv.getUint32(0, true);
  const ny = dv.getUint32(4, true);
  const nz = dv.getUint32(8, true);
  const scalarMax = dv.getFloat32(12, true);
  const minX = dv.getFloat32(16, true);
  const maxX = dv.getFloat32(20, true);
  const minY = dv.getFloat32(24, true);
  const maxY = dv.getFloat32(28, true);
  const minZ = dv.getFloat32(32, true);
  const maxZ = dv.getFloat32(36, true);
  const voxelCount = nx * ny * nz;
  const expectedSize = HA_PREVIEW_HEADER_BYTES + voxelCount;
  if (buf.byteLength !== expectedSize) {
    throw new Error(
      `Unexpected H-alpha preview size: ${buf.byteLength} bytes (expected ${expectedSize} = header + ${nx}x${ny}x${nz} voxels)`,
    );
  }

  return {
    u8: new Uint8Array(buf, HA_PREVIEW_HEADER_BYTES, voxelCount),
    nx,
    ny,
    nz,
    scalarMax,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    cellCount: voxelCount,
    frame: 'galactic',
    format: 'mccallum_ha_preview',
    sourceUrl: options.sourceUrl ?? null,
  };
}

export function createHaPreviewData3DTexture(volume) {
  const tex = new THREE.Data3DTexture(volume.u8, volume.nx, volume.ny, volume.nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export async function loadHaPreviewVolume(url = DEFAULT_MCCALLUM_HA_PREVIEW_URL) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const parsed = parseHaPreviewVolumeBuffer(await resp.arrayBuffer(), {
    sourceUrl: url,
  });
  return {
    ...parsed,
    texture: createHaPreviewData3DTexture(parsed),
  };
}
