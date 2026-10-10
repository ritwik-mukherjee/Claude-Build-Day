// Single source of truth for timing: source-frame time remaps (used by the compositor) and the
// audio/visual cue sheet (impacts, whooshes, typing clicks) derived from the same numbers.
// Standalone (no DOM) so the audio build can import it in Node.

/** trailer-local seconds → source frame, per shot (piecewise linear) */
export const MAPS = {
  prompt: [[0, 14], [0.3, 24], [1.65, 64], [1.95, 76], [2.9, 98], [3.5, 103]],
  chamber: [[0, 0], [1.15, 38], [1.9, 47], [2.1, 52], [3.1, 84], [3.6, 97]],
};
export const SHOTS = { prompt: 2.5, chamber: 6.0, launch: 9.6 };

function inverse(pts, f) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    if (f >= y0 && f <= y1) return x0 + ((f - y0) / (y1 - y0)) * (x1 - x0);
  }
  return null;
}

const events = [];
const E = (type, t, o = {}) => events.push({ type, t: +t.toFixed(3), ...o });

// ---- hook
E("drone", 0, { dur: 2.6, f: 49, fade_in: 0.4, fade_out: 0.3, gain: 1.2 });
E("whoosh", 0.62, { dur: 0.55, rising: true, gain: 0.7 });
E("hit", 0.62, { power: 0.6, gain: 0.9 });
E("metal", 0.64, { f: 260, gain: 0.8 });
E("whoosh", 1.35, { dur: 0.25, rising: true, gain: 0.5 });
for (const [i, w] of [1.4, 1.5, 1.62, 1.8, 1.92].entries()) E("click", w, { gain: 1.4 + i * 0.1 });
E("impact", 2.04, { power: 0.8 });
E("riser", 2.5, { dur: 0.35, f0: 300, f1: 2400, gain: 0.8 });

// ---- prompt: one click per typed character (source frames 24..63; spaces take 2 frames)
{
  const PROMPT = "GIVE MY GOBLIN SIX ROCKET BOOSTERS.";
  let f = 24;
  for (const ch of PROMPT) {
    const lt = inverse(MAPS.prompt, f);
    if (ch !== " " && lt !== null) E("click", SHOTS.prompt + lt);
    f += ch === " " ? 2 : 1;
  }
  E("blip", SHOTS.prompt + inverse(MAPS.prompt, 77), { f: 1800, gain: 1.4 }); // Enter / MUTATE
  for (let k = 0; k < 6; k++) E("blip", SHOTS.prompt + inverse(MAPS.prompt, 80 + k * 3.5), { f: 900 + k * 180, gain: 0.7 });
  E("riser", SHOTS.chamber, { dur: 0.9, f0: 120, f1: 1600, gain: 0.9 });
  E("whoosh", SHOTS.chamber - 0.02, { dur: 0.5, rising: true, gain: 0.8 });
}

// ---- chamber
{
  const at = (f) => SHOTS.chamber + inverse(MAPS.chamber, f);
  E("hit", SHOTS.chamber, { power: 0.5, gain: 0.7 });
  E("metal", at(30), { f: 180, gain: 0.9 }); // rack snaps (LOCKED)
  E("hit", at(30), { power: 0.4, gain: 0.6 });
  E("blip", at(44), { f: 2200, gain: 1.2 }); // ✓ MOUNTED
  E("riser", at(49), { dur: 0.7, f0: 90, f1: 1200, gain: 0.8 });
  E("impact", at(49), { power: 1.0 }); // ignition
  E("roar", at(49), { dur: SHOTS.launch + 1.4 - at(49), gain: 0.9 });
  E("whoosh", at(84), { dur: 0.4, rising: false, gain: 0.7 }); // portal
}
// ---- launch
E("impact", SHOTS.launch, { power: 0.7 }); // arrival burst

// ---- payoff: rocket flight (launch f100→146 over 11.0–12.2) and laser barrage (12.2–13.0)
E("whoosh", 11.0, { dur: 0.35, rising: true, gain: 0.8 });
E("hit", 11.0 + ((109 - 100) / 46) * 1.2, { power: 0.8 }); // explosion beside the spider
E("roar", 11.0, { dur: 1.2, gain: 0.6 });
for (const tl of [12.22, 12.4, 12.55, 12.78]) E("laser", tl, { pan: 0.3 });
E("hit", 12.2, { power: 0.4, gain: 0.6 });

