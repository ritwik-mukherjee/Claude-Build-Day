// Gameplay beats — every pixel here is a real in-engine capture (.work/frames/*).
import { brackets, cam, clamp, ease, fill, frame, G, inv, lerp, line, plate, pw, text, toScreen, track, zoomBlur } from "./lib.js";
import { finish, hitK, shake, CYAN, ORANGE, RED } from "./common.js";
import { MAPS, SHOTS } from "./cues.js";

const { W, H, FPS } = G;

// ===================================================================== 2 · THE PROMPT  2.5–6.0
const promptShot = {
  a: SHOTS.prompt,
  b: SHOTS.chamber,
  async draw(t, lt) {
    const f = pw(lt, MAPS.prompt);
    const img = await frame("prompt", f);
    const c = cam(lt, [
      { t: 0, cx: 0.5, cy: 0.5, z: 1.12 },
      { t: 0.95, cx: 0.5, cy: 0.93, z: 1.55, e: ease.io3 },
      { t: 1.95, cx: 0.5, cy: 0.93, z: 1.66, e: ease.lin },
      { t: 2.25, cx: 0.37, cy: 0.8, z: 2.0, e: ease.out3 },
      { t: 2.95, cx: 0.33, cy: 0.77, z: 2.2, e: ease.lin },
      { t: 3.5, cx: 0.262, cy: 0.71, z: 3.6, e: ease.in3 },
    ]);
    const crop = plate(img, c, { filter: "contrast(1.08) saturate(1.12)" });
    // lock-on brackets around the real prompt field
    const [x0, y0] = toScreen(crop, 0.232, 0.909), [x1, y1] = toScreen(crop, 0.768, 0.967);
    const kin = ease.out3(inv(0.8, 1.0, lt)), kout = inv(1.95, 2.1, lt);
    const pad = 14 + 40 * (1 - kin);
    brackets(x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2, CYAN, 30, 3, kin * (1 - kout));
    text("// PROMPT", x0 - pad, y0 - pad - 26, { size: 22, font: "Share Tech Mono", weight: 400, track: 4, align: "left", color: CYAN, alpha: kin * (1 - kout), glow: 10 });
    // scan lock on the fighter while the plan compiles
    const [gxs, gys] = toScreen(crop, 0.258, 0.715);
    const ks = inv(2.15, 2.35, lt) * (1 - inv(2.9, 3.1, lt));
    if (ks > 0) {
      const r = 150 + 30 * (1 - ease.out3(inv(2.15, 2.35, lt)));
      brackets(gxs - r, gys - r * 1.1, r * 2, r * 2.2, ORANGE, 28, 3, ks);
      text("COMPILING MUTATION", gxs + r + 18, gys - r * 1.1 + 8, { size: 20, font: "Share Tech Mono", weight: 400, track: 4, align: "left", color: ORANGE, alpha: ks * (0.6 + 0.4 * Math.sin(lt * 30)) });
    }
    // entry punch from the hook's flash
    fill("#bffcff", 0.75 * Math.exp(-lt / 0.07), "lighter");
    // exit: zoom-blur through the terminal into the character
    const out = inv(3.0, 3.5, lt);
    if (out > 0) {
      zoomBlur(0.6 * ease.in3(out), gxs, gys);
      fill("#bffcff", 0.85 * ease.in3(inv(3.25, 3.5, lt)), "lighter");
    }
    finish(t, { bloomK: 0.3, vig: 0.5 });
  },
};

