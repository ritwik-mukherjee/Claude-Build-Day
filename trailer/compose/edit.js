// The edit: five connected beats + roster flash. Times in seconds (30 fps, 600 frames).
import {
  art, bloom, brackets, cam, chroma, clamp, ease, fill, frame, frameCount, G, grain, inv, lerp, line, meta, plate, pw, ring, smear, text, vignette, wordmark, zoomBlur,
} from "./lib.js";
import { finish, hitK, shake, CYAN, ORANGE, RED } from "./common.js";

const { W, H, FPS, hash } = G;


// ===================================================================== 1 · HOOK  0.0–2.5
const hookA = {
  a: 0,
  b: 1.35,
  async draw(t) {
    const pl = await frame("plate", 10 + t * FPS);
    const k = ease.out3(inv(0.05, 1.2, t));
    plate(pl, { cx: 0.5, cy: 0.66, z: lerp(1.42, 1.22, ease.out3(inv(0, 1.35, t))) }, { filter: `brightness(${0.04 + 0.34 * k}) saturate(0.75) contrast(1.2)` });
    fill("#03070c", 0.35);
    // pulsing light rings (the arena's "hum")
    const cx = W / 2, cy = 640;
    for (let i = 0; i < 6; i++) {
      const ph = t * 1.25 - i * 0.22;
      if (ph < 0 || ph > 1) continue;
      const r = lerp(30, 1150, ease.out3(ph));
      ring(cx, cy, r, r * 0.26, i % 3 === 1 ? ORANGE : CYAN, 2.2, (1 - ph) * 0.75 * inv(0, 0.25, t), 18);
    }
    // core glow
    const g = G.ctx.createRadialGradient(cx, cy, 0, cx, cy, 380);
    g.addColorStop(0, `rgba(38,240,255,${0.18 + 0.1 * Math.sin(t * 14)})`);
    g.addColorStop(1, "rgba(38,240,255,0)");
    G.ctx.save();
    G.ctx.globalCompositeOperation = "lighter";
    G.ctx.fillStyle = g;
    G.ctx.fillRect(0, 0, W, H);
    G.ctx.restore();
    // wordmark snaps into focus
    const s = inv(0.6, 0.8, t);
    if (t > 0.6) {
      wordmark(W / 2, 500, 150, { alpha: ease.out3(s), scale: lerp(1.16, 1, ease.outExpo(s)), blur: lerp(16, 0, ease.out3(s)), glow: 1 + 1.6 * (1 - inv(0.8, 1.2, t)) });
      const k2 = inv(0.62, 1.15, t);
      if (k2 < 1) {
        const w = 1150 * ease.out3(k2);
        line(W / 2 - w, 592, W / 2 + w, 592, CYAN, 2, 1 - k2, 22);
        line(W / 2 - w * 0.6, 598, W / 2 + w * 0.6, 598, ORANGE, 1.5, (1 - k2) * 0.8, 16);
      }
      text("CHAOS  ENGINE", W / 2, 625, { size: 26, weight: 500, track: 22, color: "#cfefff", alpha: ease.out3(inv(0.82, 1.05, t)) * 0.9 });
      fill("#bffcff", 0.35 * (1 - inv(0.6, 0.72, t)) * (t < 0.72 ? 1 : 0), "lighter");
    }
    finish(t, { bloomK: 0.3, vig: 0.85, punch: false });
  },
};

