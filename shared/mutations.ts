import { z } from "zod";

// ---------------------------------------------------------------------------
// Deterministic component library. The LLM may only compose / configure these.
// ---------------------------------------------------------------------------
export const COMPONENTS = ["rocket_booster", "chain_weapon", "shield", "spring_legs", "armor_plating", "boxing_glove"] as const;
export const SOCKETS = ["back", "left_hand", "right_hand", "feet", "torso"] as const;
export const COLORS = ["orange", "cyan", "red", "green", "purple", "gold"] as const;
export const OPS = ["attach", "modify", "remove"] as const;

export type ComponentType = (typeof COMPONENTS)[number];
export type Socket = (typeof SOCKETS)[number];
export type ColorName = (typeof COLORS)[number];

export const COLOR_HEX: Record<ColorName, number> = {
  orange: 0xff7a1a,
  cyan: 0x26f0ff,
  red: 0xff3344,
  green: 0x5dff7a,
  purple: 0xb45cff,
  gold: 0xffc83d,
};

/** Sockets each component may legally use (first is default). */
export const ALLOWED_SOCKETS: Record<ComponentType, Socket[]> = {
  rocket_booster: ["back", "feet"],
  chain_weapon: ["right_hand", "left_hand"],
  shield: ["left_hand", "right_hand", "torso"],
  spring_legs: ["feet"],
  armor_plating: ["torso"],
  boxing_glove: ["right_hand", "left_hand"],
};

export const BOUNDS = {
  size: [0.5, 3],
  power: [0.5, 3],
  mass: [0.5, 5],
  length: [0.5, 3],
  count: [1, 6],
  rocket: [0, 3],
} as const;

const clamp = (lo: number, hi: number) =>
  z
    .number()
    .finite()
    .transform((v) => Math.min(hi, Math.max(lo, v)));

export const OperationSchema = z
  .object({
    op: z.enum(OPS),
    component: z.enum(COMPONENTS),
    socket: z.enum(SOCKETS),
    size: clamp(...BOUNDS.size),
    power: clamp(...BOUNDS.power),
    mass: clamp(...BOUNDS.mass),
    length: clamp(...BOUNDS.length),
    color: z.enum(COLORS),
    // Optional so older plans / console commands stay valid; clamped below.
    count: z.number().finite().optional(),
    rocket: z.number().finite().optional(),
  })
  .transform((o) => ({
    ...o,
    count: Math.round(Math.min(BOUNDS.count[1], Math.max(BOUNDS.count[0], o.count ?? (o.op === "modify" ? 1 : 2)))),
    rocket: Math.min(BOUNDS.rocket[1], Math.max(BOUNDS.rocket[0], o.rocket ?? 0)),
    // Snap illegal socket choices to the component's default socket.
    socket: ALLOWED_SOCKETS[o.component].includes(o.socket) ? o.socket : ALLOWED_SOCKETS[o.component][0],
  }));

export const MutationPlanSchema = z.object({
  summary: z.string().min(1).max(160),
  operations: z.array(OperationSchema).min(1).max(3),
});

export type Operation = z.output<typeof OperationSchema>;
export type MutationPlan = z.output<typeof MutationPlanSchema>;

/** JSON schema handed to the model as a structured-output format. */
export const MUTATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "operations"],
  properties: {
    summary: { type: "string", description: "One punchy sentence (<120 chars) describing the mutation." },
    operations: {
      type: "array",
      description: "1 to 3 operations.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "component", "socket", "size", "power", "mass", "length", "color", "count", "rocket"],
        properties: {
          op: { type: "string", enum: [...OPS] },
          component: { type: "string", enum: [...COMPONENTS] },
          socket: { type: "string", enum: [...SOCKETS] },
          size: { type: "number", description: "0.5-3. Visual/physical scale. For modify: multiplier (1 = unchanged)." },
          power: { type: "number", description: "0.5-3. Thrust / shield durability / jump strength. For modify: multiplier." },
          mass: { type: "number", description: "0.5-5. Weapon head weight. For modify: multiplier." },
          length: { type: "number", description: "0.5-3. Chain length. For modify: multiplier." },
          color: { type: "string", enum: [...COLORS] },
          count: { type: "integer", description: "1-6. Number of rocket boosters (other components: 1). For modify: new count, or 1 = unchanged." },
          rocket: { type: "number", description: "0-3. Rocket assist on a chain_weapon or boxing_glove (0 = none). For modify: new value, 0 = unchanged." },
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Director contract
// ---------------------------------------------------------------------------
export const DIRECTOR_ACTIONS = [
  "none",
  "enemy_laser_barrage",
  "enemy_leap_slam",
  "enemy_shield_up",
  "enemy_enrage",
  "arena_crane_drop",
  "arena_steam_vent",
  "arena_crate_rain",
] as const;
export type DirectorAction = (typeof DIRECTOR_ACTIONS)[number];

export const DirectorDecisionSchema = z.object({
  commentary: z.string().min(1).max(140),
  action: z.enum(DIRECTOR_ACTIONS),
  intensity: z
    .number()
    .finite()
    .transform((v) => Math.round(Math.min(3, Math.max(1, v)))),
});
export type DirectorDecision = z.output<typeof DirectorDecisionSchema>;

export const DIRECTOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["commentary", "action", "intensity"],
  properties: {
    commentary: { type: "string", description: "Sardonic arena-announcer line, under 100 characters." },
    action: { type: "string", enum: [...DIRECTOR_ACTIONS] },
    intensity: { type: "integer", description: "1-3" },
  },
} as const;

export interface CombatSummary {
  elapsed: number;
  playerHp: number;
  enemyHp: number;
  playerComponents: string[];
  events: string[];
  round: number;
}

export type LinkState = "no_key" | "checking" | "live" | "auth_failed" | "degraded" | "offline";

export interface MutateResponse {
  plan: MutationPlan;
  source: "sonnet" | "fallback";
  note?: string;
  link?: LinkState;
}

export interface DirectorResponse {
  decision: DirectorDecision;
  source: "opus" | "fallback";
  note?: string;
  link?: LinkState;
}
