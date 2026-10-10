// Main gameplay capture, one continuous real session (Mech Goblin vs. Arachnotron):
//   prompt  : type the prompt into the real console, real compile (fallback compiler, no API key)
//   chamber : the real Three.js Mutation Chamber for the compiled plan
//   launch  : arrival beat, boosters ignite, player thrusts; the Director reacts (local fallback)
// (the hammer fight is captured separately by shot-hammer.cjs)
// Output: trailer/.work/frames/<segment>/00000.jpg …
const path = require("path");
const { open } = require("./driver.cjs");

const OUT = path.join(__dirname, "..", ".work", "frames");
const PROMPT = "GIVE MY GOBLIN SIX ROCKET BOOSTERS.";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const s = await open({ dpr: Number(process.env.DPR || 2), seed: Number(process.env.SEED || 7) });
  const p = s.page;

  // Simulated network latency for the mutation request. The response itself is the real server's
  // response (deterministic fallback compiler); only its delivery is held for a few frames so the
  // real "COMPILING" UI is visible (a live model call would take longer than this).
  let held = null;
  await p.route("**/api/mutate", async (route) => {
    const response = await route.fetch();
    held = { route, response };
  });
  const release = async () => {
    for (let i = 0; i < 200 && !held; i++) await new Promise((r) => setTimeout(r, 20));
    if (!held) throw new Error("mutate request never arrived");
    await held.route.fulfill({ response: held.response });
    held = null;
  };
  const inChamber = () => !!document.querySelector(".ch-root, #chamber, [data-t]");

  await p.click("#go-fight");
  await s.secs(1.2);

  // ---------------- prompt ----------------
  log("prompt");
  s.record(path.join(OUT, "prompt"));
  await s.secs(0.5);
  await p.click("#prompt");
  await s.secs(0.3);
  for (const ch of PROMPT) {
    await p.keyboard.type(ch);
    await s.run(ch === " " ? 2 : 1);
  }
  await s.secs(0.45);
  await p.keyboard.press("Enter");
  await s.secs(0.75); // COMPILING…
  await release();
  // run until the chamber overlay is up
  await s.until(inChamber, 120);
  await s.secs(0.2);

  // ---------------- chamber ----------------
  log("chamber");
  s.record(path.join(OUT, "chamber"));
  await s.until(() => !document.querySelector("[data-t]"), 400);

  // ---------------- launch ----------------
  log("launch");
  s.record(path.join(OUT, "launch"));
  await s.mouse(1000, 300);
  await s.secs(0.9);
  await s.key("Space", true);
  await s.secs(0.5, (i) => s.mouse(1000 + i * 8, 260));
  await s.key("d", true);
  await s.secs(0.9);
  await s.key("d", false);
  await s.key("a", true);
  await s.secs(0.5);
  await s.key("Space", false);
  await s.key("a", false);
  await s.secs(0.6);
  await s.key("Space", true);
  await s.secs(0.8);
  await s.key("Space", false);
  // director reacts (fires ~3.5 s after the mutation completes) + its countermeasure
  await s.secs(5.5, async (i) => {
    if (i % 40 === 10) await s.key("Space", true);
    if (i % 40 === 30) await s.key("Space", false);
  });
  await s.key("Space", false);
  s.stop();
  const dir = await p.evaluate(() => ({ text: document.querySelector("#dir-text").textContent, src: document.querySelector("#dir-src").textContent }));
  log("director:", JSON.stringify(dir));

  await s.close();
  log("done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
