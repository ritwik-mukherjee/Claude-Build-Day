import Phaser from "phaser";
import type { Fx } from "./Fx";
import { MB } from "./util";
import { Q } from "./quality";
import { bus } from "./bus";

export const W = 1600;
export const H = 900;
export const FLOOR_Y = 820;

interface Plat {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Dark industrial arena: layered parallax silhouettes, platforms, lamps, vents, crane. */
export class Arena {
  plats: Plat[] = [
    { x: 0, y: FLOOR_Y, w: W, h: 80 },
    { x: 150, y: 600, w: 330, h: 26 },
    { x: 1120, y: 600, w: 330, h: 26 },
    { x: 610, y: 430, w: 380, h: 26 },
  ];
  lamps: Phaser.Physics.Matter.Image[] = [];
  lampGlows: Phaser.GameObjects.Image[] = [];
  ambient: Phaser.GameObjects.Image[] = []; // purely decorative glows, hidden in reduced-effects mode
  crates: Phaser.Physics.Matter.Image[] = [];
  gears: Phaser.GameObjects.Graphics[] = [];
  // 2.5D parallax layers (offset by the focus point each frame; pure transforms, no redraw)
  private mid!: Phaser.GameObjects.Image;
  private fg!: Phaser.GameObjects.Graphics;
  private px = 0;
  private py = 0;
  vents = [400, 1200];
  steam: Phaser.GameObjects.Particles.ParticleEmitter;
  ventActive = 0;
  ventX = 0;
  trolley: Phaser.GameObjects.Container;
  warn: Phaser.GameObjects.Graphics;
  alarm: Phaser.GameObjects.Rectangle;

  constructor(
    private scene: Phaser.Scene,
    private fx: Fx,
  ) {
    this.drawBackground();
    this.drawPlatforms();
    // world walls/ceiling
    const wallOpt = { isStatic: true, label: "wall" };
    scene.matter.add.rectangle(-30, H / 2, 60, H * 2, wallOpt);
    scene.matter.add.rectangle(W + 30, H / 2, 60, H * 2, wallOpt);
    scene.matter.add.rectangle(W / 2, -200, W, 60, wallOpt);

    // hanging lamps (physical pendulums — they swing on impacts)
    for (const lx of [260, 800, 1340]) {
      const lamp = scene.matter.add.image(lx, 150, "lamp", undefined, { density: 0.002, frictionAir: 0.01, collisionFilter: { group: -7, category: 0x0010, mask: 0 } });
      scene.matter.add.worldConstraint(lamp.body as MatterJS.BodyType, 140, 0.9, { pointA: { x: lx, y: 0 }, pointB: { x: 0, y: -12 } });
      lamp.setDepth(6);
      this.lamps.push(lamp);
      const glow = scene.add.image(lx, 260, "glow").setTint(0xffb050).setAlpha(0.35).setScale(5, 7).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      this.lampGlows.push(glow);
    }

    // rising embers
    scene.add
      .particles(0, 0, "spark", {
        x: { min: 0, max: W },
        y: H + 10,
        speedY: { min: -40, max: -110 },
        speedX: { min: -20, max: 20 },
        lifespan: 9000,
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xff7a1a, 0xffc83d, 0xff3344],
        blendMode: "ADD",
        frequency: Q.low ? 260 : 110,
        maxParticles: 90,
      })
      .setDepth(8);

    this.steam = scene.add
      .particles(0, 0, "smoke", {
        speedY: { min: -500, max: -900 },
        speedX: { min: -60, max: 60 },
        lifespan: 1100,
        scale: { start: 0.6, end: 3 },
        alpha: { start: 0.55, end: 0 },
        tint: 0xd8e4ec,
        emitting: false,
      })
      .setDepth(35);

