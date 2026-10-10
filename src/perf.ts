// Optional performance overlay: open the game with ?perf to profile on the target laptop.
// Shows FPS, average update (simulation) and render cost per frame, physics bodies,
// live particles and the effects mode. Costs nothing when the query flag is absent.
import type Phaser from "phaser";
import { Q } from "./game/quality";

export function initPerf(game: Phaser.Game) {
  if (!new URLSearchParams(location.search).has("perf")) return;
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;left:8px;top:8px;z-index:99;font:11px/1.4 ui-monospace,monospace;color:#7af8ff;background:rgba(0,0,0,0.75);padding:6px 8px;border:1px solid #26f0ff55;pointer-events:none;white-space:pre";
  document.body.appendChild(el);
  let t0 = 0,
    t1 = 0,
    upd = 0,
    ren = 0,
    n = 0,
    worst = 0,
    last = performance.now();
  game.events.on("prestep", () => (t0 = performance.now()));
  game.events.on("prerender", () => (t1 = performance.now()));
  game.events.on("postrender", () => {
    const now = performance.now();
    upd += t1 - t0;
    ren += now - t1;
    worst = Math.max(worst, now - last);
    last = now;
    n++;
  });
  setInterval(() => {
    const scene = game.scene.scenes[0] as Phaser.Scene & { matter?: Phaser.Physics.Matter.MatterPhysics };
    const bodies = scene?.matter?.world ? scene.matter.world.getAllBodies().length : 0;
    let particles = 0;
    scene?.children?.list.forEach((o) => {
      const e = o as unknown as { getAliveParticleCount?: () => number };
      if (e.getAliveParticleCount) particles += e.getAliveParticleCount();
    });
    el.textContent = `FPS ${game.loop.actualFps.toFixed(0)}  worst frame ${worst.toFixed(0)} ms
update ${(upd / Math.max(1, n)).toFixed(2)} ms   render ${(ren / Math.max(1, n)).toFixed(2)} ms
bodies ${bodies}   particles ${particles}   objects ${scene?.children?.list.length ?? 0}
fx ${Q.low ? "LOW" : "HIGH"}   3D chamber ${Q.useChamber ? "on" : "off"}   dpr ${devicePixelRatio}`;
    upd = ren = n = worst = 0;
  }, 500);
}
