const LY_PER_PC = 3.26156;
const SECS_PER_YEAR = 365.25 * 24 * 3600;
const C_IN_PC_PER_SEC = 1 / (LY_PER_PC * SECS_PER_YEAR);

export function formatSpeedPcPerSec(pcPerSec) {
  if (!Number.isFinite(pcPerSec) || pcPerSec < 1e-6) return 'stationary';
  const c = pcPerSec / C_IN_PC_PER_SEC;
  const pcLabel = pcPerSec < 10
    ? `${pcPerSec.toFixed(2)} pc/s`
    : `${pcPerSec.toFixed(1)} pc/s`;
  if (c < 1000) return `${pcLabel}  (${c.toFixed(0)}c)`;
  if (c < 1e6) return `${pcLabel}  (${(c / 1e3).toFixed(1)} kc)`;
  if (c < 1e9) return `${pcLabel}  (${(c / 1e6).toFixed(1)} Mc)`;
  return `${pcLabel}  (${(c / 1e9).toFixed(1)} Gc)`;
}

export function formatDistancePc(distancePc) {
  if (!Number.isFinite(distancePc)) return '—';
  const ly = distancePc * LY_PER_PC;
  if (distancePc < 0.01) return `${(distancePc * 1000).toFixed(1)} mpc`;
  if (distancePc < 10) return `${distancePc.toFixed(2)} pc  (${ly.toFixed(2)} ly)`;
  return `${distancePc.toFixed(1)} pc  (${ly.toFixed(1)} ly)`;
}
