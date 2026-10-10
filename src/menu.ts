// Character select screen, mode switching, special-ability button, effects toggle.
import type Phaser from "phaser";
import { bus } from "./game/bus";
import { abilitiesOf, CHARACTERS, IMPORTED, charById, paintPortrait, type CharacterDef, type CharacterId } from "./game/characters";
import { Q } from "./game/quality";
import { ROULETTE } from "../shared/fallback";
import { closeShowcase, featureShow, makeSnapshots, openShowcase, snapshots } from "./feature";
import type { ModelId } from "./chamber/models";
import { CHALLENGES } from "./game/challenges";
import { PERSONALITIES, type Personality } from "../shared/mutations";
import type { Mode } from "./game/ArenaScene";

const MODEL_CREDITS = {
  hulk: "“HULK RIGGED WITH ANIMATION” by Kapider22 · CC BY 4.0",
  kratos: "“God of War 3 Kratos - Rigged and Texture” by S4int0fSSG · CC BY 4.0",
  doraemon: "“Doraemon 3D” by arc98tect · CC BY 4.0",
};

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export const ARENA_PROMPTS: [string, string][] = [
  ["🚀 giant rocket boosters", "Give me giant rocket boosters"],
  ["🔨 massive chain hammer", "Attach a massive chain hammer to my right arm"],
  ["🛡 shield", "Give me a shield"],
  ["⚖ make weapon heavier", "Make my weapon heavier"],
];

export const LAB_PROMPTS: [string, string][] = [
  ["🚀 six boosters", "Give me six rocket boosters"],
  ["🥊 spring glove", "Attach a giant boxing glove to a spring"],
  ["🔥 rocket hammer", "Give my character a rocket-powered chain hammer"],
  ["🤯 most ridiculous", "Build the most ridiculous weapon possible"],
  ["🎁 surprise me", "Surprise me"],
];

let storedPers: string | null = null;
try {
  storedPers = localStorage.getItem("ragdoll.personality");
} catch {
  /* ignore */
}
const INTRO: Record<Personality, string> = {
  tactical: "Tactical analyst online. Monitoring the engagement.",
  inspector: "Inspector on site. Clipboard ready. Everything here is a violation.",
  chaos: "OH IT'S MY TURN?!?! SOMEBODY HAND ME THE BIG RED BUTTON!!!",
};

export const state = {
  personality: ((PERSONALITIES as readonly string[]).includes(storedPers ?? "") ? storedPers : "inspector") as Personality,
  mode: "menu" as Mode,
  char: "goblin" as CharacterId,
  challenge: "standard",
  carryPending: false,
};

let selected = 0;
let bayOpen = false;
/** main roster + (optionally) imported characters whose models are still pending */
const roster = () => (bayOpen ? IMPORTED : CHARACTERS);

let spinning = false;
/** Mutation roulette: picks a curated, fully supported prompt, reveals it, then submits it normally. */
function roulette() {
  if (spinning || ($("#prompt-form button") as HTMLButtonElement).disabled) return;
  spinning = true;
  const box = $("#roulette");
  const txt = $("#ro-text");
  const verdict = $("#ro-verdict");
  const pick = ROULETTE[Math.floor(Math.random() * ROULETTE.length)];
  box.classList.add("on");
  verdict.textContent = "";
  let i = 0,
    delay = 45;
  const tick = () => {
    txt.textContent = ROULETTE[i++ % ROULETTE.length];
    txt.classList.remove("flick");
    void txt.offsetWidth;
    txt.classList.add("flick");
    delay *= 1.13;
    if (delay < 260) setTimeout(tick, delay);
    else {
      txt.textContent = pick;
      box.classList.add("landed");
      verdict.textContent = "THE WHEEL DEMANDS IT";
      setTimeout(() => {
        box.classList.remove("on", "landed");
        spinning = false;
        bus.emit("submit-prompt", pick);
      }, 1500);
    }
  };
  tick();
}

function renderChips(list: [string, string][]) {
  const chips = $("#chips");
  chips.innerHTML = "";
  const r = document.createElement("button");
  r.className = "roulette-btn";
  r.textContent = "🎰 ROULETTE";
  r.title = "Spin for an absurd (but supported) mutation";
  r.addEventListener("click", (e) => {
    e.stopPropagation();
    r.blur();
    roulette();
  });
  chips.appendChild(r);
  for (const [label, prompt] of list) {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.p = prompt;
    b.title = prompt;
    chips.appendChild(b);
  }
}

