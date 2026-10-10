// Renders the trailer: serves trailer/ over HTTP, opens compose/index.html in headless Chromium and
// screenshots the 1920×1080 canvas once per frame (renderFrame(t) is a pure function of time).
// Usage: node render.cjs [from=0] [to=600] [step=1]   → .work/out/00000.png …
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = __dirname;
const OUT = path.join(ROOT, ".work", "out");
const FPS = 30;
const TOTAL = 20 * FPS;
const [from = 0, to = TOTAL, step = 1] = process.argv.slice(2).map(Number);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".css": "text/css" };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "max-age=3600" });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--disable-web-security"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("console", (m) => console.log("[page]", m.text().slice(0, 300)));
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(`http://localhost:${port}/compose/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.ready);
  const t0 = Date.now();
  for (let f = from; f < to; f += step) {
    await page.evaluate((t) => window.renderFrame(t), f / FPS);
    await page.screenshot({ path: path.join(OUT, `${String(f).padStart(5, "0")}.png`) });
    if (f % 30 === 0) console.log(`frame ${f}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
