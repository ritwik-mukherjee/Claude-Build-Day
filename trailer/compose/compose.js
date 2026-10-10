// RAGDOLL.AI — CHAOS ENGINE · 20 s launch film compositor.
// renderFrame(t) draws one 1920×1080 frame as a pure function of time. All gameplay pixels come
// from real in-engine captures (.work/frames/*); key art plates are the user-supplied images.
import { G, setManifest } from "./lib.js";
import { EDIT } from "./edit.js";
const { ctx, W, H } = G;

window.ready = (async () => {
  setManifest(await (await fetch("../.work/manifest.json")).json());
  await document.fonts.load('900 64px "Orbitron"');
  await document.fonts.load('700 64px "Orbitron"');
  await document.fonts.load('500 64px "Orbitron"');
  await document.fonts.load('64px "Share Tech Mono"');
  await document.fonts.ready;
})();

window.renderFrame = async (t) => {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  for (const beat of EDIT) if (t >= beat.a && t < beat.b) await beat.draw(t, t - beat.a);
};
