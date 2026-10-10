import Phaser from "phaser";
import { Q } from "./quality";

/** One-stop juice: sparks, explosions, shockwaves, debris, flashes, floating text. */
export class Fx {
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private streaks: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private glow: Phaser.GameObjects.Particles.ParticleEmitter;
  private cyanSparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private debris: Phaser.Physics.Matter.Image[] = [];
  private flashRect: Phaser.GameObjects.Rectangle;

  constructor(private scene: Phaser.Scene) {
    this.smoke = scene.add.particles(0, 0, "smoke", {
      speed: { min: 20, max: 120 },
      lifespan: { min: 700, max: 1600 },
      scale: { start: 0.6, end: 2.6 },
      alpha: { start: 0.45, end: 0 },
      tint: [0x3a3f45, 0x2a2e33, 0x55504a],
      rotate: { min: 0, max: 360 },
      gravityY: -40,
      emitting: false,
    }).setDepth(40);
    this.glow = scene.add.particles(0, 0, "glow", {
      speed: { min: 0, max: 60 },
      lifespan: { min: 200, max: 500 },
      scale: { start: 2.4, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [0xff7a1a, 0xffc83d, 0xff3344],
      blendMode: "ADD",
      emitting: false,
    }).setDepth(41);
    this.sparks = scene.add.particles(0, 0, "spark", {
      speed: { min: 150, max: 650 },
      lifespan: { min: 250, max: 900 },
      scale: { start: 0.9, end: 0 },
      gravityY: 900,
      tint: [0xffffff, 0xffc83d, 0xff7a1a, 0xff9a3c],
      blendMode: "ADD",
      emitting: false,
    }).setDepth(42);
    this.streaks = scene.add.particles(0, 0, "streak", {
      speed: { min: 300, max: 900 },
      lifespan: { min: 150, max: 450 },
      scaleX: { start: 2.2, end: 0.2 },
      scaleY: { start: 1, end: 0.3 },
      rotate: 0,
      gravityY: 600,
      tint: [0xffc83d, 0xff7a1a],
      blendMode: "ADD",
      emitting: false,
    }).setDepth(42);
    this.cyanSparks = scene.add.particles(0, 0, "spark", {
      speed: { min: 100, max: 500 },
      lifespan: { min: 300, max: 900 },
      scale: { start: 1, end: 0 },
      gravityY: 300,
      tint: [0xffffff, 0x26f0ff, 0x7af8ff],
      blendMode: "ADD",
      emitting: false,
    }).setDepth(42);
    this.flashRect = scene.add
      .rectangle(0, 0, 4000, 4000, 0xffffff, 0)
      .setScrollFactor(0)
      .setDepth(1000)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  private n(v: number) {
    return Math.max(1, Math.round(v * Q.k));
  }

  burst(x: number, y: number, n = 20, cyan = false) {
    (cyan ? this.cyanSparks : this.sparks).explode(this.n(n), x, y);
  }

  notes(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const im = this.scene.add.image(x, y, "note").setTint(i % 2 ? 0xff4fd8 : 0xffc83d).setDepth(46).setScale(1.2);
      this.scene.tweens.add({ targets: im, x: x + Math.cos(a) * 220, y: y + Math.sin(a) * 160 - 40, angle: Phaser.Math.Between(-60, 60), alpha: 0, duration: 800, ease: "Cubic.easeOut", onComplete: () => im.destroy() });
    }
  }

  smokePuff(x: number, y: number, n = 6) {
    this.smoke.explode(this.n(n), x, y);
  }

  shockwave(x: number, y: number, color = 0xffc83d, scale = 3, duration = 450) {
    const r = this.scene.add.image(x, y, "ring").setTint(color).setBlendMode(Phaser.BlendModes.ADD).setDepth(43).setScale(0.1);
    this.scene.tweens.add({ targets: r, scale, alpha: 0, duration, ease: "Cubic.easeOut", onComplete: () => r.destroy() });
  }

  flash(alpha = 0.6, duration = 160, color = 0xffffff) {
    this.flashRect.setFillStyle(color, alpha).setVisible(true);
    this.scene.tweens.killTweensOf(this.flashRect);
    // full-screen additive quad: hidden when idle so it costs no fill-rate
    this.scene.tweens.add({ targets: this.flashRect, fillAlpha: 0, duration, onComplete: () => this.flashRect.setVisible(false) });
  }

  shake(duration = 250, intensity = 0.01) {
    this.scene.cameras.main.shake(duration, intensity);
  }

  floatText(x: number, y: number, text: string, color = "#ffc83d", size = 28) {
    const t = this.scene.add
      .text(x, y, text, { fontFamily: "Orbitron, monospace", fontSize: `${size}px`, fontStyle: "900", color, stroke: "#000", strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(1001);
    this.scene.tweens.add({ targets: t, y: y - 60, scale: { from: 1.5, to: 1 }, duration: 1000, ease: "Cubic.easeOut" });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 550, duration: 450, onComplete: () => t.destroy() });
  }

  /** Big set-piece explosion. power ~1..3 */
  explosion(x: number, y: number, power = 1) {
    const ball = this.scene.add.image(x, y, "glow").setTint(0xffb040).setBlendMode(Phaser.BlendModes.ADD).setDepth(44).setScale(0.5);
    this.scene.tweens.add({ targets: ball, scale: 3 + 2.5 * power, alpha: 0, duration: 420 + 120 * power, ease: "Expo.easeOut", onComplete: () => ball.destroy() });
    this.glow.explode(this.n(6 * power), x, y);
    this.sparks.explode(this.n(40 * power), x, y);
    this.streaks.explode(this.n(24 * power), x, y);
    this.smoke.explode(this.n(8 * power), x, y);
    this.shockwave(x, y, 0xffc83d, 2 + power * 1.5);
    if (power > 1.5) this.shockwave(x, y, 0xff3344, 1 + power, 700);
    this.flash(Math.min(0.4, 0.14 * power), 180, 0xffd8a0); // capped so big hits never white-out the fighters
    this.shake(250 + 120 * power, 0.006 * power);
    this.spawnDebris(x, y, this.n(6 * power));
  }

  spawnDebris(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      const d = this.scene.matter.add.image(x + Phaser.Math.Between(-20, 20), y - 10, "debris", undefined, {
        frictionAir: 0.01,
        restitution: 0.3,
        collisionFilter: { group: -9, category: 0x0008, mask: 0x0001 },
      });
      d.setScale(Phaser.Math.FloatBetween(0.6, 1.8)).setDepth(39).setTint(Phaser.Utils.Array.GetRandom([0x8a9096, 0x6b5a4a, 0xa0a8b0]));
      d.setVelocity(Phaser.Math.FloatBetween(-12, 12), Phaser.Math.FloatBetween(-16, -6));
      d.setAngularVelocity(Phaser.Math.FloatBetween(-0.4, 0.4));
      this.debris.push(d);
      this.scene.tweens.add({ targets: d, alpha: 0, delay: 2200, duration: 800, onComplete: () => this.destroyDebris(d) });
    }
    while (this.debris.length > (Q.low ? 14 : 36)) this.destroyDebris(this.debris[0]);
  }

  private destroyDebris(d: Phaser.Physics.Matter.Image) {
    const i = this.debris.indexOf(d);
    if (i >= 0) this.debris.splice(i, 1);
    if (d.active) d.destroy();
  }
}
