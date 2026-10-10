import Phaser from "phaser";

// ---------------------------------------------------------------------------
// Playable characters. All four share the same active-ragdoll + mutation system
// (Goblin.ts); they differ in proportions, physics profile, art and special.
// ---------------------------------------------------------------------------
export type CharacterId = "goblin" | "diva" | "gremlin" | "menace" | "kratos" | "doraemon";
export type SpecialId =
  | "scrap_bomb"
  | "sonic_wave"
  | "dome"
  | "ground_pound"
  // imported-character abilities (src/game/abilities.ts)
  | "leviathan_axe"
  | "spartan_rage"
  | "air_cannon"
  | "bamboo_copter"
  | "anywhere_door";

export interface AbilityDef {
  id: SpecialId;
  name: string;
  short?: string; // label for the ability strip
  desc: string;
  cooldown: number;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  title: string;
  bio: string;
  quote: string;
  tex: string; // texture key prefix
  accent: string; // css color for UI
  dims: {
    torso: [number, number];
    head: number; // head collision radius
    headOffset: number; // head sprite y offset from body center
    uarm: [number, number];
    farm: [number, number];
    thigh: [number, number];
    shin: [number, number];
  };
  density: number; // torso density
  hp: number;
  armor: number; // damage multiplier (1 = none)
  speed: number;
  jump: number;
  airJumps: number;
  backTint: number;
  special: AbilityDef; // slot 1 (F / E / 1)
  extra?: AbilityDef[]; // slots 2, 3 (keys 2 / 3)
  /** imported character whose real 3D/2D model is not in the repo yet: uses a neutral prototype rig */
  modelPending?: boolean;
  stats: { speed: number; power: number; armor: number; chaos: number }; // 1..5 for the select screen
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: "goblin",
    name: "MECH GOBLIN",
    title: "Scrapyard Prodigy",
    bio: "Built itself out of a toaster and three bad decisions. Will bolt anything to anything.",
    quote: "“If it fits, it ships.”",
    tex: "g",
    accent: "#6fae3c",
    dims: { torso: [36, 50], head: 19, headOffset: 0, uarm: [12, 28], farm: [11, 28], thigh: [14, 28], shin: [14, 32] },
    density: 0.004,
    hp: 100,
    armor: 1,
    speed: 6.5,
    jump: 12.5,
    airJumps: 0,
    backTint: 0xb8c0c8,
    special: { id: "scrap_bomb", name: "SCRAP BOMB", desc: "Lobs a fizzing junk bomb that explodes on contact.", cooldown: 3.5 },
    stats: { speed: 3, power: 3, armor: 3, chaos: 4 },
  },
  {
    id: "diva",
    name: "THE DIVA",
    title: "Chrome Pop Sensation",
    bio: "Sold out every arena in the sector. Tonight's arena just doesn't know it yet.",
    quote: "“Hit the high note. Then hit you.”",
    tex: "d",
    accent: "#ff4fd8",
    dims: { torso: [30, 46], head: 17, headOffset: -4, uarm: [10, 30], farm: [9, 30], thigh: [12, 34], shin: [12, 38] },
    density: 0.003,
    hp: 85,
    armor: 1,
    speed: 8.6,
    jump: 14,
    airJumps: 1,
    backTint: 0xd8b8d0,
    special: { id: "sonic_wave", name: "SONIC SHOCKWAVE", desc: "A high note that blasts enemies back and shatters incoming lasers.", cooldown: 3.5 },
    stats: { speed: 5, power: 3, armor: 2, chaos: 4 },
  },
  {
    id: "gremlin",
    name: "GADGET GREMLIN",
    title: "Pocket-Sized Engineer",
    bio: "Fits in a lunchbox. Carries a dome generator in its tummy for emotional support.",
    quote: "“Beep. I fixed it. It's worse now.”",
    tex: "r",
    accent: "#26f0ff",
    dims: { torso: [30, 30], head: 20, headOffset: -4, uarm: [9, 20], farm: [9, 22], thigh: [11, 18], shin: [12, 22] },
    density: 0.0035,
    hp: 80,
    armor: 1,
    speed: 7.4,
    jump: 12.5,
    airJumps: 0,
    backTint: 0xa0c8cc,
    special: { id: "dome", name: "POP-UP DOME", desc: "Deploys a hex-shield bubble: invulnerable, reflects lasers, repels the spider.", cooldown: 6 },
    stats: { speed: 4, power: 2, armor: 4, chaos: 3 },
  },
  {
    id: "menace",
    name: "INDUSTRIAL MENACE",
    title: "Demolition Unit 9",
    bio: "Union-certified wrecking machine. Takes two coffee breaks per fight, mandatory.",
    quote: "“Load-bearing walls are a suggestion.”",
    tex: "m",
    accent: "#ffc83d",
    dims: { torso: [50, 60], head: 21, headOffset: 0, uarm: [17, 32], farm: [18, 34], thigh: [19, 30], shin: [22, 34] },
    density: 0.006,
    hp: 160,
    armor: 0.75,
    speed: 4.8,
    jump: 10.5,
    airJumps: 0,
    backTint: 0xb0a890,
    special: { id: "ground_pound", name: "GROUND POUND", desc: "Leaps and slams the floor, shockwave damages everything nearby.", cooldown: 4 },
    stats: { speed: 1, power: 5, armor: 5, chaos: 3 },
  },
];

