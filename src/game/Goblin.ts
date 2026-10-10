import Phaser from "phaser";
import { COLOR_HEX, type ComponentType, type Operation } from "../../shared/mutations";
import type { Arena } from "./Arena";
import type { Fx } from "./Fx";
import { MB, flashWhite, unflash } from "./util";
import { Q } from "./quality";
import { CHARACTERS, type CharacterDef } from "./characters";

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
  count: number;
  rocket: number;
}

interface Comp {
  type: ComponentType;
  params: Params;
  sprites: Phaser.GameObjects.Image[];
  imgs: Img[];
  constraints: MatterJS.ConstraintType[];
  emitters: Phaser.GameObjects.Particles.ParticleEmitter[];
  head?: Img; // chain weapon head / boxing glove
  shieldHp?: number;
  shieldDown?: number;
  spring?: MatterJS.ConstraintType; // boxing glove spring
  gfx?: Phaser.GameObjects.Graphics;
  extendT?: number;
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

  def: CharacterDef;
  /** torso-center height above ground when standing */
  stand: number;
  airJumpsLeft = 0;
  /** per-ability-slot cooldowns (slot 0 = the F special) */
  cds = [0, 0, 0];
  get specialCd() {
    return this.cds[0];
  }
  set specialCd(v: number) {
    this.cds[0] = v;
  }
  dmgTakenMul = 1; // Spartan Rage
  speedMul = 1; // Spartan Rage
  frozenT = 0; // Anywhere Door transit: no input, no motion
  launchT = 0; // scripted leap window (Hulk Smash)
  /** player-initiated attack window (click / slam): weapons and fists only deal damage while it's open */
  attackT = 0;
  domeT = 0; // Gremlin dome: invulnerable while > 0
  private jumpHeld = false;

  constructor(
    private scene: Phaser.Scene,
    x: number,
    y: number,
    private arena: Arena,
    private fx: Fx,
    def: CharacterDef = CHARACTERS[0],
  ) {
    this.def = def;
    this.hp = this.maxHp = def.hp;
    const D = def.dims;
    const T = (p: string) => `${def.tex}_${p}`;
    const opt = (density = 0.002) => ({
      friction: 0.8,
      frictionAir: 0.03,
      density,
      collisionFilter: { group: PLAYER_GROUP, category: CAT_PLAYER },
      chamfer: { radius: 5 },
    });
    const add = (dx: number, dy: number, key: string, [w, h]: [number, number], density?: number) => {
      const i = scene.matter.add.image(x + dx, y + dy, key, undefined, { ...opt(density), shape: { type: "rectangle", width: w, height: h } });
      i.setDepth(20);
      this.parts.push(i);
      return i;
    };
    // Joint geometry is derived from part sizes so every character shares one rig.
    const [tw, th] = D.torso;
    const shX = tw / 2 - 3,
      shY = -th / 2 + 7,
      hipX = tw / 4,
      hipY = th / 2 - 3;
    const ua = D.uarm[1] / 2 - 3,
      fa = D.farm[1] / 2 - 3,
      tg = D.thigh[1] / 2 - 3,
      sh = D.shin[1] / 2 - 4;
    this.stand = hipY + 2 * tg + 2 + sh + D.shin[1] / 2 - 2;
    this.torso = add(0, 0, T("torso"), D.torso, def.density);
    this.head = scene.matter.add.image(x, y - th / 2 - D.head, T("head"), undefined, { ...opt(0.0015), shape: { type: "circle", radius: D.head } }).setDepth(21);
    this.head.setOrigin(0.5, 0.5 - def.dims.headOffset / this.head.height);
    this.parts.push(this.head);
    this.uarmL = add(-shX, shY + ua, T("uarm"), D.uarm);
    this.farmL = add(-shX, shY + 2 * ua + fa, T("farm"), D.farm);
    this.uarmR = add(shX, shY + ua, T("uarm"), D.uarm);
    this.farmR = add(shX, shY + 2 * ua + fa, T("farm"), D.farm);
    this.thighL = add(-hipX, hipY + tg, T("thigh"), D.thigh);
    this.shinL = add(-hipX, hipY + 2 * tg + sh, T("shin"), D.shin);
    this.thighR = add(hipX, hipY + tg, T("thigh"), D.thigh);
    this.shinR = add(hipX, hipY + 2 * tg + sh, T("shin"), D.shin);
    this.shinL.setFriction(1.2);
    this.shinR.setFriction(1.2);
    // back limbs drawn behind
    for (const p of this.backParts()) p.setDepth(18).setTint(def.backTint);

    const j = (a: Img, b: Img, ax: number, ay: number, bx: number, by: number) =>
      scene.matter.add.constraint(a.body as Body, b.body as Body, 0, 0.95, { pointA: { x: ax, y: ay }, pointB: { x: bx, y: by }, damping: 0.1 });
    j(this.torso, this.head, 0, -th / 2 + 1, 0, D.head - 1);
    j(this.torso, this.uarmL, -shX, shY, 0, -ua);
    j(this.uarmL, this.farmL, 0, ua, 0, -fa);
    j(this.torso, this.uarmR, shX, shY, 0, -ua);
    j(this.uarmR, this.farmR, 0, ua, 0, -fa);
    j(this.torso, this.thighL, -hipX, hipY, 0, -tg);
    j(this.thighL, this.shinL, 0, tg, 0, -sh);
    j(this.torso, this.thighR, hipX, hipY, 0, -tg);
    j(this.thighR, this.shinR, 0, tg, 0, -sh);

    // Ambient scan ring shown while a mutation request is in flight.
    this.scanRing = scene.add.graphics().setDepth(30).setVisible(false);
  }

