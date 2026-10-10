// Deterministic, offline mutation compiler + director. Used when no API key is
// configured, when the model call fails, or when the browser can't reach the server.
import {
  COLORS,
  MutationPlanSchema,
  type ColorName,
  type CombatSummary,
  type ComponentType,
  type DirectorDecision,
  type MutationPlan,
  type Personality,
} from "./mutations";

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

function pickColor(t: string, dflt: ColorName): ColorName {
  for (const c of COLORS) if (t.includes(c)) return c;
  if (has(t, "blue", "neon")) return "cyan";
  if (has(t, "fire", "flame", "lava")) return "orange";
  if (has(t, "toxic", "acid")) return "green";
  if (has(t, "golden", "yellow")) return "gold";
  return dflt;
}

function magnitude(t: string): number {
  if (has(t, "colossal", "enormous", "gigantic", "absurd", "insane", "ultra", "mega")) return 2.6;
  if (has(t, "giant", "massive", "huge", "big", "heavy", "large", "strong", "powerful")) return 2;
  if (has(t, "small", "tiny", "little", "light", "mini")) return 0.7;
  return 1.3;
}

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 6, eight: 6, ten: 6, dozen: 6, hundred: 6, many: 6 };

/** "six rocket boosters" / "4 jets" -> 6 / 4 (clamped later to 1..6) */
function boosterCount(t: string): number | undefined {
  const m = t.match(/(\d+|one|two|three|four|five|six|seven|eight|ten|dozen|hundred|many)\s+(?:\w+\s+){0,2}(?:rocket|booster|jet|thruster|engine)/);
  if (!m) return undefined;
  return Number.isFinite(Number(m[1])) ? Number(m[1]) : NUMBERS[m[1]];
}

const op = (component: ComponentType, socket: string, v: Partial<Record<"size" | "power" | "mass" | "length" | "count" | "rocket", number>>, color: ColorName, kind = "attach") => ({
  op: kind,
  component,
  socket,
  size: v.size ?? 1.3,
  power: v.power ?? 1.3,
  mass: v.mass ?? 1.3,
  length: v.length ?? 1.3,
  count: v.count ?? (kind === "modify" ? 1 : 2),
  rocket: v.rocket ?? 0,
  color,
});

/** Curated "Surprise me" builds — all valid, all within physics limits. Rotated by seed. */
export const SURPRISES: { summary: string; ops: ReturnType<typeof op>[] }[] = [
  { summary: "Surprise: a rocket-powered wrecking ball and six back jets. Good luck.", ops: [op("chain_weapon", "right_hand", { size: 2.2, mass: 3.5, length: 2, rocket: 2.5, power: 2 }, "gold"), op("rocket_booster", "back", { count: 6, power: 2, size: 1.2 }, "orange")] },
  { summary: "Surprise: spring-loaded boxing glove plus pogo legs. Boing-based combat.", ops: [op("boxing_glove", "right_hand", { size: 2.2, power: 2.5, length: 2.2 }, "red"), op("spring_legs", "feet", { power: 2.6, size: 1.5 }, "green")] },
  { summary: "Surprise: tank mode. Purple armor, a cyan shield and rocket boots.", ops: [op("armor_plating", "torso", { power: 2.5, size: 1.6 }, "purple"), op("shield", "left_hand", { size: 1.8, power: 2.5 }, "cyan"), op("rocket_booster", "feet", { count: 2, power: 1.6 }, "orange")] },
  { summary: "Surprise: a feather-light flail on an absurdly long chain.", ops: [op("chain_weapon", "right_hand", { size: 0.9, mass: 0.7, length: 3, power: 1.5 }, "cyan")] },
  { summary: "Surprise: four golden jets and a rocket haymaker.", ops: [op("rocket_booster", "back", { count: 4, power: 2.2, size: 1.4 }, "gold"), op("boxing_glove", "right_hand", { size: 1.8, power: 2.2, rocket: 2 }, "red")] },
];

