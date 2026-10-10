// Compositor primitives: image/frame loading, plates, blur/bloom/chroma passes, text, wordmark.

const W = 1920, H = 1080, FPS = 30;
const cv = document.getElementById("c");
const ctx = cv.getContext("2d");
ctx.imageSmoothingQuality = "high";

// ----------------------------------------------------------------- utilities
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const inv = (a, b, x) => clamp((x - a) / (b - a));
export const ease = {
  lin: (k) => k,
  out3: (k) => 1 - Math.pow(1 - k, 3),
  out5: (k) => 1 - Math.pow(1 - k, 5),
  in3: (k) => k * k * k,
  io3: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
  outBack: (k) => 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2),
};
/** piecewise-linear map: pts = [[x0,y0],[x1,y1],…] */
export function pw(x, pts, e = ease.lin) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return lerp(y0, y1, e((x - x0) / (x1 - x0)));
    }
  }
  return pts[pts.length - 1][1];
}
/** keyframed camera: keys = [{t, cx, cy, z}] with per-segment easing */
export function cam(t, keys) {
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1], b = keys[i];
      const k = (keys[i].e || ease.io3)((t - a.t) / (b.t - a.t));
      return { cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k), z: lerp(a.z, b.z, k) };
    }
  }
  return keys[keys.length - 1];
}
// deterministic hash noise
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ----------------------------------------------------------------- image loading
const cache = new Map();
function load(src) {
  if (!cache.has(src)) {
    cache.set(
      src,
      new Promise((res, rej) => {
        const i = new Image();
        i.decoding = "async";
        i.onload = () => i.decode().then(() => res(i), () => res(i));
        i.onerror = () => rej(new Error("load " + src));
        i.src = src;
      }),
    );
    if (cache.size > 260) cache.delete(cache.keys().next().value);
  }
  return cache.get(src);
}
let MANIFEST = {};
export const setManifest = (m) => (MANIFEST = m);
export const frameCount = (seg) => MANIFEST[seg]?.n ?? 0;
/** tracked normalized positions {goblin:[x,y], spider:[x,y]} for a source frame */
export function track(seg, i) {
  const tr = MANIFEST[seg]?.track;
  if (!tr) return null;
  const k = Math.round(clamp(i, 0, tr.goblin.length - 1));
  return { goblin: tr.goblin[k], spider: tr.spider[k] };
}
export const meta = (seg, i) => MANIFEST[seg]?.meta?.[Math.round(clamp(i, 0, frameCount(seg) - 1))] ?? null;
export function frame(seg, i) {
  const n = frameCount(seg);
  const k = Math.round(clamp(i, 0, n - 1));
  return load(`../.work/frames/${seg}/${String(k).padStart(5, "0")}.jpg`);
}
export const art = (name) => load(`../.work/keyart/hd/${name}.jpg`);

// ----------------------------------------------------------------- drawing primitives
/** Draw an image covering the frame, zoomed around normalized source point (cx, cy). */
export function plate(img, { cx = 0.5, cy = 0.5, z = 1, rot = 0, dx = 0, dy = 0 } = {}, { alpha = 1, filter = "none", comp = "source-over", target = ctx } = {}) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const cover = Math.max(W / iw, H / ih) * z;
  const sw = W / cover, sh = H / cover;
  let sx = cx * iw - sw / 2, sy = cy * ih - sh / 2;
  sx = clamp(sx, 0, iw - sw);
  sy = clamp(sy, 0, ih - sh);
  target.save();
  target.globalAlpha = alpha;
  target.globalCompositeOperation = comp;
  target.filter = filter;
  if (rot || dx || dy) {
    target.translate(W / 2 + dx, H / 2 + dy);
    target.rotate(rot);
    target.translate(-W / 2, -H / 2);
  }
  target.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  target.restore();
  return { x: sx / iw, y: sy / ih, w: sw / iw, h: sh / ih };
}
/** normalized source point → screen px, given the crop returned by plate() */
export const toScreen = (crop, nx, ny) => [((nx - crop.x) / crop.w) * W, ((ny - crop.y) / crop.h) * H];