  /** every physics body that belongs to the fighter, including equipped weapon chains */
  allBodies(): Body[] {
    const out = this.parts.map((p) => p.body as Body);
    for (const c of this.comps.values()) for (const i of c.imgs) out.push(i.body as Body);
    return out;
  }

  /** rigid teleport: shift every body by the same delta and kill momentum */
  teleportBy(dx: number, dy: number) {
    for (const b of this.allBodies()) {
      MB.setPosition(b, { x: b.position.x + dx, y: b.position.y + dy });
      MB.setVelocity(b, { x: 0, y: 0 });
      MB.setAngularVelocity(b, 0);
    }
  }

  hidden = false;

  setHidden(hidden: boolean, alpha = 1) {
    this.hidden = hidden;
    const objs: Phaser.GameObjects.Components.Alpha[] = [...this.parts];
    for (const c of this.comps.values()) objs.push(...c.imgs, ...c.sprites);
    for (const o of objs) o.setAlpha(hidden ? 0 : alpha);
    for (const c of this.comps.values()) c.gfx?.setVisible(!hidden);
  }

  backParts() {
    return [this.uarmL, this.farmL, this.thighL, this.shinL];
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
        return this.w(this.farmR, 0, this.def.dims.farm[1] / 2);
      case "left_hand":
        return this.w(this.farmL, 0, this.def.dims.farm[1] / 2);
      case "feet":
        return this.w(this.shinR, 0, this.def.dims.shin[1] / 2);
      case "back":
        return this.w(this.torso, -this.facing * (this.def.dims.torso[0] / 2 + 2), 0);
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
    for (let i = 0; i < this.cds.length; i++) this.cds[i] = Math.max(0, this.cds[i] - dt);
    this.launchT = Math.max(0, this.launchT - dt);
    this.attackT = Math.max(0, this.attackT - dt);
    if (this.frozenT > 0) {
      this.frozenT -= dt;
      for (const p of this.allBodies()) MB.setVelocity(p, { x: 0, y: 0 });
      return;
    }
    this.domeT = Math.max(0, this.domeT - dt);
    const alive = this.hp > 0;
    this.facing = inp.aimX >= this.x ? 1 : -1;
    this.head.setFlipX(this.facing < 0);

    // ---- hover spring / grounding ----
    const gy = this.arena.groundY(this.x, this.y + 10);
    const dist = gy - this.y;
    const STAND = this.stand;
    this.grounded = dist < STAND + 14;
    if (alive && this.stun <= 0 && this.slamT < 0) {
      const launched = this.launchT > 0; // scripted leap: don't let the stand spring / ground friction cancel it
      if (this.grounded && !launched && !(this.thrusting && t.velocity.y < 0)) {
        const want = (dist - STAND) * 0.35;
        MB.setVelocity(t, { x: t.velocity.x, y: t.velocity.y + (want - t.velocity.y) * 0.45 });
      }
      // ---- horizontal ----
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const sp = this.def.speed * this.speedMul;
      const speed = this.grounded ? sp : this.thrusting ? Math.max(8, sp) : sp * 0.77;
      const accel = this.grounded ? 0.25 : 0.08;
      if (!launched && (dir !== 0 || this.grounded)) MB.setVelocity(t, { x: t.velocity.x + (dir * speed - t.velocity.x) * accel, y: t.velocity.y });
      // ---- jump ----
      const springs = this.comps.get("spring_legs");
      if (this.grounded) this.airJumpsLeft = this.def.airJumps;
      const pressed = inp.jump && !this.jumpHeld;
      if (inp.jump && this.jumpCd <= 0 && (this.grounded || (pressed && this.airJumpsLeft > 0))) {
        if (!this.grounded) {
          this.airJumpsLeft--;
          this.fx.burst(this.x, this.y + 40, 14, true);
        }
        const jm = springs ? 1 + 0.35 * springs.params.power : 1;
        for (const p of this.parts) MB.setVelocity(p.body as Body, { x: (p.body as Body).velocity.x, y: -this.def.jump * jm });
        this.jumpCd = 0.3;
        if (springs) this.fx.burst(this.x, gy, 12);
      }
      // ---- upright torso ----
      this.drive(this.torso, 0, this.thrusting ? 0.5 : 0.35, this.thrusting ? 0.85 : 0.6);
      this.drive(this.head, 0, 0.3, 0.4);
      // ---- arms: right aims at pointer, left guards ----
      const aim = Math.atan2(inp.aimY - (this.y - 18), inp.aimX - this.x) - Math.PI / 2;
      // heavy model fighters keep the elbow bent (boxer guard) instead of a straight pointing arm
      this.drive(this.uarmR, this.def.model ? aim * 0.6 : aim, 0.35, 0.5);
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

    this.jumpHeld = inp.jump;

    // ---- rockets ----
    const rockets = this.comps.get("rocket_booster");
    this.thrusting = false;
    if (rockets && alive) {
      this.autoThrust -= dt;
      const want = (inp.thrust || this.autoThrust > 0) && this.fuel > 0.02 && this.stun <= 0;
      if (want) {
        this.thrusting = true;
        this.fuel = Math.max(0, this.fuel - dt * (0.32 / Math.sqrt(rockets.params.power)));
        const p = Math.min(3, rockets.params.power * (1 + 0.12 * (rockets.params.count - 2)));
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
    const glove = this.comps.get("boxing_glove");
    if (glove?.spring && glove.extendT !== undefined && glove.extendT > 0) {
      glove.extendT -= dt;
      if (glove.extendT <= 0) glove.spring.length = 16 * glove.params.size;
    }
    if (chain?.head && chain.params.rocket > 0) {
      // rocket assist: push the head along its direction of travel (capped for solver stability)
      const hb = chain.head.body as Body;
      const sp = Math.hypot(hb.velocity.x, hb.velocity.y);
      if (sp > 2 && sp < 30) MB.applyForce(hb, hb.position, { x: (hb.velocity.x / sp) * 0.0006 * chain.params.rocket * hb.mass, y: (hb.velocity.y / sp) * 0.0006 * chain.params.rocket * hb.mass });
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

  }

  /** per-frame visuals (logic runs per fixed physics step in update) */
  render(time: number) {
    if (this.hidden) return;
    this.updateComponentVisuals(time);
  }

  /** true only while the player is actively swinging / slamming: no passive contact damage */
  get attacking() {
    return this.attackT > 0 || this.slamming;
  }

  get slamming() {
    return this.slamT >= 0;
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
    this.attackT = 0.5;
    const glove = this.comps.get("boxing_glove");
    if (glove?.head && glove.spring) {
      // spring-loaded haymaker: extend the spring, launch the glove at the cursor, snap back later
      const p = glove.params;
      const hand = this.socketPos(p.socket);
      const ang = Math.atan2(aimY - hand.y, aimX - hand.x);
      const sp = 20 + 6 * p.power + 6 * p.rocket;
      glove.spring.length = (60 + 70 * p.length) * (0.8 + 0.2 * p.size);
      glove.extendT = 0.22;
      MB.setVelocity(glove.head.body as Body, { x: Math.cos(ang) * sp, y: Math.sin(ang) * sp });
      return;
    }
    const ang = Math.atan2(aimY - this.farmR.y, aimX - this.farmR.x);
    MB.setVelocity(this.farmR.body as Body, { x: Math.cos(ang) * 22, y: Math.sin(ang) * 22 });
    // chain weapon: the click whips the hammer head toward the cursor (a deliberate swing)
    const chain = this.comps.get("chain_weapon");
    if (chain?.head) {
      const hb = chain.head.body as Body;
      const a = Math.atan2(aimY - hb.position.y, aimX - hb.position.x);
      const sp = 16 + 3 * chain.params.power;
      MB.setVelocity(hb, { x: hb.velocity.x * 0.3 + Math.cos(a) * sp, y: hb.velocity.y * 0.3 + Math.sin(a) * sp - 4 });
    }
  }

  /** speed of whichever weapon head (hammer / glove) is attached */
  weaponSpeed(type: "chain_weapon" | "boxing_glove") {
    const h = this.comps.get(type)?.head;
    if (!h) return 0;
    const v = (h.body as Body).velocity;
    return Math.hypot(v.x, v.y);
  }

  private flameEmitter(params: Params) {
    return this.scene.add
      .particles(0, 0, "glow", {
        speed: { min: 40, max: 120 },
        lifespan: { min: 120, max: 260 + 60 * params.rocket },
        scale: { start: 0.45 + 0.15 * params.rocket, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffffff, 0xffc83d, 0xff7a1a, 0xff3344],
        blendMode: "ADD",
        emitting: false,
      })
      .setDepth(21);
  }

  /** returns damage actually taken */
  damage(n: number, fromX: number, knock = 6): number {
    if (this.invuln > 0 || this.hp <= 0 || this.domeT > 0) return 0;
    const armor = this.comps.get("armor_plating");
    const dmg = n * this.def.armor * this.dmgTakenMul * (armor ? Math.max(0.45, 1 - 0.18 * armor.params.power) : 1);
    this.hp = Math.max(0, this.hp - dmg);
    this.invuln = 0.25;
    const dir = Math.sign(this.x - fromX) || 1;
    MB.setVelocity(this.torso.body as Body, { x: dir * knock, y: -knock * 0.7 });
    if (dmg > 9 || this.hp <= 0) this.stun = this.hp <= 0 ? 999 : 0.7;
    for (const p of this.parts) flashWhite(p);
    this.scene.time.delayedCall(70, () => {
      for (const p of this.parts) unflash(p);
      for (const p of this.backParts()) p.setTint(this.def.backTint);
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
    return [...this.comps.values()].map(
      (c) =>
        `${c.type}${c.type === "rocket_booster" ? ` x${c.params.count}` : ""}(size ${c.params.size.toFixed(1)}, power ${c.params.power.toFixed(1)}, mass ${c.params.mass.toFixed(1)}, length ${c.params.length.toFixed(1)}${c.params.rocket > 0 ? `, rocket ${c.params.rocket.toFixed(1)}` : ""})`,
    );
  }

  attach(op: Operation) {
    this.remove(op.component, true);
    const params: Params = { size: op.size, power: op.power, mass: op.mass, length: op.length, color: COLOR_HEX[op.color], socket: op.socket, count: op.count, rocket: op.rocket };
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
    if (op.count !== 1) p.count = op.count; // modify: explicit new count, 1 = unchanged
    if (op.rocket > 0) p.rocket = op.rocket; // modify: explicit rocket assist, 0 = unchanged
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
    c.gfx?.destroy();
    this.comps.delete(type);
  }

  private build(type: ComponentType, params: Params) {
    const c: Comp = { type, params, sprites: [], imgs: [], constraints: [], emitters: [] };
    const sc = this.scene;
    switch (type) {
      case "rocket_booster": {
        const n = params.count;
        const k = n > 2 ? 0.85 : 1; // shrink a little when there are many
        for (let i = 0; i < n; i++) {
          const s = sc.add.image(0, 0, "c_booster").setScale((0.7 + 0.35 * params.size) * k).setDepth(params.socket === "feet" ? 22 : 17);
          s.setTint(params.color === COLOR_HEX.orange ? 0xffffff : params.color);
          c.sprites.push(s);
        }
        {
          // one shared flame emitter for all nozzles (cheap on integrated GPUs)
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
      case "boxing_glove": {
        const hand = this.socketPos(params.socket);
        const forearm = params.socket === "left_hand" ? this.farmL : this.farmR;
        const r = 13 * params.size;
        const glove = sc.matter.add.image(hand.x + this.facing * 20, hand.y, "c_glove", undefined, {
          shape: { type: "circle", radius: r },
          density: 0.0025 * Math.sqrt(params.mass),
          frictionAir: 0.04,
          restitution: 0.5,
          label: "glove",
          collisionFilter: { group: PLAYER_GROUP, category: CAT_PLAYER },
        });
        glove.setDisplaySize(r * 2.6, r * 2.4).setDepth(23).setTint(params.color === COLOR_HEX.red ? 0xffffff : params.color);
        c.imgs.push(glove);
        c.head = glove;
        c.spring = sc.matter.add.constraint(forearm.body as Body, glove.body as Body, 16 * params.size, 0.12, {
          pointA: { x: 0, y: this.def.dims.farm[1] / 2 },
          pointB: { x: 0, y: 0 },
          damping: 0.05,
        });
        c.constraints.push(c.spring);
        c.gfx = sc.add.graphics().setDepth(22);
        c.extendT = 0;
        if (params.rocket > 0) c.emitters.push(this.flameEmitter(params));
        break;
      }
      case "chain_weapon": {
        const hand = this.socketPos(params.socket);
        const links = Math.round(4 + 4 * params.length);
        const forearm = params.socket === "left_hand" ? this.farmL : this.farmR;
        let prev: Body = forearm.body as Body;
        let prevPt = { x: 0, y: this.def.dims.farm[1] / 2 };
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
        if (params.rocket > 0) c.emitters.push(this.flameEmitter(params));
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
          const e = c.emitters[0];
          const tw = this.def.dims.torso[0],
            th = this.def.dims.torso[1];
          const per = Q.low ? 1 : c.sprites.length > 3 ? 2 : 3;
          c.sprites.forEach((s, i) => {
            let p: Phaser.Math.Vector2, rot: number;
            if (c.params.socket === "feet") {
              const shin = i % 2 === 0 ? this.shinL : this.shinR;
              p = this.w(shin, 0, 8 - Math.floor(i / 2) * 12);
              rot = shin.rotation;
            } else {
              // back rack: columns of up to 3, fanned slightly
              const col = Math.floor(i / 3),
                row = i % 3;
              const rows = Math.min(3, c.sprites.length - col * 3);
              p = this.w(this.torso, -this.facing * (tw / 2 + 2 + col * 11), -th / 4 + (row - (rows - 1) / 2) * 15);
              rot = this.torso.rotation + (row - (rows - 1) / 2) * 0.15 * -this.facing;
            }
            s.setPosition(p.x, p.y).setRotation(rot);
            const nozzle = new Phaser.Math.Vector2(p.x - Math.sin(rot) * 24 * s.scaleY, p.y + Math.cos(rot) * 24 * s.scaleY);
            if (this.thrusting) e.emitParticleAt(nozzle.x, nozzle.y, per);
            else if (Math.random() < 0.15) e.emitParticleAt(nozzle.x, nozzle.y, 1);
          });
          break;
        }
        case "boxing_glove": {
          const g = c.gfx!,
            gl = c.head!;
          const hand = this.socketPos(c.params.socket);
          g.clear();
          // zig-zag spring between hand and glove
          const dx = gl.x - hand.x,
            dy = gl.y - hand.y;
          const L = Math.hypot(dx, dy) || 1;
          const nx = -dy / L,
            ny = dx / L;
          const coils = 9;
          g.lineStyle(3, 0xd0d6dc, 1).beginPath().moveTo(hand.x, hand.y);
          for (let i = 1; i < coils; i++) {
            const t = i / coils,
              side = i % 2 ? 6 : -6;
            g.lineTo(hand.x + dx * t + nx * side * c.params.size, hand.y + dy * t + ny * side * c.params.size);
          }
          g.lineTo(gl.x, gl.y).strokePath();
          gl.setRotation(Math.atan2(dy, dx));
          gl.setFlipY(dx < 0);
          if (c.emitters[0] && (Math.hypot((gl.body as Body).velocity.x, (gl.body as Body).velocity.y) > 6 || Math.random() < 0.2))
            c.emitters[0].emitParticleAt(gl.x - (dx / L) * 18, gl.y - (dy / L) * 18, Q.low ? 1 : 2);
          break;
        }
        case "chain_weapon": {
          const h = c.head;
          if (h && c.emitters[0]) {
            const v = (h.body as Body).velocity;
            const sp = Math.hypot(v.x, v.y) || 1;
            c.emitters[0].emitParticleAt(h.x - (v.x / sp) * 24, h.y - (v.y / sp) * 24, sp > 5 ? (Q.low ? 1 : 3) : 1);
          }
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
