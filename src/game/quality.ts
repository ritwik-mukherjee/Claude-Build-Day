// Reduced-effects mode for integrated GPUs (e.g. Intel UHD 620).
// Toggle with the HUD button / "L" key, or it switches on automatically when the
// frame rate stays low. Cinematic beats (zoom, letterbox, blueprint, explosions) are kept;
// only particle density, debris, ambient effects and solver iterations are reduced.
import { bus } from "./bus";

const KEY = "ragdoll.lowfx";
let stored: string | null = null;
try {
  stored = localStorage.getItem(KEY);
} catch {
  /* storage unavailable */
}

let chamberStored: string | null = null;
try {
  chamberStored = localStorage.getItem("ragdoll.chamber3d");
} catch {
  /* ignore */
}

let slowFrames = 0;
let window_ = 0;
let auto = stored === null; // only auto-switch if the user never chose

export const Q = {
  low: stored === "1",
  /** 3D Mutation Chamber preference (on by default; never used in reduced-effects mode) */
  chamber: chamberStored !== "0",
  get useChamber() {
    return this.chamber && !this.low;
  },
  setChamber(on: boolean) {
    this.chamber = on;
    try {
      localStorage.setItem("ragdoll.chamber3d", on ? "1" : "0");
    } catch {
      /* ignore */
    }
    bus.emit("quality", this.low);
  },
  /** particle count multiplier */
  get k() {
    return this.low ? 0.45 : 1;
  },
  set(low: boolean, byUser = true) {
    this.low = low;
    if (byUser) {
      auto = false;
      try {
        localStorage.setItem(KEY, low ? "1" : "0");
      } catch {
        /* ignore */
      }
    }
    document.body.classList.toggle("lowfx", low);
    bus.emit("quality", low);
  },
  /** feed frame deltas; auto-enables low mode after ~3 s below ~40 fps */
  sample(deltaMs: number) {
    if (!auto || this.low) return;
    window_++;
    if (deltaMs > 25) slowFrames++;
    if (window_ >= 180) {
      if (slowFrames > 120) {
        this.set(true, false);
        bus.emit("quality-auto");
      }
      window_ = 0;
      slowFrames = 0;
    }
  },
};
