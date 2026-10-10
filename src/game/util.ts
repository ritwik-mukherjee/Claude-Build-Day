import Phaser from "phaser";

/** Matter.Body static helpers (setVelocity, applyForce, …) — typed via MatterPhysics. */
export const MB = (Phaser.Physics.Matter as unknown as { Matter: { Body: Phaser.Physics.Matter.MatterPhysics["body"] } }).Matter.Body;

type Tintable = Phaser.GameObjects.Components.Tint & Phaser.GameObjects.GameObject;

/** Phaser 4: tint color and tint mode are separate. */
export function flashWhite(o: Tintable) {
  o.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
}
export function unflash(o: Tintable, tint?: number) {
  o.setTintMode(Phaser.TintModes.MULTIPLY);
  if (tint === undefined) o.clearTint();
  else o.setTint(tint);
}
