import {
  apparentMagnitude,
  createStarCellKey,
  decodeTemperatureK,
} from '@found-in-space/star-trees';
import {
  parseDeclination,
  parseRightAscension,
  raDecToIcrsDirection,
} from '@found-in-space/spatial';

const SIMBAD_SIM_ID_BASE = 'https://simbad.cds.unistra.fr/simbad/sim-id';
const URL_ICRS_DECIMALS = 6;

export function parseStarRefBookmark(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 4) return null;
  const ordinalText = decodeURIComponent(parts.at(-1));
  const mortonCode = decodeURIComponent(parts.at(-2));
  const levelText = decodeURIComponent(parts.at(-3));
  const datasetId = decodeURIComponent(parts.slice(0, -3).join(':'));
  const level = Number(levelText);
  const ordinal = Number(ordinalText);
  if (!datasetId || !Number.isInteger(level) || level < 0 || !/^\d+$/.test(mortonCode) || !Number.isInteger(ordinal) || ordinal < 0) {
    return null;
  }
  return { datasetId, level, mortonCode: String(BigInt(mortonCode)), ordinal };
}

export function serializeStarRefBookmark(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const datasetId = String(ref.datasetId ?? '').trim();
  const level = Number(ref.level);
  const ordinal = Number(ref.ordinal);
  let mortonCode = '';
  try {
    mortonCode = BigInt(String(ref.mortonCode)).toString(10);
  } catch {
    return null;
  }
  if (!datasetId || !Number.isInteger(level) || level < 0 || !Number.isInteger(ordinal) || ordinal < 0 || BigInt(mortonCode) < 0n) {
    return null;
  }
  return [
    encodeURIComponent(datasetId),
    String(level),
    mortonCode,
    String(ordinal),
  ].join(':');
}

export function parseIcrsCoordinatesFromSearchParams(searchParams) {
  const packed = searchParams.get('icrs');
  if (packed) {
    const parts = packed.split(',').map((part) => parseFiniteNumber(part.trim()));
    if (parts.length === 3 && parts.every((value) => value != null)) {
      return { x: parts[0], y: parts[1], z: parts[2] };
    }
  }

  const x = parseFiniteNumber(searchParams.get('x'));
  const y = parseFiniteNumber(searchParams.get('y'));
  const z = parseFiniteNumber(searchParams.get('z'));
  if (x != null && y != null && z != null) {
    return { x, y, z };
  }

  return null;
}

export function readSelectionMarkerFromUrl(urlValue, baseUrl = globalThis.location?.href ?? 'https://example.test/') {
  const url = new URL(urlValue, baseUrl);
  const bookmarkId = url.searchParams.get('star')?.trim();
  if (bookmarkId) {
    const ref = parseStarRefBookmark(bookmarkId);
    return ref ? { kind: 'bookmark', bookmarkId: serializeStarRefBookmark(ref), ref } : null;
  }
  const icrsPc = parseIcrsCoordinatesFromSearchParams(url.searchParams);
  return icrsPc ? { kind: 'icrs', icrsPc } : null;
}

export function writeSelectionMarkerToUrl(marker, urlValue, baseUrl = globalThis.location?.href ?? 'https://example.test/') {
  const url = new URL(urlValue, baseUrl);
  url.searchParams.delete('star');
  url.searchParams.delete('icrs');
  url.searchParams.delete('x');
  url.searchParams.delete('y');
  url.searchParams.delete('z');

  if (marker?.kind === 'bookmark') {
    const bookmarkId = marker.bookmarkId ?? serializeStarRefBookmark(marker.ref);
    if (bookmarkId) url.searchParams.set('star', bookmarkId);
  } else if (marker?.kind === 'icrs' && marker.icrsPc) {
    url.searchParams.set('icrs', [
      formatUrlCoordinate(marker.icrsPc.x),
      formatUrlCoordinate(marker.icrsPc.y),
      formatUrlCoordinate(marker.icrsPc.z),
    ].join(','));
  }
  return url.toString();
}

export function icrsTargetFromRaDecDistance(raInput, decInput, distanceInput) {
  const parsedRa = parseRightAscension(raInput, { unit: 'auto' });
  const decDeg = parseDeclination(decInput);
  const distancePc = Number(distanceInput);
  if (!parsedRa) throw new TypeError('RA must be decimal hours, decimal degrees, or sexagesimal.');
  if (!Number.isFinite(decDeg)) throw new TypeError('Dec must be decimal degrees or sexagesimal.');
  if (!Number.isFinite(distancePc) || distancePc < 0) {
    throw new RangeError('Distance must be a finite number >= 0 parsecs.');
  }
  const raDeg = 'raDeg' in parsedRa ? parsedRa.raDeg : parsedRa.raHours * 15;
  const direction = raDecToIcrsDirection({ raDeg, decDeg });
  if (!direction) throw new TypeError('RA/Dec could not be resolved.');
  return {
    targetPc: {
      x: direction.x * distancePc,
      y: direction.y * distancePc,
      z: direction.z * distancePc,
    },
    raDeg,
    decDeg,
    distancePc,
  };
}

