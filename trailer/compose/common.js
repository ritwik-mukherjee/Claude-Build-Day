// Shared finishing + cue helpers used by every beat.
import { bloom, chroma, fill, G, grain, vignette } from "./lib.js";
import CUES from "./cues.js";
const { FPS, hash } = G;
export const CYAN = "#26f0ff", ORANGE = "#ff8a2a", RED = "#ff3344";
export { CUES };

/** impact envelope from the shared cue sheet (same timestamps drive the audio) */
export function hitK(t, decay = 0.18) {
  let k = 0;
  for (const c of CUES.events) if ((c.type === "impact" || c.type === "hit") && t >= c.t && t < c.t + decay * 2) k = Math.max(k, (c.power ?? 0.7) * Math.exp(-(t - c.t) / decay));
  return k;
}
export function shake(t, amp) {
  return { dx: (hash(Math.floor(t * FPS) * 1.7) - 0.5) * 2 * amp, dy: (hash(Math.floor(t * FPS) * 2.3 + 9) - 0.5) * 2 * amp };
}
/** common finishing: bloom, impact punch, grain, vignette */
export function finish(t, { bloomK = 0.35, vig = 0.55, grainK = 0.05, punch = true } = {}) {
  bloom(bloomK);
  if (punch) {
    const k = hitK(t);
    if (k > 0.02) {
      chroma(8 * k);
      fill("#fff4e0", 0.22 * k, "lighter");
    }
  }
  vignette(vig);
  grain(t, grainK);
}
