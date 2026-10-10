import Phaser from "phaser";
import type { Arena } from "./Arena";
import type { Fx } from "./Fx";
import { MB, flashWhite, unflash } from "./util";

type Body = MatterJS.BodyType;

export const ENEMY_GROUP = -2;
export const CAT_ENEMY = 0x0004;

interface Leg {
  side: number; // -1 back, 1 front (relative to facing)
  spread: number;
  foot: Phaser.Math.Vector2;
  from: Phaser.Math.Vector2;
  to: Phaser.Math.Vector2;
  t: number; // step progress 0..1 (1 = planted)
}

export interface Laser {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
}

type State = "stalk" | "charge_laser" | "leap" | "stunned";

/** Mechanical spider: physics body + procedural IK legs + simple attack loop. */
export class Spider {
  body: Phaser.Physics.Matter.Image;
  gfx: Phaser.GameObjects.Graphics;
  dome: Phaser.GameObjects.Image;
  legs: Leg[] = [];
  hp = 160;
  maxHp = 160;
  private invuln = 0;
  vuln = 1; // damage taken multiplier (challenges)
  facing = -1;
  state: State = "stalk";
  stateT = 0;
  nextAttack = 3;
  shieldT = 0;
  enrageT = 0;
  laserQueue = 0;
  pendingLeap = false;
  airborne = false;
  dead = false;
  private flashT = 0;
  // --- presentation (visual only; physics/AI above are unchanged) ---
  private vis!: Phaser.GameObjects.Container;
  private hull!: Phaser.GameObjects.Image;
  private core!: Phaser.GameObjects.Image;
  private coreGlow!: Phaser.GameObjects.Image;
  private optic!: Phaser.GameObjects.Image;
  private pupil!: Phaser.GameObjects.Image;
  private cannon!: Phaser.GameObjects.Image;
  private muzzle!: Phaser.GameObjects.Image;
  private gfxBack!: Phaser.GameObjects.Graphics;
  private aim = 0; // cannon angle in container space
  private kick = 0; // recoil 0..1
  private bob = 0;
  private deathT = 0;
  private smokeT = 0;
  private lastHit = 0;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    private arena: Arena,
    private fx: Fx,
    private onLaser: (l: Laser) => void,
    private onSlam: (x: number, y: number, power: number) => void,
  ) {
    this.body = scene.matter.add.image(x, y, "s_body", undefined, {
      shape: { type: "circle", radius: 46 },
      density: 0.004,
      frictionAir: 0.04,
      friction: 0.2,
      label: "spider",
      collisionFilter: { group: ENEMY_GROUP, category: CAT_ENEMY },
    });
    // physics body stays exactly as before; its sprite is hidden and a richer visual rig follows it
    this.body.setFixedRotation().setDepth(25).setOrigin(0.4, 0.5).setVisible(false);
    this.gfxBack = scene.add.graphics().setDepth(23);
    this.gfx = scene.add.graphics().setDepth(26);
    const add = (k: string, x: number, y: number) => scene.add.image(x, y, k);
    this.hull = add("boss_body", -14, 0);
    this.coreGlow = add("glow", -20, 2).setTint(0xff2a30).setBlendMode(Phaser.BlendModes.ADD).setScale(1.3);
    this.core = add("boss_core", -20, 2).setBlendMode(Phaser.BlendModes.ADD);
    this.optic = add("boss_optic", 52, -12);
    this.pupil = add("boss_pupil", 52, -12).setBlendMode(Phaser.BlendModes.ADD);
    this.cannon = add("boss_cannon", 40, 16).setOrigin(0.08, 0.5);
    this.muzzle = add(scene.textures.exists("k_muzzle_02") ? "k_muzzle_02" : "glow", 108, 16).setTint(0xff4050).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setScale(0.3).setOrigin(0.5, 0.92); // flame grows out of the barrel
    this.vis = scene.add.container(x, y, [this.hull, this.coreGlow, this.core, this.cannon, this.muzzle, this.optic, this.pupil]).setDepth(25);
    this.dome = scene.add.image(x, y, scene.textures.exists("dome") ? "dome" : "glow").setTint(0xff3344).setScale(1.7).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(27);
    const spreads = [0.4, 1.0, 1.6, 2.2];
    for (const side of [-1, 1])
      for (const s of spreads) {
        const fx = x + side * s * 40;
        const p = new Phaser.Math.Vector2(fx, arena.groundY(fx, y));
        this.legs.push({ side, spread: s, foot: p.clone(), from: p.clone(), to: p.clone(), t: 1 });
      }
  }

  get x() {
    return this.body.x;
  }
  get y() {
    return this.body.y;
  }
  get b() {
    return this.body.body as Body;
  }

  /** force: bypass the brief post-hit invulnerability (used by big ground-slam shockwaves) */
  damage(n: number, fromX: number, knock = 8, force = false): number {
    if (this.dead || (this.invuln > 0 && !force)) return 0;
    this.invuln = 0.2;
    const dmg = n * this.vuln * (this.shieldT > 0 ? 0.3 : 1);
    this.hp = Math.max(0, this.hp - dmg);
    this.flashT = 0.08;
    // localized impact on the side that was hit; bigger hits → more sparks + smoke
    const side = Math.sign(fromX - this.x) || 1;
    this.fx.burst(this.x + side * 44, this.y - 4, Math.round(4 + Math.min(24, dmg * 1.2)));
    if (dmg > 10) this.fx.smokePuff(this.x + side * 30, this.y - 10, 2);
    this.lastHit = dmg;
    MB.setVelocity(this.b, { x: Math.sign(this.x - fromX) * knock, y: -knock * 0.6 });
    if (dmg > 8) {
      this.state = "stunned";
      this.stateT = 0.5;
    }
    if (this.hp <= 0) this.dead = true;
    return dmg;
  }

  // Director-triggered behaviours
  laserBarrage(n: number) {
    this.laserQueue += n;
    if (this.state === "stalk") this.beginLaser();
  }
  leapSlam() {
    this.pendingLeap = true;
  }
  shieldUp(sec: number) {
    this.shieldT = sec;
  }
  enrage(sec: number) {
    this.enrageT = sec;
  }

  private beginLaser() {
    this.state = "charge_laser";
    this.stateT = 0.55;
  }

  private px = 0;
  private py = 0;
  private gy = 0;

  update(dt: number, time: number, px: number, py: number, passive = false) {
    const b = this.b;
    this.px = px;
    this.py = py;
    this.stateT -= dt;
    this.nextAttack -= dt;
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.enrageT = Math.max(0, this.enrageT - dt);
    this.flashT -= dt;
    this.invuln -= dt;
    const rage = this.enrageT > 0 ? 1.6 : 1;
    this.facing = px < this.x ? -1 : 1;
    this.body.setFlipX(this.facing < 0);
    this.body.setOrigin(this.facing < 0 ? 0.6 : 0.4, 0.5);

    const gy = (this.gy = this.arena.groundY(this.x, this.y + 20));
    const dist = gy - this.y;
    const STAND = 92;
    const near = dist < STAND + 30;

    if (this.dead) return;

    // hover on legs
    if (near && this.state !== "leap") {
      const want = (dist - STAND) * 0.3;
      MB.setVelocity(b, { x: b.velocity.x, y: b.velocity.y + (want - b.velocity.y) * 0.4 });
    }
    // landing from leap
    if (this.state === "leap") {
      if (b.velocity.y > 0 && near) {
        this.state = "stalk";
        this.onSlam(this.x, gy, 1.4 * rage);
      }
    }

    if (this.state === "stalk" && passive) {
      // Character Lab training dummy: idles in place, never attacks.
      MB.setVelocity(b, { x: b.velocity.x * 0.9, y: b.velocity.y });
    } else if (this.state === "stalk") {
      const dx = px - this.x;
      const keep = 240;
      const want = Math.abs(dx) > keep ? Math.sign(dx) * 3.2 * rage : Math.abs(dx) < keep - 80 ? -Math.sign(dx) * 2.2 : 0;
      MB.setVelocity(b, { x: b.velocity.x + (want - b.velocity.x) * 0.08, y: b.velocity.y });
      // climb toward player height using small hops
      if (py < this.y - 120 && near && Math.random() < 0.01) MB.setVelocity(b, { x: Math.sign(dx) * 6, y: -17 });

      if (this.pendingLeap && near) {
        this.pendingLeap = false;
        this.leap(px, py);
      } else if (this.laserQueue > 0) {
        this.beginLaser();
      } else if (this.nextAttack <= 0) {
        this.nextAttack = Phaser.Math.FloatBetween(2.2, 3.8) / rage;
        if (Math.abs(dx) < 300 && Math.random() < 0.45 && near) this.leap(px, py);
        else {
          this.laserQueue = Math.random() < 0.5 ? 1 : 2;
          this.beginLaser();
        }
      }
    } else if (this.state === "charge_laser") {
      MB.setVelocity(b, { x: b.velocity.x * 0.9, y: b.velocity.y });
      if (this.stateT <= 0) {
        this.fire(px, py, rage);
        this.laserQueue = Math.max(0, this.laserQueue - 1);
        if (this.laserQueue > 0) this.stateT = 0.22;
        else this.state = "stalk";
      }
    } else if (this.state === "stunned") {
      if (this.stateT <= 0) this.state = "stalk";
    }

    void time;
  }

  /** per-frame visuals */
  render(time: number) {
    const { px, py, gy } = this;
    const dt = 1 / 60;
    const f = this.facing;
    this.vis.setScale(f, 1);
    if (this.dead) {
      // shutdown: core sputters out, optic dies, sparks, legs splay as the hull collapses
      this.deathT += dt;
      const flick = this.deathT < 1.2 && Math.random() < 0.5 ? 1 : 0;
      this.core.setAlpha(Math.max(0, 1 - this.deathT) * (0.4 + 0.6 * flick));
      this.coreGlow.setAlpha(Math.max(0, 0.8 - this.deathT) * flick);
      this.pupil.setAlpha(Math.max(0, 1 - this.deathT * 2));
      if (this.deathT < 1.4 && Math.random() < 0.25) this.fx.burst(this.x + Phaser.Math.Between(-50, 50), this.y + Phaser.Math.Between(-30, 20), 4);
      this.cannon.setRotation(Phaser.Math.Linear(this.cannon.rotation, 0.6, 0.05));
      this.vis.setPosition(this.x, this.y).setRotation(Phaser.Math.Linear(this.vis.rotation, 0.12 * f, 0.05));
      this.drawLegs(time, gy);
      return;
    }
    const b = this.b;
    // body motion: idle breathing, sink while charging, lean into movement, recoil
    const charging = this.state === "charge_laser";
    const targetBob = (charging ? 7 : 0) + Math.sin(time * 0.003) * 2 + this.legBob;
    this.bob = Phaser.Math.Linear(this.bob, targetBob, 0.2);
    this.kick = Math.max(0, this.kick - dt * 5);
    const lean = Phaser.Math.Clamp(b.velocity.x * 0.012, -0.1, 0.1) + (this.state === "stunned" ? Math.sin(time * 0.04) * 0.08 : 0);
    this.vis.setPosition(this.x - f * this.kick * 6, this.y + this.bob).setRotation(lean);
    // cannon tracks the player (container space), recoils on fire
    const want = Phaser.Math.Clamp(Math.atan2(py - (this.y + 16), (px - this.x) * f), -0.6, 0.85);
    this.aim = Phaser.Math.Linear(this.aim, want, charging ? 0.35 : 0.12);
    this.cannon.setRotation(this.aim).setPosition(40 - this.kick * 8, 16);
    const m = new Phaser.Math.Vector2(40 + Math.cos(this.aim) * 72, 16 + Math.sin(this.aim) * 72);
    this.muzzle.setPosition(m.x, m.y).setRotation(this.aim + Math.PI / 2); // sprite points up → along the barrel
    if (charging) this.muzzle.setAlpha(0.35 + (0.55 - this.stateT) * 1.2).setScale(0.12 + (0.55 - Math.max(0, this.stateT)) * 0.4);
    else this.muzzle.setAlpha(Math.max(0, this.muzzle.alpha - dt * 6));
    // optic tracks the player
    const ang = Math.atan2(py - this.y, (px - this.x) * f);
    this.pupil.setPosition(52 + Math.cos(ang) * 4, -12 + Math.sin(ang) * 4);
    // reactor core: intensity tells the state
    const hpK = this.hp / this.maxHp;
    let glow = 0.55 + Math.sin(time * 0.004) * 0.1;
    if (charging) glow = 0.8 + (0.55 - Math.max(0, this.stateT)) * 0.8;
    if (this.enrageT > 0) glow = 0.75 + (Math.sin(time * 0.03) > 0 ? 0.35 : 0);
    if (hpK < 0.35 && Math.random() < 0.08) glow *= 0.3; // sputtering when badly damaged
    if (this.state === "stunned") glow *= 0.5 + Math.random() * 0.5;
    this.core.setAlpha(Math.min(1, glow));
    this.coreGlow.setAlpha(Math.min(0.9, glow * 0.7)).setScale(1.1 + glow * 0.5);
    this.pupil.setScale(charging ? 1.4 : 1).setAlpha(this.state === "stunned" ? (Math.random() < 0.5 ? 0.2 : 1) : 1);
    // hit flash on the hull only (core/optic keep glowing)
    if (this.flashT > 0) flashWhite(this.hull);
    else unflash(this.hull, this.enrageT > 0 ? 0xff9090 : undefined);
    // damage smoke when low on health
    this.smokeT -= dt;
    if (hpK < 0.35 && this.smokeT <= 0) {
      this.smokeT = 0.35;
      this.fx.smokePuff(this.x - f * 30, this.y - 30, 1);
    }
    this.dome.setPosition(this.x, this.y).setAlpha(this.shieldT > 0 ? 0.45 + Math.sin(time * 0.02) * 0.12 : 0);
    this.drawLegs(time, gy);
    // charge telegraph: aim line + reticle on the target
    if (charging) {
      const e = this.eye();
      const k = Phaser.Math.Clamp(1 - this.stateT / 0.55, 0, 1);
      this.gfx.lineStyle(1 + k * 2, 0xff2030, 0.25 + k * 0.4).lineBetween(e.x, e.y, px, py);
      this.gfx.lineStyle(2, 0xff2030, 0.8).strokeCircle(px, py, 26 - k * 14);
    }
  }

  /** cannon muzzle in world space (lasers originate here) */
  eye() {
    const L = 70;
    const lx = 40 + Math.cos(this.aim) * L,
      ly = 16 + this.bob + Math.sin(this.aim) * L;
    return new Phaser.Math.Vector2(this.x + this.facing * lx, this.y + ly);
  }

  setVisible(v: boolean) {
    this.vis.setVisible(v);
    this.gfx.setVisible(v);
    this.gfxBack.setVisible(v);
  }

  /** defeat: leave a dark, collapsed wreck instead of vanishing */
  wreck() {
    this.hull.setTint(0x55585c);
    this.cannon.setTint(0x55585c);
    this.core.setAlpha(0);
    this.coreGlow.setAlpha(0);
    this.pupil.setAlpha(0);
    this.muzzle.setAlpha(0);
  }

  private fire(px: number, py: number, rage: number) {
    const e = this.eye();
    const a = Math.atan2(py - e.y, px - e.x) + Phaser.Math.FloatBetween(-0.05, 0.05);
    const sp = 13 * Math.min(rage, 1.3);
    const img = this.scene.add.image(e.x, e.y, "bolt").setScale(1.3, 1.4).setRotation(a).setBlendMode(Phaser.BlendModes.ADD).setDepth(45);
    this.kick = 1;
    this.muzzle.setAlpha(1).setScale(0.55);
    this.onLaser({ img, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 3, dmg: 7 * rage });
    this.fx.burst(e.x, e.y, 8);
    MB.setVelocity(this.b, { x: this.b.velocity.x - Math.cos(a) * 1.5, y: this.b.velocity.y });
  }

  private leap(px: number, py: number) {
    this.state = "leap";
    const dx = Phaser.Math.Clamp(px - this.x, -420, 420);
    MB.setVelocity(this.b, { x: dx / 32, y: -19 + Math.min(0, (py - this.y) / 40) });
    this.fx.smokePuff(this.x, this.y + 80, 5);
  }

  private legBob = 0;

  /** tapered armour segment from a→b */
  private seg(g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number, w1: number, w2: number, fill: number, edge: number) {
    const dx = bx - ax,
      dy = by - ay;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L,
      ny = dx / L;
    const pts = [
      new Phaser.Math.Vector2(ax + nx * w1, ay + ny * w1),
      new Phaser.Math.Vector2(bx + nx * w2, by + ny * w2),
      new Phaser.Math.Vector2(bx - nx * w2, by - ny * w2),
      new Phaser.Math.Vector2(ax - nx * w1, ay - ny * w1),
    ];
    g.fillStyle(0x0a0b0e).fillPoints(pts, true);
    const inset = pts.map((p, i) => new Phaser.Math.Vector2(p.x - nx * (i < 2 ? 2 : -2), p.y - ny * (i < 2 ? 2 : -2)));
    g.fillStyle(fill).fillPoints(inset, true);
    g.lineStyle(2, edge, 0.9).lineBetween(inset[0].x, inset[0].y, inset[1].x, inset[1].y); // lit edge
  }

  private drawLegs(time: number, gy: number) {
    const gF = this.gfx,
      gB = this.gfxBack;
    gF.clear();
    gB.clear();
    const L1 = 62,
      L2 = 72;
    // coordinated gait: two alternating groups; a group may only lift while the other is planted
    const stepping = [0, 0];
    this.legs.forEach((l, i) => l.t < 1 && stepping[(i + (l.side > 0 ? 1 : 0)) % 2]++);
    let bobSum = 0;
    this.legs.forEach((leg, i) => {
      const group = (i + (leg.side > 0 ? 1 : 0)) % 2;
      const dir = leg.side * this.facing;
      const hip = new Phaser.Math.Vector2(this.x + dir * (8 + 16 * leg.spread), this.y + 14 + this.bob);
      const idealX = this.x + dir * (30 + leg.spread * 38) + this.b.velocity.x * 6;
      const gY = this.arena.groundY(idealX, this.y);
      const reach = Phaser.Math.Distance.Between(hip.x, hip.y, leg.foot.x, leg.foot.y);
      const airborne = gY - this.y > 220;
      if (this.dead) {
        // splayed and lifeless: feet slide outward onto the floor
        const tx = this.x + dir * (50 + leg.spread * 42);
        leg.foot.set(Phaser.Math.Linear(leg.foot.x, tx, 0.06), Phaser.Math.Linear(leg.foot.y, this.arena.groundY(tx, this.y), 0.1));
      } else if (airborne) {
        // tucked during leaps
        leg.foot.set(hip.x + dir * (30 + leg.spread * 16), hip.y + 52 + Math.sin(time * 0.01 + leg.spread) * 6);
        leg.t = 1;
      } else if (leg.t >= 1 && stepping[1 - group] === 0 && (Math.abs(leg.foot.x - idealX) > 46 || reach > L1 + L2 - 4)) {
        leg.from.copy(leg.foot);
        leg.to.set(idealX + Phaser.Math.Between(-6, 6), gY);
        leg.t = 0;
        stepping[group]++;
      }
      if (leg.t < 1 && !this.dead) {
        leg.t = Math.min(1, leg.t + 0.16);
        leg.foot.set(Phaser.Math.Linear(leg.from.x, leg.to.x, leg.t), Phaser.Math.Linear(leg.from.y, leg.to.y, leg.t) - Math.sin(leg.t * Math.PI) * 26);
        bobSum += Math.sin(leg.t * Math.PI);
        if (leg.t >= 1) this.fx.burst(leg.foot.x, leg.foot.y, 1);
      }
      // 2-bone IK, knee bends upward/outward
      const dx = leg.foot.x - hip.x,
        dy = leg.foot.y - hip.y;
      const d = Math.min(Math.hypot(dx, dy), L1 + L2 - 0.01);
      const a = Math.atan2(dy, dx);
      const cosK = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
      const k = Math.acos(Phaser.Math.Clamp(cosK, -1, 1));
      const ka = a - k * Math.sign(dx || dir);
      const knee = new Phaser.Math.Vector2(hip.x + Math.cos(ka) * L1, hip.y + Math.sin(ka) * L1);
      const back = i % 2 === 1; // alternate near/far legs on both sides for depth
      const g = back ? gB : gF;
      const dim = this.dead ? 0.6 : 1;
      const c = (r: number, gg: number, bb: number) => Phaser.Display.Color.GetColor(r * dim, gg * dim, bb * dim);
      this.seg(g, hip.x, hip.y, knee.x, knee.y, 7, 5, back ? c(38, 42, 50) : c(58, 66, 78), back ? c(70, 80, 92) : c(150, 170, 190));
      this.seg(g, knee.x, knee.y, leg.foot.x, leg.foot.y, 5, 2.5, back ? c(30, 34, 40) : c(74, 84, 98), back ? c(60, 68, 78) : c(130, 140, 150));
      // piston on the femur
      g.lineStyle(2, back ? 0x2a2e34 : 0x9aa4ad, 0.9).lineBetween(Phaser.Math.Linear(hip.x, knee.x, 0.25), Phaser.Math.Linear(hip.y, knee.y, 0.25) + 5, Phaser.Math.Linear(hip.x, knee.x, 0.8), Phaser.Math.Linear(hip.y, knee.y, 0.8) + 4);
      // joints + claw foot
      g.fillStyle(0x0a0b0e).fillCircle(knee.x, knee.y, 6.5);
      g.fillStyle(back ? 0x8a6a20 : 0xffc83d).fillCircle(knee.x, knee.y, 4);
      g.fillStyle(0x0a0b0e).fillCircle(knee.x, knee.y, 1.6);
      g.fillStyle(0x0a0b0e).fillCircle(hip.x, hip.y, 5);
      const fx = leg.foot.x,
        fy = leg.foot.y;
      g.fillStyle(back ? 0x50565e : 0xaab4be).fillTriangle(fx - 6, fy - 7, fx, fy + 2, fx - 1, fy - 9).fillTriangle(fx + 6, fy - 7, fx, fy + 2, fx + 1, fy - 9);
    });
    this.legBob = bobSum * 1.2; // body rises slightly with each lifted pair
    void gy;
  }

  destroy() {
    this.body.destroy();
    this.gfx.destroy();
    this.gfxBack.destroy();
    this.vis.destroy();
    this.dome.destroy();
  }
}