export function fallbackCompile(prompt: string, owned: ComponentType[] = [], seed = 0): MutationPlan {
  const t = prompt.toLowerCase();
  const m = magnitude(t);
  const ops: unknown[] = [];
  const side = has(t, "left") ? "left_hand" : "right_hand";
  const base = { size: m, power: m, mass: m, length: 1.3 };

  // --- whole-plan presets ---
  if (has(t, "surprise", "random", "dealer's choice", "anything")) {
    const pick = SURPRISES[Math.abs(seed) % SURPRISES.length];
    return MutationPlanSchema.parse({ summary: pick.summary, operations: pick.ops });
  }
  if (has(t, "ridiculous", "most absurd", "stupidest", "dumbest", "maximum", "everything")) {
    return MutationPlanSchema.parse({
      summary: "Maximum ridiculousness: rocket wrecking hammer, six jets, a rocket boxing glove. Permits denied.",
      operations: [
        op("chain_weapon", "right_hand", { size: 3, mass: 5, length: 2.6, power: 3, rocket: 3 }, "gold"),
        op("rocket_booster", "back", { count: 6, power: 3, size: 1.4 }, "orange"),
        op("boxing_glove", "left_hand", { size: 2.6, power: 3, length: 2.4, rocket: 2 }, "red"),
      ],
    });
  }

  const removing = has(t, "remove", "drop ", "detach", "lose", "get rid");
  const modifying = has(t, "heavier", "lighter", "longer", "shorter", "bigger", "stronger", "more power", "faster", "upgrade", "make my", "make the");

  const rocketWord = has(t, "rocket", "jet", "thrust", "propel", "booster", "fly", "flight");
  const wantsGlove = has(t, "glove", "boxing", "fist", "punch", "haymaker");
  const wantsChain = has(t, "chain", "hammer", "flail", "mace", "wrecking", "ball", "weapon") && !(wantsGlove && !has(t, "chain", "hammer", "flail", "mace", "wrecking"));
  const weaponRocket = (wantsChain || wantsGlove) && has(t, "rocket-powered", "rocket powered", "jet-powered", "jet powered", "rocket-assisted", "rocket hammer", "rocket glove", "rocket fist", "rocket flail");
  const count = boosterCount(t);
  const wantsRocket = (rocketWord && !weaponRocket) || count !== undefined || has(t, "booster");
  const wantsShield = has(t, "shield", "barrier", "block", "protect", "defen", "guard");
  const wantsSpring = (has(t, "spring leg", "springs on", "jump", "leap", "bounce", "pogo") || (has(t, "spring") && !wantsGlove));
  const wantsArmor = has(t, "armor", "armour", "plating", "plate", "tank");
  const rocketAssist = weaponRocket ? Math.min(3, 1.5 + m * 0.5) : 0;

  const target = (): ComponentType =>
    wantsGlove ? "boxing_glove" : wantsRocket ? "rocket_booster" : wantsShield ? "shield" : wantsSpring ? "spring_legs" : wantsArmor ? "armor_plating" : "chain_weapon";

  if (removing) {
    ops.push(op(target(), "torso", { size: 1, power: 1, mass: 1, length: 1 }, "orange", "remove"));
  } else if (modifying && (owned.length > 0 || has(t, "weapon"))) {
    const tg: ComponentType = has(t, "weapon") && !wantsGlove && owned.includes("boxing_glove") && !owned.includes("chain_weapon") ? "boxing_glove" : target();
    const up = !has(t, "lighter", "shorter", "smaller", "weaker");
    const k = up ? 1.8 : 0.6;
    const owns = owned.includes(tg);
    const sock = tg === "chain_weapon" || tg === "boxing_glove" ? side : tg === "rocket_booster" ? "back" : tg === "shield" ? "left_hand" : tg === "spring_legs" ? "feet" : "torso";
    ops.push(
      op(
        tg,
        sock,
        {
          size: owns ? (has(t, "bigger", "larger", "smaller") ? k : 1) : m,
          power: owns ? (has(t, "stronger", "more power", "faster", "weaker") ? k : 1) : m,
          mass: owns ? (has(t, "heavier", "lighter") ? k : 1) : m,
          length: owns ? (has(t, "longer", "shorter") ? k : 1) : 1.3,
          count: owns ? (count ?? 1) : (count ?? 2),
          rocket: weaponRocket ? rocketAssist : 0,
        },
        pickColor(t, "orange"),
        owns ? "modify" : "attach",
      ),
    );
  } else {
    if (wantsRocket)
      ops.push(op("rocket_booster", has(t, "feet", "foot", "boots", "legs") ? "feet" : "back", { ...base, count: count ?? 2, power: Math.max(m, count && count > 2 ? 1.8 : m) }, pickColor(t, "orange")));
    if (wantsChain) ops.push(op("chain_weapon", side, { ...base, length: has(t, "long") ? 2.2 : 1.4, rocket: rocketAssist }, pickColor(t, "gold")));
    if (wantsGlove)
      ops.push(op("boxing_glove", wantsChain && side === "right_hand" ? "left_hand" : side, { ...base, length: has(t, "long", "spring") ? 2 : 1.5, rocket: rocketAssist }, pickColor(t, "red")));
    if (wantsShield) ops.push(op("shield", has(t, "right") && !wantsChain && !wantsGlove ? "right_hand" : "left_hand", base, pickColor(t, "cyan")));
    if (wantsSpring) ops.push(op("spring_legs", "feet", base, pickColor(t, "green")));
    if (wantsArmor) ops.push(op("armor_plating", "torso", base, pickColor(t, "purple")));
  }

  if (ops.length === 0) {
    // Unknown request: give them *something* fun rather than nothing.
    ops.push(op("chain_weapon", "right_hand", { size: 1.4, power: 1.4, mass: 1.6, length: 1.4 }, pickColor(t, "gold")));
  }

  const names = (ops as { op: string; component: string; count?: number }[])
    .map((o) => `${o.op} ${o.component === "rocket_booster" && (o.count ?? 2) > 2 ? `${o.count}× ` : ""}${o.component.replace("_", " ")}`)
    .join(", ");
  return MutationPlanSchema.parse({ summary: `Workshop override: ${names}.`.slice(0, 160), operations: ops.slice(0, 3) });
}

