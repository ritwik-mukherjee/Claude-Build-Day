// Character select screen, mode switching, special-ability button, effects toggle.
import type Phaser from "phaser";
import { bus } from "./game/bus";
import { CHARACTERS, charById, paintPortrait, type CharacterDef, type CharacterId } from "./game/characters";
import { Q } from "./game/quality";
import type { Mode } from "./game/ArenaScene";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

export const ARENA_PROMPTS: [string, string][] = [
  ["🚀 giant rocket boosters", "Give me giant rocket boosters"],
  ["🔨 massive chain hammer", "Attach a massive chain hammer to my right arm"],
  ["🛡 shield", "Give me a shield"],
  ["⚖ make weapon heavier", "Make my weapon heavier"],
];

export const LAB_PROMPTS: [string, string][] = [
  ["🚀 six rocket boosters", "Give me six rocket boosters"],
  ["🥊 boxing glove on a spring", "Attach a giant boxing glove to a spring"],
  ["🔥 rocket-powered chain hammer", "Give my character a rocket-powered chain hammer"],
  ["🤯 most ridiculous weapon", "Build the most ridiculous weapon possible"],
  ["🎁 surprise me", "Surprise me"],
];

export const state = {
  mode: "menu" as Mode,
  char: "goblin" as CharacterId,
  challenge: "standard",
};

let selected = 0;

function renderChips(list: [string, string][]) {
  const chips = $("#chips");
  chips.innerHTML = "";
  for (const [label, prompt] of list) {
    const b = document.createElement("button");
    b.textContent = label;
    b.dataset.p = prompt;
    b.title = prompt;
    chips.appendChild(b);
  }
}

function select(i: number) {
  selected = (i + CHARACTERS.length) % CHARACTERS.length;
  const def = CHARACTERS[selected];
  document.querySelectorAll<HTMLElement>(".card").forEach((c, k) => c.classList.toggle("on", k === selected));
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
  state.mode = mode;
  if (char) state.char = char;
  bus.emit("start", { mode, char: state.char, challenge: state.challenge });
}

export function initMenu(game: Phaser.Game) {
  const roster = $("#roster");
  let painted = false;
  CHARACTERS.forEach((def, i) => {
    const card = document.createElement("button");
    card.className = "card";
    card.style.setProperty("--accent", def.accent);
    const bars = (["speed", "power", "armor", "chaos"] as const)
      .map((k) => `<div class="stat"><span>${k.toUpperCase()}</span><b>${"<i></i>".repeat(def.stats[k])}${"<i class=off></i>".repeat(5 - def.stats[k])}</b></div>`)
      .join("");
    card.innerHTML = `<div class="pf"><canvas width="220" height="230"></canvas></div>
      <div class="cn">${def.name}</div><div class="ct">${def.title}</div>
      <div class="stats">${bars}</div><div class="csp">★ ${def.special.name}</div>`;
    card.addEventListener("mouseenter", () => select(i));
    card.addEventListener("focus", () => select(i));
    card.addEventListener("click", () => {
      select(i);
      start("arena", def.id);
    });
    roster.appendChild(card);
  });
  select(0);

  $("#go-fight").addEventListener("click", () => start("arena", CHARACTERS[selected].id));
  $("#go-lab").addEventListener("click", () => start("lab", CHARACTERS[selected].id));
  $("#btn-menu").addEventListener("click", () => start("menu"));
  $("#btn-mode").addEventListener("click", () => start(state.mode === "lab" ? "arena" : "lab"));
  $("#special").addEventListener("click", () => bus.emit("special"));
  const fxBtn = $("#btn-fx");
  const renderFx = () => (fxBtn.textContent = Q.low ? "FX: LOW" : "FX: HIGH");
  fxBtn.addEventListener("click", () => {
    Q.set(!Q.low);
    renderFx();
    fxBtn.blur();
  });
  bus.on("quality", renderFx);
  document.body.classList.toggle("lowfx", Q.low);
  renderFx();

  window.addEventListener("keydown", (e) => {
    const typing = document.activeElement?.tagName === "INPUT";
    if (state.mode === "menu") {
      if (e.key === "ArrowRight" || e.key === "d") select(selected + 1);
      else if (e.key === "ArrowLeft" || e.key === "a") select(selected - 1);
      else if (e.key === "Enter") start("arena", CHARACTERS[selected].id);
      else if (e.key === "l" || e.key === "L") start("lab", CHARACTERS[selected].id);
      e.stopImmediatePropagation();
      if (e.key === "Enter" || e.key === " ") e.preventDefault();
      return;
    }
    if (typing) return;
    if (e.key === "Escape") start("menu");
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
      document.querySelectorAll<HTMLCanvasElement>(".card canvas").forEach((c, k) => paintPortrait(game, CHARACTERS[k], c));
    }
    if (mode === "menu") {
      select(CHARACTERS.findIndex((c) => c.id === char));
      return;
    }
    const d = charById(char);
    $(".hp.left .hp-name").innerHTML = `${d.name.replace(" ", " <span>")}</span>`;
    $(".hp.left").style.setProperty("--accent", d.accent);
    $("#special .sp-name").textContent = d.special.name;
    $("#btn-mode").textContent = mode === "lab" ? "▶ ARENA" : "⚗ LAB";
    $(".hp.right .hp-sub").textContent = mode === "lab" ? "TRAINING DUMMY // CANNOT DIE" : "HOSTILE // FOUNDRY GUARDIAN";
    renderChips(mode === "lab" ? LAB_PROMPTS : ARENA_PROMPTS);
    void def;
  });

  bus.on("special-cd", (f: number) => {
    const b = $("#special");
    (b.querySelector("i") as HTMLElement).style.transform = `scaleX(${Math.max(0, f)})`;
    b.classList.toggle("ready", f <= 0);
  });
}
