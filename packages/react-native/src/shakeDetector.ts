/** Two distinct strong movements; no global sensor settings or permission prompts. */
export function createShakeDetector(now = Date.now): (sample: { x: number; y: number; z: number }) => boolean {
  let first = -Infinity;
  let last = -Infinity;
  let high = false;
  return ({ x, y, z }) => {
    const strength = Math.hypot(x, y, z);
    if (!Number.isFinite(strength)) return false;
    if (strength < 1.5) { high = false; return false; }
    if (strength < 2.3 || high) return false;
    high = true;
    const time = now();
    if (time - last < 2500) return false;
    if (time - first >= 100 && time - first <= 900) {
      first = -Infinity; last = time; return true;
    }
    first = time;
    return false;
  };
}
