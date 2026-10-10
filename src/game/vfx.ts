// Signature ability VFX (Hulk Smash = earth: green/orange; Thunderclap = air: pale cyan/white).
// Built from the Kenney CC0 particle sprites in public/assets/vfx (procedural fallbacks if a
// sprite failed to load). Everything is bounded: fixed sprite counts per event, tweens that
// destroy their objects, and a cap on persistent decals. Called ONLY from real ability events.
import Phaser from "phaser";
import { FLOOR_Y, W } from "./Arena";
import { Q } from "./quality";

export const VFX_SPRITES = ["circle_02", "circle_05", "dirt_02", "dirt_03", "flare_01", "light_01", "light_03", "muzzle_02", "scorch_01", "scorch_02", "smoke_04", "smoke_07", "spark_04", "spark_06", "trace_02", "trace_05", "twirl_02", "flame_03", "magic_04"];

export function preloadVfx(scene: Phaser.Scene) {
  for (const f of VFX_SPRITES) if (!scene.textures.exists(`k_${f}`)) scene.load.image(`k_${f}`, `${import.meta.env.BASE_URL}assets/vfx/${f}.png`);
}

type Img = Phaser.GameObjects.Image;

export class AbilityVfx {
  private decals: Img[] = [];
  private dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private chunks: Phaser.GameObjects.Particles.ParticleEmitter;
  private airDust: Record<number, Phaser.GameObjects.Particles.ParticleEmitter> = {};

  constructor(private s: Phaser.Scene) {
    this.dust = s.add
      .particles(0, 0, this.k("smoke_07", "smoke"), {
        lifespan: { min: 700, max: 1300 },
        speedX: { min: -260, max: 260 },
        speedY: { min: -90, max: -10 },
        scale: { start: 0.25, end: 0.75 },
        alpha: { start: 0.55, end: 0 },
        tint: [0x8a7a62, 0x6b6052, 0xa89a80],
        rotate: { min: 0, max: 360 },
        emitting: false,
      })
      .setDepth(41);
    this.chunks = s.add
      .particles(0, 0, this.k("dirt_03", "debris"), {
        lifespan: { min: 600, max: 1100 },
        speed: { min: 260, max: 620 },
        angle: { min: 200, max: 340 },
        gravityY: 1400,
        scale: { start: 0.16, end: 0.08 },
        rotate: { min: 0, max: 360 },
        tint: [0x5a5048, 0x3a342e, 0x7a6a58],
        emitting: false,
      })
      .setDepth(42);
    for (const f of [-1, 1])
      this.airDust[f] = s.add
        .particles(0, 0, this.k("smoke_04", "smoke"), {
          lifespan: { min: 500, max: 900 },
          speedX: { min: f * 220, max: f * 520 },
          speedY: { min: -40, max: 0 },
          scale: { start: 0.18, end: 0.6 },
          alpha: { start: 0.4, end: 0 },
          tint: [0xdff6ff, 0xb8e8ff],
          emitting: false,
        })
        .setDepth(41);
  }

  /** Kenney sprite key, or a procedural fallback if it didn't load. */
  private k(name: string, fallback: string) {
    return this.s.textures.exists(`k_${name}`) ? `k_${name}` : fallback;
  }

  private sprite(x: number, y: number, name: string, fallback: string, tint: number, depth = 43, add = true) {
    const im = this.s.add.image(x, y, this.k(name, fallback)).setTint(tint).setDepth(depth);
    if (add) im.setBlendMode(Phaser.BlendModes.ADD);
    return im;
  }

  private fade(im: Img, props: Phaser.Types.Tweens.TweenBuilderConfig | object, duration: number, delay = 0) {
    this.s.tweens.add({ targets: im, ...props, delay, duration, ease: "Cubic.easeOut", onComplete: () => im.destroy() });
  }

