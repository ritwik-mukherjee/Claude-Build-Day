// Frame-accurate capture of the real game. Drives the page with real keyboard/mouse input and
// steps the virtual clock (virtual-time.js) one frame at a time, screenshotting each frame.
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const FPS = 30;
const DT = 1000 / FPS;
const URL = process.env.GAME_URL || "http://localhost:5173/";

async function open({ dpr = 1.2, seed = 7, storage = {} } = {}) {
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
  await ctx.addInitScript({ path: path.join(__dirname, "virtual-time.js") });
  await ctx.addInitScript((st) => {
    for (const [k, v] of Object.entries(st.local)) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(st.session)) sessionStorage.setItem(k, v);
  }, {
    local: { "ragdoll.lowfx": "0", "ragdoll.chamber3d": "1", "ragdoll.personality": "tactical", ...(storage.local || {}) },
    session: { "ragdoll.hinted": "1", ...(storage.session || {}) },
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[page ${m.type()}]`, m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`${URL}?seed=${seed}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const shot = new Shot(browser, page);
  await shot.run(30); // let Phaser boot
  return shot;
}

class Shot {
  constructor(browser, page) {
    this.browser = browser;
    this.page = page;
    this.dir = null;
    this.n = 0;
  }
  record(dir) {
    this.stop();
    this.dir = dir;
    this.meta = [];
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    this.n = 0;
  }
  stop() {
    if (this.dir && this.meta) fs.writeFileSync(path.join(this.dir, "meta.json"), JSON.stringify(this.meta));
    this.dir = null;
  }
  async step() {
    await this.page.evaluate((dt) => window.__vt.advance(dt), DT);
    if (this.dir) {
      const file = path.join(this.dir, `${String(this.n++).padStart(5, "0")}.jpg`);
      await this.page.screenshot({ path: file, type: "jpeg", quality: 94, animations: "allow", caret: "initial" });
      // per-frame state so the compositor can track the action with real coordinates (game px, 1600×900)
      this.meta.push(
        await this.page.evaluate(() => {
          const sc = window.game?.scene?.scenes?.[0];
          if (!sc?.goblin) return null;
          const c = sc.cameras.main;
          return { g: [Math.round(sc.goblin.x), Math.round(sc.goblin.y)], s: [Math.round(sc.spider.x), Math.round(sc.spider.y)], shp: Math.round(sc.spider.hp), z: +c.zoom.toFixed(3), sx: Math.round(c.scrollX), sy: Math.round(c.scrollY), hs: sc.hitStop > 0 ? 1 : 0, dt: document.querySelector("#dir-text")?.textContent?.length ?? 0 };
        }),
      );
    }
  }
  /** advance n frames; onFrame(i) may inject input before each frame */
  async run(n, onFrame) {
    for (let i = 0; i < n; i++) {
      if (onFrame) await onFrame(i);
      await this.step();
    }
  }
  async secs(s, onFrame) {
    return this.run(Math.round(s * FPS), onFrame);
  }
  /** run frames until pred() (evaluated in page) is true, or max frames */
  async until(pred, max = 600, arg) {
    for (let i = 0; i < max; i++) {
      if (await this.page.evaluate(pred, arg)) return i;
      await this.step();
    }
    throw new Error("until(): timed out");
  }
  key(k, down) {
    return down ? this.page.keyboard.down(k) : this.page.keyboard.up(k);
  }
  mouse(x, y) {
    return this.page.mouse.move(x, y);
  }
  close() {
    return this.browser.close();
  }
}

module.exports = { open, FPS, DT };
