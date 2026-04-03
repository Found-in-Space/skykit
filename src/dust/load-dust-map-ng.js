import * as THREE from 'three';

/** Matches `build.py` / dust_map_ng.bin: 48-byte little-endian header + uint8 voxels. */
export const DUST_MAP_NG_HEADER_BYTES = 48;

/**
 * Fetch and parse dust_map_ng.bin (Rezaei Kh. et al. 2024 pipeline).
 *
 * @param {string} url
 * @returns {Promise<{
 *   u8: Uint8Array,
 *   nx: number, ny: number, nz: number,
 *   maxDensity: number,
 *   minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number,
 *   cellCount: number,
 * }>}
 */
export async function loadDustMapNg(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  if (buf.byteLength >= 1 && new Uint8Array(buf)[0] === 0x3c) {
    throw new Error(
      `Response for ${url} looks like HTML (starts with '<'), not dust_map_ng.bin`,
    );
  }
  if (buf.byteLength < DUST_MAP_NG_HEADER_BYTES) {
    throw new Error(
      `File too small for dust_map_ng.bin header (${buf.byteLength} < ${DUST_MAP_NG_HEADER_BYTES})`,
    );
  }
  const dv = new DataView(buf);
  const nx = dv.getUint32(0, true);
  const ny = dv.getUint32(4, true);
  const nz = dv.getUint32(8, true);
  const maxDensity = dv.getFloat32(12, true);
  const minX = dv.getFloat32(16, true);
  const maxX = dv.getFloat32(20, true);
  const minY = dv.getFloat32(24, true);
  const maxY = dv.getFloat32(28, true);
  const minZ = dv.getFloat32(32, true);
  const maxZ = dv.getFloat32(36, true);
  const voxelCount = nx * ny * nz;
  const expectedSize = DUST_MAP_NG_HEADER_BYTES + voxelCount;
  if (buf.byteLength !== expectedSize) {
    throw new Error(
      `Unexpected dust_map_ng.bin size: ${buf.byteLength} bytes (expected ${expectedSize} = header + ${nx}×${ny}×${nz} voxels)`,
    );
  }
  const u8 = new Uint8Array(buf, DUST_MAP_NG_HEADER_BYTES, voxelCount);
  return {
    u8,
    nx,
    ny,
    nz,
    maxDensity,
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    cellCount: voxelCount,
  };
}

/**
 * @param {Awaited<ReturnType<typeof loadDustMapNg>>} map
 * @returns {THREE.Data3DTexture}
 */
export function createDustMapNgData3DTexture(map) {
  const tex = new THREE.Data3DTexture(map.u8, map.nx, map.ny, map.nz);
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

/**
 * Parsed map plus a GPU 3D texture for volume rendering (e.g. dust-roam).
 *
 * @param {string} url
 */
export async function loadDustMapNgVolume(url) {
  const map = await loadDustMapNg(url);
  return {
    ...map,
    texture: createDustMapNgData3DTexture(map),
    frame: 'galactic',
    format: 'dust_map_ng',
    sourceUrl: url,
  };
}