function select(i: number) {
  const list = roster();
  selected = (i + list.length) % list.length;
  const def = list[selected];
  document.querySelectorAll<HTMLElement>(bayOpen ? ".fl-item" : ".card").forEach((c, k) => c.classList.toggle("on", k === selected));
  if (bayOpen && def.model) featureShow(def.model);
  const sel = $("#select");
  sel.style.setProperty("--accent", def.accent);
  $("#sd-name").textContent = def.name;
  $("#sd-title").textContent = def.title;
  $("#sd-bio").textContent = def.bio;
  $("#sd-quote").textContent = def.quote;
  $("#sd-sp").textContent = def.special.name;
  $("#sd-sp-desc").textContent = def.special.desc;
}

function start(mode: Mode, char?: CharacterId) {
  if (mode !== "menu") closeShowcase(); // free the WebGL context before the arena / chamber run
  state.mode = mode;
  if (char) state.char = char;
  bus.emit("start", { mode, char: state.char, challenge: state.challenge });
}

interface GameOver {
  winner: string;
  reason?: string;
  time: number;
  mutations: number;
  hp: number;
  char: CharacterId;
  challenge: string;
  cleared: boolean;
  build: string[];
  summaries: string[];
}

function victoryCard(game: Phaser.Game, d: GameOver) {
  const go = $("#gameover");
  const def = charById(d.char);
  const win = d.winner === "player";
  go.classList.add("on");
  go.classList.toggle("lose", !win);
  go.style.setProperty("--accent", def.accent);
  const cv = go.querySelector("canvas") as HTMLCanvasElement;
  const snap = snapshots.get(def.id);
  if (snap) {
    const img = new Image();
    img.onload = () => {
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const k = Math.min(cv.width / img.width, cv.height / img.height);
      ctx.drawImage(img, (cv.width - img.width * k) / 2, cv.height - img.height * k, img.width * k, img.height * k);
    };
    img.src = snap;
  } else paintPortrait(game, def, cv);
  ($("#gameover .vc-badge") as HTMLElement).textContent = def.name;
  ($("#gameover .go-title") as HTMLElement).textContent = win ? "VICTORY" : d.reason ?? "SCRAPPED";
  ($("#gameover .go-sub") as HTMLElement).textContent = win ? `${def.name} decommissioned the Arachnotron` : `${def.name} was reduced to scrap`;
  ($("#gameover .vc-ch") as HTMLElement).innerHTML = `${d.challenge} · <b class="${d.cleared ? "ok" : "bad"}">${d.cleared ? "CLEARED" : "FAILED"}</b>`;
  const t = `${String(Math.floor(d.time / 60)).padStart(2, "0")}:${String(Math.floor(d.time % 60)).padStart(2, "0")}`;
  ($("#gameover .vc-stats") as HTMLElement).innerHTML = `<div><b>${t}</b><span>TIME</span></div><div><b>${d.mutations}</b><span>MUTATIONS</span></div><div><b>${Math.round(d.hp)}%</b><span>HULL</span></div>`;
  const muts = $("#gameover .vc-muts");
  muts.innerHTML = d.summaries.length ? d.summaries.map((m) => `<div>▸ ${m.replace(/</g, "&lt;")}</div>`).join("") : "<div class=dim>none — bare chassis. Respect.</div>";
  if (d.build.length) muts.innerHTML += `<div class=dim>final build: ${d.build.map((b) => b.split("(")[0].replace(/_/g, " ")).join(", ")}</div>`;
}

function showControlsOnce() {
  try {
    if (sessionStorage.getItem("ragdoll.hinted")) return;
    sessionStorage.setItem("ragdoll.hinted", "1");
  } catch {
    /* ignore */
  }
  const t = $("#hint");
  t.classList.add("on");
  setTimeout(() => t.classList.remove("on"), 7000);
}

