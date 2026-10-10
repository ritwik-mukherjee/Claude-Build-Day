import Phaser from "phaser";
import "./style.css";
import { getStatus } from "./api";
import { H, W } from "./game/Arena";
import { ArenaScene } from "./game/ArenaScene";
import { bus, EV } from "./game/bus";
import type { MutationPlan } from "../shared/mutations";
import { initMenu } from "./menu";
import { initPerf } from "./perf";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: W,
  height: H,
  backgroundColor: "#05060a",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: "matter", matter: { gravity: { x: 0, y: 1.25 }, debug: false } },
  scene: [ArenaScene],
});
(window as unknown as { game: Phaser.Game }).game = game;

// ---------------------------------------------------------------- HUD
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const hud = $("#hud");
const input = $<HTMLInputElement>("#prompt");
const form = $<HTMLFormElement>("#prompt-form");
const submitBtn = form.querySelector("button") as HTMLButtonElement;
const status = $("#console-status");
const statusDefault = status.textContent ?? "";
const tl = $("#tl-list");
let pendingCard: HTMLElement | null = null;
let startT = performance.now();

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = input.value.trim();
  if (!v) return;
  bus.emit("submit-prompt", v);
  input.value = "";
  input.blur();
});
// chips are rebuilt per mode (menu.ts) — use delegation
$("#chips").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!b?.dataset.p) return;
  bus.emit("submit-prompt", b.dataset.p);
  b.blur();
});
initMenu(game);
initPerf(game);

input.addEventListener("focus", () => bus.emit("console-focus", true));
input.addEventListener("blur", () => bus.emit("console-focus", false));
window.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.activeElement !== input) {
    input.focus();
    e.preventDefault();
  } else if (e.key === "Escape") input.blur();
  // stop page scroll on space when playing
  if (e.key === " " && document.activeElement !== input) e.preventDefault();
});
$("#restart").addEventListener("click", () => bus.emit("restart"));