const HEAD = [
  { w: "WHAT", line: 0, t: 1.4 },
  { w: "IF", line: 0, t: 1.5 },
  { w: "WORDS", line: 0, t: 1.62 },
  { w: "COULD", line: 1, t: 1.8 },
  { w: "BREAK", line: 1, t: 1.92 },
  { w: "PHYSICS?", line: 1, t: 2.04, accent: true },
];
const hookB = {
  a: 1.35,
  b: 2.5,
  async draw(t, lt) {
    const img = await art("kratos-3");
    const sh = shake(t, 10 * hitK(t, 0.12));
    plate(img, { cx: 0.5, cy: 0.42, z: lerp(1.06, 1.2, ease.out3(inv(0, 1.15, lt))), ...sh }, { filter: "brightness(0.82) contrast(1.3) saturate(0.9)" });
    // teal shadows / orange highlights
    fill("#2a5a6a", 0.35, "multiply");
    fill("#3a1a06", 0.22, "screen");
    // legibility band
    const gr = G.ctx.createLinearGradient(0, 300, 0, 780);
    gr.addColorStop(0, "rgba(0,0,0,0)");
    gr.addColorStop(0.5, "rgba(0,0,0,0.55)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    G.ctx.fillStyle = gr;
    G.ctx.fillRect(0, 300, W, 480);
    const size = 112, gap = 34;
    const ws = HEAD.map((h) => ({ ...h, width: measureW(h.w, size) }));
    for (const ln of [0, 1]) {
      const row = ws.filter((h) => h.line === ln);
      const total = row.reduce((s, h) => s + h.width, 0) + gap * (row.length - 1);
      let x = W / 2 - total / 2;
      for (const h of row) {
        const k = inv(h.t, h.t + 0.14, t);
        if (k > 0)
          text(h.w, x + h.width / 2 + sh.dx, (ln ? 600 : 470) + sh.dy, {
            size, track: 4, color: h.accent ? ORANGE : "#ffffff", alpha: ease.out3(k), scale: lerp(1.35, 1, ease.outExpo(k)), blur: lerp(10, 0, k),
            glow: h.accent ? 40 : 18, glowColor: h.accent ? "rgba(255,120,30,0.9)" : "rgba(255,255,255,0.35)",
          });
        x += h.width + gap;
      }
    }
    // zoom-through into the game
    const out = inv(2.3, 2.5, t);
    if (out > 0) {
      zoomBlur(0.35 * ease.in3(out));
      fill("#bffcff", 0.8 * ease.in3(out), "lighter");
    }
    finish(t, { bloomK: 0.3, vig: 0.75 });
  },
};
function measureW(s, size) {
  G.ctx.save();
  G.ctx.font = `900 ${size}px "Orbitron"`;
  G.ctx.letterSpacing = "4px";
  const w = G.ctx.measureText(s).width;
  G.ctx.restore();
  return w;
}

// ===================================================================== 5b · ROSTER FLASH  17.7–18.3
const ROSTER = [
  { name: "sb-hulk", a: 17.7, cx: 0.48, cy: 0.5 },
  { name: "sb-kratos", a: 17.86, cx: 0.6, cy: 0.45 },
  { name: "sb-doraemon", a: 18.02, cx: 0.5, cy: 0.45 },
  { name: "sb-spider", a: 18.16, cx: 0.5, cy: 0.5 },
];
const roster = {
  a: 17.7,
  b: 18.3,
  async draw(t) {
    let cur = ROSTER[0];
    for (const r of ROSTER) if (t >= r.a) cur = r;
    const lt = t - cur.a;
    const img = await art(cur.name);
    plate(img, { cx: cur.cx, cy: cur.cy, z: lerp(1.16, 1.04, ease.out3(clamp(lt / 0.16))) }, { filter: "contrast(1.2) saturate(1.1) brightness(1.05)" });
    fill("#ffffff", 0.55 * Math.exp(-lt / 0.035), "lighter");
    chroma(10 * Math.exp(-lt / 0.06));
    finish(t, { bloomK: 0.35, vig: 0.6, grainK: 0.07, punch: false });
  },
};

// ===================================================================== 6 · BRAND  18.3–20.0
const brand = {
  a: 18.3,
  b: 20.01,
  async draw(t, lt) {
    fill("#030508");
    // drifting embers
    for (let i = 0; i < 70; i++) {
      const x = hash(i * 3.1) * W, sp = 20 + hash(i * 5.7) * 60;
      const y = H - ((hash(i * 7.3) * H + lt * sp * 3) % H);
      const a = 0.25 + 0.5 * hash(i * 1.9);
      G.ctx.fillStyle = i % 4 ? `rgba(255,138,42,${a * 0.6})` : `rgba(38,240,255,${a * 0.5})`;
      G.ctx.fillRect(x, y, 2, 2);
    }
    // floor ring
    for (let i = 0; i < 3; i++) {
      const ph = (lt * 0.7 + i / 3) % 1;
      ring(W / 2, 760, lerp(200, 1200, ph), lerp(200, 1200, ph) * 0.12, i === 1 ? ORANGE : CYAN, 1.5, (1 - ph) * 0.35, 12);
    }
    const s = inv(0, 0.22, lt);
    wordmark(W / 2, 450, 168, { scale: lerp(1.12, 1, ease.outExpo(s)), glow: 1 + 1.4 * (1 - inv(0.05, 0.6, lt)) });
    const k2 = inv(0.02, 0.5, lt);
    const w = 900 * ease.out3(k2);
    line(W / 2 - w, 560, W / 2 + w, 560, CYAN, 2, 0.9 * (1 - 0.6 * k2), 18);
    text("CHAOS  ENGINE", W / 2, 600, { size: 30, weight: 500, track: 26, color: "#d8f6ff", alpha: ease.out3(inv(0.12, 0.35, lt)) });
    const tags = [
      ["TYPE THE IMPOSSIBLE.", 0.38, "#ffffff"],
      ["BUILD THE RIDICULOUS.", 0.55, "#ffffff"],
      ["UNLEASH THE CHAOS.", 0.72, ORANGE],
    ];
    const ts = 34, gap = 50;
    const widths = tags.map(([s]) => measureT(s, ts));
    let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + gap * 2) / 2;
    tags.forEach(([s, at, c], i) => {
      const k = inv(at, at + 0.16, lt);
      text(s, x + widths[i] / 2, 700, { size: ts, weight: 700, track: 4, color: c, alpha: ease.out3(k), scale: lerp(1.15, 1, ease.out3(k)), glow: c === ORANGE ? 24 : 0, glowColor: "rgba(255,120,30,0.8)" });
      x += widths[i] + gap;
    });
    text("PHASER  ·  MATTER.JS  ·  THREE.JS", W / 2, 800, { size: 18, font: "Share Tech Mono", weight: 400, track: 6, color: "#7d93a3", alpha: ease.out3(inv(0.95, 1.2, lt)) });
    text("Gameplay captured in engine · AI calls in this capture ran on the built-in offline fallback", W / 2, 1035, { size: 17, font: "Share Tech Mono", weight: 400, track: 1, color: "#66778a", alpha: ease.out3(inv(0.95, 1.2, lt)) });
    fill("#ffffff", 0.5 * Math.exp(-lt / 0.05), "lighter");
    fill("#000", inv(1.55, 1.7, lt));
    finish(t, { bloomK: 0.4, vig: 0.7, punch: false });
  },
};
function measureT(s, size) {
  G.ctx.save();
  G.ctx.font = `700 ${size}px "Orbitron"`;
  G.ctx.letterSpacing = "4px";
  const w = G.ctx.measureText(s).width;
  G.ctx.restore();
  return w;
}

import { prompt, transform, payoff, intel } from "./gameplay.js";
export const EDIT = [hookA, hookB, ...prompt, ...transform, ...payoff, ...intel, roster, brand];
