// Character-specific abilities for imported characters (Kratos, Doraemon), bound to stable
// ability ids — independent of the characters' visual models. Everything here uses the
// existing Matter world, Spider.damage / ArenaScene.impact damage paths and Fx juice.
// Every projectile / timer is bounded and cleaned up (see reset()).
import Phaser from "phaser";
import type { ArenaScene } from "./ArenaScene";
import { FLOOR_Y, H, W } from "./Arena";
import type { SpecialId } from "./characters";
import { MB } from "./util";
import { Q } from "./quality";
import { PLAYER_GROUP } from "./Goblin";

type Body = MatterJS.BodyType;
type Img = Phaser.Physics.Matter.Image;

interface Axe {
  img: Img;
  phase: "out" | "lodged" | "return";
  t: number;
  life: number;
  hitOut: boolean;
  hitBack: boolean;
  side: number; // arc direction for the recall
}
interface AirShot {
  img: Img;
  t: number;
}

export interface AbilityInput {
  up: boolean;
  aimX: number;
  aimY: number;
}

const AXE_OUT_TIME = 0.55;
const AXE_MAX_LIFE = 3.2; // hard cap: force-cleaned if anything goes wrong
const MAX_AIR = 3;
const COPTER_TIME = 5;
const SAFE_FALL_TIME = 1.5;
const RAGE_TIME = 6;

export class Abilities {
  axe: Axe | null = null;
  private axeTrail?: Phaser.GameObjects.Particles.ParticleEmitter;
  air: AirShot[] = [];
  copterT = 0;
  safeFallT = 0;
  private rotor?: Phaser.GameObjects.Image;
  rageT = 0;
  private rageAura?: Phaser.GameObjects.Image;
  doorBusy = false;
  private doorObjs: Phaser.GameObjects.GameObject[] = [];

  constructor(private s: ArenaScene) {}

  get busy() {
    return this.doorBusy;
  }

  /** returns true if the ability actually started (cooldown is only charged then) */
  use(id: SpecialId, inp: AbilityInput): boolean {
    switch (id) {
      case "leviathan_axe":
        return this.throwAxe(inp);
      case "spartan_rage":
        return this.startRage();
      case "air_cannon":
        return this.fireAir(inp);
      case "bamboo_copter":
        return this.startCopter();
      case "anywhere_door":
        return this.openDoor();
      default:
        return false;
    }
  }

  // ======================================================================
  // KRATOS — Leviathan Axe
  // ======================================================================
  private throwAxe(inp: AbilityInput) {
    if (this.axe) {
      this.s.hint("AXE ALREADY THROWN");
      return false;
    }
    const g = this.s.goblin;
    const hand = g.socketPos("right_hand");
    const a = Math.atan2(inp.aimY - hand.y, inp.aimX - hand.x);
    const img = this.s.matter.add.image(hand.x + Math.cos(a) * 20, hand.y + Math.sin(a) * 20, "axe", undefined, {
      shape: { type: "rectangle", width: 44, height: 30 },
      isSensor: true, // passes through, collision events drive damage
      ignoreGravity: true,
      frictionAir: 0,
      label: "axe",
      collisionFilter: { group: PLAYER_GROUP },
    });
    img.setDepth(27);
    img.setVelocity(Math.cos(a) * 21, Math.sin(a) * 21);
    this.axe = { img, phase: "out", t: 0, life: 0, hitOut: false, hitBack: false, side: g.facing };
    this.axeTrail ??= this.s.add
      .particles(0, 0, "spark", { lifespan: 260, scale: { start: 0.8, end: 0 }, tint: [0x9fe8ff, 0xffffff], blendMode: "ADD", emitting: false })
      .setDepth(26);
    this.s.fx.burst(hand.x, hand.y, 10, true);
    this.s.fx.floatText(hand.x, hand.y - 40, "LEVIATHAN!", "#9fe8ff", 18);
    MB.setVelocity(g.farmR.body as Body, { x: Math.cos(a) * 18, y: Math.sin(a) * 18 }); // throwing motion
    this.s.log("player threw the leviathan axe");
    return true;
  }