// ---------------------------------------------------------------------------
// Imported characters (models supplied separately). Mechanics are bound to these
// stable ids; until the model files exist they render as a clearly-labelled neutral
// prototype rig and are kept out of the main roster (select screen "prototype bay").
// ---------------------------------------------------------------------------
export const IMPORTED: CharacterDef[] = [
  {
    id: "kratos",
    name: "KRATOS",
    title: "Imported fighter · model pending",
    bio: "Throws his axe, recalls it, and is extremely annoyed by spiders.",
    quote: "“Prototype rig — real model pending import.”",
    tex: "xk",
    accent: "#e0402a",
    dims: { torso: [40, 56], head: 18, headOffset: 0, uarm: [15, 32], farm: [15, 32], thigh: [17, 32], shin: [18, 36] },
    density: 0.005,
    hp: 140,
    armor: 0.85,
    speed: 6.2,
    jump: 12.5,
    airJumps: 0,
    backTint: 0xa8a0a0,
    special: { id: "leviathan_axe", name: "LEVIATHAN AXE", short: "AXE", desc: "Throw the axe; it recalls along an arc and can hit on the way back.", cooldown: 2.2 },
    extra: [{ id: "spartan_rage", name: "SPARTAN RAGE", short: "RAGE", desc: "6 s: ground-slam entry, shockwave punches, 1.4× damage dealt, half damage taken.", cooldown: 18 }],
    modelPending: true,
    stats: { speed: 3, power: 5, armor: 4, chaos: 3 },
  },
  {
    id: "doraemon",
    name: "DORAEMON",
    title: "Imported fighter · model pending",
    bio: "Pulls gadgets out of a pocket. The pocket is bigger on the inside.",
    quote: "“Prototype rig — real model pending import.”",
    tex: "xd",
    accent: "#2a9df4",
    dims: { torso: [40, 38], head: 24, headOffset: 0, uarm: [10, 18], farm: [11, 18], thigh: [13, 14], shin: [16, 16] },
    density: 0.004,
    hp: 100,
    armor: 1,
    speed: 6.5,
    jump: 12,
    airJumps: 0,
    backTint: 0xa0b4c8,
    special: { id: "air_cannon", name: "AIR CANNON", short: "AIR CANNON", desc: "Compressed-air blast: big knockback, light damage.", cooldown: 1.2 },
    extra: [
      { id: "bamboo_copter", name: "BAMBOO COPTER", short: "COPTER", desc: "Rotor hover for up to 5 s (hold W/SPACE to climb), safe landing after.", cooldown: 9 },
      { id: "anywhere_door", name: "ANYWHERE DOOR", short: "DOOR", desc: "Step through a door and out of another one somewhere safe.", cooldown: 8 },
    ],
    modelPending: true,
    stats: { speed: 3, power: 2, armor: 3, chaos: 5 },
  },
];