export function approachTargetFromObserver(targetPc, observerPc, distancePc) {
  const dx = targetPc.x - observerPc.x;
  const dy = targetPc.y - observerPc.y;
  const dz = targetPc.z - observerPc.z;
  const len = Math.hypot(dx, dy, dz);
  if (!(len > distancePc)) {
    return { ...observerPc };
  }
  const factor = distancePc / len;
  return {
    x: targetPc.x - dx * factor,
    y: targetPc.y - dy * factor,
    z: targetPc.z - dz * factor,
  };
}

export function buildSimbadBasicSearch(fields) {
  const hip = trimField(fields?.hip);
  const gaia = trimField(fields?.gaia);
  if (hip) {
    const ident = `HIP ${hip}`;
    return { url: buildSimIdUrl(ident), label: ident };
  }
  if (gaia) {
    const ident = `Gaia DR3 ${gaia}`;
    return { url: buildSimIdUrl(ident), label: ident };
  }
  return null;
}

export function resolveSkycultureCommonName(commonName, fallback = 'Constellation') {
  const source = commonName && typeof commonName === 'object' ? commonName : null;
  const native = trimField(source?.native);
  if (native) return native;
  const english = trimField(source?.english);
  if (english) return english;
  return trimField(fallback) || 'Constellation';
}

export function createSelectionResultFromCell(cell, objectIndex, view) {
  if (!cell || !Number.isInteger(objectIndex) || objectIndex < 0 || objectIndex >= cell.count) return null;
  const positionIndex = objectIndex * 3;
  const position = {
    x: cell.coordinates.components[positionIndex],
    y: cell.coordinates.components[positionIndex + 1],
    z: cell.coordinates.components[positionIndex + 2],
  };
  const coordinateUnitsPerParsec = Number(view.coordinateUnitsPerParsec) || 1;
  const targetPc = {
    x: position.x / coordinateUnitsPerParsec,
    y: position.y / coordinateUnitsPerParsec,
    z: position.z / coordinateUnitsPerParsec,
  };
  const observerPc = view.observerPc ?? { x: 0, y: 0, z: 0 };
  const distancePc = Math.hypot(targetPc.x - observerPc.x, targetPc.y - observerPc.y, targetPc.z - observerPc.z);
  const absoluteMagnitude = Number(cell.attributes.magAbs?.[objectIndex]);
  const apparent = Number.isFinite(absoluteMagnitude)
    ? apparentMagnitude({ magAbs: absoluteMagnitude, distancePc })
    : null;
  const teffLog8 = cell.attributes.teffLog8?.[objectIndex];
  return {
    source: 'bookmark',
    cellKey: cell.cellKey,
    objectIndex,
    position,
    targetPc,
    distancePc,
    apparentMagnitude: apparent,
    magAbs: Number.isFinite(absoluteMagnitude) ? absoluteMagnitude : null,
    teffLog8: Number.isFinite(Number(teffLog8)) ? Number(teffLog8) : null,
    temperatureK: Number.isFinite(Number(teffLog8)) ? decodeTemperatureK(Number(teffLog8)) : null,
    visualRadiusPx: null,
    score: null,
    angularDistanceDeg: null,
    objectRef: cell.refs?.[objectIndex] ?? null,
    pickMeta: cell.pickMeta?.[objectIndex] ?? null,
  };
}

export function findSelectionResultInCells(cells, ref, view) {
  if (!ref) return null;
  const cellKey = createStarCellKey(ref);
  for (const cell of cells) {
    if (cell.cellKey !== cellKey) continue;
    return createSelectionResultFromCell(cell, ref.ordinal, view);
  }
  return null;
}

function parseFiniteNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUrlCoordinate(value, decimals = URL_ICRS_DECIMALS) {
  return Number.isFinite(value)
    ? Number(value).toFixed(decimals).replace(/\.?0+$/, '')
    : '';
}

function trimField(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildSimIdUrl(ident) {
  const params = new URLSearchParams();
  params.set('Ident', ident);
  params.set('NbIdent', '1');
  params.set('Radius', '2');
  params.set('Radius.unit', 'arcmin');
  params.set('submit', 'submit id');
  return `${SIMBAD_SIM_ID_BASE}?${params.toString()}`;
}