// ===================================================================== 3 · THE TRANSFORMATION  6.0–11.0
const chamberShot = {
  a: SHOTS.chamber,
  b: SHOTS.launch,
  async draw(t, lt) {
    const f = pw(lt, MAPS.chamber);
    const img = await frame("chamber", f);
    const ign = inv(1.98, 2.25, lt);
    const z = lerp(1.0, 1.1, ease.io3(inv(0, 1.9, lt))) + 0.08 * Math.exp(-Math.max(0, lt - 1.98) / 0.25) * (lt > 1.98 ? 1 : 0);
    const sh = shake(t, 14 * hitK(t, 0.15));
    plate(img, { cx: 0.56, cy: 0.5, z, ...sh }, { filter: `contrast(1.12) saturate(${1.1 + 0.3 * ign})` });
    // entry flash
    fill("#bffcff", 0.6 * Math.exp(-lt / 0.045), "lighter");
    finish(t, { bloomK: 0.4 + 0.15 * ign, vig: 0.55, punch: false });
  },
};

const launchShot = {
  a: SHOTS.launch,
  b: 11.0,
  async draw(t, lt) {
    const f = lt * FPS;
    const img = await frame("launch", f);
    const tr = track("launch", f)?.goblin ?? [0.26, 0.68];
    const k = ease.out3(inv(0, 0.45, lt));
    const z = lerp(1.25, 2.5, k);
    const sh = shake(t, 10 * hitK(t, 0.15));
    plate(img, { cx: lerp(0.4, tr[0] + 0.05, k), cy: lerp(0.6, tr[1] - 0.05, k), z, ...sh }, { filter: "contrast(1.12) saturate(1.2)" });
    finish(t, { bloomK: 0.5, vig: 0.55 });
  },
};

