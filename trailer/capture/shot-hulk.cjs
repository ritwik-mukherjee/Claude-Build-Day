// Hulk in the arena (game branch with the model-baked Hulk): gamma-drop entrance, then the real
// Hulk Smash (3D-rendered frames from the glTF) and Thunderclap on the Arachnotron.
// Run against a dev server of a game build that has Hulk in the roster.
const path = require("path");
const { open } = require("./driver.cjs");
const OUT = path.join(__dirname, "..", ".work", "frames");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const s = await open({ dpr: Number(process.env.DPR || 2), seed: Number(process.env.SEED || 5) });
  const p = s.page;
  const st = () =>
    p.evaluate(() => {
      const sc = window.game.scene.scenes[0];
      return { gx: Math.round(sc.goblin.x), gy: Math.round(sc.goblin.y), sx: Math.round(sc.spider.x), sy: Math.round(sc.spider.y), shp: Math.round(sc.spider.hp), deploy: sc.deployT > 0, char: sc.goblin.def.id };
    });

  await p.mouse.move(1200, 700);
  s.record(path.join(OUT, "hulk-enter"));
  await p.click('.card:has-text("HULK")');
  await s.secs(0.2);
  for (let i = 0; i < 150; i++) {
    await s.step();
    if (i > 20 && !(await st()).deploy) break;
  }
  await s.secs(0.8);
  s.stop();
  log("entered", JSON.stringify(await st()));

  s.record(path.join(OUT, "hulk-fight"));
  const aimSpider = async () => {
    const q = await st();
    await s.mouse(q.sx, q.sy);
    return q;
  };
  for (let round = 0; round < 4; round++) {
    // HULK SMASH toward the spider (aim assist lands beside it)
    await aimSpider();
    await s.step();
    await p.keyboard.press("f");
    await s.secs(1.6, async (i) => {
      if (i % 4 === 0) await aimSpider();
    });
    log("smash", round, JSON.stringify(await st()));
    // walk in and THUNDERCLAP
    let q = await aimSpider();
    const k = q.sx > q.gx ? "d" : "a";
    await s.key(k, true);
    for (let i = 0; i < 30; i++) {
      await s.step();
      q = await aimSpider();
      if (Math.abs(q.sx - q.gx) < 300) break;
    }
    await s.key(k, false);
    await p.keyboard.press("2");
    await s.secs(1.3);
    // a couple of punches
    for (let j = 0; j < 3; j++) {
      q = await aimSpider();
      await p.mouse.down();
      await s.step();
      await p.mouse.up();
      await s.secs(0.25);
    }
    await s.secs(1.6);
    log("clap", round, JSON.stringify(await st()));
    if ((await st()).shp <= 0) break;
  }
  await s.secs(1.0);
  s.stop();
  await s.close();
  log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