/** Radial zoom blur: stacked scaled copies of the current canvas. */
const tmp = document.createElement("canvas");
tmp.width = W;
tmp.height = H;
const tctx = tmp.getContext("2d");
export function zoomBlur(strength, cx = W / 2, cy = H / 2, n = 7) {
  if (strength <= 0.001) return;
  tctx.clearRect(0, 0, W, H);
  tctx.drawImage(cv, 0, 0);
  for (let i = 1; i <= n; i++) {
    const s = 1 + (strength * i) / n;
    ctx.save();
    ctx.globalAlpha = 0.5 / i + 0.08;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }
}
/** Horizontal motion smear (whip pan). */
export function smear(px) {
  if (Math.abs(px) < 1) return;
  tctx.clearRect(0, 0, W, H);
  tctx.drawImage(cv, 0, 0);
  for (let i = 1; i <= 6; i++) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.drawImage(tmp, (px * i) / 6, 0);
    ctx.restore();
  }
}
/** Cheap bloom: blurred quarter-res copy added back. */
const small = document.createElement("canvas");
small.width = W / 4;
small.height = H / 4;
const sctx = small.getContext("2d");
export function bloom(k, threshold = 0.55) {
  if (k <= 0) return;
  sctx.clearRect(0, 0, small.width, small.height);
  sctx.filter = `brightness(${threshold}) contrast(2.2) blur(5px)`;
  sctx.drawImage(cv, 0, 0, small.width, small.height);
  sctx.filter = "none";
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = k;
  ctx.drawImage(small, 0, 0, W, H);
  ctx.restore();
}
/** RGB split for impacts. */
export function chroma(px) {
  if (px < 0.5) return;
  tctx.clearRect(0, 0, W, H);
  tctx.drawImage(cv, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgb(0,255,255)";
  ctx.fillRect(0, 0, W, H); // keep G+B of the base
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(tinted(tmp, "rgb(255,0,0)"), px, 0);
  ctx.restore();
}
const tint = document.createElement("canvas");
tint.width = W;
tint.height = H;
const tictx = tint.getContext("2d");
function tinted(src, color) {
  tictx.globalCompositeOperation = "source-over";
  tictx.clearRect(0, 0, W, H);
  tictx.drawImage(src, 0, 0);
  tictx.globalCompositeOperation = "multiply";
  tictx.fillStyle = color;
  tictx.fillRect(0, 0, W, H);
  return tint;
}
export function fill(color, alpha = 1, comp = "source-over") {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = comp;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
export function vignette(k = 0.6, inner = 0.45) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * inner, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${k})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
// film grain: a few pre-baked tiles
const grains = [0, 1, 2, 3].map((s) => {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 270;
  const g = c.getContext("2d");
  const d = g.createImageData(480, 270);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = 128 + (hash(i * 0.37 + s * 1000.1) - 0.5) * 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
});
export function grain(t, k = 0.06) {
  ctx.save();
  ctx.globalAlpha = k;
  ctx.globalCompositeOperation = "overlay";
  ctx.drawImage(grains[Math.floor(t * FPS) % 4], 0, 0, W, H);
  ctx.restore();
}
/** Text with tracking + glow. */
export function text(str, x, y, o = {}) {
  const { size = 64, font = "Orbitron", weight = 900, color = "#fff", track = 0, align = "center", alpha = 1, glow = 0, glowColor = color, scale = 1, blur = 0, baseline = "middle" } = o;
  if (alpha <= 0) return 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = `${weight} ${size}px "${font}"`;
  ctx.letterSpacing = `${track}px`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (blur) ctx.filter = `blur(${blur}px)`;
  if (glow) {
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    ctx.fillText(str, align === "center" ? track / 2 : 0, 0);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  ctx.fillText(str, align === "center" ? track / 2 : 0, 0);
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w * scale;
}
export function measure(str, size, font = "Orbitron", weight = 900, track = 0) {
  ctx.save();
  ctx.font = `${weight} ${size}px "${font}"`;
  ctx.letterSpacing = `${track}px`;
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}
/** The RAGDOLL.AI wordmark, as the game's own logo styles it (white + orange glow, cyan ".AI"). */
export function wordmark(cx, cy, size, { alpha = 1, glow = 1, scale = 1, blur = 0, track = 0.12 } = {}) {
  const tr = size * track;
  const a = "RAGDOLL", b = ".AI";
  const wa = measure(a, size, "Orbitron", 900, tr), wb = measure(b, size, "Orbitron", 900, tr);
  const x0 = cx - ((wa + wb) * scale) / 2;
  ctx.save();
  ctx.translate(x0, cy);
  ctx.scale(scale, scale);
  text(a, 0, 0, { size, track: tr, align: "left", alpha, glow: 38 * glow, glowColor: "rgba(255,140,40,0.85)", blur });
  text(b, wa, 0, { size, track: tr, align: "left", color: "#26f0ff", alpha, glow: 40 * glow, glowColor: "rgba(38,240,255,0.95)", blur });
  ctx.restore();
}
export function line(x0, y0, x1, y1, color, w = 2, alpha = 1, glow = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
  }
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}
export function ring(x, y, rx, ry, color, w = 2, alpha = 1, glow = 12) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
/** Corner brackets around a rect. */
export function brackets(x, y, w, h, color, len = 26, lw = 3, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    ctx.moveTo(px, py + sy * len);
    ctx.lineTo(px, py);
    ctx.lineTo(px + sx * len, py);
  }
  ctx.stroke();
  ctx.restore();
}
export const G = { ctx, W, H, FPS, hash };

