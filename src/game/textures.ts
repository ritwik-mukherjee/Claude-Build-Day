import Phaser from "phaser";

// All art is procedural: drawn once into textures at boot.
type G = Phaser.GameObjects.Graphics;

function tex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

const METAL = 0x4a5560;
const METAL_DARK = 0x262d35;
const METAL_LIGHT = 0x7d8a96;
const GOBLIN = 0x6fae3c;
const GOBLIN_DARK = 0x3e6b22;
const EYE = 0xffdd33;

function rivets(g: G, pts: [number, number][]) {
  g.fillStyle(0xaab6c0, 1);
  for (const [x, y] of pts) g.fillCircle(x, y, 1.6);
}

export function buildTextures(scene: Phaser.Scene) {
  // ---- FX ----
  tex(scene, "px", 4, 4, (g) => g.fillStyle(0xffffff).fillRect(0, 0, 4, 4));
  tex(scene, "spark", 8, 8, (g) => {
    g.fillStyle(0xffffff, 1).fillCircle(4, 4, 3);
  });
  tex(scene, "streak", 16, 4, (g) => {
    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 16, 4, 2);
  });
  tex(scene, "glow", 64, 64, (g) => {
    for (let r = 32; r > 0; r -= 2) g.fillStyle(0xffffff, 0.05 + (1 - r / 32) * 0.12).fillCircle(32, 32, r);
  });
  tex(scene, "smoke", 48, 48, (g) => {
    for (let r = 24; r > 0; r -= 3) g.fillStyle(0xffffff, 0.06).fillCircle(24, 24, r);
  });
  tex(scene, "debris", 14, 12, (g) => {
    g.fillStyle(0x5a6068, 1).fillPoints([new Phaser.Math.Vector2(0, 4), new Phaser.Math.Vector2(9, 0), new Phaser.Math.Vector2(14, 7), new Phaser.Math.Vector2(5, 12)], true);
    g.lineStyle(1, 0xff9a3c, 0.8).strokeLineShape(new Phaser.Geom.Line(2, 4, 9, 1));
  });
  tex(scene, "shadow", 64, 16, (g) => {
    for (let r = 8; r > 0; r -= 1) g.fillStyle(0x000000, 0.09).fillEllipse(32, 8, r * 8, r * 2);
  });
  tex(scene, "ring", 128, 128, (g) => {
    g.lineStyle(6, 0xffffff, 1).strokeCircle(64, 64, 58);
  });
  tex(scene, "crack", 200, 36, (g) => {
    // scorch mark
    for (let r = 18; r > 0; r -= 3) g.fillStyle(0x050506, 0.12).fillEllipse(100, 10, r * 10, r * 1.4);
    g.lineStyle(2, 0x050506, 0.9);
    for (const [x2, y2] of [[30, 6], [170, 8], [60, 14], [140, 15], [100, 18], [15, 10], [185, 12]]) {
      g.beginPath().moveTo(100, 4).lineTo((100 + x2) / 2 + (x2 % 7) - 3, 6 + (y2 % 5)).lineTo(x2, y2).strokePath();
    }
  });
  // ---- Goblin parts (vertical, "down" = +y) ----
  tex(scene, "g_torso", 40, 52, (g) => {
    g.fillStyle(METAL_DARK).fillRoundedRect(0, 0, 40, 52, 9);
    g.fillStyle(METAL).fillRoundedRect(3, 3, 34, 46, 7);
    g.fillStyle(GOBLIN_DARK).fillRoundedRect(8, 30, 24, 18, 4);
    g.fillStyle(0x1b2228).fillCircle(20, 18, 9);
    g.fillStyle(0x26f0ff, 0.9).fillCircle(20, 18, 6);
    g.fillStyle(0xffffff, 0.9).fillCircle(18, 16, 2);
    g.lineStyle(2, METAL_LIGHT, 0.7).strokeRoundedRect(3, 3, 34, 46, 7);
    rivets(g, [[7, 7], [33, 7], [7, 44], [33, 44]]);
  });
  tex(scene, "g_head", 64, 50, (g) => {
    // ears
    g.fillStyle(GOBLIN_DARK).fillTriangle(0, 10, 22, 20, 18, 32);
    g.fillTriangle(64, 10, 42, 20, 46, 32);
    g.fillStyle(GOBLIN).fillTriangle(4, 12, 21, 21, 19, 29);
    g.fillTriangle(60, 12, 43, 21, 45, 29);
    // skull
    g.fillStyle(GOBLIN).fillEllipse(32, 26, 36, 38);
    // metal helmet / jaw plate
    g.fillStyle(METAL).fillRoundedRect(15, 5, 34, 13, 5);
    g.fillStyle(METAL_DARK).fillRoundedRect(18, 34, 28, 12, 4);
    g.fillStyle(0xe8e0c0).fillTriangle(22, 34, 25, 34, 23.5, 39).fillTriangle(39, 34, 42, 34, 40.5, 39);
    // eyes
    g.fillStyle(0x111111).fillEllipse(24, 25, 12, 9).fillEllipse(40, 25, 12, 9);
    g.fillStyle(EYE).fillCircle(25, 25, 3.5).fillCircle(41, 25, 3.5);
    rivets(g, [[19, 11], [32, 9], [45, 11]]);
  });
  const limb = (key: string, w: number, h: number, skin: boolean) =>
    tex(scene, key, w, h, (g) => {
      g.fillStyle(METAL_DARK).fillRoundedRect(0, 0, w, h, w / 2);
      g.fillStyle(skin ? GOBLIN : METAL).fillRoundedRect(2, 2, w - 4, h - 4, (w - 4) / 2);
      g.fillStyle(METAL_LIGHT).fillCircle(w / 2, w / 2, w / 3);
      g.fillStyle(0xff7a1a, 0.8).fillCircle(w / 2, w / 2, w / 7);
      g.lineStyle(1, 0x000000, 0.3).strokeLineShape(new Phaser.Geom.Line(3, h * 0.6, w - 3, h * 0.6));
    });
  limb("g_uarm", 14, 30, false);
  limb("g_farm", 13, 30, true);
  limb("g_thigh", 16, 30, false);
  tex(scene, "g_shin", 16, 34, (g) => {
    g.fillStyle(METAL_DARK).fillRoundedRect(0, 0, 16, 34, 6);
    g.fillStyle(METAL).fillRoundedRect(2, 2, 12, 26, 5);
    g.fillStyle(METAL_DARK).fillRoundedRect(-1, 26, 18, 8, 3);
    g.fillStyle(METAL_LIGHT).fillCircle(8, 7, 5);
  });

  // ---- Components ----
  tex(scene, "c_booster", 26, 54, (g) => {
    g.fillStyle(METAL_DARK).fillRoundedRect(2, 0, 22, 44, 8);
    g.fillStyle(0xc0462a).fillRoundedRect(5, 3, 16, 30, 6);
    g.fillStyle(0xffffff, 0.25).fillRect(8, 6, 3, 24);
    g.fillStyle(0x33393f).fillTriangle(1, 54, 25, 54, 13, 38).fillRect(4, 40, 18, 8);
    g.fillStyle(0xffc83d).fillRect(5, 34, 16, 3);
  });
  tex(scene, "c_shield", 34, 76, (g) => {
    g.fillStyle(0xffffff, 0.18).fillRoundedRect(0, 0, 34, 76, 14);
    g.lineStyle(3, 0xffffff, 0.95).strokeRoundedRect(2, 2, 30, 72, 13);
    g.lineStyle(1, 0xffffff, 0.45);
    for (let y = 10; y < 70; y += 10) g.strokeLineShape(new Phaser.Geom.Line(6, y, 28, y + 5));
    g.fillStyle(0xffffff, 0.9).fillCircle(17, 38, 5);
  });
  tex(scene, "c_link", 12, 12, (g) => {
    g.lineStyle(3, 0x9aa4ad, 1).strokeCircle(6, 6, 4.5);
  });
  tex(scene, "c_hammer", 60, 40, (g) => {
    g.fillStyle(METAL_DARK).fillRoundedRect(0, 0, 60, 40, 6);
    g.fillStyle(0x59636d).fillRoundedRect(3, 3, 54, 34, 5);
    g.fillStyle(0xffffff, 0.75).fillRect(6, 6, 48, 4);
    g.fillStyle(0x1a1f24);
    for (let x = 8; x < 54; x += 10) g.fillRect(x, 16, 5, 14);
    g.fillStyle(0xffc83d).fillRect(0, 0, 8, 40).fillRect(52, 0, 8, 40);
    g.fillStyle(0x111111);
    for (let y = 2; y < 40; y += 8) g.fillTriangle(0, y, 8, y + 4, 0, y + 6).fillTriangle(52, y, 60, y + 4, 52, y + 6);
  });
  tex(scene, "c_glove", 40, 36, (g) => {
    // boxing glove pointing right (+x)
    g.fillStyle(0x5a0a10).fillRoundedRect(2, 4, 34, 28, 13);
    g.fillStyle(0xff3344).fillRoundedRect(4, 5, 31, 25, 12);
    g.fillStyle(0xff7080).fillEllipse(24, 11, 16, 6);
    g.fillStyle(0xe02030).fillRoundedRect(12, 22, 16, 8, 4); // thumb
    g.fillStyle(0xf0f0f0).fillRect(0, 9, 7, 18); // cuff
    g.lineStyle(1, 0x5a0a10).lineBetween(2, 12, 6, 12).lineBetween(2, 18, 6, 18).lineBetween(2, 24, 6, 24);
  });
  tex(scene, "c_spring", 18, 22, (g) => {
    g.lineStyle(3, 0xd0d6dc, 1);
    for (let y = 2; y < 20; y += 5) g.strokeLineShape(new Phaser.Geom.Line(1, y, 17, y + 4));
  });
  tex(scene, "c_armor", 46, 40, (g) => {
    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 46, 40, 8);
    g.fillStyle(0x000000, 0.25).fillRoundedRect(4, 18, 38, 4, 2);
    g.fillStyle(0x000000, 0.35);
    for (const [x, y] of [[6, 6], [40, 6], [6, 33], [40, 33]]) g.fillCircle(x, y, 2.5);
  });

  // ---- Spider ----
  tex(scene, "s_body", 150, 96, (g) => {
    // abdomen
    g.fillStyle(0x1a1d22).fillEllipse(52, 46, 96, 78);
    g.fillStyle(0x3a2a2a).fillEllipse(52, 44, 84, 66);
    g.lineStyle(3, 0x55606b).strokeEllipse(52, 44, 84, 66);
    for (let i = 0; i < 4; i++) g.lineStyle(2, 0x111418, 0.9).strokeEllipse(52, 44, 84 - i * 18, 66 - i * 14);
    g.fillStyle(0xff3344, 0.85).fillCircle(52, 44, 10);
    g.fillStyle(0xffd0d0).fillCircle(49, 41, 3);
    g.fillStyle(0xffc83d).fillRect(20, 8, 64, 5);
    // head/cephalothorax
    g.fillStyle(0x1a1d22).fillRoundedRect(86, 26, 58, 46, 14);
    g.fillStyle(0x4a5560).fillRoundedRect(90, 30, 50, 38, 11);
    g.fillStyle(0x111111).fillRoundedRect(110, 36, 30, 22, 6);
    g.fillStyle(0xff2030);
    for (const [x, y, r] of [[120, 42, 4], [131, 42, 4], [116, 51, 3], [126, 52, 3], [135, 51, 3]]) g.fillCircle(x, y, r);
    // mandibles
    g.fillStyle(0x8a949e).fillTriangle(132, 66, 150, 74, 138, 60).fillTriangle(120, 66, 132, 80, 126, 62);
    for (const [x, y] of [[96, 34], [96, 64], [30, 22], [74, 22], [30, 70], [74, 70]]) g.fillStyle(0xaab6c0).fillCircle(x, y, 2);
  });

  // ---- Arena ----
  tex(scene, "crate", 56, 56, (g) => {
    g.fillStyle(0x3b2a1a).fillRect(0, 0, 56, 56);
    g.fillStyle(0x6b4a2a).fillRect(4, 4, 48, 48);
    g.lineStyle(5, 0x3b2a1a).strokeLineShape(new Phaser.Geom.Line(4, 4, 52, 52)).strokeLineShape(new Phaser.Geom.Line(52, 4, 4, 52));
    g.fillStyle(0xffc83d).fillRect(0, 0, 56, 6);
    g.fillStyle(0x111111);
    for (let x = 0; x < 56; x += 12) g.fillTriangle(x, 0, x + 6, 0, x, 6);
  });
  tex(scene, "lamp", 40, 26, (g) => {
    g.fillStyle(0x22272c).fillTriangle(20, 0, 0, 22, 40, 22);
    g.fillStyle(0xffd27a).fillEllipse(20, 22, 30, 8);
  });
}
