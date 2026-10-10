// Hammer fight: same build as the main session (six boosters), plus a rocket-powered chain hammer,
// both through the real prompt pipeline (Chamber skipped by clicking it; the plan is still applied
// for real). Then hammer slams (Q) on the Arachnotron.
const path = require("path");
const { open } = require("./driver.cjs");
const OUT = path.join(__dirname, "..", ".work", "frames");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const s = await open({ dpr: Number(process.env.DPR || 2), seed: Number(process.env.SEED || 21) });
  const p = s.page;
  const mutate = async (text) => {
    await p.click("#prompt");
    await p.keyboard.type(text);
    await p.keyboard.press("Enter");
    await s.until(() => !!document.querySelector("[data-t]"), 300);
    await s.secs(0.2);
    await p.click("[data-t]"); // skip the animation; the plan is still executed
    await s.until(() => !document.querySelector("[data-t]"), 300);
    await s.secs(1.2);
  };
  await p.click("#go-fight");
  await s.secs(1.0);
  await mutate("GIVE MY GOBLIN SIX ROCKET BOOSTERS.");
  await mutate("GIVE MY GOBLIN A ROCKET-POWERED CHAIN HAMMER");
  log("loadout", await p.evaluate(() => document.querySelector("#loadout").textContent));

  log("hammer");
  s.record(path.join(OUT, "hammer"));
  const st = () =>
    p.evaluate(() => {
      const sc = window.game.scene.scenes[0];
      return { gx: sc.goblin.x, gy: sc.goblin.y, sx: sc.spider.x, sy: sc.spider.y, shp: Math.round(sc.spider.hp), php: Math.round(sc.goblin.hp) };
    });
  for (let round = 0; round < 7; round++) {
    let q = await st();
    const dirKey = q.sx > q.gx ? "d" : "a";
    await s.key(dirKey, true);
    for (let i = 0; i < 50; i++) {
      await s.mouse(q.sx, q.sy - 60 + Math.sin(i / 3) * 120);
      await s.step();
      if (i % 5 === 0) q = await st();
      if (Math.abs(q.sx - q.gx) < 240) break;
    }
    await s.key(dirKey, false);
    await p.keyboard.press("q");
    await s.secs(1.3);
    const r = await st();
    log("round", round, JSON.stringify(r));
    if (r.shp <= 0 || r.php <= 0) break;
  }
  await s.secs(1.0);
  s.stop();
  await s.close();
  log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
