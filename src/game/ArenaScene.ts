import Phaser from "phaser";
import { DirectorDecisionSchema, type ComponentType, type DirectorDecision, type MutationPlan, type Operation } from "../../shared/mutations";
import { requestDirector, requestMutation } from "../api";
import { dispatch, parseCommand, registerHandler, validatePlan } from "./actions";
import { Arena, FLOOR_Y, H, W } from "./Arena";
import { bus, EV } from "./bus";
import { Fx } from "./Fx";
import { Goblin } from "./Goblin";
import { Spider, type Laser } from "./Spider";
import { buildTextures } from "./textures";

type Body = MatterJS.BodyType;

const LABEL: Record<ComponentType, string> = {
  rocket_booster: "ROCKET BOOSTERS",
  chain_weapon: "CHAIN HAMMER",
  shield: "ENERGY SHIELD",
  spring_legs: "SPRING LEGS",
  armor_plating: "ARMOR PLATING",
};

export class ArenaScene extends Phaser.Scene {
  fx!: Fx;
  arena!: Arena;
  goblin!: Goblin;
  spider!: Spider;
  lasers: Laser[] = [];
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  events_: string[] = [];
  round = 0;
  elapsed = 0;
  busy = false; // mutation in flight / cinematic
  cinematic = false;
  over = false;
  nextDirector = 9;
  directorInFlight = false;
  hitStop = 0;
  baseTimeScale = 1;
  blueprint!: Phaser.GameObjects.Graphics;
  lastImpact = 0;

  constructor() {
    super("arena");
  }

