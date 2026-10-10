// Repeatable challenge presets (arena mode only).
export interface Challenge {
  id: string;
  name: string;
  desc: string;
  playerHpMul?: number;
  dealMul?: number; // damage dealt multiplier
  spiderHp?: number;
  enraged?: boolean;
  timeLimit?: number; // seconds
  noMutations?: boolean;
}

export const CHALLENGES: Challenge[] = [
  { id: "standard", name: "STANDARD BOUT", desc: "One fighter, one spider, unlimited bad ideas." },
  { id: "glass", name: "GLASS CANNON", desc: "35% hull, but you hit 1.6× harder.", playerHpMul: 0.35, dealMul: 1.6 },
  { id: "clock", name: "BEAT THE CLOCK", desc: "Decommission the spider in 75 seconds.", timeLimit: 75 },
  { id: "enraged", name: "ENRAGED ARACHNOTRON", desc: "220 HP, permanently furious.", spiderHp: 220, enraged: true },
  { id: "nomod", name: "FACTORY SETTINGS", desc: "No mutations allowed. Specials only.", noMutations: true },
];

export const challengeById = (id?: string) => CHALLENGES.find((c) => c.id === id) ?? CHALLENGES[0];