export const charById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? IMPORTED.find((c) => c.id === id) ?? CHARACTERS[0];
export const abilitiesOf = (def: CharacterDef): AbilityDef[] => [def.special, ...(def.extra ?? [])];

// ---------------------------------------------------------------------------
// Procedural textures for the three new characters (Goblin's live in textures.ts)
// ---------------------------------------------------------------------------
type G = Phaser.GameObjects.Graphics;
const V = (x: number, y: number) => new Phaser.Math.Vector2(x, y);
function tex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}
function limb(scene: Phaser.Scene, key: string, w: number, h: number, outer: number, inner: number, joint: number, band?: number) {
  tex(scene, key, w + 2, h + 2, (g) => {
    g.fillStyle(outer).fillRoundedRect(0, 0, w + 2, h + 2, (w + 2) / 2);
    g.fillStyle(inner).fillRoundedRect(2, 2, w - 2, h - 2, (w - 2) / 2);
    g.fillStyle(joint).fillCircle((w + 2) / 2, (w + 2) / 2, w / 3);
    if (band !== undefined) g.fillStyle(band).fillRect(1, h * 0.62, w, 3);
  });
}

/** Neutral prototype rig (no character likeness) sized from the def's dims. */
function buildMannequin(scene: Phaser.Scene, def: CharacterDef) {
  const T = (p: string) => `${def.tex}_${p}`;
  const acc = Phaser.Display.Color.HexStringToColor(def.accent).color;
  const D = def.dims;
  const part = (key: string, [w, h]: [number, number], stripe: boolean) =>
    tex(scene, T(key), w + 2, h + 2, (g) => {
      g.fillStyle(0x3a4048).fillRoundedRect(0, 0, w + 2, h + 2, Math.min(8, (w + 2) / 2));
      g.fillStyle(0x8a929c).fillRoundedRect(2, 2, w - 2, h - 2, Math.min(7, (w - 2) / 2));
      g.fillStyle(0xffffff, 0.18).fillRect(3, 3, Math.max(2, (w - 2) / 3), h - 4);
      if (stripe) g.fillStyle(acc).fillRect(2, h * 0.45, w - 2, 4);
      g.fillStyle(0x50565e).fillCircle((w + 2) / 2, Math.min(w, h) / 2.5, Math.min(w, h) / 5);
    });
  part("torso", D.torso, true);
  part("uarm", D.uarm, false);
  part("farm", D.farm, true);
  part("thigh", D.thigh, false);
  part("shin", D.shin, true);
  const r = D.head;
  tex(scene, T("head"), r * 2 + 6, r * 2 + 6, (g) => {
    g.fillStyle(0x3a4048).fillCircle(r + 3, r + 3, r + 2);
    g.fillStyle(0x8a929c).fillCircle(r + 3, r + 3, r);
    g.fillStyle(0xffffff, 0.2).fillCircle(r - 2, r - 3, r * 0.45);
    g.fillStyle(0x1a1d22).fillRoundedRect(r * 0.45, r * 0.85, r * 1.5, r * 0.45, 3); // visor
    g.fillStyle(acc).fillRect(r * 0.55, r * 0.98, r * 1.3, r * 0.18);
  });
}