  private axeStep(dt: number) {
    const ax = this.axe;
    if (!ax) return;
    ax.t += dt;
    ax.life += dt;
    const b = ax.img.body as Body;
    ax.img.rotation += (ax.phase === "lodged" ? 0 : 0.55) * ax.side;
    if (ax.phase === "out" && ax.t > AXE_OUT_TIME) this.recall();
    if (ax.phase === "lodged") {
      MB.setVelocity(b, { x: 0, y: 0 });
      if (ax.t > 0.3) this.recall();
    }
    if (ax.phase === "return") {
      // home on the hand with an arc that decays: visible curved recall path
      const hand = this.s.goblin.socketPos("right_hand");
      const dx = hand.x - b.position.x,
        dy = hand.y - b.position.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = Math.min(30, 12 + ax.t * 30);
      const curve = Math.max(0, 1 - ax.t * 2.2) * 0.35 * ax.side; // shallow arc: visible curve, still hits on the way back
      MB.setVelocity(b, { x: (dx / d) * sp - (dy / d) * sp * curve, y: (dy / d) * sp + (dx / d) * sp * curve });
      if (d < 34) this.catchAxe();
    }
    if (ax.life > AXE_MAX_LIFE || b.position.y > H + 100 || b.position.x < -200 || b.position.x > W + 200) this.cleanAxe();
  }

  private recall() {
    const ax = this.axe!;
    ax.phase = "return";
    ax.t = 0;
    this.s.fx.floatText(ax.img.x, ax.img.y - 30, "RECALL", "#9fe8ff", 14);
  }

  private catchAxe() {
    const ax = this.axe!;
    this.s.fx.burst(ax.img.x, ax.img.y, 16, true);
    this.s.fx.shockwave(ax.img.x, ax.img.y, 0x9fe8ff, 0.9, 240);
    this.s.cameras.main.shake(90, 0.003);
    this.cleanAxe();
  }

  private cleanAxe() {
    if (!this.axe) return;
    if (this.axe.img.active) this.axe.img.destroy();
    this.axe = null;
  }

  /** collision hook (called from ArenaScene.onCollide); returns true if handled */
  onPair(a: Body, b: Body): boolean {
    const ax = this.axe;
    if (ax && ax.img.active && (a === ax.img.body || b === ax.img.body)) {
      const other = a === ax.img.body ? b : a;
      const sp = this.s.spider;
      if (other === sp.b && !sp.dead) {
        const back = ax.phase === "return";
        if (back ? ax.hitBack : ax.hitOut) return true; // one hit per pass
        if (back) ax.hitBack = true;
        else ax.hitOut = true;
        const v = (ax.img.body as Body).velocity;
        const d = sp.damage(back ? 10 : 14, ax.img.x - v.x * 3, back ? 9 : 12);
        MB.setVelocity(sp.b, { x: sp.b.velocity.x + v.x * 0.35, y: sp.b.velocity.y - 3 });
        this.s.fx.floatText(sp.x, sp.y - 70, `-${Math.round(d)}`, "#9fe8ff", 28);
        this.s.impact(ax.img.x, ax.img.y, back ? 1.1 : 1.4, false);
        this.s.log(`leviathan axe ${back ? "recall " : ""}hit spider for ${Math.round(d)}`);
        this.s.emitHp();
        if (!back) this.recall();
        return true;
      }
      if ((other.label === "platform" || other.label === "wall") && ax.phase === "out") {
        ax.phase = "lodged";
        ax.t = 0;
        this.s.fx.burst(ax.img.x, ax.img.y, 14);
        this.s.fx.floatText(ax.img.x, ax.img.y - 26, "THUNK", "#ffc83d", 14);
        return true;
      }
      if (other.label === "crate") MB.setVelocity(other, { x: (ax.img.body as Body).velocity.x * 0.6, y: -6 });
      return true;
    }
    for (const shot of this.air) {
      if (!shot.img.active || (a !== shot.img.body && b !== shot.img.body)) continue;
      const other = a === shot.img.body ? b : a;
      const sp = this.s.spider;
      if (other === sp.b && !sp.dead) {
        const v = (shot.img.body as Body).velocity;
        const n = Math.hypot(v.x, v.y) || 1;
        const d = sp.damage(8, shot.img.x - v.x * 3, 16);
        MB.setVelocity(sp.b, { x: (v.x / n) * 17, y: -7 }); // big knockback is the point
        this.s.fx.floatText(sp.x, sp.y - 70, `-${Math.round(d)}  WHOOMP`, "#9fe8ff", 22);
        this.s.log(`air cannon hit spider for ${Math.round(d)}`);
        this.s.emitHp();
        this.popAir(shot);
        return true;
      }
      if (other.label === "platform" || other.label === "wall") this.popAir(shot);
      else if (other.label === "crate") {
        const v = (shot.img.body as Body).velocity;
        MB.setVelocity(other, { x: v.x * 0.8, y: -8 });
        this.popAir(shot);
      }
      return true;
    }
    return false;
  }