/** Mutation roulette: absurd but fully supported prompts (each compiles to a valid plan offline). */
export const ROULETTE: string[] = [
  "Give me six rocket boosters and a tiny shield",
  "Attach a giant rocket-powered boxing glove",
  "Strap a colossal wrecking ball on a long chain to my left arm",
  "Pogo spring legs and gold armor plating",
  "Rocket boots and a massive chain hammer",
  "Four purple jets on my back and a heavy flail",
  "A huge boxing glove on a spring and pogo legs",
  "Make me an unstoppable tank with armor and a shield",
  "Rocket-powered flail with a mega spiked ball",
  "Three cyan rocket boosters and a long boxing glove",
];

const ACTION_NAME: Record<DirectorDecision["action"], string> = {
  none: "a dramatic pause",
  enemy_laser_barrage: "laser barrage",
  enemy_leap_slam: "leap slam",
  enemy_shield_up: "carapace shield",
  enemy_enrage: "full enrage",
  arena_crane_drop: "crane drop",
  arena_steam_vent: "steam vents",
  arena_crate_rain: "crate rain",
};

/** Pick a countermeasure from the actual build/state (deterministic). */
function chooseAction(s: CombatSummary): { action: DirectorDecision["action"]; intensity: number } {
  const comps = s.playerComponents;
  const roll = (s.round * 7 + Math.floor(s.elapsed)) % 4;
  const intensity = s.enemyHp < 40 ? 3 : s.enemyHp < 70 ? 2 : 1;
  const arenaOnly: DirectorDecision["action"][] = ["arena_crate_rain", "arena_crane_drop", "arena_steam_vent"];
  if (s.mode === "lab") return { action: arenaOnly[s.round % 3], intensity: 1 };
  if (s.playerHp < 25) return { action: "none", intensity: 1 }; // ease off a losing player
  if (s.enemyHp < 25) return { action: "enemy_enrage", intensity: 3 };
  if (comps.includes("rocket_booster") && roll < 2) return { action: "enemy_laser_barrage", intensity };
  if ((comps.includes("chain_weapon") || comps.includes("boxing_glove")) && roll === 2) return { action: "enemy_shield_up", intensity };
  if (comps.includes("shield") && roll === 3) return { action: "enemy_leap_slam", intensity };
  const generic: DirectorDecision["action"][] = ["arena_crate_rain", "arena_crane_drop", "arena_steam_vent", "enemy_laser_barrage"];
  return { action: generic[s.round % generic.length], intensity };
}

