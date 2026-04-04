/**
 * Builds a SIMBAD CDS sim-id query URL from meta sidecar display fields.
 * Uses HIP when present, otherwise Gaia DR3 — our primary cross-match keys.
 * HD and other designations are ignored for the link (less reliable for SIMBAD lookup).
 *
 * @param {{ hip?: string, gaia?: string } | null | undefined} fields
 * @returns {{ url: string, label: string } | null}
 */
const SIMBAD_SIM_ID_BASE = 'https://simbad.cds.unistra.fr/simbad/sim-id';

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

export function buildSimbadBasicSearch(fields) {
  if (!fields || typeof fields !== 'object') {
    return null;
  }
  const hip = trimField(fields.hip);
  const gaia = trimField(fields.gaia);

  if (hip) {
    const ident = `HIP ${hip}`;
    return {
      url: buildSimIdUrl(ident),
      label: ident,
    };
  }
  if (gaia) {
    const ident = `Gaia DR3 ${gaia}`;
    return {
      url: buildSimIdUrl(ident),
      label: ident,
    };
  }
  return null;
}