  create() {
    buildTextures(this);
    this.matter.world.setGravity(0, 1.25);
    this.matter.world.engine.positionIterations = 10;
    this.matter.world.engine.velocityIterations = 8;
    this.matter.world.engine.constraintIterations = 4;
    this.cameras.main.setBounds(0, 0, W, H);

    this.fx = new Fx(this);
    this.arena = new Arena(this, this.fx);
    this.goblin = new Goblin(this, 360, FLOOR_Y - 90, this.arena, this.fx);
    this.spider = new Spider(this, 1250, FLOOR_Y - 100, this.arena, this.fx, (l) => this.lasers.push(l), (x, y, p) => this.spiderSlam(x, y, p));
    this.blueprint = this.add.graphics().setDepth(50);

    const kb = this.input.keyboard!;
    // enableCapture=false so typing in the DOM console still works.
    this.keys = kb.addKeys("W,A,S,D,SPACE,SHIFT,UP,LEFT,RIGHT,Q,R,E", false) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.cinematic || this.over) return;
      if (p.rightButtonDown()) this.trySlam();
      else this.goblin.punch(p.worldX, p.worldY);
    });

    // Shared action handlers (LLM plans and /commands both land here).
    registerHandler("attach", (op) => this.goblin.attach(op));
    registerHandler("modify", (op) => this.goblin.modify(op));
    registerHandler("remove", (op) => this.goblin.remove(op.component));

    this.matter.world.on("collisionstart", (ev: Phaser.Physics.Matter.Events.CollisionStartEvent) => this.onCollide(ev));

    bus.on("submit-prompt", (text: string) => this.submitPrompt(text));
    bus.on("console-focus", (f: boolean) => (this.input.keyboard!.enabled = !f));
    bus.on("restart", () => this.scene.restart());
    this.events.once("shutdown", () => {
      bus.off("submit-prompt");
      bus.off("console-focus");
      bus.off("restart");
      this.lasers = [];
    });
    bus.emit(EV.HP, { player: 1, enemy: 1 });
    bus.emit(EV.LOADOUT, []);
    this.say("Welcome to the Foundry. Goblin vs. Arachnotron. Type a mutation to begin.", "system");
  }

  // ---------------------------------------------------------------------
  update(_t: number, deltaMs: number) {
    const time = this.time.now;
    const dt = Math.min(deltaMs, 50) / 1000;
    // hit-stop
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.matter.world.engine.timing.timeScale = 0.08;
    } else this.matter.world.engine.timing.timeScale = this.baseTimeScale;
    const sdt = dt * this.matter.world.engine.timing.timeScale;

    if (!this.over && !this.cinematic) this.elapsed += dt;
    const k = this.keys;
    const p = this.input.activePointer;
    const inp = {
      left: k.A.isDown || k.LEFT.isDown,
      right: k.D.isDown || k.RIGHT.isDown,
      jump: k.W.isDown || k.UP.isDown || (k.SPACE.isDown && !this.goblin.comps.has("rocket_booster")),
      thrust: k.SPACE.isDown || k.SHIFT.isDown,
      aimX: p.worldX || this.spider.x,
      aimY: p.worldY || this.spider.y,
    };
    if (this.cinematic || this.over) Object.assign(inp, { left: false, right: false, jump: false, thrust: false });
    if (Phaser.Input.Keyboard.JustDown(k.Q)) this.trySlam();
    if (Phaser.Input.Keyboard.JustDown(k.R) && this.over) this.scene.restart();

    this.goblin.update(sdt * 60 > 0 ? dt : 0, inp, time);
    if (this.goblin.thrusting && Math.random() < 0.02) this.log("player rocket-boosting");
    this.spider.update(sdt, time, this.goblin.x, this.goblin.y);
    this.arena.update(time, dt);
    this.updateLasers(sdt * 60);
    this.updateVent();
    if (!this.spider.dead && !this.cinematic) this.checkContactDamage();

    bus.emit(EV.FUEL, this.goblin.comps.has("rocket_booster") ? this.goblin.fuel : -1);

    // fell off-world safety
    if (this.goblin.y > H + 200) this.respawnGoblin();
    if (this.spider.y > H + 200) this.spider.body.setPosition(W - 200, 300);

    // director
    if (!this.over && !this.cinematic) {
      this.nextDirector -= dt;
      if (this.nextDirector <= 0 && !this.directorInFlight) this.callDirector();
    }
    this.checkGameOver();
  }

  // ---------------------------------------------------------------------
  // Prompt -> mutation (signature moment #1)
  // ---------------------------------------------------------------------
  async submitPrompt(text: string) {
    text = text.trim();
    if (!text || this.busy || this.over) return;
    this.busy = true;
    bus.emit(EV.MUTATION_START, { prompt: text });
    this.goblin.scanRing?.setVisible(true);
    try {
      let plan: MutationPlan | undefined;
      let source = "console";
      let note: string | undefined;
      const cmd = parseCommand(text);
      if (cmd) {
        if (cmd.error || !cmd.plan) throw new Error(cmd.error ?? "invalid command");
        plan = cmd.plan;
      } else {
        const res = await requestMutation(text, [...this.goblin.comps.keys()]);
        const v = validatePlan(res.plan); // never trust the wire
        if (!v.plan) throw new Error(`invalid plan: ${v.error}`);
        plan = v.plan;
        source = res.source;
        note = res.note;
      }
      bus.emit(EV.MUTATION_PLAN, { plan, source, note, prompt: text });
      this.goblin.scanRing?.setVisible(false);
      await this.playTransformation(plan);
      bus.emit(EV.MUTATION_DONE, { plan, source });
      bus.emit(EV.LOADOUT, [...this.goblin.comps.keys()]);
      this.log(`player mutated: ${plan.summary}`);
      this.nextDirector = Math.min(this.nextDirector, 3.5);
    } catch (e) {
      bus.emit(EV.MUTATION_ERROR, { error: (e as Error).message });
      this.fx.floatText(this.goblin.x, this.goblin.y - 80, "MUTATION REJECTED", "#ff3344", 20);
    } finally {
      this.goblin.scanRing?.setVisible(false);
      this.busy = false;
    }
  }

  private wait(ms: number) {
    return new Promise<void>((r) => this.time.delayedCall(ms, r));
  }

  private async playTransformation(plan: MutationPlan) {
    const cam = this.cameras.main;
    const g = this.goblin;
    this.cinematic = true;
    bus.emit(EV.CINEMATIC, true);
    this.baseTimeScale = 0.12;
    cam.pan(g.x, g.y - 20, 500, "Cubic.easeInOut", true);
    cam.zoomTo(1.85, 600, "Cubic.easeInOut", true);
    this.fx.flash(0.25, 250, 0x26f0ff);

    // blueprint hologram
    const t0 = this.time.now;
    const bpEvent = this.time.addEvent({ delay: 16, loop: true, callback: () => this.drawBlueprint(this.time.now - t0, plan) });
    bus.emit(EV.BLUEPRINT, {
      title: plan.summary,
      lines: plan.operations.map(
        (o) => `${o.op.toUpperCase()} ${LABEL[o.component]} @ ${o.socket.toUpperCase()} :: size ${o.size.toFixed(1)} | power ${o.power.toFixed(1)} | mass ${o.mass.toFixed(1)} | length ${o.length.toFixed(1)} | ${o.color}`,
      ),
    });
    try {
      await this.wait(900);
      for (const op of plan.operations) await this.assemble(op);
      await this.wait(350);
    } finally {
      bpEvent.remove();
    this.blueprint.clear();
    bus.emit(EV.BLUEPRINT, null);
    cam.zoomTo(1, 500, "Cubic.easeInOut", true);
    cam.pan(W / 2, H / 2, 500, "Cubic.easeInOut", true);
    this.baseTimeScale = 1;
    this.cinematic = false;
    bus.emit(EV.CINEMATIC, false);
    }
    // Show off what changed.
    const added = plan.operations.filter((o) => o.op !== "remove").map((o) => o.component);
    if (added.includes("rocket_booster")) g.autoThrust = 0.9;
  }

  private async assemble(op: Operation) {
    const g = this.goblin;
    const target = g.socketPos(op.socket);
    const label = LABEL[op.component];
    if (op.op === "remove") {
      this.fx.floatText(target.x, target.y - 40, `${label} EJECTED`, "#ff3344", 16);
      await dispatch(op);
      this.fx.burst(target.x, target.y, 30);
      this.fx.shake(150, 0.004);
      await this.wait(500);
      return;
    }
    const key = { rocket_booster: "c_booster", chain_weapon: "c_hammer", shield: "c_shield", spring_legs: "c_spring", armor_plating: "c_armor" }[op.component];
    // ghost part flies in from off-screen, spinning, then snaps on
    const side = g.facing > 0 ? -1 : 1;
    const ghost = this.add
      .image(target.x + side * 420, target.y - 260, key)
      .setDepth(55)
      .setScale(op.size * 1.4)
      .setTint(0x26f0ff)
      .setAlpha(0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    const trail = this.add
      .particles(0, 0, "spark", { follow: ghost, lifespan: 300, scale: { start: 0.8, end: 0 }, tint: 0x26f0ff, blendMode: "ADD", frequency: 12, speed: 20 })
      .setDepth(54);
    this.fx.floatText(target.x, target.y - 70, op.op === "modify" ? `UPGRADING ${label}` : `FABRICATING ${label}`, "#26f0ff", 15);
    await new Promise<void>((res) =>
      this.tweens.add({
        targets: ghost,
        x: target.x,
        y: target.y,
        angle: 720,
        scale: op.size * 0.8,
        duration: 650,
        ease: "Cubic.easeIn",
        onComplete: () => res(),
      }),
    );
    trail.destroy();
    ghost.destroy();
    const r = await dispatch(op);
    if (!r.ok) {
      this.fx.floatText(target.x, target.y - 40, "FABRICATION FAULT", "#ff3344", 16);
      return;
    }
    const p = g.socketPos(op.socket);
    this.fx.burst(p.x, p.y, 40, true);
    this.fx.burst(p.x, p.y, 25);
    this.fx.shockwave(p.x, p.y, 0x26f0ff, 1.4, 350);
    this.fx.flash(0.18, 140, 0x9ffcff);
    this.fx.shake(140, 0.006);
    this.fx.floatText(p.x, p.y - 30, "CLANK!", "#ffc83d", 22);

    await this.wait(250);
    // component-specific "ignition" beat
    if (op.component === "rocket_booster") {
      const n = g.socketPos(op.socket);
      this.fx.explosion(n.x, n.y + 30, 1.2);
      this.fx.floatText(n.x, n.y - 50, "IGNITION", "#ff7a1a", 30);
      g.autoThrust = 0.25;
    } else if (op.component === "chain_weapon") {
      const h = g.comps.get("chain_weapon")?.head;
      if (h) {
        this.fx.burst(h.x, h.y, 50);
        this.fx.floatText(h.x, h.y - 40, `${(op.mass * 450).toFixed(0)} KG OF BAD IDEA`, "#ffc83d", 18);
      }
    } else if (op.component === "shield") {
      this.fx.shockwave(p.x, p.y, 0x26f0ff, 3, 600);
      this.fx.floatText(p.x, p.y - 50, "BARRIER ONLINE", "#26f0ff", 22);
    } else {
      this.fx.floatText(p.x, p.y - 50, `${label} ONLINE`, "#5dff7a", 20);
    }
    await this.wait(450);
  }

  private drawBlueprint(t: number, plan: MutationPlan) {
    const g = this.blueprint;
    const x = this.goblin.x,
      y = this.goblin.y;
    g.clear();
    const k = Math.min(1, t / 500);
    const w = 260 * k,
      h = 230 * k;
    g.fillStyle(0x0a2a35, 0.25).fillRect(x - w / 2, y - h / 2 - 10, w, h);
    g.lineStyle(1, 0x26f0ff, 0.18);
    for (let gx = x - w / 2; gx <= x + w / 2; gx += 16) g.lineBetween(gx, y - h / 2 - 10, gx, y + h / 2 - 10);
    for (let gy = y - h / 2 - 10; gy <= y + h / 2 - 10; gy += 16) g.lineBetween(x - w / 2, gy, x + w / 2, gy);
    g.lineStyle(2, 0x26f0ff, 0.9);
    const c = 16;
    for (const [cx, cy, sx, sy] of [
      [x - w / 2, y - h / 2 - 10, 1, 1],
      [x + w / 2, y - h / 2 - 10, -1, 1],
      [x - w / 2, y + h / 2 - 10, 1, -1],
      [x + w / 2, y + h / 2 - 10, -1, -1],
    ])
      g.lineBetween(cx, cy, cx + c * sx, cy).lineBetween(cx, cy, cx, cy + c * sy);
    // sweep line
    const sy = y - h / 2 - 10 + ((t * 0.25) % h);
    g.lineStyle(2, 0x26f0ff, 0.6).lineBetween(x - w / 2, sy, x + w / 2, sy);
    // callouts to sockets
    plan.operations.forEach((o, i) => {
      const s = this.goblin.socketPos(o.socket);
      const lx = x + (i % 2 === 0 ? 1 : -1) * (w / 2 + 10),
        ly = y - 60 + i * 50;
      g.lineStyle(1, 0xffc83d, 0.9).lineBetween(s.x, s.y, lx, ly);
      g.fillStyle(0xffc83d).fillCircle(s.x, s.y, 3);
      g.strokeCircle(s.x, s.y, 8 + Math.sin(t * 0.01) * 3);
    });
  }

  // ---------------------------------------------------------------------
  // Combat
  // ---------------------------------------------------------------------
  trySlam() {
    if (this.cinematic || this.over) return;
    if (this.goblin.slam()) {
      this.fx.floatText(this.goblin.x, this.goblin.y - 90, "HAMMER SLAM!", "#ffc83d", 22);
      this.log("player hammer slam");
    }
  }

  private onCollide(ev: Phaser.Physics.Matter.Events.CollisionStartEvent) {
    const chain = this.goblin.comps.get("chain_weapon");
    const head = chain?.head?.body as Body | undefined;
    for (const pair of ev.pairs) {
      const a = pair.bodyA.parent ?? pair.bodyA,
        b = pair.bodyB.parent ?? pair.bodyB;
      // hammer impacts
      if (head && (a === head || b === head)) {
        const other = a === head ? b : a;
        const sp = this.goblin.hammerSpeed;
        const contact = pair.collision.supports?.[0] ?? head.position;
        if (other === this.spider.b && sp > 4) {
          const dmg = Math.min(35, sp * 0.55 * Math.sqrt(chain!.params.mass) * (0.7 + 0.3 * chain!.params.power));
          const d = this.spider.damage(dmg, this.goblin.x, Math.min(16, sp * 0.6));
          this.fx.floatText(contact.x, contact.y - 20, `-${Math.round(d)}`, "#ffc83d", 30);
          this.impact(contact.x, contact.y, Math.min(3, 0.6 + sp / 18), false);
          this.log(`hammer hit spider for ${Math.round(d)}`);
        } else if (other.label === "platform" && sp > (this.goblin.slamming ? 10 : 17)) {
          this.impact(contact.x, contact.y, Math.min(3, (sp / 16) * Math.pow(chain!.params.mass, 0.3) * (this.goblin.slamming ? 1.4 : 1)), true);
        } else if (other.label === "crate" && sp > 8) {
          this.fx.burst(contact.x, contact.y, 20);
          this.matter.body.setVelocity(other, { x: head.velocity.x * 0.8, y: head.velocity.y * 0.8 - 5 });
        }
      }
      // crane crate landing
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        const go = (x as Body & { gameObject?: Phaser.GameObjects.GameObject }).gameObject;
        if (go?.getData?.("deadly") && (y.label === "platform" || y === this.spider.b || this.goblin.parts.some((p) => p.body === y))) {
          go.setData("deadly", false);
          const cx = (x as Body).position.x,
            cy = (x as Body).position.y;
          this.impact(cx, cy + 30, 2, true);
          const onLand = go.getData("onLand") as ((c: unknown) => void) | undefined;
          onLand?.(go);
        }
      }
    }
  }

  /** Signature moment #2: arena-shaking impact set piece. */
  impact(x: number, y: number, power: number, ground: boolean) {
    const now = this.time.now;
    if (now - this.lastImpact < 300) return;
    this.lastImpact = now;
    this.fx.explosion(x, y, power);
    this.hitStop = 0.05 + 0.04 * power;
    bus.emit(EV.IMPACT, { power });
    if (ground) {
      this.arena.crack(x, Math.min(y, FLOOR_Y + 2), 0.6 + power * 0.4);
      this.fx.floatText(x, y - 70, power > 2 ? "MEGA IMPACT" : "IMPACT", "#ff7a1a", 20 + power * 8);
    }
    const loose = [
      this.spider.b,
      ...this.arena.crates.map((c) => c.body as Body),
      ...(this.matter.world.getAllBodies() as Body[]).filter((b) => b.label === "Rectangle Body" && !b.isStatic && b.collisionFilter.group === -9),
    ];
    this.arena.shove(x, y, 220 + 90 * power, 6 + 6 * power, loose);
    // shockwave damage to spider if close to ground slam
    if (ground && !this.spider.dead && (this.goblin.slamming || power > 2.2)) {
      const d = Phaser.Math.Distance.Between(x, y, this.spider.x, this.spider.y + 80);
      if (d < 140 + 60 * power) {
        const dmg = this.spider.damage(6 * power, x, 10);
        this.fx.floatText(this.spider.x, this.spider.y - 70, `-${Math.round(dmg)}`, "#ffc83d", 26);
        this.log(`shockwave hit spider for ${Math.round(dmg)}`);
      }
    }
    if (power > 1.8) {
      this.arena.alarmPulse();
      this.arena.ceilingRain(x, power);
      const cam = this.cameras.main;
      if (!this.cinematic) {
        cam.setZoom(1.06);
        this.tweens.add({ targets: cam, zoom: 1, duration: 380, ease: "Cubic.easeOut" });
      }
    }
    this.emitHp();
  }

  private spiderSlam(x: number, y: number, power: number) {
    this.fx.explosion(x, y, power * 0.8);
    this.arena.crack(x, y, 0.8);
    const d = Phaser.Math.Distance.Between(x, y, this.goblin.x, this.goblin.y + 60);
    if (d < 170) {
      const dmg = this.goblin.damage(14 * power, x, 11);
      if (dmg) this.fx.floatText(this.goblin.x, this.goblin.y - 70, `-${Math.round(dmg)}`, "#ff3344", 26);
      this.log(`spider leap slam hit player for ${Math.round(dmg)}`);
    }
    this.emitHp();
  }

  private updateLasers(steps: number) {
    for (const l of [...this.lasers]) {
      l.img.x += l.vx * steps;
      l.img.y += l.vy * steps;
      l.life -= steps / 60;
      let gone = l.life <= 0 || l.img.x < -50 || l.img.x > W + 50 || l.img.y > FLOOR_Y + 10;
      const sh = this.goblin.shieldCircle();
      if (!gone && sh && Phaser.Math.Distance.Between(l.img.x, l.img.y, sh.x, sh.y) < sh.r) {
        this.fx.burst(l.img.x, l.img.y, 18, true);
        this.goblin.hitShield(l.dmg);
        this.log("shield blocked laser");
        gone = true;
        // deflect back toward spider for style
        if (Math.random() < 0.5) {
          const a = Math.atan2(this.spider.y - l.img.y, this.spider.x - l.img.x);
          const img = this.add.image(l.img.x, l.img.y, "streak").setTint(0x26f0ff).setScale(3, 2).setRotation(a).setBlendMode(Phaser.BlendModes.ADD).setDepth(45);
          this.lasers.push({ img, vx: Math.cos(a) * 15, vy: Math.sin(a) * 15, life: 2, dmg: -5 });
        }
      }
      if (!gone && l.dmg > 0) {
        for (const p of [this.goblin.torso, this.goblin.head]) {
          if (Phaser.Math.Distance.Between(l.img.x, l.img.y, p.x, p.y) < 28) {
            const dmg = this.goblin.damage(l.dmg, l.img.x - l.vx, 5);
            if (dmg) this.fx.floatText(p.x, p.y - 40, `-${Math.round(dmg)}`, "#ff3344", 24);
            this.fx.burst(l.img.x, l.img.y, 20);
            this.log(`laser hit player for ${Math.round(dmg)}`);
            gone = true;
            break;
          }
        }
      }
      if (!gone && l.dmg < 0 && Phaser.Math.Distance.Between(l.img.x, l.img.y, this.spider.x, this.spider.y) < 50) {
        const d = this.spider.damage(-l.dmg, l.img.x - l.vx, 4);
        this.fx.burst(l.img.x, l.img.y, 20, true);
        this.fx.floatText(this.spider.x, this.spider.y - 60, `-${Math.round(d)} REFLECT`, "#26f0ff", 20);
        gone = true;
      }
      if (l.img.y > FLOOR_Y - 4 && l.dmg > 0) this.fx.burst(l.img.x, FLOOR_Y, 8);
      if (gone) {
        l.img.destroy();
        this.lasers.splice(this.lasers.indexOf(l), 1);
        this.emitHp();
      }
    }
  }

  private updateVent() {
    if (this.arena.ventActive <= 0) return;
    const vx = this.arena.ventX;
    const push = (b: Body) => {
      if (Math.abs(b.position.x - vx) < 50 && b.position.y > 200) this.matter.body.setVelocity(b, { x: b.velocity.x, y: Math.min(b.velocity.y, -9) });
    };
    for (const p of this.goblin.parts) push(p.body as Body);
    push(this.spider.b);
    for (const c of this.arena.crates) push(c.body as Body);
    if (Math.abs(this.goblin.x - vx) < 50 && Math.random() < 0.05) {
      this.goblin.damage(3, vx, 2);
      this.emitHp();
    }
  }

  private checkContactDamage() {
    // crates hitting things hard
    for (const c of this.arena.crates) {
      const b = c.body as Body;
      const sp = Math.hypot(b.velocity.x, b.velocity.y);
      if (sp < 9) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, this.goblin.x, this.goblin.y) < 50 * c.scale + 20) {
        const d = this.goblin.damage(sp * 0.9, c.x, 8);
        if (d) {
          this.fx.floatText(this.goblin.x, this.goblin.y - 60, `-${Math.round(d)}`, "#ff3344", 24);
          this.log(`crate crushed player for ${Math.round(d)}`);
          this.emitHp();
        }
      }
      if (Phaser.Math.Distance.Between(c.x, c.y, this.spider.x, this.spider.y) < 50 * c.scale + 40 && sp > 11) {
        const d = this.spider.damage(sp * 0.6, c.x, 6);
        if (d > 1) {
          this.fx.floatText(this.spider.x, this.spider.y - 60, `-${Math.round(d)}`, "#ffc83d", 24);
          this.emitHp();
        }
      }
    }
    // punch / body hits on spider from fast goblin forearms
    for (const fa of [this.goblin.farmR, this.goblin.farmL]) {
      const b = fa.body as Body;
      const sp = Math.hypot(b.velocity.x, b.velocity.y);
      if (sp > 12 && Phaser.Math.Distance.Between(fa.x, fa.y, this.spider.x, this.spider.y) < 60) {
        const d = this.spider.damage(4, this.goblin.x, 5);
        if (d) {
          this.fx.burst(fa.x, fa.y, 14);
          this.fx.floatText(this.spider.x, this.spider.y - 60, `-${Math.round(d)}`, "#ffc83d", 22);
          this.emitHp();
        }
      }
    }
    // spider body ram
    if (Phaser.Math.Distance.Between(this.spider.x, this.spider.y, this.goblin.x, this.goblin.y) < 75) {
      const d = this.goblin.damage(5, this.spider.x, 9);
      if (d) this.emitHp();
    }
  }

  private emitHp() {
    bus.emit(EV.HP, { player: this.goblin.hp / this.goblin.maxHp, enemy: this.spider.hp / this.spider.maxHp });
  }

  private respawnGoblin() {
    for (const p of this.goblin.parts) {
      p.setPosition(400, 300);
      p.setVelocity(0, 0);
    }
  }

  private checkGameOver() {
    if (this.over) return;
    if (this.spider.dead) {
      this.over = true;
      const sx = this.spider.x,
        sy = this.spider.y;
      for (let i = 0; i < 6; i++) this.time.delayedCall(i * 180, () => this.fx.explosion(sx + Phaser.Math.Between(-60, 60), sy + Phaser.Math.Between(-40, 40), 1.5 + i * 0.2));
      this.time.delayedCall(1200, () => {
        this.spider.body.setVisible(false);
        this.fx.explosion(sx, sy, 3);
        bus.emit(EV.GAME_OVER, { winner: "player" });
      });
      this.say("ARACHNOTRON DECOMMISSIONED. The crowd is… mildly impressed.", "system");
    } else if (this.goblin.hp <= 0) {
      this.over = true;
      this.time.delayedCall(900, () => bus.emit(EV.GAME_OVER, { winner: "enemy" }));
      this.say("Goblin reduced to scrap. Reboot with R.", "system");
    }
  }

  // ---------------------------------------------------------------------
  // AI Director (async, non-blocking)
  // ---------------------------------------------------------------------
  log(e: string) {
    this.events_.push(`[t=${Math.round(this.elapsed)}] ${e}`);
    if (this.events_.length > 30) this.events_.shift();
  }

  say(text: string, source: string, action?: string) {
    bus.emit(EV.DIRECTOR, { text, source, action });
  }

  private async callDirector() {
    this.directorInFlight = true;
    this.round++;
    const summary = {
      elapsed: Math.round(this.elapsed),
      playerHp: Math.round(this.goblin.hp),
      enemyHp: Math.round(this.spider.hp),
      round: this.round,
      playerComponents: [...this.goblin.comps.keys()],
      events: this.events_.slice(-12),
    };
    const res = await requestDirector(summary);
    this.directorInFlight = false;
    this.nextDirector = Phaser.Math.Between(12, 16);
    if (this.over || !this.scene.isActive()) return;
    const parsed = DirectorDecisionSchema.safeParse(res.decision);
    if (!parsed.success) return;
    this.say(parsed.data.commentary, res.source, parsed.data.action);
    this.time.delayedCall(900, () => this.applyDirector(parsed.data));
  }

  private applyDirector(d: DirectorDecision) {
    if (this.over) return;
    const n = d.intensity;
    switch (d.action) {
      case "enemy_laser_barrage":
        this.spider.laserBarrage(2 + n * 2);
        break;
      case "enemy_leap_slam":
        this.spider.leapSlam();
        break;
      case "enemy_shield_up":
        this.spider.shieldUp(4 + n * 2);
        this.fx.shockwave(this.spider.x, this.spider.y, 0xff3344, 2.5);
        break;
      case "enemy_enrage":
        this.spider.enrage(6 + n * 3);
        this.arena.alarmPulse();
        this.fx.floatText(this.spider.x, this.spider.y - 90, "ENRAGED", "#ff3344", 30);
        break;
      case "arena_crane_drop":
        this.arena.craneDrop(Phaser.Math.Clamp(this.goblin.x, 80, W - 80), 1 + 0.3 * n, () => this.log("crane crate dropped"));
        break;
      case "arena_steam_vent": {
        const vx = this.arena.vents.reduce((a, b) => (Math.abs(b - this.goblin.x) < Math.abs(a - this.goblin.x) ? b : a));
        this.arena.vent(vx, 2 + n);
        break;
      }
      case "arena_crate_rain":
        for (let i = 0; i < 2 + n; i++)
          this.time.delayedCall(i * 220, () => {
            const c = this.arena.spawnCrate(Phaser.Math.Between(150, W - 150), 80, Phaser.Math.FloatBetween(0.6, 1.1));
            c.setVelocity(0, 6);
          });
        this.arena.alarmPulse();
        break;
      default:
        break;
    }
  }
}
