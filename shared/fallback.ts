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

export function fallbackCompile(prompt: string, owned: ComponentType[] = []): MutationPlan {
  const t = prompt.toLowerCase();
  const m = magnitude(t);
  const ops: unknown[] = [];
  const side = has(t, "left") ? "left_hand" : "right_hand";
  const base = { size: m, power: m, mass: m, length: 1.3 };

  const removing = has(t, "remove", "drop ", "detach", "lose", "get rid");
  const modifying = has(t, "heavier", "lighter", "longer", "shorter", "bigger", "stronger", "more power", "faster", "upgrade", "make my", "make the");

  const wantsRocket = has(t, "rocket", "booster", "jet", "thrust", "fly", "flight", "propel");
  const wantsChain = has(t, "chain", "hammer", "flail", "mace", "wrecking", "weapon", "ball");
  const wantsShield = has(t, "shield", "barrier", "block", "protect", "defen", "guard");
  const wantsSpring = has(t, "spring", "jump", "leap", "bounce", "pogo");
  const wantsArmor = has(t, "armor", "armour", "plating", "plate", "tank");

  if (removing) {
    const target: ComponentType = wantsRocket
      ? "rocket_booster"
      : wantsShield
        ? "shield"
        : wantsSpring
          ? "spring_legs"
          : wantsArmor
            ? "armor_plating"
            : "chain_weapon";
    ops.push({ op: "remove", component: target, socket: "torso", size: 1, power: 1, mass: 1, length: 1, color: "orange" });
  } else if (modifying && (owned.length > 0 || has(t, "weapon"))) {
    const target: ComponentType = wantsRocket
      ? "rocket_booster"
      : wantsShield
        ? "shield"
        : wantsSpring
          ? "spring_legs"
          : wantsArmor
            ? "armor_plating"
            : "chain_weapon";
    const up = !has(t, "lighter", "shorter", "smaller", "weaker");
    const k = up ? 1.8 : 0.6;
    ops.push({
      op: owned.includes(target) ? "modify" : "attach",
      component: target,
      socket: target === "chain_weapon" ? side : target === "rocket_booster" ? "back" : target === "shield" ? "left_hand" : target === "spring_legs" ? "feet" : "torso",
      size: owned.includes(target) ? (has(t, "bigger", "larger", "smaller") ? k : 1) : m,
      power: owned.includes(target) ? (has(t, "stronger", "more power", "faster", "weaker") ? k : 1) : m,
      mass: owned.includes(target) ? (has(t, "heavier", "lighter") ? k : 1) : m,
      length: owned.includes(target) ? (has(t, "longer", "shorter") ? k : 1) : 1.3,
      color: pickColor(t, "orange"),
    });
  } else {
    if (wantsRocket)
      ops.push({ op: "attach", component: "rocket_booster", socket: has(t, "feet", "foot", "boots", "legs") ? "feet" : "back", ...base, color: pickColor(t, "orange") });
    if (wantsChain)
      ops.push({ op: "attach", component: "chain_weapon", socket: side, ...base, length: has(t, "long") ? 2.2 : 1.4, color: pickColor(t, "gold") });
    if (wantsShield)
      ops.push({ op: "attach", component: "shield", socket: side === "right_hand" && has(t, "right") ? "right_hand" : "left_hand", ...base, color: pickColor(t, "cyan") });
    if (wantsSpring) ops.push({ op: "attach", component: "spring_legs", socket: "feet", ...base, color: pickColor(t, "green") });
    if (wantsArmor) ops.push({ op: "attach", component: "armor_plating", socket: "torso", ...base, color: pickColor(t, "purple") });
  }

  if (ops.length === 0) {
    // Unknown request: give them *something* fun rather than nothing.
    ops.push({ op: "attach", component: "chain_weapon", socket: "right_hand", size: 1.4, power: 1.4, mass: 1.6, length: 1.4, color: pickColor(t, "gold") });
  }

  const names = (ops as { op: string; component: string }[]).map((o) => `${o.op} ${o.component.replace("_", " ")}`).join(", ");
  return MutationPlanSchema.parse({ summary: `Workshop override: ${names}.`.slice(0, 160), operations: ops.slice(0, 3) });
}

const LINES: Record<string, string[]> = {
  rocket_booster: ["Goblin airborne. Spider recalibrating anti-air optics.", "Boosters detected. Lasers now tracking the sky."],
  chain_weapon: ["Heavy iron swinging. Spider hardening its carapace.", "That flail has opinions. Countermeasures deployed."],
  shield: ["Shield up? Cute. The spider will simply fall on you.", "Defensive posture logged. Initiating leap protocol."],
  generic: ["The crowd demands pain. Dropping hardware.", "Arena maintenance: optional. Crates: mandatory.", "Steam pressure rising. Mind the vents."],
};

export function fallbackDirect(s: CombatSummary): DirectorDecision {
  const comps = s.playerComponents;
  const roll = (s.round * 7 + Math.floor(s.elapsed)) % 4;
  const intensity = s.enemyHp < 40 ? 3 : s.enemyHp < 70 ? 2 : 1;
  if (s.enemyHp < 25) return { commentary: "Spider critical. Overclocking all servos.", action: "enemy_enrage", intensity: 3 };
  if (comps.includes("rocket_booster") && roll < 2) return { commentary: LINES.rocket_booster[roll % 2], action: "enemy_laser_barrage", intensity };
  if (comps.includes("chain_weapon") && roll === 2) return { commentary: LINES.chain_weapon[s.round % 2], action: "enemy_shield_up", intensity };
  if (comps.includes("shield") && roll === 3) return { commentary: LINES.shield[s.round % 2], action: "enemy_leap_slam", intensity };
  const generic: DirectorDecision["action"][] = ["arena_crate_rain", "arena_crane_drop", "arena_steam_vent", "enemy_laser_barrage"];
  return { commentary: LINES.generic[s.round % 3], action: generic[s.round % generic.length], intensity };
}
