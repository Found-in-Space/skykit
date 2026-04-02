/**
 * Builds SIMBAD sim-basic query URL from meta sidecar display fields.
 * Prefers HIP over Gaia when both are present.
 *
 * @param {{ hip?: string, gaia?: string } | null | undefined} fields
 * @returns {{ url: string, label: string } | null}
 */
export function buildSimbadBasicSearch(fields) {
  if (!fields || typeof fields !== 'object') {
    return null;
  }
  const hip = typeof fields.hip === 'string' ? fields.hip.trim() : '';
  const gaia = typeof fields.gaia === 'string' ? fields.gaia.trim() : '';

  if (hip) {
    const ident = `HIP ${hip}`;
    return {
      url: `https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=${encodeURIComponent(ident)}`,
      label: ident,
    };
  }
  if (gaia) {
    const ident = `Gaia DR3 ${gaia}`;
    return {
      url: `https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=${encodeURIComponent(ident)}`,
      label: ident,
    };
  }
  return null;
}
