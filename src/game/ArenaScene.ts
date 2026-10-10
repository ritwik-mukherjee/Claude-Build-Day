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
import { buildCharacterTextures, charById, type CharacterId } from "./characters";
import { Q } from "./quality";
import { challengeById } from "./challenges";
import { Abilities } from "./abilities";
import { abilitiesOf } from "./characters";
import { MB } from "./util";
import { state as menuState } from "../menu";

export type Mode = "menu" | "arena" | "lab";
export interface RoundCfg {
  mode: Mode;
  char: CharacterId;
  challenge?: string;
  carry?: boolean; // keep the current build when switching lab <-> arena
  ops?: Operation[];
}

type Body = MatterJS.BodyType;

const LABEL: Record<ComponentType, string> = {
  rocket_booster: "ROCKET BOOSTERS",
  chain_weapon: "CHAIN HAMMER",
  shield: "ENERGY SHIELD",
  spring_legs: "SPRING LEGS",
  armor_plating: "ARMOR PLATING",
  boxing_glove: "SPRING BOXING GLOVE",
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
  mutations = 0;
  summaries: string[] = [];
  gen = 0; // bumps on every (re)start so stale async responses are ignored
  cfg: RoundCfg = { mode: "menu", char: "goblin" };
  acc = 0; // fixed-step accumulator (seconds)
  bombs: { img: Phaser.Physics.Matter.Image; fuse: number }[] = [];
  dome?: Phaser.GameObjects.Image;
  poundT = -1;
  domeHitCd = 0;
  shadows: Phaser.GameObjects.Image[] = [];
  backlights: Phaser.GameObjects.Image[] = [];
  wasThrusting = false;
  ab!: Abilities;
  lastAb = "";
  lastFuel = -2;
  lastCd = -1;
  hintCd = 0;

  constructor() {
    super("arena");
  }

  applied: Operation[] = []; // successfully dispatched ops this round (for carrying builds)

  init(data: Partial<RoundCfg>) {
    if (data && data.mode) this.cfg = { mode: data.mode, char: data.char ?? "goblin", challenge: data.challenge, ops: data.ops };
  }

  create() {
    // Phaser reuses this instance on scene.restart(): reset all per-round state.
    Object.assign(this, {
      lasers: [], events_: [], round: 0, elapsed: 0, busy: false, cinematic: false, over: false,
      nextDirector: 9, directorInFlight: false, hitStop: 0, baseTimeScale: 1, lastImpact: 0, mutations: 0,
      acc: 0, bombs: [], poundT: -1, domeHitCd: 0, applied: [], summaries: [], wasThrusting: false, lastFuel: -2, lastCd: -1, hintCd: 0, lastAb: "",
    });
    this.gen++;
    if (!this.textures.exists("px")) buildTextures(this);
    buildCharacterTextures(this);
    this.matter.world.setGravity(0, 1.25);
    // We step physics ourselves at a fixed 60 Hz (see update) so low frame rates don't slow the game down.
    this.matter.world.autoUpdate = false;
    this.applyQuality();
    this.cameras.main.setBounds(0, 0, W, H);

    this.fx = new Fx(this);
    this.arena = new Arena(this, this.fx);
    const def = charById(this.cfg.char);
    this.goblin = new Goblin(this, 360, FLOOR_Y - 120, this.arena, this.fx, def);
    this.spider = new Spider(this, 1250, FLOOR_Y - 100, this.arena, this.fx, (l) => this.lasers.push(l), (x, y, p) => this.spiderSlam(x, y, p));
    this.blueprint = this.add.graphics().setDepth(50);
    this.ab = new Abilities(this);
    if (this.cfg.mode === "arena") {
      const ch = challengeById(this.cfg.challenge);
      if (ch.playerHpMul) this.goblin.hp = this.goblin.maxHp = Math.round(this.goblin.maxHp * ch.playerHpMul);
      if (ch.dealMul) this.spider.vuln = ch.dealMul;
      if (ch.spiderHp) this.spider.hp = this.spider.maxHp = ch.spiderHp;
      if (ch.enraged) this.spider.enrage(99999);
    }

    const kb = this.input.keyboard!;
    // enableCapture=false so typing in the DOM console still works.
    this.keys = kb.addKeys("W,A,S,D,SPACE,SHIFT,UP,LEFT,RIGHT,Q,R,E,F,ONE,TWO,THREE", false) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.cinematic || this.over || this.cfg.mode === "menu") return;
      if (p.rightButtonDown()) this.trySlam();
      else {
        this.goblin.punch(p.worldX, p.worldY);
        const h = this.goblin.socketPos("right_hand");
        this.fx.burst(h.x, h.y, 6);
        this.ab.onPunch(h.x, h.y);
      }
    });

    // Shared action handlers (LLM plans and /commands both land here).
    registerHandler("attach", (op) => this.goblin.attach(op));
    registerHandler("modify", (op) => this.goblin.modify(op));
    registerHandler("remove", (op) => this.goblin.remove(op.component));

    this.matter.world.on("collisionstart", (ev: Phaser.Physics.Matter.Events.CollisionStartEvent) => this.onCollide(ev));

    // Remove only *this scene's* listeners on shutdown (the HUD listens to "restart" too).
    const onSubmit = (text: string) => this.submitPrompt(text);
    const onFocus = (f: boolean) => {
      // drop held keys so a key released while typing doesn't leave the fighter walking forever
      this.input.keyboard!.resetKeys();
      this.input.keyboard!.enabled = !f;
    };
    const onRestart = () => this.scene.restart({ ...this.cfg });
    const onStart = (cfg: RoundCfg) =>
      this.scene.restart({ ...cfg, ops: cfg.carry && cfg.char === this.cfg.char ? [...this.applied] : undefined });
    const onSpecial = (slot?: number) => this.useSpecial(slot ?? 0);
    const onQuality = () => this.applyQuality();
    const onPersonality = () => (this.nextDirector = Math.min(this.nextDirector, 2.5));
    bus.on("submit-prompt", onSubmit);
    bus.on("console-focus", onFocus);
    bus.on("restart", onRestart);
    bus.on("start", onStart);
    bus.on("special", onSpecial);
    bus.on("quality", onQuality);
    bus.on("personality", onPersonality);
    this.events.once("shutdown", () => {
      bus.off("submit-prompt", onSubmit);
      bus.off("console-focus", onFocus);
      bus.off("restart", onRestart);
      bus.off("start", onStart);
      bus.off("special", onSpecial);
      bus.off("quality", onQuality);
      bus.off("personality", onPersonality);
      this.lasers = [];
      this.ab.reset();
    });
    if (this.cfg.mode === "menu") {
      for (const p of this.goblin.parts) p.setVisible(false);
      this.spider.body.setVisible(false);
      this.spider.gfx.setVisible(false);
    }
    // 2.5D depth cues: contact shadows + colored backlights (cheap sprites updated per frame)
    this.shadows = [0, 1].map(() => this.add.image(0, 0, "shadow").setDepth(12));
    this.backlights = [
      this.add.image(0, 0, "glow").setDepth(17).setTint(Phaser.Display.Color.HexStringToColor(def.accent).color).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.22),
      this.add.image(0, 0, "glow").setDepth(23).setTint(0xff3344).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.18),
    ];
    if (this.cfg.mode === "menu") [...this.shadows, ...this.backlights].forEach((o) => o.setVisible(false));
    this.dome = this.add.image(0, 0, "dome").setDepth(26).setTint(0x26f0ff).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    bus.emit(EV.HP, { player: 1, enemy: 1 });
    bus.emit(EV.LOADOUT, []);
    bus.emit("round", { ...this.cfg, def });
    if (this.cfg.ops?.length && this.cfg.mode !== "menu") {
      // imported build: same handlers, no cinematic
      for (const o of this.cfg.ops) {
        void dispatch(o);
        this.applied.push(o);
      }
      this.time.delayedCall(50, () => {
        this.fx.floatText(this.goblin.x, this.goblin.y - 110, "BUILD IMPORTED", "#26f0ff", 22);
        this.emitLoadout();
      });
    }
    if (this.cfg.mode === "arena") this.say(`${def.name} vs. ARACHNOTRON. ${def.quote} Type a mutation to begin.`, "system");
    else if (this.cfg.mode === "lab") this.say(`Character Lab: ${def.name}. The spider is a training dummy. Invent something stupid.`, "system");
  }

  emitLoadout() {
    bus.emit(EV.LOADOUT, [...this.goblin.comps.keys()]);
    bus.emit("loadout-detail", this.goblin.list());
  }

  applyQuality() {
    const e = this.matter.world.engine;
    e.positionIterations = Q.low ? 6 : 10;
    e.velocityIterations = Q.low ? 4 : 8;
    e.constraintIterations = Q.low ? 2 : 4;
  }

  // ---------------------------------------------------------------------
  update(_t: number, deltaMs: number) {
    const time = this.time.now;
    const dt = Math.min(deltaMs, 100) / 1000; // real seconds
    Q.sample(deltaMs);
    this.arena.update(time, dt);
    if (this.cfg.mode === "menu") return; // select screen: animated backdrop only, no simulation

    // hit-stop / slow-mo
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.matter.world.engine.timing.timeScale = 0.08;
    } else this.matter.world.engine.timing.timeScale = this.baseTimeScale;
    const ts = this.matter.world.engine.timing.timeScale;

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
    if (Phaser.Input.Keyboard.JustDown(k.F) || Phaser.Input.Keyboard.JustDown(k.E) || Phaser.Input.Keyboard.JustDown(k.ONE)) this.useSpecial(0);
    if (Phaser.Input.Keyboard.JustDown(k.TWO)) this.useSpecial(1);
    if (Phaser.Input.Keyboard.JustDown(k.THREE)) this.useSpecial(2);
    const abInp = { up: inp.jump || inp.thrust, aimX: inp.aimX, aimY: inp.aimY };
    if (Phaser.Input.Keyboard.JustDown(k.R) && this.over) bus.emit("restart");

    // Fixed 60 Hz simulation with catch-up: game speed stays correct at 30-45 fps on integrated GPUs.
    const STEP = 1 / 60;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this.acc -= STEP;
      steps++;
      this.goblin.update(STEP, inp, time);
      this.spider.update(STEP * ts, time, this.goblin.x, this.goblin.y, this.cfg.mode === "lab");
      this.updateSpecials(STEP);
      this.ab.step(STEP, abInp);
      this.updateLasers(ts);
      this.updateVent();
      if (!this.spider.dead && !this.cinematic) this.checkContactDamage();
      this.matter.world.step(STEP * 1000);
    }
    if (steps === 4) this.acc = 0; // drop backlog instead of spiralling
    this.goblin.render(time);
    this.spider.render(time);
    this.renderDepth();
    this.ab.render(time);
    if (this.goblin.thrusting && Math.random() < 0.02) this.log("player rocket-boosting");

    const fuel = this.goblin.comps.has("rocket_booster") ? Math.round(this.goblin.fuel * 100) / 100 : -1;
    if (fuel !== this.lastFuel) bus.emit(EV.FUEL, (this.lastFuel = fuel));
    const abl = abilitiesOf(this.goblin.def);
    const st = abl.map((a, i) => Math.ceil((this.goblin.cds[i] / a.cooldown) * 40) / 40);
    const active = [this.ab.axe ? 1 : 0, this.ab.rageT > 0 ? 1 : 0, Math.ceil(this.ab.copterLeft * 40) / 40];
    const key = st.join(",") + "|" + active.join(",");
    if (key !== this.lastAb) {
      this.lastAb = key;
      bus.emit("ability-cd", { cds: st, axeOut: !!this.ab.axe, rage: this.ab.rageT > 0, copter: this.ab.copterLeft });
    }

    // fell off-world safety
    if (this.goblin.y > H + 200) this.respawnGoblin();
    if (this.spider.y > H + 200) this.spider.body.setPosition(W - 200, 300);

    // director
    if (!this.over && !this.cinematic) {
      this.nextDirector -= dt;
      if (this.nextDirector <= 0 && !this.directorInFlight) this.callDirector();
    }
    if (this.cfg.mode === "lab") this.labTick();
    else this.checkGameOver();
  }

  private renderDepth() {
    const g = this.goblin,
      sp = this.spider;
    const fighters: [number, number, number][] = [
      [g.x, g.y, g.def.dims.torso[0] * 1.6],
      [sp.x, sp.y, 150],
    ];
    fighters.forEach(([x, y, w], i) => {
      const gy = this.arena.groundY(x, y);
      const h = Math.max(0, gy - y);
      const k = Phaser.Math.Clamp(1 - (h - 60) / 400, 0.25, 1);
      const vis = !(i === 1 && sp.dead) && gy < H + 50;
      this.shadows[i].setVisible(vis).setPosition(x, gy - 1).setDisplaySize(w * 1.2 * k, 20 * k).setAlpha(k);
      this.backlights[i].setVisible(vis).setPosition(x, y - (i === 0 ? 10 : 0)).setScale(i === 0 ? 2.6 : 3.6);
    });
    this.arena.parallax(g.x, g.y);
    // launch punch: dust ring + tiny zoom kick on the rising edge of rocket thrust
    if (g.thrusting && !this.wasThrusting && !this.cinematic) {
      const gy = this.arena.groundY(g.x, g.y);
      if (gy - g.y < g.stand + 40) {
        this.fx.smokePuff(g.x, gy, 6);
        this.fx.shockwave(g.x, gy, 0xff9a3c, 1.6, 380);
      }
      const cam = this.cameras.main;
      if (cam.zoom === 1) {
        cam.setZoom(1.025);
        this.tweens.add({ targets: cam, zoom: 1, duration: 300, ease: "Cubic.easeOut" });
      }
    }
    this.wasThrusting = g.thrusting;
  }

  // ---------------------------------------------------------------------
  // Character specials (F / E / HUD button)
  // ---------------------------------------------------------------------
  useSpecial(slot = 0) {
    const g = this.goblin;
    if (this.cfg.mode === "menu" || this.cinematic || this.over || g.hp <= 0 || this.ab.busy) return;
    const sp = abilitiesOf(g.def)[slot];
    if (!sp) return;
    if (g.cds[slot] > 0 || g.stun > 0) {
      bus.emit("special-denied", slot);
      if (g.cds[slot] > 0) this.hint(`${sp.name} RECHARGING`);
      return;
    }
    const aim = this.input.activePointer;
    if (!["scrap_bomb", "sonic_wave", "dome", "ground_pound"].includes(sp.id)) {
      // imported-character abilities: cooldown is only charged if the ability really started
      const ok = this.ab.use(sp.id, { up: false, aimX: aim.worldX || this.spider.x, aimY: aim.worldY || this.spider.y });
      if (!ok) {
        bus.emit("special-denied", slot);
        return;
      }
      g.cds[slot] = sp.cooldown;
      return;
    }
    g.cds[slot] = sp.cooldown;
    this.log(`player used special ${sp.name}`);
    switch (sp.id) {
      case "scrap_bomb": {
        const hand = g.socketPos("right_hand");
        const b = this.matter.add.image(hand.x, hand.y - 10, "bomb", undefined, {
          shape: { type: "circle", radius: 10 },
          density: 0.004,
          restitution: 0.4,
          label: "bomb",
          collisionFilter: { group: -1 },
        });
        b.setDepth(27);
        const a = Math.atan2((aim.worldY || this.spider.y) - hand.y, (aim.worldX || this.spider.x) - hand.x);
        b.setVelocity(Math.cos(a) * 14, Math.sin(a) * 14 - 6);
        b.setAngularVelocity(0.3);
        this.bombs.push({ img: b, fuse: 1.6 });
        this.fx.floatText(hand.x, hand.y - 40, "FIRE IN THE HOLE", "#ffc83d", 16);
        break;
      }
      case "sonic_wave": {
        const c = new Phaser.Math.Vector2(g.head.x, g.head.y);
        for (let i = 0; i < 3; i++)
          this.time.delayedCall(i * 110, () => this.fx.shockwave(c.x, c.y, 0xff4fd8, 5.2 - i * 0.6, 520));
        this.fx.notes(c.x, c.y, Q.low ? 8 : 16);
        this.fx.flash(0.15, 160, 0xff9ff0);
        this.fx.shake(220, 0.006);
        this.fx.floatText(c.x, c.y - 60, "♪ HIGH NOTE ♪", "#ff4fd8", 26);
        const R = 330;
        if (!this.spider.dead && Phaser.Math.Distance.Between(c.x, c.y, this.spider.x, this.spider.y) < R) {
          const d = this.spider.damage(12, c.x, 16);
          this.fx.floatText(this.spider.x, this.spider.y - 70, `-${Math.round(d)}`, "#ff4fd8", 26);
          this.log(`sonic shockwave hit spider for ${Math.round(d)}`);
        }
        for (const l of [...this.lasers])
          if (l.dmg > 0 && Phaser.Math.Distance.Between(c.x, c.y, l.img.x, l.img.y) < R) {
            this.fx.burst(l.img.x, l.img.y, 10, true);
            l.life = 0;
          }
        this.arena.shove(c.x, c.y, R, 10, this.arena.crates.map((cr) => cr.body as MatterJS.BodyType));
        this.emitHp();
        break;
      }
      case "dome": {
        g.domeT = 3.2;
        this.fx.shockwave(g.x, g.y, 0x26f0ff, 2.4, 400);
        this.fx.burst(g.x, g.y, 30, true);
        this.fx.floatText(g.x, g.y - 90, "DOME DEPLOYED", "#26f0ff", 22);
        break;
      }
      case "ground_pound": {
        this.poundT = 0;
        for (const p of g.parts) MB.setVelocity(p.body as MatterJS.BodyType, { x: (p.body as MatterJS.BodyType).velocity.x, y: -15 });
        this.fx.smokePuff(g.x, g.y + g.stand, 6);
        this.fx.floatText(g.x, g.y - 100, "GROUND POUND", "#ffc83d", 24);
        break;
      }
    }
  }

  private updateSpecials(STEP: number) {
    const g = this.goblin;
    // bombs
    for (const b of [...this.bombs]) {
      b.fuse -= STEP;
      const nearSpider = !this.spider.dead && Phaser.Math.Distance.Between(b.img.x, b.img.y, this.spider.x, this.spider.y) < 60;
      if (b.fuse <= 0 || nearSpider || b.img.y > H) {
        const { x, y } = b.img;
        b.img.destroy();
        this.bombs.splice(this.bombs.indexOf(b), 1);
        this.fx.explosion(x, y, 1.4);
        this.hitStop = 0.06;
        if (!this.spider.dead && Phaser.Math.Distance.Between(x, y, this.spider.x, this.spider.y) < 140) {
          const d = this.spider.damage(16, x, 12);
          this.fx.floatText(this.spider.x, this.spider.y - 70, `-${Math.round(d)}`, "#ffc83d", 28);
          this.log(`scrap bomb hit spider for ${Math.round(d)}`);
          this.emitHp();
        }
        this.arena.crack(x, y, 0.8);
      }
    }
    // dome
    if (this.dome) {
      const on = g.domeT > 0;
      this.dome.setVisible(on);
      if (on) {
        this.dome.setPosition(g.x, g.y + 10).setScale(1.5 + Math.sin(this.time.now * 0.02) * 0.03).setAlpha(g.domeT < 0.6 ? (Math.floor(g.domeT * 20) % 2 ? 0.2 : 0.8) : 0.8);
        this.domeHitCd -= STEP;
        const d = Phaser.Math.Distance.Between(g.x, g.y, this.spider.x, this.spider.y);
        if (d < 150 && this.domeHitCd <= 0 && !this.spider.dead) {
          this.domeHitCd = 0.5;
          const dmg = this.spider.damage(6, g.x, 14);
          this.fx.burst((g.x + this.spider.x) / 2, (g.y + this.spider.y) / 2, 20, true);
          if (dmg) this.fx.floatText(this.spider.x, this.spider.y - 70, `-${Math.round(dmg)}`, "#26f0ff", 22);
          this.emitHp();
        }
      }
    }
    // ground pound
    if (this.poundT >= 0) {
      this.poundT += STEP;
      if (this.poundT > 0.32 && this.poundT < 0.36)
        for (const p of g.parts) MB.setVelocity(p.body as MatterJS.BodyType, { x: (p.body as MatterJS.BodyType).velocity.x * 0.3, y: 26 });
      if (this.poundT > 0.38 && g.grounded) {
        this.poundT = -1;
        const gy = this.arena.groundY(g.x, g.y);
        this.impact(g.x, gy, 2.6, true);
      } else if (this.poundT > 2) this.poundT = -1;
    }
  }

  private labTick() {
    // training dummy regenerates; never dies
    if (this.spider.hp < this.spider.maxHp * 0.25) {
      this.spider.hp = this.spider.maxHp;
      this.fx.floatText(this.spider.x, this.spider.y - 90, "DUMMY REBOOTED", "#5dff7a", 20);
      this.emitHp();
    }
    if (this.goblin.hp < this.goblin.maxHp * 0.3) {
      this.goblin.hp = this.goblin.maxHp;
      this.emitHp();
    }
  }

  // ---------------------------------------------------------------------
  // Prompt -> mutation (signature moment #1)
  // ---------------------------------------------------------------------
  async submitPrompt(text: string) {
    text = text.trim();
    if (!text || this.busy || this.over) return;
    if (this.cfg.mode === "arena" && challengeById(this.cfg.challenge).noMutations) {
      bus.emit(EV.MUTATION_ERROR, { error: "FACTORY SETTINGS challenge: mutations are disabled. Use your special (F)!" });
      return;
    }
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
        const gen = this.gen;
        const res = await requestMutation(text, [...this.goblin.comps.keys()]);
        if (gen !== this.gen) return;
        const v = validatePlan(res.plan); // never trust the wire
        if (!v.plan) throw new Error(`invalid plan: ${v.error}`);
        plan = v.plan;
        source = res.source;
        note = res.note;
      }
      bus.emit(EV.MUTATION_PLAN, { plan, source, note, prompt: text });
      this.goblin.scanRing?.setVisible(false);
      await this.playTransformation(plan, source);
      this.mutations++;
      this.summaries.push(plan.summary);
      bus.emit(EV.MUTATION_DONE, { plan, source });
      this.emitLoadout();
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

  /** Apply every op through the shared executor; returns real per-op results. */
  private async applyPlan(plan: MutationPlan) {
    const results: { op: Operation; ok: boolean }[] = [];
    for (const op of plan.operations) {
      const r = await dispatch(op);
      if (r.ok) {
        if (op.op === "remove") this.applied = this.applied.filter((a) => a.component !== op.component);
        else this.applied.push(op);
      }
      results.push({ op, ok: r.ok });
    }
    return results;
  }

  private async playTransformation(plan: MutationPlan, source = "fallback") {
    // Preferred path: Three.js Mutation Chamber (lazy-loaded). Falls back to the 2D cinematic
    // if disabled, in reduced-effects mode, or if WebGL/three fails before the plan is applied.
    if (Q.useChamber) {
      let applied: { op: Operation; ok: boolean }[] | null = null;
      this.cinematic = true;
      try {
        const { runChamber } = await import("../chamber/Chamber");
        await runChamber(plan, {
          source,
          low: Q.low,
          sleepGame: () => this.game.loop.sleep(),
          wakeGame: () => this.game.loop.wake(),
          apply: async () => (applied = await this.applyPlan(plan)),
        });
      } catch (e) {
        console.warn("[chamber] unavailable, using 2D cinematic:", e);
        this.game.loop.wake();
      }
      this.cinematic = false;
      if (applied) {
        this.arrivalBeat(applied);
        return;
      }
    }
    await this.playTransformation2D(plan);
  }

  /** Short in-arena payoff after the 3D chamber: sparks at each mounted socket, ignition, show-off. */
  private arrivalBeat(results: { op: Operation; ok: boolean }[]) {
    const g = this.goblin;
    this.fx.flash(0.35, 260, 0xbffcff);
    for (const { op, ok } of results) {
      const p = g.socketPos(op.socket);
      if (!ok) {
        this.fx.floatText(p.x, p.y - 40, "FABRICATION FAULT", "#ff3344", 16);
        continue;
      }
      if (op.op === "remove") continue;
      this.fx.burst(p.x, p.y, 30, true);
      this.fx.shockwave(p.x, p.y, 0x26f0ff, 1.6, 400);
      if (op.component === "rocket_booster") {
        this.fx.explosion(p.x, p.y + 30, 1.1);
        g.autoThrust = 1.3;
      } else if (op.component === "boxing_glove") {
        const gl = g.comps.get("boxing_glove")?.head;
        if (gl) g.punch(gl.x + g.facing * 200, gl.y - 20);
      }
    }
    this.fx.floatText(g.x, g.y - 110, results.some((r) => r.ok) ? "MUTATION ONLINE" : "MUTATION FAILED", results.some((r) => r.ok) ? "#26f0ff" : "#ff3344", 24);
  }

  private async playTransformation2D(plan: MutationPlan) {
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
        (o) =>
          `${o.op.toUpperCase()} ${o.component === "rocket_booster" && o.count > 1 ? `${o.count}× ` : ""}${LABEL[o.component]} @ ${o.socket.toUpperCase()} :: size ${o.size.toFixed(1)} | power ${o.power.toFixed(1)} | mass ${o.mass.toFixed(1)} | length ${o.length.toFixed(1)}${o.rocket > 0 ? ` | rocket ${o.rocket.toFixed(1)}` : ""} | ${o.color}`,
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
    if (added.includes("rocket_booster")) g.autoThrust = 1.3;
  }

  private async assemble(op: Operation) {
    const g = this.goblin;
    const target = g.socketPos(op.socket);
    const label = LABEL[op.component];
    if (op.op === "remove") {
      this.fx.floatText(target.x, target.y - 40, `${label} EJECTED`, "#ff3344", 16);
      await dispatch(op);
      this.applied = this.applied.filter((a) => a.component !== op.component);
      this.fx.burst(target.x, target.y, 30);
      this.fx.shake(150, 0.004);
      await this.wait(500);
      return;
    }
    const key = { rocket_booster: "c_booster", chain_weapon: "c_hammer", shield: "c_shield", spring_legs: "c_spring", armor_plating: "c_armor", boxing_glove: "c_glove" }[op.component];
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
    this.applied.push(op);
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
      this.fx.floatText(n.x, n.y - 50, op.count > 2 ? `${op.count}× IGNITION` : "IGNITION", "#ff7a1a", 30);
      g.autoThrust = 0.25;
    } else if (op.component === "chain_weapon") {
      const h = g.comps.get("chain_weapon")?.head;
      if (h) {
        this.fx.burst(h.x, h.y, 50);
        this.fx.floatText(h.x, h.y - 40, op.rocket > 0 ? "ROCKET-POWERED. WHY." : `${(op.mass * 450).toFixed(0)} KG OF BAD IDEA`, "#ffc83d", 18);
      }
    } else if (op.component === "boxing_glove") {
      const gl = g.comps.get("boxing_glove")?.head;
      if (gl) {
        this.fx.burst(gl.x, gl.y, 30);
        this.fx.floatText(gl.x, gl.y - 40, op.rocket > 0 ? "ROCKET HAYMAKER ARMED" : "SPRING LOADED", "#ff3344", 20);
        g.punch(gl.x + g.facing * 200, gl.y - 20); // show it off
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
  /** short, throttled hint above the fighter when an input can't do anything yet */
  hint(text: string) {
    if (this.time.now < this.hintCd) return;
    this.hintCd = this.time.now + 1500;
    this.fx.floatText(this.goblin.x, this.goblin.y - 100, text, "#9ffcff", 15);
  }

  trySlam() {
    if (this.cinematic || this.over || this.cfg.mode === "menu") return;
    if (!this.goblin.comps.has("chain_weapon")) {
      this.hint("NO HAMMER — try “massive chain hammer”");
      return;
    }
    if (this.goblin.slam()) {
      this.fx.floatText(this.goblin.x, this.goblin.y - 90, "HAMMER SLAM!", "#ffc83d", 22);
      this.log("player hammer slam");
    }
  }

  private onCollide(ev: Phaser.Physics.Matter.Events.CollisionStartEvent) {
    const chain = this.goblin.comps.get("chain_weapon");
    const head = chain?.head?.body as Body | undefined;
    const gloveC = this.goblin.comps.get("boxing_glove");
    const glove = gloveC?.head?.body as Body | undefined;
    for (const pair of ev.pairs) {
      const a = pair.bodyA.parent ?? pair.bodyA,
        b = pair.bodyB.parent ?? pair.bodyB;
      if (this.ab.onPair(a, b)) continue; // imported-character projectiles (axe, air cannon)
      // spring boxing glove
      if (glove && (a === glove || b === glove)) {
        const other = a === glove ? b : a;
        const sp = this.goblin.weaponSpeed("boxing_glove");
        if (other === this.spider.b && sp > 6) {
          const p = gloveC!.params;
          const dmg = Math.min(30, sp * 0.45 * (0.7 + 0.3 * p.power) * Math.sqrt(p.size) + 4 * p.rocket);
          const d = this.spider.damage(dmg, this.goblin.x, Math.min(22, sp * 0.8));
          this.fx.floatText(this.spider.x, this.spider.y - 70, `-${Math.round(d)}`, "#ff3344", 32);
          this.fx.floatText(glove.position.x, glove.position.y - 30, sp > 22 ? "K.O. PUNCH!" : "BOING!", "#ffc83d", sp > 22 ? 26 : 20);
          this.impact(glove.position.x, glove.position.y, Math.min(2.4, 0.6 + sp / 20), false);
          this.log(`boxing glove hit spider for ${Math.round(d)}`);
        } else if (other.label === "crate" && sp > 6) {
          this.fx.burst(glove.position.x, glove.position.y, 16);
          this.matter.body.setVelocity(other, { x: glove.velocity.x, y: glove.velocity.y - 6 });
        }
      }
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

  emitHp() {
    bus.emit(EV.HP, { player: this.goblin.hp / this.goblin.maxHp, enemy: this.spider.hp / this.spider.maxHp });
  }

  private respawnGoblin() {
    for (const p of this.goblin.parts) {
      p.setPosition(400, 300);
      p.setVelocity(0, 0);
    }
  }

  private gameOverPayload(winner: "player" | "enemy", reason?: string) {
    const ch = challengeById(this.cfg.challenge);
    return {
      winner,
      reason,
      time: this.elapsed,
      mutations: this.mutations,
      hp: winner === "player" ? (this.goblin.hp / this.goblin.maxHp) * 100 : 0,
      char: this.goblin.def.id,
      challenge: ch.name,
      cleared: winner === "player",
      build: this.goblin.list(),
      summaries: this.summaries.slice(-4),
    };
  }

  private checkGameOver() {
    if (this.over) return;
    const ch = challengeById(this.cfg.challenge);
    if (ch.timeLimit) {
      const left = Math.max(0, ch.timeLimit - this.elapsed);
      bus.emit("clock", left);
      if (left <= 0 && !this.spider.dead) {
        this.over = true;
        this.say("TIME. The spider clocks out undefeated.", "system");
        this.time.delayedCall(600, () => bus.emit(EV.GAME_OVER, this.gameOverPayload("enemy", "TIME UP")));
        return;
      }
    }
    if (this.spider.dead) {
      this.over = true;
      const sx = this.spider.x,
        sy = this.spider.y;
      for (let i = 0; i < 6; i++) this.time.delayedCall(i * 180, () => this.fx.explosion(sx + Phaser.Math.Between(-60, 60), sy + Phaser.Math.Between(-40, 40), 1.5 + i * 0.2));
      this.time.delayedCall(1200, () => {
        this.spider.body.setVisible(false);
        this.spider.gfx.setVisible(false);
        this.fx.explosion(sx, sy, 3);
        bus.emit(EV.GAME_OVER, this.gameOverPayload("player"));
      });
      this.say("ARACHNOTRON DECOMMISSIONED. The crowd is… mildly impressed.", "system");
    } else if (this.goblin.hp <= 0) {
      this.over = true;
      this.time.delayedCall(900, () => bus.emit(EV.GAME_OVER, this.gameOverPayload("enemy")));
      this.say(`${this.goblin.def.name} reduced to scrap. R to rematch.`, "system");
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
      personality: menuState.personality,
      character: this.goblin.def.name,
      mode: this.cfg.mode === "lab" ? ("lab" as const) : ("arena" as const),
    };
    const gen = this.gen;
    const res = await requestDirector(summary);
    if (gen !== this.gen) return;
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
    if (this.cfg.mode === "lab" && d.action.startsWith("enemy_")) return; // training dummy never fights back
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