export function buildCharacterTextures(scene: Phaser.Scene) {
  for (const d of IMPORTED) buildMannequin(scene, d);
  // ---------------- THE DIVA ----------------
  tex(scene, "d_torso", 34, 48, (g) => {
    g.fillStyle(0x2a1030).fillRoundedRect(0, 0, 34, 48, 12);
    g.fillStyle(0xe8e0f0).fillRoundedRect(3, 2, 28, 44, 10); // chrome
    g.fillStyle(0xff4fd8).fillTriangle(3, 14, 31, 14, 17, 46); // sequin V-gown panel
    g.fillStyle(0xffffff, 0.9);
    for (const [x, y] of [[10, 18], [17, 22], [24, 18], [13, 28], [21, 28], [17, 35], [15, 40], [19, 40]]) g.fillCircle(x, y, 1.3);
    g.fillStyle(0xffc83d).fillRoundedRect(4, 2, 26, 7, 3); // gold collar
    g.fillStyle(0xffc83d).fillPoints([V(17, 9), V(19.5, 13), V(17, 16), V(14.5, 13)], true); // brooch
  });
  tex(scene, "d_head", 70, 64, (g) => {
    // sculpted hair wave (back)
    g.fillStyle(0x7a1fb8).fillEllipse(30, 22, 58, 40);
    g.fillStyle(0xb44cff).fillEllipse(26, 18, 46, 30);
    g.fillStyle(0xff4fd8).fillTriangle(4, 20, 30, 2, 22, 30).fillTriangle(50, 4, 66, 26, 42, 22);
    // face
    g.fillStyle(0xf2e6f4).fillEllipse(36, 38, 30, 34);
    // heart visor
    g.fillStyle(0xffc83d).fillCircle(31, 35, 6).fillCircle(41, 35, 6).fillTriangle(25, 37, 47, 37, 36, 47);
    g.fillStyle(0xff2f8a).fillCircle(31, 35, 4).fillCircle(41, 35, 4).fillTriangle(27.5, 37, 44.5, 37, 36, 44);
    g.fillStyle(0xffffff, 0.8).fillCircle(29, 33, 1.5);
    // lips
    g.fillStyle(0xff2f8a).fillEllipse(37, 50, 8, 3.5);
    // headset mic
    g.lineStyle(2, 0x333344).beginPath().arc(36, 38, 17, Math.PI * 0.15, Math.PI * 0.55).strokePath();
    g.fillStyle(0x222233).fillCircle(31, 54, 3);
    // hair front swoop
    g.fillStyle(0xb44cff).fillTriangle(18, 14, 52, 12, 22, 34);
  });
  limb(scene, "d_uarm", 10, 30, 0x5a2a60, 0xe8e0f0, 0xff4fd8, 0xffc83d);
  limb(scene, "d_farm", 9, 30, 0x5a2a60, 0xe8e0f0, 0xffc83d);
  limb(scene, "d_thigh", 12, 34, 0x5a2a60, 0xff4fd8, 0xffc83d);
  tex(scene, "d_shin", 16, 40, (g) => {
    g.fillStyle(0x5a2a60).fillRoundedRect(2, 0, 12, 34, 6);
    g.fillStyle(0xe8e0f0).fillRoundedRect(4, 2, 8, 30, 4);
    g.fillStyle(0xff4fd8).fillRoundedRect(1, 24, 14, 10, 4); // boot
    g.fillStyle(0xffc83d).fillRect(12, 32, 3, 8).fillRect(1, 34, 9, 4); // heel + sole
  });

  // ---------------- GADGET GREMLIN ----------------
  tex(scene, "r_torso", 34, 32, (g) => {
    g.fillStyle(0x1c2a30).fillRoundedRect(0, 0, 34, 32, 9);
    g.fillStyle(0xffc83d).fillRoundedRect(2, 2, 30, 28, 8);
    g.fillStyle(0xd09a20).fillRect(2, 18, 30, 5); // tool belt
    g.fillStyle(0x6b4a2a).fillRoundedRect(5, 16, 7, 9, 2).fillRoundedRect(22, 16, 7, 9, 2);
    g.fillStyle(0x26f0ff).fillCircle(17, 10, 4); // power core
    g.fillStyle(0xffffff).fillCircle(16, 9, 1.4);
  });
  tex(scene, "r_head", 60, 60, (g) => {
    // antennae
    g.lineStyle(2, 0x9aa4ad).lineBetween(20, 16, 14, 2).lineBetween(40, 16, 48, 4);
    g.fillStyle(0xff3344).fillCircle(14, 3, 3);
    g.fillStyle(0x5dff7a).fillCircle(48, 5, 3);
    // big round head shell
    g.fillStyle(0x10303a).fillRoundedRect(4, 12, 52, 44, 18);
    g.fillStyle(0x2bb3c0).fillRoundedRect(6, 14, 48, 40, 16);
    g.fillStyle(0xffffff, 0.25).fillRoundedRect(10, 16, 20, 8, 4);
    // single huge camera eye
    g.fillStyle(0x0a1418).fillCircle(32, 34, 13);
    g.fillStyle(0x26f0ff).fillCircle(32, 34, 9);
    g.fillStyle(0x0a1418).fillCircle(33, 35, 4.5);
    g.fillStyle(0xffffff).fillCircle(28, 30, 2.6);
    // smile LEDs
    g.fillStyle(0x5dff7a);
    for (const [x, y] of [[22, 48], [27, 50], [32, 51], [37, 50], [42, 48]]) g.fillRect(x, y, 3, 2);
    // ear bolts
    g.fillStyle(0x9aa4ad).fillCircle(5, 34, 4).fillCircle(55, 34, 4);
  });
  limb(scene, "r_uarm", 9, 20, 0x10303a, 0x2bb3c0, 0x9aa4ad);
  tex(scene, "r_farm", 13, 24, (g) => {
    g.fillStyle(0x10303a).fillRoundedRect(2, 0, 9, 18, 4);
    g.fillStyle(0x2bb3c0).fillRoundedRect(3, 1, 7, 16, 3);
    g.fillStyle(0x9aa4ad).fillTriangle(0, 16, 6, 24, 6, 16).fillTriangle(13, 16, 7, 24, 7, 16); // claw
  });
  limb(scene, "r_thigh", 11, 18, 0x10303a, 0x9aa4ad, 0x2bb3c0);
  tex(scene, "r_shin", 18, 24, (g) => {
    g.fillStyle(0x10303a).fillRoundedRect(4, 0, 10, 16, 4);
    g.fillStyle(0x9aa4ad).fillRoundedRect(5, 1, 8, 14, 3);
    g.fillStyle(0x10303a).fillCircle(9, 18, 6); // wheel foot
    g.fillStyle(0xffc83d).fillCircle(9, 18, 3);
  });

  // ---------------- INDUSTRIAL MENACE ----------------
  tex(scene, "m_torso", 56, 64, (g) => {
    g.fillStyle(0x15181c).fillRoundedRect(0, 0, 56, 64, 8);
    g.fillStyle(0xffb000).fillRoundedRect(3, 3, 50, 58, 6);
    // hazard band
    g.fillStyle(0x111111).fillRect(3, 44, 50, 12);
    g.fillStyle(0xffc83d);
    for (let x = -6; x < 56; x += 12) g.fillTriangle(x, 56, x + 6, 44, x + 12, 44).fillTriangle(x, 56, x + 6, 56, x + 12, 44);
    // cab window
    g.fillStyle(0x0b1418).fillRoundedRect(10, 9, 36, 22, 4);
    g.fillStyle(0xff7a1a, 0.85).fillRoundedRect(13, 12, 30, 6, 2);
    g.fillStyle(0xffffff, 0.15).fillRect(13, 20, 30, 2);
    g.fillStyle(0x4a5560);
    for (const [x, y] of [[7, 7], [49, 7], [7, 38], [49, 38]]) g.fillCircle(x, y, 2.5);
    // exhaust stacks
    g.fillStyle(0x2a2f36).fillRect(4, 32, 6, 10).fillRect(46, 32, 6, 10);
  });
  tex(scene, "m_head", 60, 48, (g) => {
    g.fillStyle(0x15181c).fillRoundedRect(6, 4, 48, 42, 6);
    g.fillStyle(0xd8d0b8).fillRoundedRect(8, 6, 44, 38, 5);
    // hazard forehead
    g.fillStyle(0x111111).fillRect(8, 6, 44, 10);
    g.fillStyle(0xffc83d);
    for (let x = 2; x < 52; x += 10) g.fillTriangle(x, 16, x + 5, 6, x + 10, 6).fillTriangle(x, 16, x + 5, 16, x + 10, 6);
    // visor slit
    g.fillStyle(0x0a0a0a).fillRect(12, 22, 36, 9);
    g.fillStyle(0xff5a10).fillRect(14, 24, 32, 5);
    g.fillStyle(0xffd0a0).fillRect(16, 25, 10, 2);
    // jaw grille
    g.fillStyle(0x4a5560);
    for (let x = 16; x < 46; x += 6) g.fillRect(x, 35, 3, 7);
    // side lamps
    g.fillStyle(0xff3344).fillCircle(4, 26, 4).fillCircle(56, 26, 4);
  });
  limb(scene, "m_uarm", 17, 32, 0x15181c, 0x6b7580, 0xffb000, 0x111111);
  tex(scene, "m_farm", 20, 36, (g) => {
    g.fillStyle(0x15181c).fillRoundedRect(0, 0, 20, 36, 6);
    g.fillStyle(0xffb000).fillRoundedRect(2, 2, 16, 24, 5);
    g.fillStyle(0xc0c8d0).fillRect(8, 4, 4, 20); // piston
    g.fillStyle(0x2a2f36).fillRoundedRect(0, 26, 20, 10, 3); // fist block
  });
  limb(scene, "m_thigh", 19, 30, 0x15181c, 0x6b7580, 0xffb000);
  tex(scene, "m_shin", 26, 36, (g) => {
    g.fillStyle(0x15181c).fillRoundedRect(3, 0, 20, 28, 5);
    g.fillStyle(0xffb000).fillRoundedRect(5, 2, 16, 24, 4);
    g.fillStyle(0x1a1d22).fillRoundedRect(0, 24, 26, 12, 4); // tread boot
    g.fillStyle(0x4a5560);
    for (let x = 3; x < 24; x += 5) g.fillRect(x, 32, 3, 3);
  });

  // ---------------- imported-character ability props (generic shapes) ----------------
  tex(scene, "axe", 56, 40, (g) => {
    g.fillStyle(0x5a3a22).fillRoundedRect(0, 17, 40, 6, 3); // handle (pointing -x)
    g.fillStyle(0x2a1a10).fillRect(6, 17, 3, 6).fillRect(16, 17, 3, 6);
    g.fillStyle(0x9aa8b4).fillPoints([V(34, 2), V(54, 8), V(56, 32), V(34, 38), V(40, 20)], true); // blade
    g.fillStyle(0xcfe8ff).fillPoints([V(50, 7), V(56, 8), V(56, 32), V(50, 33), V(53, 20)], true); // frost edge
    g.fillStyle(0x6ad0ff).fillCircle(44, 14, 1.8).fillCircle(44, 26, 1.8).fillCircle(47, 20, 1.8); // runes
  });
  tex(scene, "airball", 48, 48, (g) => {
    g.fillStyle(0xffffff, 0.12).fillCircle(24, 24, 22);
    g.lineStyle(4, 0xffffff, 0.9).strokeCircle(24, 24, 18);
    g.lineStyle(2, 0x9fe8ff, 0.8).strokeCircle(24, 24, 11);
  });
  tex(scene, "rotor", 64, 22, (g) => {
    g.fillStyle(0xffc83d).fillEllipse(32, 6, 62, 8); // blades
    g.fillStyle(0xd09a20).fillRect(30, 4, 4, 14); // mast
    g.fillStyle(0x6b4a2a).fillCircle(32, 19, 3);
  });
  tex(scene, "door", 52, 92, (g) => {
    g.fillStyle(0x7a3a5a).fillRoundedRect(0, 0, 52, 92, 4); // frame
    g.fillStyle(0xff7ab8).fillRoundedRect(5, 5, 42, 85, 3); // panel
    g.lineStyle(2, 0xd05a90).strokeRoundedRect(10, 12, 32, 30, 3).strokeRoundedRect(10, 50, 32, 32, 3);
    g.fillStyle(0xffd060).fillCircle(39, 48, 3.5); // knob
  });

  // ---------------- specials ----------------
  tex(scene, "bomb", 26, 26, (g) => {
    g.fillStyle(0x1a1d22).fillCircle(13, 15, 10);
    g.fillStyle(0x4a5560).fillCircle(10, 12, 3);
    g.fillStyle(0xffc83d).fillRect(11, 1, 4, 5);
    g.fillStyle(0xff3344).fillRect(4, 14, 18, 3);
  });
  tex(scene, "note", 16, 22, (g) => {
    g.fillStyle(0xffffff).fillEllipse(5, 18, 9, 7).fillRect(8, 2, 2, 16).fillTriangle(8, 2, 15, 6, 8, 9);
  });
  tex(scene, "dome", 128, 128, (g) => {
    g.fillStyle(0xffffff, 0.12).fillCircle(64, 64, 62);
    g.lineStyle(3, 0xffffff, 0.9).strokeCircle(64, 64, 61);
    g.lineStyle(1, 0xffffff, 0.35);
    for (let y = 8; y < 128; y += 14)
      for (let x = (y / 14) % 2 ? 7 : 0; x < 128; x += 14) {
        if ((x - 64) ** 2 + (y - 64) ** 2 < 56 * 56) g.strokeCircle(x, y, 6);
      }
  });
}