const fmtT = () => {
  const s = Math.floor((performance.now() - startT) / 1000);
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// health bars with trailing "lag" bar
function setHp(side: "left" | "right", v: number) {
  const el = $(`.hp.${side}`);
  const fill = el.querySelector(".fill") as HTMLElement;
  const lag = el.querySelector(".lag") as HTMLElement;
  const prev = parseFloat(fill.style.width || "100");
  const pct = Math.max(0, v * 100);
  fill.style.width = `${pct}%`;
  lag.style.width = `${pct}%`;
  if (pct < prev - 0.5) {
    el.classList.remove("hit");
    void el.offsetWidth;
    el.classList.add("hit");
  }
}
bus.on(EV.HP, ({ player, enemy, enemyHp, enemyMax }: { player: number; enemy: number; enemyHp?: number; enemyMax?: number }) => {
  setHp("left", player);
  setHp("right", enemy);
  const bh = document.querySelector("#boss-hp");
  if (bh && enemyHp !== undefined) bh.textContent = `${enemyHp} / ${enemyMax} HP`;
});

bus.on(EV.FUEL, (f: number) => {
  const el = $("#fuel");
  el.classList.toggle("on", f >= 0);
  if (f >= 0) (el.querySelector(".fuel-bar div") as HTMLElement).style.width = `${f * 100}%`;
});

bus.on(EV.LOADOUT, (list: string[]) => {
  $("#loadout").textContent = list.length ? list.map((s) => s.replace("_", " ").toUpperCase()).join(" · ") : "NO MUTATIONS";
});

// Director ticker: typewriter
let typeTimer = 0;
bus.on(EV.DIRECTOR, ({ text, source, action }: { text: string; source: string; action?: string }) => {
  const el = $("#dir-text");
  $("#dir-src").textContent = source === "opus" ? "OPUS · LIVE" : source === "system" ? "SYSTEM" : "LOCAL";
  $("#dir-action").textContent = action && action !== "none" ? `▶ ${action.replace(/_/g, " ").toUpperCase()}` : "";
  window.clearInterval(typeTimer);
  el.textContent = "";
  let i = 0;
  typeTimer = window.setInterval(() => {
    el.textContent = text.slice(0, ++i);
    if (i >= text.length) window.clearInterval(typeTimer);
  }, 22);
  const d = $("#director");
  d.classList.remove("pulse");
  void d.offsetWidth;
  d.classList.add("pulse");
});

// Mutation lifecycle -> console + timeline
bus.on(EV.MUTATION_START, ({ prompt }: { prompt: string }) => {
  submitBtn.disabled = true;
  $("#compile").classList.add("on");
  status.classList.remove("err");
  status.textContent = `routing "${prompt}" to mutation compiler…`;
  pendingCard = document.createElement("div");
  pendingCard.className = "tl pending";
  pendingCard.innerHTML = `<div class="t"><span>${fmtT()}</span><span class="badge console">COMPILING</span></div><div class="p"></div>`;
  (pendingCard.querySelector(".p") as HTMLElement).textContent = `“${prompt}”`;
  tl.prepend(pendingCard);
  while (tl.children.length > 4) tl.lastElementChild?.remove();
});
bus.on(EV.MUTATION_PLAN, ({ plan, source, note }: { plan: MutationPlan; source: string; note?: string }) => {
  $("#compile").classList.remove("on");
  status.textContent = `${source === "sonnet" ? "SONNET compiled" : source === "console" ? "manual command" : "local fallback compiled"} ${plan.operations.length} op(s)${note ? ` — ${note}` : ""}`;
  if (pendingCard) {
    pendingCard.classList.remove("pending");
    const badge = pendingCard.querySelector(".badge") as HTMLElement;
    badge.className = `badge ${source}`;
    badge.textContent = source === "sonnet" ? "SONNET" : source === "console" ? "CONSOLE" : "FALLBACK";
    const s = document.createElement("div");
    s.className = "s";
    s.textContent = plan.summary;
    pendingCard.appendChild(s);
  }
});
bus.on(EV.MUTATION_DONE, () => {
  submitBtn.disabled = false;
  pendingCard = null;
  setTimeout(() => {
    if (!submitBtn.disabled) {
      status.textContent = statusDefault;
    }
  }, 4000);
});
bus.on(EV.MUTATION_ERROR, ({ error }: { error: string }) => {
  submitBtn.disabled = false;
  $("#compile").classList.remove("on");
  status.classList.add("err");
  status.textContent = `mutation rejected: ${error.slice(0, 140)}`;
  if (pendingCard) {
    pendingCard.classList.remove("pending");
    pendingCard.classList.add("err");
    const badge = pendingCard.querySelector(".badge") as HTMLElement;
    badge.textContent = "REJECTED";
    pendingCard = null;
  }
});

bus.on(EV.CINEMATIC, (on: boolean) => hud.classList.toggle("cine", on));
bus.on(EV.BLUEPRINT, (bp: { title: string; lines: string[] } | null) => {
  const el = $("#blueprint");
  el.classList.toggle("on", !!bp);
  if (!bp) return;
  $("#bp-title").textContent = bp.title;
  const lines = $("#bp-lines");
  lines.innerHTML = "";
  bp.lines.forEach((l, i) => {
    const d = document.createElement("div");
    lines.appendChild(d);
    let k = 0;
    setTimeout(() => {
      const iv = setInterval(() => {
        d.textContent = "› " + l.slice(0, (k += 3));
        if (k >= l.length) clearInterval(iv);
      }, 12);
    }, i * 350);
  });
});
bus.on(EV.IMPACT, () => {
  hud.classList.remove("impact");
  void hud.offsetWidth;
  hud.classList.add("impact");
});
// game-over / victory card lives in menu.ts
bus.on("restart", () => resetHud());
bus.on("start", () => resetHud());
function resetHud() {
  $("#gameover").classList.remove("on");
  $("#blueprint").classList.remove("on");
  $("#compile").classList.remove("on");
  hud.classList.remove("cine");
  submitBtn.disabled = false;
  pendingCard = null;
  status.classList.remove("err");
  status.textContent = statusDefault;
  tl.innerHTML = "";
  startT = performance.now();
}

// Link status: only "LIVE" after the server has a real authenticated API response.
let models = "";
function renderLink(state: string, detail?: string) {
  const el = $("#link");
  const text: Record<string, string> = {
    live: `LINK: LIVE AI · ${models}`,
    checking: "LINK: VERIFYING API KEY…",
    no_key: "LINK: NO API KEY · LOCAL FALLBACK",
    auth_failed: `LINK: AUTH FAILED${detail ? ` (${detail})` : ""} · LOCAL FALLBACK`,
    degraded: "LINK: AI ERROR · LOCAL FALLBACK",
    offline: "LINK: SERVER OFFLINE · IN-BROWSER FALLBACK",
  };
  el.textContent = text[state] ?? `LINK: ${state}`;
  el.className = `link ${state}`;
}
bus.on("link", ({ state }: { state: string }) => renderLink(state));
async function pollStatus(tries = 8) {
  const s = await getStatus();
  if (!s) return renderLink("offline");
  models = `${s.mutationModel} / ${s.directorModel}`;
  renderLink(s.state, s.detail);
  if (s.state === "checking" && tries > 0) setTimeout(() => pollStatus(tries - 1), 1500);
}
pollStatus();
