// Hulk Smash presentation: frames pre-rendered from the real Hulk glTF (scripts/bake/smash.ts)
// replace the ragdoll sprites for the duration of the move, driven by the ability's real phases.
// Purely visual: physics bodies, collision, damage and cooldowns are untouched. If the sheet
// failed to load, nothing here runs and the ragdoll performs the move as before.
import Phaser from "phaser";
import type { ArenaScene } from "./ArenaScene";
import { Q } from "./quality";
import { flashWhite, unflash } from "./util";

export const SMASH_SHEET = "hulk_smash";
export const SMASH_META = "hulk_smash_meta";

interface Meta {
  frameWidth: number;
  frameHeight: number;
  frames: number;
  hipsX: number;
  hipsY: number;
  footRow: number[];
  impactFrame: number;
}

export function preloadSmash(scene: Phaser.Scene) {
  const base = `${import.meta.env.BASE_URL}assets/sprites/hulk`;
  if (!scene.textures.exists(SMASH_SHEET)) scene.load.spritesheet(SMASH_SHEET, `${base}/smash.png`, { frameWidth: 256, frameHeight: 256 });
  if (!scene.cache.json.exists(SMASH_META)) scene.load.json(SMASH_META, `${base}/smash.json`);
}

type Phase = "windup" | "rise" | "fall";
// recovery after the impact frame: [frame, seconds]
const LAND: [number, number][] = [
  [9, 0.16],
  [10, 0.12],
  [11, 0.07],
  [12, 0.07],
  [13, 0.07],
];

export class SmashAnim {
  private img: Phaser.GameObjects.Sprite;
  private meta: Meta;
  private land: { t: number; gy: number; x: number } | null = null;
  private active = false;
  private ghostT = 0;
  private ghosts: Phaser.GameObjects.Sprite[] = [];
  private last = 0;

  static create(s: ArenaScene) {
    return s.textures.exists(SMASH_SHEET) && s.cache.json.exists(SMASH_META) ? new SmashAnim(s) : null;
  }

  private constructor(private s: ArenaScene) {
    this.meta = s.cache.json.get(SMASH_META) as Meta;
    this.img = s.add.sprite(0, 0, SMASH_SHEET, 0).setDepth(21).setVisible(false);
    this.img.setOrigin(this.meta.hipsX / this.meta.frameWidth, this.meta.hipsY / this.meta.frameHeight);
  }

  get playing() {
    return this.active;
  }

  begin() {
    this.active = true;
    this.land = null;
    this.s.goblin.setHidden(true);
    this.img.setVisible(true).setAlpha(1).setDepth(21);
    unflash(this.img);
  }

  /** landing: hold the impact frame through the hit-stop, then recover */
  impact(gy: number) {
    if (!this.active) return;
    this.land = { t: 0, gy, x: this.s.goblin.x };
    // the slam pose must read on top of the dust / shockwave layers
    this.img.setDepth(46);
    for (const gh of this.ghosts) gh.destroy();
    this.ghosts = [];
    flashWhite(this.img); // brief flash on contact
    this.s.time.delayedCall(50, () => this.img.active && unflash(this.img));
  }

  end() {
    if (!this.active) return;
    this.active = false;
    this.land = null;
    this.img.setVisible(false);
    if (this.s.goblin.hp > 0) this.s.goblin.setHidden(false);
  }

  /** per-frame: pick the frame from the ability state and place it on the fighter */
  render(time: number, sm: { t: number; phase: Phase } | null) {
    const dt = Math.min(0.05, Math.max(0, (time - (this.last || time)) / 1000));
    this.last = time;
    if (!this.active) return;
    const g = this.s.goblin;
    const m = this.meta;
    this.img.setFlipX(g.facing < 0);
    // the sprite's origin is the hips; the ragdoll's hip joints sit just below the torso centre
    const hipX = g.x,
      hipY = g.y + g.def.dims.torso[1] / 2 - 3;
    let f = 0;
    let grounded = false;
    if (this.land) {
      this.land.t += dt;
      let acc = 0;
      f = -1;
      for (const [fr, d] of LAND) {
        acc += d;
        if (this.land.t < acc) {
          f = fr;
          break;
        }
      }
      if (f < 0) return this.end();
      grounded = true;
    } else if (sm) {
      if (sm.phase === "windup") {
        f = Math.min(2, Math.floor((sm.t / 0.14) * 3));
        grounded = true;
      } else if (sm.phase === "rise") f = sm.t < 0.1 ? 3 : sm.t < 0.2 ? 4 : sm.t < 0.32 ? 5 : 6;
      else {
        const gy = this.s.arena.groundY(g.x, g.y + 10);
        f = gy - hipY < 150 ? 8 : 7; // arms come over just before contact
      }
    } else return this.end();
    this.img.setFrame(f);
    if (grounded) {
      const gy = this.land ? this.land.gy : this.s.arena.groundY(g.x, g.y + 10);
      // align the rendered feet with the floor
      this.img.setPosition(this.land ? this.land.x : hipX, gy - (m.footRow[f] - m.hipsY));
    } else this.img.setPosition(hipX, hipY);
    // airborne afterimages (skipped in reduced-effects mode)
    if (!grounded && !Q.low) {
      this.ghostT -= dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.07;
        const gh = this.s.add
          .sprite(this.img.x, this.img.y, SMASH_SHEET, f)
          .setOrigin(this.img.originX, this.img.originY)
          .setFlipX(this.img.flipX)
          .setDepth(20)
          .setTint(0x5dff3a)
          .setTintMode(Phaser.TintModes.FILL)
          .setAlpha(0.16)
          .setBlendMode(Phaser.BlendModes.ADD);
        this.ghosts.push(gh);
        if (this.ghosts.length > 4) this.ghosts.shift()!.destroy();
        this.s.tweens.add({ targets: gh, alpha: 0, duration: 160, onComplete: () => gh.active && gh.destroy() });
      }
    }
  }

  destroy() {
    this.end();
    for (const gh of this.ghosts) gh.destroy();
    this.img.destroy();
  }
}
