import Phaser from "phaser";
import { COLOR_HEX, type ComponentType, type Operation } from "../../shared/mutations";
import type { Arena } from "./Arena";
import type { Fx } from "./Fx";
import { MB, flashWhite, unflash } from "./util";

type Body = MatterJS.BodyType;
type Img = Phaser.Physics.Matter.Image;

export const PLAYER_GROUP = -1;
export const CAT_PLAYER = 0x0002;

export interface Params {
  size: number;
  power: number;
  mass: number;
  length: number;
  color: number;
  socket: Operation["socket"];
}

interface Comp {
  type: ComponentType;
  params: Params;
  sprites: Phaser.GameObjects.Image[];
  imgs: Img[];
  constraints: MatterJS.ConstraintType[];
  emitters: Phaser.GameObjects.Particles.ParticleEmitter[];
  head?: Img; // chain weapon head
  shieldHp?: number;
  shieldDown?: number;
}

export interface GoblinInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  thrust: boolean;
  aimX: number;
  aimY: number;
}

const wrap = (a: number) => Phaser.Math.Angle.Wrap(a);

/** Self-righting "active ragdoll": Matter bodies + joints, PD-driven limb angles, hover spring. */
export class Goblin {
  torso!: Img;
  head!: Img;
  uarmL!: Img;
  farmL!: Img;
  uarmR!: Img;
  farmR!: Img;
  thighL!: Img;
  shinL!: Img;
  thighR!: Img;
  shinR!: Img;
  parts: Img[] = [];
  comps = new Map<ComponentType, Comp>();
  hp = 100;
  maxHp = 100;
  fuel = 1;
  facing = 1;
  stun = 0;
  grounded = false;
  thrusting = false;
  autoThrust = 0;
  private phase = 0;
  private jumpCd = 0;
  private slamT = -1;
  invuln = 0;
  hammerSpeed = 0;
  scanRing?: Phaser.GameObjects.Graphics;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    private arena: Arena,
    private fx: Fx,
  ) {
    const opt = (density = 0.002) => ({
      friction: 0.8,
      frictionAir: 0.03,
      density,
      collisionFilter: { group: PLAYER_GROUP, category: CAT_PLAYER },
      chamfer: { radius: 5 },
    });
    const add = (dx: number, dy: number, key: string, w: number, h: number, density?: number) => {
      const i = scene.matter.add.image(x + dx, y + dy, key, undefined, { ...opt(density), shape: { type: "rectangle", width: w, height: h } });
      i.setDepth(20);
      this.parts.push(i);
      return i;
    };
    this.torso = add(0, 0, "g_torso", 36, 50, 0.004);
    this.head = scene.matter.add.image(x, y - 44, "g_head", undefined, { ...opt(0.0015), shape: { type: "circle", radius: 19 } }).setDepth(21);
    this.parts.push(this.head);
    this.uarmL = add(-18, -8, "g_uarm", 12, 28);
    this.farmL = add(-18, 20, "g_farm", 11, 28);
    this.uarmR = add(18, -8, "g_uarm", 12, 28);
    this.farmR = add(18, 20, "g_farm", 11, 28);
    this.thighL = add(-9, 38, "g_thigh", 14, 28);
    this.shinL = add(-9, 68, "g_shin", 14, 32);
    this.thighR = add(9, 38, "g_thigh", 14, 28);
    this.shinR = add(9, 68, "g_shin", 14, 32);
    this.shinL.setFriction(1.2);
    this.shinR.setFriction(1.2);
    // back limbs drawn behind
    for (const p of [this.uarmL, this.farmL, this.thighL, this.shinL]) p.setDepth(18).setTint(0xb8c0c8);

    const j = (a: Img, b: Img, ax: number, ay: number, bx: number, by: number) =>
      scene.matter.add.constraint(a.body as Body, b.body as Body, 0, 0.95, { pointA: { x: ax, y: ay }, pointB: { x: bx, y: by }, damping: 0.1 });
    j(this.torso, this.head, 0, -24, 0, 18);
    j(this.torso, this.uarmL, -15, -18, 0, -11);
    j(this.uarmL, this.farmL, 0, 11, 0, -11);
    j(this.torso, this.uarmR, 15, -18, 0, -11);
    j(this.uarmR, this.farmR, 0, 11, 0, -11);
    j(this.torso, this.thighL, -9, 22, 0, -11);
    j(this.thighL, this.shinL, 0, 11, 0, -12);
    j(this.torso, this.thighR, 9, 22, 0, -11);
    j(this.thighR, this.shinR, 0, 11, 0, -12);

    // Ambient scan ring shown while a mutation request is in flight.
    this.scanRing = scene.add.graphics().setDepth(30).setVisible(false);
  }

  get x() {
    return this.torso.x;
  }
  get y() {
    return this.torso.y;
  }
  get vx() {
    return (this.torso.body as Body).velocity.x;
  }

  /** local offset on a body -> world */
  w(img: Img, lx: number, ly: number) {
    const c = Math.cos(img.rotation),
      s = Math.sin(img.rotation);
    return new Phaser.Math.Vector2(img.x + lx * c - ly * s, img.y + lx * s + ly * c);
  }

  socketPos(socket: Operation["socket"]) {
    switch (socket) {
      case "right_hand":
        return this.w(this.farmR, 0, 14);
      case "left_hand":
        return this.w(this.farmL, 0, 14);
      case "feet":
        return this.w(this.shinR, 0, 16);
      case "back":
        return this.w(this.torso, -this.facing * 20, 0);
      default:
        return new Phaser.Math.Vector2(this.torso.x, this.torso.y);
    }
  }

  private drive(img: Img, target: number, k: number, blend: number) {
    const b = img.body as Body;
    const desired = wrap(target - b.angle) * k;
    MB.setAngularVelocity(b, b.angularVelocity + (desired - b.angularVelocity) * blend);
  }

  update(dt: number, inp: GoblinInput, time: number) {
    const t = this.torso.body as Body;
    this.jumpCd -= dt;
    this.invuln -= dt;
    this.stun = Math.max(0, this.stun - dt);
    const alive = this.hp > 0;
    this.facing = inp.aimX >= this.x ? 1 : -1;
    this.head.setFlipX(this.facing < 0);

    // ---- hover spring / grounding ----
    const gy = this.arena.groundY(this.x, this.y + 10);
    const dist = gy - this.y;
    const STAND = 74;
    this.grounded = dist < STAND + 14;
    if (alive && this.stun <= 0 && this.slamT < 0) {
      if (this.grounded && !(this.thrusting && t.velocity.y < 0)) {
        const want = (dist - STAND) * 0.35;
        MB.setVelocity(t, { x: t.velocity.x, y: t.velocity.y + (want - t.velocity.y) * 0.45 });
      }
      // ---- horizontal ----
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const speed = this.grounded ? 6.5 : this.thrusting ? 8 : 5;
      const accel = this.grounded ? 0.25 : 0.08;
      if (dir !== 0 || this.grounded) MB.setVelocity(t, { x: t.velocity.x + (dir * speed - t.velocity.x) * accel, y: t.velocity.y });
      // ---- jump ----
      const springs = this.comps.get("spring_legs");
      if (inp.jump && this.grounded && this.jumpCd <= 0) {
        const jm = springs ? 1 + 0.35 * springs.params.power : 1;
        for (const p of this.parts) MB.setVelocity(p.body as Body, { x: (p.body as Body).velocity.x, y: -12.5 * jm });
        this.jumpCd = 0.35;
        if (springs) this.fx.burst(this.x, gy, 12);
      }
      // ---- upright torso ----
      this.drive(this.torso, 0, 0.35, 0.6);
      this.drive(this.head, 0, 0.3, 0.4);
      // ---- arms: right aims at pointer, left guards ----
      const aim = Math.atan2(inp.aimY - (this.y - 18), inp.aimX - this.x) - Math.PI / 2;
      this.drive(this.uarmR, aim, 0.35, 0.5);
      this.drive(this.farmR, aim, 0.35, 0.5);
      const guard = this.comps.has("shield") ? -this.facing * 1.35 : this.facing * 0.4 + Math.sin(time * 0.004) * 0.15;
      this.drive(this.uarmL, this.comps.has("shield") ? -this.facing * 0.6 : guard, 0.3, 0.4);
      this.drive(this.farmL, guard, 0.3, 0.4);
      // ---- legs: walk cycle ----
      const moving = Math.abs(t.velocity.x) > 0.8 && this.grounded;
      this.phase += moving ? Math.abs(t.velocity.x) * 0.045 : 0;
      const swing = moving ? Math.sin(this.phase) * 0.6 : 0;
      const air = this.grounded ? 0 : 0.5;
      this.drive(this.thighL, swing - air * this.facing, 0.4, 0.5);
      this.drive(this.thighR, -swing - air * this.facing * 0.5, 0.4, 0.5);
      this.drive(this.shinL, swing + (moving ? Math.max(0, Math.cos(this.phase)) * 0.7 * this.facing : 0) + air * this.facing, 0.4, 0.5);
      this.drive(this.shinR, -swing + (moving ? Math.max(0, -Math.cos(this.phase)) * 0.7 * this.facing : 0) + air * this.facing, 0.4, 0.5);
    }

    // ---- rockets ----
    const rockets = this.comps.get("rocket_booster");
    this.thrusting = false;
    if (rockets && alive) {
      this.autoThrust -= dt;
      const want = (inp.thrust || this.autoThrust > 0) && this.fuel > 0.02 && this.stun <= 0;
      if (want) {
        this.thrusting = true;
        this.fuel = Math.max(0, this.fuel - dt * (0.32 / Math.sqrt(rockets.params.power)));
        const p = rockets.params.power;
        const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        MB.setVelocity(t, {
          x: t.velocity.x + dir * 0.25 * p,
          y: Math.max(-6 - 3.5 * p, t.velocity.y - (0.9 + 0.35 * p)),
        });
      } else {
        this.fuel = Math.min(1, this.fuel + dt * (this.grounded ? 0.45 : 0.12));
      }
    }

    // ---- scripted hammer slam ----
    const chain = this.comps.get("chain_weapon");
    if (this.slamT >= 0) {
      this.slamT += dt;
      if (chain?.head && this.slamT > 0.32 && this.slamT < 0.36) {
        MB.setVelocity(chain.head.body as Body, { x: this.facing * 9, y: 34 });
      }
      if (this.slamT > 0.9) this.slamT = -1;
    }
    if (chain?.head) {
      const hb = chain.head.body as Body;
      this.hammerSpeed = Math.hypot(hb.velocity.x, hb.velocity.y);
      // Swing assist: pull the head toward a point along the aim direction (laggy, weighty whirl).
      if (this.slamT < 0 && alive && this.stun <= 0) {
        const hand = this.socketPos(chain.params.socket);
        const ang = Math.atan2(inp.aimY - hand.y, inp.aimX - hand.x);
        const reach = 60 + 70 * chain.params.length;
        const tx = hand.x + Math.cos(ang) * reach,
          ty = hand.y + Math.sin(ang) * reach;
        const k = 0.0016 / Math.sqrt(chain.params.mass);
        MB.applyForce(hb, hb.position, { x: (tx - hb.position.x) * k * hb.mass, y: (ty - hb.position.y) * k * hb.mass });
      }
    }

    this.updateComponentVisuals(time);
  }

  slam() {
    if (!this.comps.has("chain_weapon") || this.slamT >= 0 || this.stun > 0) return false;
    this.slamT = 0;
    for (const p of this.parts) MB.setVelocity(p.body as Body, { x: (p.body as Body).velocity.x + this.facing * 3, y: -13 });
    const head = this.comps.get("chain_weapon")!.head!;
    MB.setVelocity(head.body as Body, { x: -this.facing * 6, y: -22 });
    return true;
  }

  punch(aimX: number, aimY: number) {
    const ang = Math.atan2(aimY - this.farmR.y, aimX - this.farmR.x);
    MB.setVelocity(this.farmR.body as Body, { x: Math.cos(ang) * 22, y: Math.sin(ang) * 22 });
  }

  /** returns damage actually taken */
  damage(n: number, fromX: number, knock = 6): number {
    if (this.invuln > 0 || this.hp <= 0) return 0;
    const armor = this.comps.get("armor_plating");
    const dmg = n * (armor ? Math.max(0.45, 1 - 0.18 * armor.params.power) : 1);
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = 0.25;
    const dir = Math.sign(this.x - fromX) || 1;
    MB.setVelocity(this.torso.body as Body, { x: dir * knock, y: -knock * 0.7 });
    if (dmg > 9 || this.hp <= 0) this.stun = this.hp <= 0 ? 999 : 0.7;
    for (const p of this.parts) flashWhite(p);
    this.scene.time.delayedCall(70, () => {
      for (const p of this.parts) unflash(p);
      for (const p of [this.uarmL, this.farmL, this.thighL, this.shinL]) p.setTint(0xb8c0c8);
    });
    return dmg;
  }

  shieldCircle(): { x: number; y: number; r: number } | null {
    const s = this.comps.get("shield");
    if (!s || (s.shieldDown ?? 0) > 0 || !s.sprites[0]) return null;
    return { x: s.sprites[0].x, y: s.sprites[0].y, r: 34 * s.params.size };
  }

  hitShield(dmg: number) {
    const s = this.comps.get("shield");
    if (!s) return;
    s.shieldHp = (s.shieldHp ?? 0) - dmg;
    s.sprites[0].setAlpha(1);
    if (s.shieldHp <= 0) {
      s.shieldDown = 5;
      this.fx.burst(s.sprites[0].x, s.sprites[0].y, 40, true);
      this.fx.shockwave(s.sprites[0].x, s.sprites[0].y, 0x26f0ff, 1.5);
      this.fx.floatText(s.sprites[0].x, s.sprites[0].y - 30, "SHIELD BROKEN", "#26f0ff", 18);
    }
  }

  // ---------------------------------------------------------------------
  // Components
  // ---------------------------------------------------------------------
  list(): string[] {
    return [...this.comps.values()].map((c) => `${c.type}(size ${c.params.size.toFixed(1)}, power ${c.params.power.toFixed(1)}, mass ${c.params.mass.toFixed(1)}, length ${c.params.length.toFixed(1)})`);
  }

  attach(op: Operation) {
    this.remove(op.component, true);
    const params: Params = { size: op.size, power: op.power, mass: op.mass, length: op.length, color: COLOR_HEX[op.color], socket: op.socket };
    this.build(op.component, params);
  }

  modify(op: Operation) {
    const c = this.comps.get(op.component);
    if (!c) return this.attach({ ...op, op: "attach", size: Math.max(1, op.size), power: Math.max(1, op.power), mass: Math.max(1, op.mass), length: Math.max(1, op.length) });
    const p = { ...c.params };
    p.size = Phaser.Math.Clamp(p.size * op.size, 0.5, 3);
    p.power = Phaser.Math.Clamp(p.power * op.power, 0.5, 3);
    p.mass = Phaser.Math.Clamp(p.mass * op.mass, 0.5, 5);
    p.length = Phaser.Math.Clamp(p.length * op.length, 0.5, 3);
    this.remove(op.component, true);
    this.build(op.component, p);
  }

  remove(type: ComponentType, silent = false) {
    const c = this.comps.get(type);
    if (!c) return;
    if (!silent) {
      const p = c.sprites[0] ?? c.imgs[0];
      if (p) this.fx.burst(p.x, p.y, 30);
    }
    for (const k of c.constraints) this.scene.matter.world.removeConstraint(k);
    for (const i of c.imgs) i.destroy();
    for (const s of c.sprites) s.destroy();
    for (const e of c.emitters) e.destroy();
    this.comps.delete(type);
  }

  private build(type: ComponentType, params: Params) {
    const c: Comp = { type, params, sprites: [], imgs: [], constraints: [], emitters: [] };
    const sc = this.scene;
    switch (type) {
      case "rocket_booster": {
        const n = params.socket === "feet" ? 2 : 2;
        for (let i = 0; i < n; i++) {
          const s = sc.add.image(0, 0, "c_booster").setScale(0.7 + 0.35 * params.size).setDepth(params.socket === "feet" ? 22 : 17);
          s.setTint(params.color === COLOR_HEX.orange ? 0xffffff : params.color);
          c.sprites.push(s);
          const e = sc.add.particles(0, 0, "glow", {
            speed: { min: 180, max: 380 },
            angle: { min: 80, max: 100 },
            lifespan: { min: 120, max: 300 + 80 * params.power },
            scale: { start: 0.55 + 0.2 * params.size, end: 0 },
            alpha: { start: 1, end: 0 },
            tint: [0xffffff, 0xffc83d, 0xff7a1a, 0xff3344],
            blendMode: "ADD",
            emitting: false,
          });
          e.setDepth(16);
          c.emitters.push(e);
        }
        break;
      }
      case "chain_weapon": {
        const hand = this.socketPos(params.socket);
        const links = Math.round(4 + 4 * params.length);
        const forearm = params.socket === "left_hand" ? this.farmL : this.farmR;
        let prev: Body = forearm.body as Body;
        let prevPt = { x: 0, y: 14 };
        for (let i = 0; i < links; i++) {
          const l = sc.matter.add.image(hand.x, hand.y + 10 + i * 10, "c_link", undefined, {
            shape: { type: "circle", radius: 4 },
            density: 0.002,
            frictionAir: 0.02,
            collisionFilter: { group: PLAYER_GROUP, category: CAT_PLAYER, mask: 0x0001 },
          });
          l.setDepth(19).setTint(params.color === COLOR_HEX.gold ? 0xffffff : params.color);
          c.imgs.push(l);
          c.constraints.push(sc.matter.add.constraint(prev, l.body as Body, 0, 0.9, { pointA: prevPt, pointB: { x: 0, y: -5 } }));
          prev = l.body as Body;
          prevPt = { x: 0, y: 5 };
        }
        const w = 46 * params.size,
          h = 30 * params.size;
        const head = sc.matter.add.image(hand.x, hand.y + 20 + links * 10, "c_hammer", undefined, {
          shape: { type: "rectangle", width: w, height: h },
          density: 0.0018 * params.mass,
          frictionAir: 0.01,
          restitution: 0.2,
          label: "hammer",
          collisionFilter: { group: PLAYER_GROUP, category: CAT_PLAYER },
        });
        head.setDisplaySize(w * 1.3, h * 1.3).setDepth(23);
        head.setTint(params.color === COLOR_HEX.gold ? 0xffffff : params.color);
        c.imgs.push(head);
        c.head = head;
        c.constraints.push(sc.matter.add.constraint(prev, head.body as Body, 0, 0.9, { pointA: prevPt, pointB: { x: 0, y: -h / 2 } }));
        break;
      }
      case "shield": {
        const s = sc.add.image(0, 0, "c_shield").setScale(0.8 + 0.4 * params.size).setDepth(24).setTint(params.color).setBlendMode(Phaser.BlendModes.ADD);
        c.sprites.push(s);
        c.shieldHp = 40 + 40 * params.power;
        c.shieldDown = 0;
        break;
      }
      case "spring_legs": {
        for (let i = 0; i < 2; i++) c.sprites.push(sc.add.image(0, 0, "c_spring").setScale(0.8 + 0.3 * params.size).setDepth(22).setTint(params.color));
        break;
      }
      case "armor_plating": {
        const s = sc.add.image(0, 0, "c_armor").setScale(0.75 + 0.15 * params.size).setDepth(21).setTint(params.color);
        c.sprites.push(s);
        break;
      }
    }
    this.comps.set(type, c);
  }

  private updateComponentVisuals(time: number) {
    for (const c of this.comps.values()) {
      switch (c.type) {
        case "rocket_booster": {
          c.sprites.forEach((s, i) => {
            let p: Phaser.Math.Vector2, rot: number;
            if (c.params.socket === "feet") {
              const shin = i === 0 ? this.shinL : this.shinR;
              p = this.w(shin, 0, 8);
              rot = shin.rotation;
            } else {
              p = this.w(this.torso, -this.facing * (16 + i * 9), -2 - i * 4);
              rot = this.torso.rotation;
            }
            s.setPosition(p.x, p.y).setRotation(rot);
            const nozzle = new Phaser.Math.Vector2(p.x - Math.sin(rot) * 24 * s.scaleY, p.y + Math.cos(rot) * 24 * s.scaleY);
            const e = c.emitters[i];
            if (this.thrusting) e.emitParticleAt(nozzle.x, nozzle.y, 3);
            else if (Math.random() < 0.3) e.emitParticleAt(nozzle.x, nozzle.y, 1);
          });
          break;
        }
        case "shield": {
          const s = c.sprites[0];
          const hand = c.params.socket === "right_hand" ? this.farmR : c.params.socket === "torso" ? this.torso : this.farmL;
          const p = this.w(hand, 0, c.params.socket === "torso" ? 0 : 10);
          s.setPosition(p.x + this.facing * (c.params.socket === "torso" ? 34 : 14), p.y - 6);
          if ((c.shieldDown ?? 0) > 0) {
            c.shieldDown! -= 1 / 60;
            s.setAlpha(0.08);
            if (c.shieldDown! <= 0) c.shieldHp = 40 + 40 * c.params.power;
          } else s.setAlpha(0.55 + Math.sin(time * 0.01) * 0.2);
          break;
        }
        case "spring_legs": {
          c.sprites.forEach((s, i) => {
            const shin = i === 0 ? this.shinL : this.shinR;
            const p = this.w(shin, 0, 20);
            s.setPosition(p.x, p.y).setRotation(shin.rotation);
          });
          break;
        }
        case "armor_plating": {
          const p = this.w(this.torso, this.facing * 2, 2);
          c.sprites[0].setPosition(p.x, p.y).setRotation(this.torso.rotation);
          break;
        }
      }
    }
    if (this.scanRing?.visible) {
      const g = this.scanRing;
      g.clear();
      const r = 70 + Math.sin(time * 0.008) * 6;
      g.lineStyle(2, 0x26f0ff, 0.8);
      for (let i = 0; i < 4; i++) {
        const a0 = time * 0.004 + (i * Math.PI) / 2;
        g.beginPath().arc(this.x, this.y + 10, r, a0, a0 + 0.9).strokePath();
      }
      g.lineStyle(1, 0x26f0ff, 0.4).strokeCircle(this.x, this.y + 10, r + 12);
      const sy = this.y + 10 + Math.sin(time * 0.006) * r;
      g.lineStyle(2, 0x26f0ff, 0.6).lineBetween(this.x - r, sy, this.x + r, sy);
    }
  }

  destroy() {
    for (const t of [...this.comps.keys()]) this.remove(t, true);
    for (const p of this.parts) p.destroy();
    this.scanRing?.destroy();
  }
}
