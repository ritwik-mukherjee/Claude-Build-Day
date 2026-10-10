// Hammer-fight shots (13.0–16.0): three real chain-hammer slams on the Arachnotron, cut on impact,
// slow-motion into the last (biggest) shockwave. Timing lives in cues.js (shared with the audio).
import { ease, inv, lerp } from "./lib.js";
import { HAMMER } from "./cues.js";
import { shot } from "./gameplay.js";

export const PAYOFF_HAMMER = () =>
  HAMMER.map((h, i) =>
    shot(
      h.a,
      h.b,
      "hammer",
      h.map,
      (lt) => {
        const k = ease.io3(inv(0, h.b - h.a, lt));
        return { cx: h.center[0] / 1600, cy: h.center[1] / 900, z: lerp(h.z, h.z + (i === 2 ? 0.25 : 0.12), k) };
      },
      { cutFlash: 0.3, bloom: 0.32, shake: i === 2 ? 26 : 18, filter: "contrast(1.22) saturate(1.15) brightness(0.92)" },
    ),
  );
