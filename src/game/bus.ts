import Phaser from "phaser";

/** Game <-> HUD event bus. */
export const bus = new Phaser.Events.EventEmitter();

export const EV = {
  HP: "hp", // { player, enemy }
  FUEL: "fuel", // 0..1
  DIRECTOR: "director", // { text, source, action }
  MUTATION_START: "mutation-start", // { prompt }
  MUTATION_PLAN: "mutation-plan", // { plan, source, note }
  MUTATION_DONE: "mutation-done", // { plan }
  MUTATION_ERROR: "mutation-error", // { error }
  CINEMATIC: "cinematic", // boolean
  BLUEPRINT: "blueprint", // { lines: string[] } | null
  LOADOUT: "loadout", // string[]
  IMPACT: "impact", // { power }
  GAME_OVER: "game-over", // { winner }
} as const;