  // ======================================================================
  // KRATOS — Spartan Rage (reuses ground slam impact + hit paths)
  // ======================================================================
  private startRage() {
    if (this.rageT > 0) return false;
    const g = this.s.goblin;
    this.rageT = RAGE_TIME;
    g.dmgTakenMul = 0.5;
    g.speedMul = 1.25;
    this.s.spider.vuln *= 1.4;
    const gy = this.s.arena.groundY(g.x, g.y);
    this.s.impact(g.x, gy, 2.3, true); // existing ground-slam set piece (damages a nearby spider)
    this.s.fx.floatText(g.x, g.y - 110, "SPARTAN RAGE", "#ff3344", 30);
    this.rageAura ??= this.s.add.image(0, 0, "glow").setTint(0xff2a10).setBlendMode(Phaser.BlendModes.ADD).setDepth(19);
    this.rageAura.setVisible(true);
    this.s.log("player entered spartan rage");
    return true;
  }

  private endRage() {
    const g = this.s.goblin;
    g.dmgTakenMul = 1;
    g.speedMul = 1;
    this.s.spider.vuln /= 1.4;
    this.rageAura?.setVisible(false);
    this.s.fx.floatText(g.x, g.y - 100, "RAGE FADES", "#ff9a8a", 16);
  }

  /** punches during rage become shockwave hits (existing impact + damage paths) */
  onPunch(handX: number, handY: number) {
    if (this.rageT <= 0) return;
    const sp = this.s.spider;
    this.s.fx.shockwave(handX, handY, 0xff3344, 1.2, 260);
    if (!sp.dead && Phaser.Math.Distance.Between(handX, handY, sp.x, sp.y) < 140) {
      const d = sp.damage(9, this.s.goblin.x, 12);
      this.s.fx.floatText(sp.x, sp.y - 70, `-${Math.round(d)}`, "#ff3344", 26);
      this.s.impact(handX, handY, 1.3, false);
      this.s.emitHp();
    }
  }

  // ======================================================================
  // DORAEMON — Air Cannon
  // ======================================================================
  private fireAir(inp: AbilityInput) {
    if (this.air.length >= MAX_AIR) return false;
    const g = this.s.goblin;
    const hand = g.socketPos("right_hand");
    const a = Math.atan2(inp.aimY - hand.y, inp.aimX - hand.x);
    const img = this.s.matter.add.image(hand.x + Math.cos(a) * 24, hand.y + Math.sin(a) * 24, "airball", undefined, {
      shape: { type: "circle", radius: 18 },
      isSensor: true,
      ignoreGravity: true,
      frictionAir: 0,
      label: "airshot",
      collisionFilter: { group: PLAYER_GROUP },
    });
    img.setDepth(27).setBlendMode(Phaser.BlendModes.ADD).setScale(0.6);
    img.setVelocity(Math.cos(a) * 17, Math.sin(a) * 17);
    this.air.push({ img, t: 0 });
    this.s.fx.shockwave(hand.x, hand.y, 0xffffff, 1.1, 220); // compressed-air ring at the muzzle
    this.s.fx.burst(hand.x, hand.y, 8, true);
    MB.setVelocity(g.torso.body as Body, { x: (g.torso.body as Body).velocity.x - Math.cos(a) * 3, y: (g.torso.body as Body).velocity.y }); // recoil
    this.s.log("player fired the air cannon");
    return true;
  }

  private airStep(dt: number) {
    for (const shot of [...this.air]) {
      shot.t += dt;
      shot.img.setScale(0.6 + shot.t * 1.4).setAlpha(Math.max(0.15, 1 - shot.t));
      if (shot.t > 0.85 || !shot.img.active) this.popAir(shot);
    }
  }