// "PROMPT → INVENTION → CHAOS" — minimal overlay across the transformation
const tagline = {
  a: SHOTS.chamber,
  b: 11.0,
  async draw(t, lt) {
    const words = [
      ["PROMPT", 0.35, "#ffffff"],
      ["→", 1.15, CYAN],
      ["INVENTION", 1.2, "#ffffff"],
      ["→", 1.95, ORANGE],
      ["CHAOS", 1.98, ORANGE],
    ];
    const size = 40, gap = 30;
    G.ctx.save();
    G.ctx.font = `700 ${size}px "Orbitron"`;
    G.ctx.letterSpacing = "10px";
    const ws = words.map(([w]) => G.ctx.measureText(w).width);
    G.ctx.restore();
    const total = ws.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
    let x = W / 2 - total / 2;
    const fadeOut = 1 - inv(4.3, 4.7, lt);
    const y = 118;
    // backing band for legibility
    const band = ease.out3(inv(0.3, 0.6, lt)) * fadeOut;
    const g = G.ctx.createLinearGradient(0, y - 60, 0, y + 60);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, `rgba(0,0,0,${0.55 * band})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    G.ctx.fillStyle = g;
    G.ctx.fillRect(0, y - 60, W, 120);
    words.forEach(([w, at, c], i) => {
      const k = inv(at, at + 0.14, lt);
      text(w, x + ws[i] / 2, y, { size, weight: 700, track: 10, color: c, alpha: ease.out3(k) * fadeOut, scale: lerp(1.3, 1, ease.outExpo(k)), glow: c === ORANGE ? 30 : 12, glowColor: c === ORANGE ? "rgba(255,120,30,0.9)" : "rgba(38,240,255,0.5)" });
      x += ws[i] + gap;
    });
  },
};

export { shot };
export const prompt = [promptShot];
export const transform = [chamberShot, launchShot, tagline];
import { PAYOFF_HAMMER } from "./hammer.js";

// ===================================================================== 4 · THE PAYOFF  11.0–16.0
/** generic tracked gameplay shot */
function shot(a, b, seg, map, camFn, o = {}) {
  return {
    a,
    b,
    async draw(t, lt) {
      const f = pw(lt, map);
      const img = await frame(seg, f);
      const tr = track(seg, f) ?? { goblin: [0.5, 0.5], spider: [0.5, 0.5] };
      const c = camFn(lt, tr, f);
      const sh = shake(t, (o.shake ?? 16) * hitK(t, 0.14));
      const crop = plate(img, { ...c, ...sh }, { filter: o.filter ?? "contrast(1.14) saturate(1.22)" });
      if (o.overlay) o.overlay(t, lt, crop, f);
      // cut-in punch
      fill("#fff2dd", (o.cutFlash ?? 0.35) * Math.exp(-lt / 0.05), "lighter");
      finish(t, { bloomK: o.bloom ?? 0.5, vig: 0.55 });
    },
  };
}
// a · six boosters, full burn: the goblin rockets for the ceiling
const rocketShot = shot(11.0, 12.2, "launch", [[0, 100], [1.2, 146]], (lt, tr) => {
  const z = lerp(1.9, 2.3, ease.io3(inv(0, 1.2, lt)));
  return { cx: tr.goblin[0] + 0.04, cy: tr.goblin[1] + 0.06, z };
});
// b · the Director's countermeasure: laser barrage from the Arachnotron
const laserShot = shot(12.2, 13.0, "launch", [[0, 150], [0.8, 178]], (lt) => ({ cx: 0.38, cy: 0.5, z: lerp(1.45, 1.6, lt / 0.8) }), { cutFlash: 0.25 });

export const payoff = [rocketShot, laserShot, ...PAYOFF_HAMMER()];

// ===================================================================== 5 · THE INTELLIGENCE  16.0–17.7
const intelShot = {
  a: 16.0,
  b: 17.7,
  async draw(t, lt) {
    const f = pw(lt, [[0, 122], [0.9, 176], [1.7, 200]]);
    const img = await frame("launch", f);
    const c = cam(lt, [
      { t: 0, cx: 0.5, cy: 0.14, z: 2.0 },
      { t: 1.0, cx: 0.5, cy: 0.14, z: 2.04, e: ease.lin },
      { t: 1.35, cx: 0.86, cy: 0.22, z: 2.4, e: ease.io3 },
      { t: 1.7, cx: 0.88, cy: 0.22, z: 2.6, e: ease.lin },
    ]);
    const crop = plate(img, c, { filter: "contrast(1.1) saturate(1.15)" });
    // panel brackets (cyan) + action highlight (red)
    const [x0, y0] = toScreen(crop, 0.274, 0.1), [x1, y1] = toScreen(crop, 0.726, 0.185);
    const kin = ease.out3(inv(0.05, 0.3, lt)) * (1 - inv(1.0, 1.15, lt));
    brackets(x0 - 18, y0 - 18, x1 - x0 + 36, y1 - y0 + 36, CYAN, 34, 3, kin);
    const ka = ease.out3(inv(0.55, 0.75, lt)) * (1 - inv(1.0, 1.15, lt));
    const [ax, ay] = toScreen(crop, 0.29, 0.168);
    if (ka > 0) line(ax - 10, ay + 22, ax - 10 + 420 * ka, ay + 22, RED, 3, ka, 16);
    // timeline card brackets after the pan
    const [tx0, ty0] = toScreen(crop, 0.823, 0.19), [tx1, ty1] = toScreen(crop, 0.99, 0.31);
    const kt = ease.out3(inv(1.3, 1.5, lt));
    brackets(tx0 - 14, ty0 - 14, tx1 - tx0 + 28, ty1 - ty0 + 28, CYAN, 26, 3, kt);
    // horizontal scan sweep
    const sy = lerp(-40, H + 40, (lt * 1.6) % 1);
    const g = G.ctx.createLinearGradient(0, sy - 30, 0, sy + 30);
    g.addColorStop(0, "rgba(38,240,255,0)");
    g.addColorStop(0.5, "rgba(38,240,255,0.10)");
    g.addColorStop(1, "rgba(38,240,255,0)");
    G.ctx.fillStyle = g;
    G.ctx.fillRect(0, sy - 30, W, 60);
    fill("#bffcff", 0.4 * Math.exp(-lt / 0.05), "lighter");
    finish(t, { bloomK: 0.3, vig: 0.5 });
  },
};
export const intel = [intelShot];