export function initMenu(game: Phaser.Game) {
  // challenge picker (arena mode)
  const chBox = $("#sel-ch");
  const renderCh = () =>
    (chBox.innerHTML =
      `<span class="lbl">CHALLENGE</span>` +
      CHALLENGES.map((c) => `<button data-c="${c.id}" class="${c.id === state.challenge ? "on" : ""}" title="${c.desc}">${c.name}<small>${c.desc}</small></button>`).join(""));
  chBox.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!b) return;
    state.challenge = b.dataset.c!;
    renderCh();
  });
  renderCh();
  bus.on("game-over", (d: GameOver) => victoryCard(game, d));
  bus.on("clock", (left: number) => {
    const el = $("#clock");
    el.textContent = `⏱ ${Math.ceil(left)}s`;
    el.classList.toggle("urgent", left < 15);
  });
  $("#vc-build").addEventListener("click", () => bus.emit("start", { mode: "arena", char: state.char, challenge: state.challenge, carry: true }));
  $("#vc-fighters").addEventListener("click", () => start("menu"));
  $("#vc-lab").addEventListener("click", () => start("lab"));

  const rosterEl = $("#roster");
  let painted = false;
  const addCard = (def: CharacterDef, i: number) => {
    const card = document.createElement("button");
    card.className = def.modelPending ? "card proto" : "card";
    card.style.setProperty("--accent", def.accent);
    const bars = (["speed", "power", "armor", "chaos"] as const)
      .map((k) => `<div class="stat"><span>${k.toUpperCase()}</span><b>${"<i></i>".repeat(def.stats[k])}${"<i class=off></i>".repeat(5 - def.stats[k])}</b></div>`)
      .join("");
    card.innerHTML = `<div class="pf"><canvas width="220" height="230"></canvas></div>
      <div class="cn">${def.name}</div><div class="ct">${def.title}</div>
      <div class="stats">${bars}</div><div class="csp">★ ${abilitiesOf(def).map((a) => a.short ?? a.name).join(" · ")}</div>
      ${def.modelPending ? `<div class="pending">MODEL PENDING · PROTOTYPE RIG</div>` : ""}`;
    card.addEventListener("mouseenter", () => select(i));
    card.addEventListener("focus", () => select(i));
    card.addEventListener("click", () => {
      select(i);
      start("arena", def.id);
    });
    rosterEl.appendChild(card);
    return card;
  };
  CHARACTERS.forEach(addCard);
  select(0);
  // Imported 3D fighters tab: live three.js showcase of the real glTF models
  const bayBtn = $<HTMLButtonElement>("#bay-btn");
  const tabRoster = $<HTMLButtonElement>("#tab-roster");
  const flist = $("#feature-list");
  const fstatus = $("#feature-stage .fs-status");
  const credit = $("#feature-credit");
  const thumb = (d: CharacterDef) => (snapshots.has(d.id) ? `<img src="${snapshots.get(d.id)}" alt="">` : `<canvas width="110" height="115"></canvas>`);
  const renderList = () => {
    flist.innerHTML = IMPORTED.map(
      (d, i) => `<button class="fl-item${i === selected ? " on" : ""}" data-i="${i}" style="--accent:${d.accent}">${thumb(d)}<span class="fl-txt"><b>${d.name}</b><small>${d.title}</small><em>${abilitiesOf(d).map((a) => a.name).join(" · ")}</em></span></button>`,
    ).join("");
    flist.querySelectorAll<HTMLCanvasElement>("canvas").forEach((c) => {
      const d = IMPORTED[Number((c.closest(".fl-item") as HTMLElement).dataset.i)];
      paintPortrait(game, d, c);
    });
  };
  flist.addEventListener("mouseover", (e) => {
    const b = (e.target as HTMLElement).closest(".fl-item") as HTMLElement | null;
    if (b && Number(b.dataset.i) !== selected) select(Number(b.dataset.i));
  });
  flist.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest(".fl-item") as HTMLElement | null;
    if (b) select(Number(b.dataset.i));
  });
  const onStatus = (id: string, st: string, msg?: string) => {
    const d = charById(id);
    fstatus.textContent = st === "loading" ? `LOADING ${d.name} MODEL…` : st === "error" ? `3D MODEL UNAVAILABLE (${msg ?? "error"}) — 2D rig still playable` : "";
    fstatus.className = `fs-status ${st}`;
    if (st === "ready") credit.textContent = `Model: ${d.model ? (MODEL_CREDITS as Record<string, string>)[d.model] : ""}`;
  };
  const openFeature = async () => {
    const sc = await openShowcase($("#feature-stage"), Q.low, onStatus);
    if (!sc) {
      fstatus.textContent = "3D UNAVAILABLE ON THIS DEVICE — fighters still playable with their 2D rigs";
      fstatus.className = "fs-status error";
      return;
    }
    if (bayOpen && roster()[selected]?.model) featureShow(roster()[selected].model as ModelId);
    void makeSnapshots(
      IMPORTED.map((d) => d.model as ModelId),
      () => renderList(),
    );
  };
  const setTab = (imported: boolean) => {
    bayOpen = imported;
    $("#select").classList.toggle("imported", imported);
    bayBtn.classList.toggle("on", imported);
    tabRoster.classList.toggle("on", !imported);
    selected = 0;
    if (imported) {
      renderList();
      select(0); // Hulk first
      void openFeature();
    } else {
      closeShowcase();
      select(0);
    }
  };
  bayBtn.addEventListener("click", () => {
    setTab(true);
    bayBtn.blur();
  });
  tabRoster.addEventListener("click", () => {
    setTab(false);
    tabRoster.blur();
  });

  $("#go-fight").addEventListener("click", () => start("arena", roster()[selected].id));
  $("#go-lab").addEventListener("click", () => start("lab", roster()[selected].id));
  $("#btn-menu").addEventListener("click", () => start("menu"));
  const switchMode = () => bus.emit("start", { mode: state.mode === "lab" ? "arena" : "lab", char: state.char, challenge: state.challenge, carry: true });
  $("#btn-mode").addEventListener("click", switchMode);
  $("#lp-arena").addEventListener("click", switchMode);
  bus.on("loadout-detail", (list: string[]) => {
    $("#lp-loadout").innerHTML = list.length
      ? list.map((l) => `<div>▸ ${l.replace(/_/g, " ").replace("(", " <small>(").replace(/\)$/, ")</small>")}</div>`).join("")
      : "<i>nothing bolted on yet — try a prompt or the roulette</i>";
  });
  // ability strip: one clickable button per character ability (1/F, 2, 3)
  $("#abilities").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
    if (!b) return;
    bus.emit("special", Number(b.dataset.slot));
    b.blur();
  });
  const renderPers = () => document.querySelectorAll<HTMLButtonElement>("#dir-pers button").forEach((b) => b.classList.toggle("on", b.dataset.p === state.personality));
  document.querySelectorAll<HTMLButtonElement>("#dir-pers button").forEach((b) =>
    b.addEventListener("click", () => {
      state.personality = b.dataset.p as Personality;
      try {
        localStorage.setItem("ragdoll.personality", state.personality);
      } catch {
        /* ignore */
      }
      renderPers();
      b.blur();
      bus.emit("director", { text: INTRO[state.personality], source: "system" });
      bus.emit("personality", state.personality);
    }),
  );
  renderPers();
  const fxBtn = $("#btn-fx");
  const renderFx = () => (fxBtn.textContent = Q.low ? "FX LO" : "FX HI");
  fxBtn.addEventListener("click", () => {
    Q.set(!Q.low);
    renderFx();
    fxBtn.blur();
  });
  const b3d = $("#btn-3d");
  const render3d = () => {
    b3d.textContent = Q.low ? "3D –" : Q.chamber ? "3D ✓" : "3D ✗";
    b3d.title = Q.low ? "3D Mutation Chamber is off in reduced-effects mode" : "Three.js Mutation Chamber cinematic (click to toggle)";
  };
  b3d.addEventListener("click", () => {
    Q.setChamber(!Q.chamber);
    b3d.blur();
  });
  bus.on("quality", () => {
    renderFx();
    render3d();
  });
  render3d();
  document.body.classList.toggle("lowfx", Q.low);
  renderFx();

  window.addEventListener("keydown", (e) => {
    const typing = document.activeElement?.tagName === "INPUT";
    if (state.mode === "menu") {
      if (e.key === "ArrowRight" || e.key === "d") select(selected + 1);
      else if (e.key === "ArrowLeft" || e.key === "a") select(selected - 1);
      else if (e.key === "Enter") start("arena", roster()[selected].id);
      else if (e.key === "l" || e.key === "L") start("lab", roster()[selected].id);
      e.stopImmediatePropagation();
      if (e.key === "Enter" || e.key === " ") e.preventDefault();
      return;
    }
    if (typing) return;
    if (e.key === "Escape") start("menu");
    if ((e.key === "b" || e.key === "B") && $("#gameover").classList.contains("on"))
      bus.emit("start", { mode: "arena", char: state.char, challenge: state.challenge, carry: true });
    if (e.key === "l" || e.key === "L") {
      Q.set(!Q.low);
      renderFx();
    }
  }, true);

  bus.on("round", ({ mode, char, def }: { mode: Mode; char: CharacterId; def: CharacterDef }) => {
    state.mode = mode;
    state.char = char;
    document.body.classList.remove("mode-menu", "mode-arena", "mode-lab");
    document.body.classList.add(`mode-${mode}`);
    if (!painted) {
      // textures exist once the scene has run create()
      painted = true;
      document.querySelectorAll<HTMLCanvasElement>(".card canvas").forEach((c, k) => paintPortrait(game, roster()[k], c));
    }
    $("#clock").textContent = "";
    if (mode === "menu") {
      const imported = IMPORTED.some((c) => c.id === char);
      if (imported !== bayOpen) setTab(imported);
      else if (imported) void openFeature();
      select(Math.max(0, roster().findIndex((c) => c.id === char)));
      return;
    }
    const d = charById(char);
    $(".hp.left .hp-name").innerHTML = d.name.includes(" ") ? `${d.name.replace(" ", " <span>")}</span>` : `${d.name}${d.modelPending ? " <span>PROTO RIG</span>" : ""}`;
    $(".hp.left").style.setProperty("--accent", d.accent);
    const abl = abilitiesOf(d);
    const strip = $("#abilities");
    strip.className = abl.length > 1 ? "multi" : "";
    strip.innerHTML = abl
      .map((a, i) => `<button class="ab ready" data-slot="${i}" title="${a.name}: ${a.desc}"><span class="sp-key">${i === 0 ? "1·F" : i + 1}</span><span class="sp-name">${abl.length > 1 ? a.short ?? a.name : a.name}</span><i></i><u></u></button>`)
      .join("");
    $("#btn-mode").textContent = mode === "lab" ? "▶ ARENA" : "⚗ LAB";
    $("#btn-mode").title = mode === "lab" ? "Take this build into the arena" : "Open the Character Lab (keeps your build)";
    $("#lp-name").textContent = `${d.name} — ${d.title}`;
    $("#lp-sp").textContent = abilitiesOf(d).map((a) => a.name).join(" · ");
    $("#lp-sp-desc").innerHTML = abilitiesOf(d)
      .map((a, i) => `<div><b>${i === 0 ? "1/F" : i + 1}</b> ${a.desc}</div>`)
      .join("");
    if (!state.carryPending) $("#lp-loadout").innerHTML = "<i>nothing bolted on yet — try a prompt or the roulette</i>";
    $(".hp.right .hp-sub").textContent = mode === "lab" ? "TRAINING DUMMY // CANNOT DIE" : "HOSTILE // FOUNDRY GUARDIAN";
    renderChips(mode === "lab" ? LAB_PROMPTS : ARENA_PROMPTS);
    showControlsOnce();
    void def;
  });

  bus.on("special-denied", (slot = 0) => {
    const b = document.querySelector<HTMLElement>(`#abilities [data-slot="${slot}"]`);
    if (!b) return;
    b.classList.remove("denied");
    void b.offsetWidth;
    b.classList.add("denied");
  });
  bus.on("ability-cd", (st: { cds: number[]; axeOut: boolean; rage: boolean; copter: number }) => {
    const ids = abilitiesOf(charById(state.char)).map((a) => a.id);
    document.querySelectorAll<HTMLElement>("#abilities .ab").forEach((b, i) => {
      const f = st.cds[i] ?? 0;
      (b.querySelector("i") as HTMLElement).style.transform = `scaleX(${Math.max(0, f)})`;
      b.classList.toggle("ready", f <= 0);
      // active-state indicators: axe in flight, rage running, copter battery
      const id = ids[i];
      const active = (id === "leviathan_axe" && st.axeOut) || (id === "spartan_rage" && st.rage) || (id === "bamboo_copter" && st.copter > 0);
      b.classList.toggle("active", active);
      (b.querySelector("u") as HTMLElement).style.transform = `scaleX(${id === "bamboo_copter" ? st.copter : 0})`;
    });
  });
}