/** Compose a full-body portrait in a plain 2D canvas from the generated textures (for the DOM select screen). */
export function paintPortrait(game: Phaser.Game, def: CharacterDef, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const T = (part: string) => `${def.tex}_${part}`;
  const imgs: Record<string, HTMLImageElement> = {};
  const parts = ["shin", "thigh", "torso", "uarm", "farm", "head"];
  let loaded = 0;
  for (const p of parts) {
    const im = new Image();
    im.onload = () => {
      if (++loaded === parts.length) draw();
    };
    im.src = game.textures.getBase64(T(p));
    imgs[p] = im;
  }
  const d = def.dims;
  function draw() {
    const W = canvas.width,
      H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const total = d.head * 2 + d.torso[1] + d.thigh[1] + d.shin[1];
    const k = Math.min((H * 0.86) / total, (W * 0.8) / (d.torso[0] + d.uarm[0] * 4));
    ctx.save();
    ctx.translate(W / 2, H * 0.94);
    ctx.scale(k, k);
    ctx.imageSmoothingEnabled = true;
    const put = (im: HTMLImageElement, x: number, y: number, rot = 0, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(im, -im.width / 2, -im.height / 2);
      ctx.restore();
    };
    const shinY = -d.shin[1] / 2;
    const thighY = shinY - d.shin[1] / 2 - d.thigh[1] / 2 + 6;
    const torsoY = thighY - d.thigh[1] / 2 - d.torso[1] / 2 + 6;
    const hx = d.torso[0] / 4;
    // back limbs
    put(imgs.thigh, -hx, thighY, 0.12, 0.75);
    put(imgs.shin, -hx - 2, shinY, 0.05, 0.75);
    put(imgs.uarm, -d.torso[0] / 2 + 2, torsoY - d.torso[1] / 2 + 6 + d.uarm[1] / 2 - 3, 0.35, 0.75);
    put(imgs.farm, -d.torso[0] / 2 - 6, torsoY - d.torso[1] / 2 + 6 + d.uarm[1] + d.farm[1] / 2 - 8, 0.15, 0.75);
    // body
    put(imgs.thigh, hx, thighY, -0.1);
    put(imgs.shin, hx + 2, shinY, 0);
    put(imgs.torso, 0, torsoY);
    put(imgs.head, 0, torsoY - d.torso[1] / 2 - d.head + 4 + def.dims.headOffset);
    // front arm raised in a pose
    const sx = d.torso[0] / 2 - 2,
      sy = torsoY - d.torso[1] / 2 + 6;
    // canvas rotation r turns the limb's "down" axis into (-sin r, cos r)
    const r1 = -2.1,
      r2 = -2.75;
    const L1 = d.uarm[1] - 6,
      L2 = d.farm[1] - 6;
    const d1 = [-Math.sin(r1), Math.cos(r1)],
      d2 = [-Math.sin(r2), Math.cos(r2)];
    const ex = sx + d1[0] * L1,
      ey = sy + d1[1] * L1;
    put(imgs.uarm, sx + (d1[0] * L1) / 2, sy + (d1[1] * L1) / 2, r1);
    put(imgs.farm, ex + (d2[0] * L2) / 2, ey + (d2[1] * L2) / 2, r2);
    ctx.restore();
  }
}