    // crane trolley on the ceiling rail
    const tg = scene.add.graphics();
    tg.fillStyle(0x2a3038).fillRect(-40, 0, 80, 26);
    tg.fillStyle(0xffc83d).fillRect(-40, 22, 80, 4);
    tg.lineStyle(3, 0x666e76).lineBetween(0, 26, 0, 70);
    tg.lineStyle(4, 0x9aa4ad).strokeCircle(0, 76, 7);
    this.trolley = scene.add.container(W / 2, 40, [tg]).setDepth(7);
    this.warn = scene.add.graphics().setDepth(9);
    this.ambient.push(...this.lampGlows);
    const applyQ = () => this.ambient.forEach((a) => a.setVisible(!Q.low));
    applyQ();
    bus.on("quality", applyQ);
    scene.events.once("shutdown", () => bus.off("quality", applyQ));
    this.alarm = scene.add.rectangle(W / 2, H / 2, W, H, 0xff2030, 0).setDepth(900).setScrollFactor(0).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
  }

  groundY(x: number, fromY: number): number {
    let best = FLOOR_Y + 400;
    for (const p of this.plats) if (x >= p.x - 6 && x <= p.x + p.w + 6 && p.y >= fromY - 8 && p.y < best) best = p.y;
    return best;
  }

  private drawBackground() {
    const s = this.scene;
    const g = s.add.graphics().setDepth(0);
    // sky gradient
    const top = Phaser.Display.Color.ValueToColor(0x07080d);
    const bot = Phaser.Display.Color.ValueToColor(0x3a1a0c);
    for (let i = 0; i < 60; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(top, bot, 60, i);
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b)).fillRect(0, (i * H) / 60, W, H / 60 + 1);
    }
    // furnace glow on horizon
    s.add.image(W / 2, FLOOR_Y - 40, "glow").setTint(0xff5a10).setScale(30, 6).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(0);

    // far silhouettes
    const far = s.add.graphics();
    far.fillStyle(0x10131a);
    let x = -90;
    const rnd = new Phaser.Math.RandomDataGenerator(["ragdoll"]);
    while (x < W + 90) {
      const w = rnd.between(60, 160),
        h = rnd.between(180, 420);
      far.fillRect(x, FLOOR_Y - h, w, h);
      if (rnd.frac() < 0.5) far.fillRect(x + w * 0.3, FLOOR_Y - h - rnd.between(60, 160), 18, 200); // chimney
      for (let wy = FLOOR_Y - h + 20; wy < FLOOR_Y - 20; wy += 26)
        for (let wx = x + 8; wx < x + w - 10; wx += 18) if (rnd.frac() < 0.12) {
          far.fillStyle(rnd.pick([0xff7a1a, 0xffc83d, 0x26f0ff]), 0.5).fillRect(wx, wy, 6, 9);
          far.fillStyle(0x10131a);
        }
      x += w + rnd.between(4, 30);
    }
    // mid: trusses + pipes
    const mid = s.add.graphics();
    mid.fillStyle(0x161b22);
    for (const tx of [90, 560, 1040, 1510]) {
      mid.fillRect(tx - 14, 60, 28, FLOOR_Y - 60);
      mid.lineStyle(3, 0x1d232c);
      for (let ty = 80; ty < FLOOR_Y; ty += 60) {
        mid.lineBetween(tx - 14, ty, tx + 14, ty + 60);
        mid.lineBetween(tx + 14, ty, tx - 14, ty + 60);
      }
    }
    mid.fillStyle(0x1b2129).fillRect(-80, 34, W + 160, 22); // ceiling rail
    mid.fillStyle(0xffc83d, 0.6);
    for (let rx = -80; rx < W + 80; rx += 40) mid.fillTriangle(rx, 56, rx + 20, 56, rx + 10, 50);
    mid.lineStyle(14, 0x232a33).lineBetween(-80, 300, 560, 300).lineBetween(560, 300, 560, 120).lineBetween(1040, 250, W + 80, 250);
    mid.lineStyle(4, 0x2f3843).lineBetween(0, 294, 560, 294).lineBetween(1040, 244, W, 244);

    // big rotating gears
    for (const [gx, gy, r, sp] of [
      [330, 300, 110, 0.002],
      [1290, 330, 140, -0.0015],
      [800, 210, 70, 0.003],
    ] as const) {
      const gear = s.add.graphics({ x: gx, y: gy }).setDepth(2);
      gear.fillStyle(0x0f1217);
      gear.fillCircle(0, 0, r);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        gear.fillRect(Math.cos(a) * r - 10, Math.sin(a) * r - 10, 20, 20);
      }
      gear.fillStyle(0x07090c).fillCircle(0, 0, r * 0.55);
      gear.lineStyle(2, 0xff7a1a, 0.25).strokeCircle(0, 0, r * 0.7);
      gear.fillStyle(0x232a33).fillCircle(0, 0, r * 0.18);
      gear.setData("sp", sp);
      this.gears.push(gear);
    }

    // foreground silhouettes (darkest layer, in front of fighters, only at the frame edges)
    const fg = s.add.graphics();
    fg.fillStyle(0x030405, 0.92);
    fg.fillRect(-60, 0, 86, H).fillRect(W - 26, 0, 86, H); // edge girders
    fg.fillStyle(0x0b0e12, 1);
    for (let y = 30; y < H; y += 70) {
      fg.fillTriangle(26, y, 26, y + 34, 44, y + 17);
      fg.fillTriangle(W - 26, y, W - 26, y + 34, W - 44, y + 17);
    }
    fg.fillStyle(0x030405, 0.95).fillRect(-60, -10, W + 120, 22); // top beam
    fg.lineStyle(5, 0x07090c, 1);
    for (const [cx, len] of [
      [150, 120],
      [178, 70],
      [1430, 150],
      [1462, 90],
    ]) {
      for (let y = 12; y < len; y += 12) fg.strokeRect(cx - 3, y - 6, 6, 11); // hanging chains
    }
    fg.fillStyle(0xff7a1a, 0.5).fillRect(-60, 10, W + 120, 2);

    // Static layers are baked once into textures: one quad each per frame instead of
    // re-processing hundreds of vector shapes (big win on integrated GPUs/CPUs).
    // sky + far skyline share one full-screen texture; the mid layer (and gears) carry the parallax
    this.bake([g, far], "bg_back", -1, 0);
    this.mid = this.bake([mid], "bg_mid", 2, 90, 30, 800);
    this.fg = fg.setDepth(70); // a handful of shapes at the edges: cheaper as vectors than a full-screen quad

    // haze
    s.add.rectangle(W / 2, FLOOR_Y - 120, W, 240, 0xff6a20, 0.05).setDepth(3);

    // warning beacons
    for (const bx of [40, W - 40]) {
      const b = s.add.image(bx, 120, "glow").setTint(0xff3020).setScale(1.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(4);
      s.tweens.add({ targets: b, alpha: { from: 1, to: 0.1 }, duration: 600, yoyo: true, repeat: -1 });
    }
  }

  /** Bake vector layers into one texture covering rows [top, top+height) (cropped to save fill-rate). */
  private bake(gs: Phaser.GameObjects.Graphics[], key: string, depth: number, margin: number, top = 0, height = H) {
    const s = this.scene;
    if (!s.textures.exists(key)) {
      const dt = s.textures.addDynamicTexture(key, W + margin * 2, height)!;
      for (const g of gs) dt.draw(g, margin, -top);
      dt.render();
    }
    for (const g of gs) g.destroy();
    return s.add.image(-margin, top, key).setOrigin(0, 0).setDepth(depth);
  }

  private drawPlatforms() {
    const s = this.scene;
    const g = s.add.graphics().setDepth(10);
    for (const p of this.plats) {
      s.matter.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, { isStatic: true, friction: 1, label: "platform" });
      const floor = p.h > 40;
      g.fillStyle(0x1c2229).fillRect(p.x, p.y, p.w, p.h);
      g.fillStyle(0x3a4552).fillRect(p.x, p.y, p.w, 6);
      g.fillStyle(0x6d7f90).fillRect(p.x, p.y, p.w, 2);
      // hazard stripes
      const sy = p.y + 8,
        sh = floor ? 12 : 10;
      g.fillStyle(0xffc83d, 0.9).fillRect(p.x, sy, p.w, sh);
      g.fillStyle(0x111111);
      for (let x = p.x - 20; x < p.x + p.w; x += 24) g.fillTriangle(x, sy + sh, x + 12, sy, x + 22, sy).fillTriangle(x, sy + sh, x + 10, sy + sh, x + 22, sy);
      g.fillStyle(0x1c2229).fillRect(p.x + p.w, sy, 30, sh);
      // rivets
      g.fillStyle(0x56626e);
      for (let x = p.x + 10; x < p.x + p.w; x += 40) g.fillCircle(x, p.y + p.h - 6, 2);
      if (!floor) {
        // supports + underglow
        g.fillStyle(0x161b22).fillRect(p.x + 20, p.y + p.h, 10, 40).fillRect(p.x + p.w - 30, p.y + p.h, 10, 40);
        this.ambient.push(s.add.image(p.x + p.w / 2, p.y + p.h + 4, "glow").setTint(0x26f0ff).setScale(p.w / 40, 0.4).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(9));
      }
    }
    // floor grating lines + vents
    g.lineStyle(1, 0x2b333c);
    for (let x = 0; x < W; x += 32) g.lineBetween(x, FLOOR_Y + 22, x, H);
    for (const vx of this.vents) {
      g.fillStyle(0x0b0d10).fillRect(vx - 36, FLOOR_Y - 4, 72, 10);
      g.fillStyle(0xff7a1a, 0.6);
      for (let i = 0; i < 6; i++) g.fillRect(vx - 30 + i * 11, FLOOR_Y - 2, 6, 5);
    }
    this.bake([g], "bg_platforms", 10, 0, 400, H - 400);
  }

  /** 2.5D parallax: layers drift against the focus point (fighter / camera). */
  parallax(fx: number, fy: number) {
    const tx = (fx - W / 2) / (W / 2),
      ty = (fy - H / 2) / (H / 2);
    this.px += (tx - this.px) * 0.06;
    this.py += (ty - this.py) * 0.06;
    this.mid.setPosition(-90 - this.px * 42, 30 - this.py * 14);
    for (const g of this.gears) g.setData("ox", g.getData("ox") ?? g.x).setX(g.getData("ox") - this.px * 42);
    this.fg.setPosition(this.px * 26, this.py * 6);
  }

  update(time: number, dt: number) {
    for (const gr of this.gears) gr.rotation += gr.getData("sp") * dt * 60;
    this.lamps.forEach((l, i) => {
      const glow = this.lampGlows[i];
      glow.setPosition(l.x, l.y + 110).setRotation(l.rotation);
      glow.setAlpha(0.3 + Math.random() * 0.04);
    });
    if (this.ventActive > 0) {
      this.ventActive -= dt;
      this.steam.emitParticleAt(this.ventX + Phaser.Math.Between(-20, 20), FLOOR_Y - 4, 3);
    }
    for (const c of [...this.crates]) if (!c.active) this.crates.splice(this.crates.indexOf(c), 1);
  }

  /** Radial impulse on everything loose: lamps swing, crates jump, debris flies. */
  shove(x: number, y: number, radius: number, power: number, bodies: MatterJS.BodyType[]) {
    for (const b of bodies) {
      if (b.isStatic) continue;
      const dx = b.position.x - x,
        dy = b.position.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius || d < 1) continue;
      const f = (1 - d / radius) * power;
      MB.setVelocity(b, { x: b.velocity.x + (dx / d) * f, y: b.velocity.y + (dy / d) * f - f * 0.4 });
    }
    for (const l of this.lamps) {
      const d = Math.abs(l.x - x);
      if (d < radius * 2.5) MB.setVelocity(l.body as MatterJS.BodyType, { x: Math.sign(l.x - x || 1) * Math.min(5, power * 0.5), y: -1 });
    }
    // lamps flicker
    for (const g of this.lampGlows) this.scene.tweens.add({ targets: g, alpha: 0.05, duration: 60, yoyo: true, repeat: 3 });
  }

  crack(x: number, y: number, scale = 1) {
    y = this.groundY(x, y - 40);
    if (y > FLOOR_Y + 50) return;
    const c = this.scene.add.image(x, y + 4, "crack").setDepth(11).setScale(scale).setAlpha(0.9);
    this.scene.tweens.add({ targets: c, alpha: 0, delay: 9000, duration: 2000, onComplete: () => c.destroy() });
    const ember = this.scene.add.image(x, y + 2, "glow").setTint(0xff5a10).setScale(scale * 3, scale * 0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(11);
    this.scene.tweens.add({ targets: ember, alpha: 0, duration: 2500, onComplete: () => ember.destroy() });
  }

  /** Arena reaction to big hits: dust + debris rain from the ceiling, sparks off catwalk edges. */
  ceilingRain(x: number, power: number) {
    const s = this.scene;
    for (let i = 0; i < 4 + power * 3; i++) {
      s.time.delayedCall(i * 60, () => {
        const dx = Phaser.Math.Clamp(x + Phaser.Math.Between(-320, 320), 40, W - 40);
        this.fx.smokePuff(dx, 60, 1);
        this.fx.spawnDebris(dx, 70, 1);
      });
    }
    for (const p of this.plats.slice(1)) {
      if (Math.abs(p.x + p.w / 2 - x) < 500) {
        this.fx.burst(p.x + 4, p.y + 10, 10);
        this.fx.burst(p.x + p.w - 4, p.y + 10, 10);
      }
    }
  }

  alarmPulse() {
    // full-screen additive quad: only visible while pulsing (saves fill-rate the rest of the time)
    this.alarm.setVisible(true);
    this.scene.tweens.add({ targets: this.alarm, fillAlpha: { from: 0.18, to: 0 }, duration: 350, repeat: 2, onComplete: () => this.alarm.setVisible(false) });
  }

  /** Telegraphed crane crate drop at x. */
  craneDrop(x: number, heavy: number, onLand: (crate: Phaser.Physics.Matter.Image) => void) {
    this.alarmPulse();
    this.scene.tweens.add({
      targets: this.trolley,
      x,
      duration: 700,
      ease: "Cubic.easeInOut",
      onComplete: () => {
        this.warn.clear().fillStyle(0xff2030, 0.18).fillRect(x - 40 * heavy, 60, 80 * heavy, FLOOR_Y - 60);
        this.scene.time.delayedCall(500, () => {
          this.warn.clear();
          const c = this.spawnCrate(x, 110, heavy);
          c.setData("deadly", true);
          c.setVelocity(0, 12);
          c.setData("onLand", onLand);
        });
      },
    });
  }

  spawnCrate(x: number, y: number, scale = 1) {
    const c = this.scene.matter.add.image(x, y, "crate", undefined, { density: 0.003, friction: 0.6, restitution: 0.1, label: "crate", chamfer: { radius: 4 } });
    c.setScale(scale).setDepth(15);
    this.crates.push(c);
    while (this.crates.length > 10) {
      const old = this.crates.shift()!;
      this.fx.burst(old.x, old.y, 10);
      old.destroy();
    }
    return c;
  }

  vent(x: number, seconds: number) {
    this.ventX = x;
    this.ventActive = seconds;
    this.fx.smokePuff(x, FLOOR_Y, 8);
  }
}