  private popAir(shot: AirShot) {
    const i = this.air.indexOf(shot);
    if (i < 0) return;
    this.air.splice(i, 1);
    if (shot.img.active) {
      this.s.fx.shockwave(shot.img.x, shot.img.y, 0x9fe8ff, 1.4, 260);
      this.s.fx.burst(shot.img.x, shot.img.y, 12, true);
      shot.img.destroy();
    }
  }

  // ======================================================================
  // DORAEMON — Bamboo Copter
  // ======================================================================
  private startCopter() {
    if (this.copterT > 0) return false;
    this.copterT = COPTER_TIME;
    this.safeFallT = 0;
    this.rotor ??= this.s.add.image(0, 0, "rotor").setDepth(24);
    this.rotor.setVisible(true);
    const g = this.s.goblin;
    for (const p of g.parts) MB.setVelocity(p.body as Body, { x: (p.body as Body).velocity.x, y: -7 }); // lift-off
    this.s.fx.floatText(g.x, g.y - 110, "BAMBOO COPTER", "#ffc83d", 20);
    this.s.log("player deployed the bamboo copter");
    return true;
  }

  private copterStep(dt: number, inp: AbilityInput) {
    const g = this.s.goblin;
    if (this.copterT > 0) {
      this.copterT -= dt;
      if (g.hp <= 0 || this.s.over) this.copterT = 0;
      const t = g.torso.body as Body;
      // controlled hover: hold up to climb, otherwise drift down slowly; never above the ceiling
      const target = inp.up && t.position.y > 140 ? -5 : 1.2;
      MB.setVelocity(t, { x: t.velocity.x, y: t.velocity.y + (target - t.velocity.y) * 0.25 });
      if (this.copterT <= 0) {
        this.safeFallT = SAFE_FALL_TIME; // safe landing: capped fall speed after expiry
        this.s.fx.floatText(g.x, g.y - 100, "BATTERY LOW", "#ffc83d", 14);
      }
    } else if (this.safeFallT > 0) {
      this.safeFallT -= dt;
      const t = g.torso.body as Body;
      if (t.velocity.y > 3.5) MB.setVelocity(t, { x: t.velocity.x, y: 3.5 });
      if (g.grounded) this.safeFallT = 0;
    }
  }

