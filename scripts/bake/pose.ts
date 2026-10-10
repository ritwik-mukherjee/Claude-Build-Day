// Shared bake-time posing for the rigged Hulk: natural arms-down stance and fists, applied through
// the model's own finger / arm bones before any part or animation frame is rendered.
import * as THREE from "three";
import { aimBone } from "../../src/chamber/models";

const W = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

/** Curl every finger into a fist (proximal joint toward the palm, middle joint back to the wrist). */
export function makeFists(bones: Map<string, THREE.Bone>, flip = 1) {
  for (const side of ["left", "right"]) {
    const B = (k: string) => bones.get(`${side}hand${k}`);
    const hand = bones.get(`${side}hand`);
    const m1 = B("middle1"), i1 = B("index1"), p1 = B("pinky1");
    if (!hand || !m1 || !i1 || !p1) continue;
    hand.updateWorldMatrix(true, true);
    const handDir = W(m1).sub(W(hand)).normalize();
    const across = W(i1).sub(W(p1)).normalize();
    const n = new THREE.Vector3().crossVectors(handDir, across).normalize().multiplyScalar(side === "left" ? flip : -flip);
    for (const f of ["index", "middle", "ring", "pinky"]) {
      const f1 = B(`${f}1`), f2 = B(`${f}2`), f3 = B(`${f}3`);
      aimBone(f1, f2, n.clone().add(handDir.clone().multiplyScalar(0.15)));
      aimBone(f2, f3, handDir.clone().negate().add(n.clone().multiplyScalar(0.25)));
    }
    // thumb folds across the front of the fist
    aimBone(B("thumb1"), B("thumb2"), handDir.clone().add(n.clone().multiplyScalar(0.6)));
    aimBone(B("thumb2"), B("thumb3"), across.clone().negate().add(n.clone().multiplyScalar(0.5)));
  }
}

/** Arms hanging naturally with a slight elbow bend (the bind pose is an A-pose). */
export function armsDown(bones: Map<string, THREE.Bone>) {
  for (const [side, s] of [["left", 1], ["right", -1]] as const) {
    aimBone(bones.get(`${side}arm`), bones.get(`${side}forearm`), new THREE.Vector3(s * 0.28, -1, 0.02));
    aimBone(bones.get(`${side}forearm`), bones.get(`${side}hand`), new THREE.Vector3(s * 0.1, -1, 0.22));
  }
}