// ---- hammer fight (13.0–16.0): three real slams; impact frames from the capture's per-frame meta
export const HAMMER = [
  { a: 13.0, b: 13.8, map: [[0, 72], [0.5, 90], [0.8, 99]], hit: 90, center: [1260, 560], z: 1.5, power: 0.8 },
  { a: 13.8, b: 14.6, map: [[0, 240], [0.35, 253], [0.5, 255], [0.8, 260]], hit: 255, center: [640, 570], z: 1.95, power: 0.85 },
  { a: 14.6, b: 16.0, map: [[0, 286], [0.4, 301], [0.48, 303], [1.1, 312], [1.4, 322]], hit: 303, center: [300, 560], z: 1.8, power: 1.0 },
];
for (const h of HAMMER) {
  const at = h.a + inverse(h.map, h.hit);
  E("whoosh", at, { dur: 0.35, rising: true, gain: 0.6 });
  E("impact", at, { power: h.power });
  E("metal", at, { f: 120 + 30 * h.power, gain: 0.7 });
}

// ---- intelligence
E("whoosh", 16.0, { dur: 0.3, rising: true, gain: 0.6 });
E("blip", 16.02, { f: 1400, gain: 1.2 });
for (let k = 0; k < 14; k++) E("click", 16.05 + k * 0.06, { gain: 0.45 });
E("blip", 16.6, { f: 700, gain: 1.0 });
E("blip", 16.66, { f: 520, gain: 1.0 }); // red action line
E("whoosh", 17.05, { dur: 0.35, rising: false, gain: 0.55 });
E("blip", 17.35, { f: 1900, gain: 0.9 });
E("riser", 17.7, { dur: 0.6, f0: 200, f1: 2600, gain: 0.8 });

// ---- roster flash + brand
for (const [i, tl] of [17.7, 17.86, 18.02, 18.16].entries()) {
  E("hit", tl, { power: 0.55 + i * 0.05, gain: 0.8, pan: [-0.4, 0.4, -0.2, 0.2][i] });
  E("metal", tl, { f: 160 + i * 40, gain: 0.5 });
}
E("impact", 18.3, { power: 1.0 });
E("metal", 18.3, { f: 110, gain: 0.9 });
E("drone", 18.3, { dur: 1.7, f: 41.2, fade_in: 0.05, fade_out: 1.2, gain: 1.4 });

export default {
  events,
  music: { bpm: 128, start: 2.5, end: 17.65, bass: [41.2, 41.2, 49.0, 36.7], mute: [[5.9, 8.0]] },
};

// ---- v2 cut: remap the original cues through the retimed windows + hits on every key-art cut
const WIN = [[0, 1.35, 0, 1.35], [1.35, 2.3, 1.35, 2.5], [2.3, 3.6, 2.5, 6.0], [3.6, 4.9, 6.0, 9.6], [13.2, 14.6, 14.6, 16.0], [14.6, 15.4, 16.0, 17.7], [15.4, 16.6, 17.7, 18.3], [16.6, 20.0, 18.3, 20.0]];
const v2 = [];
for (const e of events) {
  const w = WIN.find(([, , a, b]) => e.t >= a && e.t < b);
  if (!w) continue;
  const [na, nb, a, b] = w;
  const t = na + ((e.t - a) / (b - a)) * (nb - na);
  v2.push({ ...e, t: +t.toFixed(3), ...(e.dur ? { dur: Math.min(e.dur, e.type === "roar" ? 1.0 : e.dur) } : {}) });
}
for (const t of [4.9, 5.7, 6.4, 7.6, 8.9, 10.0, 10.9, 12.1, 13.2]) {
  v2.push({ type: "whoosh", t, dur: 0.3, rising: true, gain: 0.6 });
  v2.push({ type: "hit", t, power: 0.7, gain: 0.85 });
  v2.push({ type: "metal", t, f: 150 + (t * 37) % 120, gain: 0.45 });
}
v2.push({ type: "impact", t: 7.2, power: 1.0 }); // Hulk lands (gamma drop)
v2.push({ type: "impact", t: 10.0, power: 0.9 });
v2.push({ type: "drone", t: 4.9, dur: 8.3, f: 49, fade_in: 0.3, fade_out: 0.5, gain: 0.8 });
export const V2 = { events: v2.sort((x, y) => x.t - y.t), music: { bpm: 128, start: 2.3, end: 16.5, bass: [41.2, 41.2, 49.0, 36.7], mute: [] } };
