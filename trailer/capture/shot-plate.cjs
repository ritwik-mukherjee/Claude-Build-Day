// Clean plate of the real arena (HUD hidden) for the opening shot.
const path = require("path");
const { open } = require("./driver.cjs");
const OUT = path.join(__dirname, "..", ".work", "frames");
(async () => {
  const s = await open({ dpr: 1.2, seed: 11 });
  const p = s.page;
  await p.click("#go-fight");
  await p.addStyleTag({ content: "#hud{display:none!important}" });
  await s.secs(1.0);
  s.record(path.join(OUT, "plate"));
  await s.secs(3.0);
  s.stop();
  await s.close();
})().catch((e) => { console.error(e); process.exit(1); });