  // =====================================================================
  // HULK SMASH
  // =====================================================================
  /** anticipation: dust and green energy sucked toward the crouching Hulk */
  smashWindup(x: number, footY: number) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI;
      const sx = x + Math.cos(a) * 150,
        sy = footY - Math.sin(a) * 80;
      const d = this.sprite(sx, sy, "smoke_04", "smoke", 0x9ad070, 40, false).setScale(0.2).setAlpha(0.6);
      this.fade(d, { x, y: footY - 20, scale: 0.08, alpha: 0 }, 160);
    }
    const aura = this.sprite(x, footY - 60, "light_01", "glow", 0x5dbb3a).setScale(0.9).setAlpha(0.7);
    this.fade(aura, { scale: 0.4, alpha: 0 }, 180);
  }

  /** launch: ground burst under Hulk's feet */
  smashLaunch(x: number, footY: number) {
    this.dust.explode(Q.low ? 4 : 8, x, footY);
    const r = this.sprite(x, footY, "circle_05", "ring", 0xc8f0a0).setScale(0.2, 0.06);
    this.fade(r, { scaleX: 0.9, scaleY: 0.2, alpha: 0 }, 320);
  }

  /** the slam itself (synced with ArenaScene.impact at the actual landing) */
  smashImpact(x: number, footY: number) {
    const s = this.s;
    // 1) bright but bounded impact core (never full-screen)
    const core = this.sprite(x, footY - 18, "light_03", "glow", 0xfff2c0).setScale(0.3);
    this.fade(core, { scale: 1.6, alpha: 0 }, 380);
    const flare = this.sprite(x, footY - 10, "flare_01", "glow", 0xffd070).setScale(0.4, 0.25);
    this.fade(flare, { scaleX: 2.6, scaleY: 0.5, alpha: 0 }, 420);
    // 2) radial ground shockwave: flattened rings at different speeds (earth palette)
    const rings: [number, number, number][] = [
      [0x8adf5a, 3.6, 640],
      [0xffb040, 2.7, 760],
      [0xffffff, 1.8, 420],
    ];
    rings.forEach(([tint, sc, dur], i) => {
      const r = this.s.add.image(x, footY, "ring").setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setDepth(43).setScale(0.3, 0.07);
      this.fade(r, { scaleX: sc, scaleY: sc * 0.22, alpha: 0 }, dur, i * 60);
    });
    const dome = this.sprite(x, footY, "circle_02", "ring", 0xb0ff80).setScale(0.2).setAlpha(0.8);
    this.fade(dome, { scale: 1.5, alpha: 0 }, 520);
    // 3) floor ripple: bright streaks racing along the floor in both directions
    for (const dir of [-1, 1]) {
      const st = this.sprite(x, footY - 2, "trace_02", "streak", 0xffe0a0).setScale(0.9, 0.35).setRotation(dir > 0 ? 0 : Math.PI);
      this.fade(st, { x: Phaser.Math.Clamp(x + dir * 600, 0, W), alpha: 0, scaleX: 1.6 }, 620);
    }
    // 4) dust, flying fragments, sparks
    this.dust.explode(Q.low ? 7 : 14, x, footY);
    this.chunks.explode(Q.low ? 6 : 14, x, footY - 6);
    // 5) persistent scorch/crater decal (capped)
    this.decal(x, footY);
    // 6) arena response: dust shaken off nearby platform undersides
    this.platformDust(x);
    void s; // camera response = existing impact() shake + zoom punch (scroll is bound-clamped at zoom 1)
  }

  private decal(x: number, footY: number) {
    const d = this.s.add.image(x, footY + 3, this.k("scorch_02", "crack")).setDepth(11).setTint(0x1a140e).setScale(0.9, 0.16).setAlpha(0.85);
    const glow = this.sprite(x, footY + 2, "scorch_01", "glow", 0xff6a20, 12).setScale(0.7, 0.12).setAlpha(0.8);
    this.s.tweens.add({ targets: glow, alpha: 0, duration: 1800, onComplete: () => glow.destroy() });
    this.decals.push(d);
    this.s.tweens.add({ targets: d, alpha: 0, delay: 7000, duration: 1500, onComplete: () => this.dropDecal(d) });
    while (this.decals.length > 4) this.dropDecal(this.decals[0]);
  }

  private dropDecal(d: Img) {
    const i = this.decals.indexOf(d);
    if (i >= 0) this.decals.splice(i, 1);
    if (d.active) d.destroy();
  }

  private platformDust(x: number) {
    const plats = (this.s as unknown as { arena: { plats: { x: number; y: number; w: number; h: number }[] } }).arena.plats;
    for (const p of plats.slice(1)) {
      const cx = Phaser.Math.Clamp(x, p.x + 20, p.x + p.w - 20);
      if (Math.abs(cx - x) > 600) continue;
      for (let i = 0; i < (Q.low ? 1 : 3); i++) {
        const px = Phaser.Math.Between(p.x + 20, p.x + p.w - 20);
        const d = this.sprite(px, p.y + p.h + 2, "smoke_04", "smoke", 0x9a8a72, 38, false).setScale(0.08).setAlpha(0.7);
        this.fade(d, { y: p.y + p.h + 90, scale: 0.22, alpha: 0 }, 900, i * 90);
      }
    }
  }

  // =====================================================================
  // THUNDERCLAP (air / pressure: pale cyan + white, horizontal cone)
  // =====================================================================
  /** anticipation: air drawn into the hands */
  clapWindup(cx: number, cy: number) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const st = this.sprite(cx + Math.cos(a) * 110, cy + Math.sin(a) * 80, "trace_05", "streak", 0xcff4ff).setScale(0.25, 0.12).setRotation(a + Math.PI).setAlpha(0.8);
      this.fade(st, { x: cx, y: cy, alpha: 0, scaleX: 0.08 }, 130);
    }
  }

  clapRelease(cx: number, cy: number, f: number, radius: number, halfAngle: number) {
    // sharp white core at the hands
    const core = this.sprite(cx, cy, "flare_01", "glow", 0xffffff).setScale(0.25);
    this.fade(core, { scale: 1.1, alpha: 0 }, 180);
    // pressure fronts: stretched in the facing direction, each with a faint offset
    // "refraction" double (cyan / magenta) to read as distorted air rather than fire
    for (let i = 0; i < 3; i++) {
      const delay = i * 70;
      const to = { x: cx + f * (radius * (0.45 + i * 0.18)), scaleX: 0.5 + i * 0.18, scaleY: 1.4 + i * 0.35, alpha: 0 };
      const ring = this.s.add.image(cx, cy, "ring").setTint(0xf0fdff).setBlendMode(Phaser.BlendModes.ADD).setDepth(44).setScale(0.12, 0.3);
      this.fade(ring, to, 560, delay);
      // dark inner edge (normal blend) so the front reads as refracted air even on bright backgrounds
      const edge = this.s.add.image(cx - f * 4, cy, "ring").setTint(0x08202c).setAlpha(0.45).setDepth(43).setScale(0.11, 0.28);
      this.fade(edge, { ...to, x: to.x - f * 8, scaleX: to.scaleX * 0.93, scaleY: to.scaleY * 0.93 }, 560, delay);
      const fill = this.sprite(cx, cy, "circle_02", "ring", 0xc8f2ff).setScale(0.12, 0.3).setAlpha(0.5);
      this.fade(fill, to, 560, delay);
      const ghostC = this.sprite(cx - f * 3, cy, "circle_02", "ring", 0x40e0ff).setScale(0.12, 0.3).setAlpha(0.35);
      this.fade(ghostC, { ...to, x: to.x - f * 6 }, 560, delay + 20);
      if (!Q.low) {
        const ghostM = this.sprite(cx + f * 3, cy, "circle_02", "ring", 0xff70e0).setScale(0.12, 0.3).setAlpha(0.18);
        this.fade(ghostM, { ...to, x: to.x + f * 6 }, 560, delay + 30);
      }
    }
    // air streaks fanning out across the cone
    const n = Q.low ? 5 : 9;
    for (let i = 0; i < n; i++) {
      const a = -halfAngle + (2 * halfAngle * i) / (n - 1);
      const ang = f > 0 ? a : Math.PI - a;
      const st = this.s.add.image(cx, cy, "streak").setTint(0xe8fbff).setBlendMode(Phaser.BlendModes.ADD).setDepth(44).setScale(4, 1.2).setRotation(ang);
      this.fade(st, { x: cx + Math.cos(ang) * radius * 0.9, y: cy + Math.sin(ang) * radius * 0.9, scaleX: 7, alpha: 0 }, 480, 30);
    }
    // floor dust blown outward
    const floorY = FLOOR_Y;
    if (Math.abs(cy - floorY) < 200) {
      this.airDust[f > 0 ? 1 : -1].explode(Q.low ? 5 : 10, cx + f * 40, floorY - 6);
    }
  }

  /** localized hit marker where the pressure wave struck the target */
  clapHit(x: number, y: number) {
    const r = this.sprite(x, y, "circle_05", "ring", 0xffffff).setScale(0.15);
    this.fade(r, { scale: 0.8, alpha: 0 }, 260);
    const sp = this.sprite(x, y, "spark_06", "spark", 0xdff8ff).setScale(0.35);
    this.fade(sp, { scale: 0.7, alpha: 0, angle: 90 }, 240);
  }

  /** heavy landing (Hulk only): small dust ring so the weight reads on every jump */
  heavyLanding(x: number, footY: number) {
    this.dust.explode(Q.low ? 2 : 4, x, footY);
    const r = this.sprite(x, footY, "circle_05", "ring", 0xd0c0a0).setScale(0.15, 0.04).setAlpha(0.6);
    this.fade(r, { scaleX: 0.7, scaleY: 0.12, alpha: 0 }, 260);
  }
}