/** Parse the most recent notable event into a short phrase, e.g. "hammer hit spider for 35". */
function lastEvent(events: string[]): { kind: "mutation" | "hit" | "hurt" | "special" | "none"; text: string } {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i].replace(/^\[t=\d+\]\s*/, "");
    if (e.startsWith("player mutated:")) return { kind: "mutation", text: e.replace("player mutated:", "").replace("Workshop override:", "").trim().replace(/\.$/, "") };
    if (/hit spider for|crushed spider/.test(e)) return { kind: "hit", text: e };
    if (/hit player for|crushed player/.test(e)) return { kind: "hurt", text: e };
    if (e.startsWith("player used special")) return { kind: "special", text: e.replace("player used special ", "") };
  }
  return { kind: "none", text: "" };
}

const pick = <T,>(arr: T[], n: number) => arr[Math.abs(n) % arr.length];

/** Contextual local commentary in each director personality's voice. */
export function voiceLine(p: Personality, s: CombatSummary, action: DirectorDecision["action"]): string {
  const ev = lastEvent(s.events);
  const act = ACTION_NAME[action];
  const who = (s.character ?? "goblin").toUpperCase();
  const comp = (s.playerComponents[s.playerComponents.length - 1] ?? "bare chassis").replace(/_/g, " ");
  const n = s.round;
  const lines: Record<Personality, Record<string, string[]>> = {
    tactical: {
      mutation: [`New hardware logged: ${ev.text}. Threat revised. Countering with ${act}.`, `Loadout change confirmed (${comp}). Adjusting doctrine: ${act}.`],
      hit: [`Confirmed: ${ev.text}. Enemy integrity ${s.enemyHp}%. Response: ${act}.`, `Effective strike. Arachnotron at ${s.enemyHp}%. Deploying ${act}.`],
      hurt: [`${who} hull at ${s.playerHp}%. Recommend evasive movement. Next: ${act}.`],
      special: [`${ev.text} observed. Adapting. Executing ${act}.`],
      none: [`T+${s.elapsed}s. Player ${s.playerHp}% vs enemy ${s.enemyHp}%. Executing ${act}.`],
    },
    inspector: {
      mutation: [`Inspection note: ${ev.text}. Zero permits filed. Approving ${act}.`, `${comp} bolted on with duct tape and optimism. Citation: ${act}.`],
      hit: [`${ev.text}. Structurally questionable, legally hilarious. Fine: ${act}.`, `That impact voided three warranties. Spider at ${s.enemyHp}%. Issuing ${act}.`],
      hurt: [`Hull at ${s.playerHp}%, warranty at 0%. Scheduling ${act}.`],
      special: [`${ev.text}? Not in the safety manual. Retaliatory ${act} approved.`],
      none: [`Code violation #${n * 7 + 13}: insufficient guard rails. Approving ${act}.`, `Routine inspection of ${who}: everything is on fire. Adding ${act}.`],
    },
    chaos: {
      mutation: [`${ev.text.toUpperCase()}!!! WHO APPROVED THIS?! ME!!! ${act.toUpperCase()}!!!`, `${comp.toUpperCase()}?!?! INCREDIBLE. TERRIBLE. ${act.toUpperCase()} TIME!!!`],
      hit: [`${ev.text.toUpperCase()}!!! THE FLOOR IS SCREAMING!!! ${act.toUpperCase()}!!!`, `SPIDER AT ${s.enemyHp}% AND I AM AT 1000%!!! ${act.toUpperCase()}!!!`],
      hurt: [`${who} AT ${s.playerHp}% AND I'VE NEVER BEEN HAPPIER!!! ${act.toUpperCase()}!!!`],
      special: [`${ev.text.toUpperCase()}!!! DO IT AGAIN!!! ${act.toUpperCase()} FOR EVERYONE!!!`],
      none: [`ROUND ${n}!!! THE CRATES ARE HUNGRY!!! ${act.toUpperCase()}!!!`, `NOBODY WARNED ${who} ABOUT THE ${act.toUpperCase()}!!! HERE IT COMES!!!`],
    },
  };
  return pick(lines[p][ev.kind], n).slice(0, 140);
}

export function fallbackDirect(s: CombatSummary): DirectorDecision {
  const { action, intensity } = chooseAction(s);
  return { commentary: voiceLine(s.personality ?? "inspector", s, action), action, intensity };
}