  // ======================================================================
  // DORAEMON — Anywhere Door
  // ======================================================================
  /** a safe torso position: in bounds, standing on a platform, clear of bodies, away from the spider */
  private findDoorSpot(): { x: number; y: number } | null {
    const g = this.s.goblin;
    const sp = this.s.spider;
    const halfW = 34;
    const others = (this.s.matter.world.getAllBodies() as Body[]).filter((b) => !g.allBodies().includes(b) && b.label !== "platform" && b.label !== "wall");
    const candidates: { x: number; y: number; score: number }[] = [];
    for (const p of this.s.arena.plats) {
      for (let x = p.x + 40; x <= p.x + p.w - 40; x += 50) {
        if (x < 70 || x > W - 70) continue;
        const y = p.y - g.stand - 6; // torso center when standing on this platform
        if (y - g.stand < 70) continue; // too close to the ceiling
        if (Math.abs(x - g.x) < 220 && Math.abs(y - g.y) < 120) continue; // must actually go somewhere
        const box = { min: { x: x - halfW, y: y - g.stand }, max: { x: x + halfW, y: p.y - 4 } };
        // not inside another platform (e.g. under a catwalk) and not inside any loose body
        if (this.s.arena.plats.some((q) => q !== p && box.max.x > q.x && box.min.x < q.x + q.w && box.max.y > q.y && box.min.y < q.y + q.h)) continue;
        if (this.s.matter.query.region(others, box).length > 0) continue;
        const dSpider = Math.hypot(x - sp.x, y - sp.y);
        if (dSpider < 200) continue;
        candidates.push({ x, y, score: Math.min(dSpider, 700) + Math.random() * 250 });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  private makeDoor(x: number, footY: number) {
    const glow = this.s.add.image(x, footY - 46, "glow").setTint(0xfff0ff).setBlendMode(Phaser.BlendModes.ADD).setScale(1.2, 2).setAlpha(0).setDepth(18);
    const door = this.s.add.image(x - 22, footY, "door").setOrigin(0, 1).setDepth(22).setScale(0.1, 0.1);
    this.doorObjs.push(glow, door);
    this.s.tweens.add({ targets: door, scaleX: 1, scaleY: 1, duration: 200, ease: "Back.easeOut" });
    return { glow, door };
  }

  private openDoor() {
    if (this.doorBusy) return false;
    const g = this.s.goblin;
    if (g.hp <= 0 || !g.grounded) {
      this.s.hint(g.grounded ? "CAN'T USE THE DOOR NOW" : "LAND FIRST TO OPEN A DOOR");
      return false;
    }
    const dest = this.findDoorSpot();
    if (!dest) {
      this.s.hint("DOOR JAMMED — NO SAFE EXIT");
      return false;
    }
    this.doorBusy = true;
    g.frozenT = 2; // safety net; released explicitly below
    g.invuln = 2;
    const footA = this.s.arena.groundY(g.x, g.y);
    const a = this.makeDoor(g.x, footA);
    const footB = dest.y + g.stand + 6;
    this.s.log("player opened the anywhere door");
    // 1) door A opens (panel swings), glow spills out, fighter fades into it
    this.s.time.delayedCall(220, () => {
      this.s.tweens.add({ targets: a.door, scaleX: 0.12, duration: 220, ease: "Cubic.easeIn" });
      this.s.tweens.add({ targets: a.glow, alpha: 0.9, duration: 220 });
    });
    this.s.time.delayedCall(450, () => g.setHidden(true));
    // 2) teleport the actual physics bodies, door B opens at the destination
    this.s.time.delayedCall(560, () => {
      if (!this.doorBusy) return;
      g.teleportBy(dest.x - g.x, dest.y - g.y);
      const b = this.makeDoor(dest.x, footB);
      b.door.setScale(0.12, 1);
      b.glow.setAlpha(0.9);
      this.s.tweens.add({ targets: a.door, scaleX: 1, duration: 160 });
      this.s.tweens.add({ targets: a.glow, alpha: 0, duration: 160 });
      // 3) fighter steps out, door B closes, both doors pop away
      this.s.time.delayedCall(180, () => {
        g.setHidden(false);
        g.frozenT = 0;
        g.invuln = 0.4;
        this.s.fx.burst(dest.x, dest.y, 18, true);
        this.s.tweens.add({ targets: b.door, scaleX: 1, duration: 200, ease: "Cubic.easeOut" });
        this.s.tweens.add({ targets: b.glow, alpha: 0, duration: 260 });
        this.s.time.delayedCall(420, () => this.clearDoors());
      });
    });
    return true;
  }

  private clearDoors() {
    for (const o of this.doorObjs) {
      this.s.tweens.killTweensOf(o);
      if (o.active) o.destroy();
    }
    this.doorObjs = [];
    this.doorBusy = false;
  }

  // ======================================================================
  step(dt: number, inp: AbilityInput) {
    this.axeStep(dt);
    this.airStep(dt);
    this.copterStep(dt, inp);
    if (this.rageT > 0) {
      this.rageT -= dt;
      if (this.rageT <= 0 || this.s.goblin.hp <= 0) {
        this.rageT = 0;
        this.endRage();
      }
    }
  }

  /** per-frame visuals */
  render(time: number) {
    const g = this.s.goblin;
    if (this.axe && this.axeTrail) this.axeTrail.emitParticleAt(this.axe.img.x, this.axe.img.y, Q.low ? 1 : 2);
    if (this.rotor) {
      const on = this.copterT > 0;
      this.rotor.setVisible(on && !g.hidden);
      if (on) {
        const p = g.w(g.head, 0, -g.def.dims.head - 10);
        this.rotor.setPosition(p.x, p.y).setRotation(g.head.rotation).setScale(Math.cos(time * 0.06) * 1.1, 1); // spinning blades
        if (Math.random() < 0.3) this.s.fx.burst(p.x, p.y, 1);
      }
    }
    if (this.rageAura && this.rageT > 0) this.rageAura.setPosition(g.x, g.y).setScale(3 + Math.sin(time * 0.02) * 0.25).setAlpha(0.3);
  }

  /** fraction of the copter battery left (for the HUD strip), 0 when off */
  get copterLeft() {
    return this.copterT > 0 ? this.copterT / COPTER_TIME : 0;
  }

  reset() {
    this.cleanAxe();
    for (const s of [...this.air]) if (s.img.active) s.img.destroy();
    this.air = [];
    this.copterT = this.safeFallT = this.rageT = 0;
    this.clearDoors();
    void FLOOR_Y;
  }
}
