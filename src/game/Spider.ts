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
    this.body.setFixedRotation().setDepth(25).setOrigin(0.4, 0.5);
    this.gfx = scene.add.graphics().setDepth(24);
    this.dome = scene.add.image(x, y, "glow").setTint(0xff3344).setScale(4).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD).setDepth(26);
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
    if (this.dead) {
      this.drawLegs(time, gy);
      return;
    }
    if (this.flashT > 0) flashWhite(this.body);
    else unflash(this.body, this.enrageT > 0 ? 0xff8080 : undefined);
    this.dome.setPosition(this.x, this.y).setAlpha(this.shieldT > 0 ? 0.35 + Math.sin(time * 0.02) * 0.1 : 0);
    this.drawLegs(time, gy);

    // charging eye glare
    if (this.state === "charge_laser") {
      const e = this.eye();
      this.gfx.fillStyle(0xff2030, 0.5 + Math.random() * 0.5).fillCircle(e.x, e.y, 6 + (0.55 - this.stateT) * 18);
      this.gfx.lineStyle(1, 0xff2030, 0.35).lineBetween(e.x, e.y, px, py);
    }
  }

  eye() {
    return new Phaser.Math.Vector2(this.x + this.facing * 62, this.y - 2);
  }

  private fire(px: number, py: number, rage: number) {
    const e = this.eye();
    const a = Math.atan2(py - e.y, px - e.x) + Phaser.Math.FloatBetween(-0.05, 0.05);
    const sp = 13 * Math.min(rage, 1.3);
    const img = this.scene.add.image(e.x, e.y, "streak").setTint(0xff2030).setScale(3.2, 2).setRotation(a).setBlendMode(Phaser.BlendModes.ADD).setDepth(45);
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

  private drawLegs(time: number, gy: number) {
    const g = this.gfx;
    g.clear();
    const L1 = 62,
      L2 = 72;
    for (const leg of this.legs) {
      const dir = leg.side * this.facing;
      const hip = new Phaser.Math.Vector2(this.x + dir * 14 * leg.spread, this.y + 6);
      const idealX = this.x + dir * (30 + leg.spread * 38) + this.b.velocity.x * 6;
      const gY = this.arena.groundY(idealX, this.y);
      const reach = Phaser.Math.Distance.Between(hip.x, hip.y, leg.foot.x, leg.foot.y);
      const airborne = gY - this.y > 220 || this.dead;
      if (airborne) {
        // dangle
        leg.foot.set(hip.x + dir * (40 + leg.spread * 20), hip.y + 70 + Math.sin(time * 0.01 + leg.spread) * 10);
        leg.t = 1;
      } else if (leg.t >= 1 && (Math.abs(leg.foot.x - idealX) > 46 || reach > L1 + L2 - 4)) {
        // step (alternate legs implicitly by threshold differences)
        leg.from.copy(leg.foot);
        leg.to.set(idealX + Phaser.Math.Between(-6, 6), gY);
        leg.t = 0;
      }
      if (leg.t < 1) {
        leg.t = Math.min(1, leg.t + 0.14);
        leg.foot.set(Phaser.Math.Linear(leg.from.x, leg.to.x, leg.t), Phaser.Math.Linear(leg.from.y, leg.to.y, leg.t) - Math.sin(leg.t * Math.PI) * 26);
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
      const back = leg.side * this.facing < 0 ? 0.75 : 1;
      g.lineStyle(9, Phaser.Display.Color.GetColor(30 * back, 34 * back, 40 * back)).lineBetween(hip.x, hip.y, knee.x, knee.y);
      g.lineStyle(6, Phaser.Display.Color.GetColor(70 * back, 80 * back, 92 * back)).lineBetween(knee.x, knee.y, leg.foot.x, leg.foot.y);
      g.fillStyle(0xffc83d * 1).fillCircle(knee.x, knee.y, 4);
      g.fillStyle(0x8a949e).fillTriangle(leg.foot.x - 4, leg.foot.y - 8, leg.foot.x + 4, leg.foot.y - 8, leg.foot.x, leg.foot.y + 2);
    }
    void gy;
  }

  destroy() {
    this.body.destroy();
    this.gfx.destroy();
    this.dome.destroy();
  }
}
