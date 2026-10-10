// Dev-time bake: Hulk Smash animation rendered from the real rigged glTF. Keyframe poses are
// authored by aiming the model's own bones (see aimBone), interpolated per bone with slerp, and
// rendered in a 3/4 view at arena scale. Output: a 7x2 sprite sheet + per-frame foot rows.
import * as THREE from "three";
import { instantiate, loadEnvironment, aimBone } from "../../src/chamber/models";

type V3 = [number, number, number];
// directions in model space: +z = forward, +y = up, +x = Hulk's left; s = side sign (left +1, right -1)
type Pose = { spine: V3; neck: V3; arm: V3; fore: V3; thigh: V3; shin: V3 };
const P: Record<string, Pose> = {
  idle: { spine: [0, 1, 0.08], neck: [0, 1, 0.15], arm: [0.35, -0.9, 0.15], fore: [0.1, -0.7, 0.7], thigh: [0.1, -1, 0.05], shin: [0, -1, -0.05] },
  wind: { spine: [0, 0.8, 0.6], neck: [0, 1, 0.4], arm: [0.3, 0.8, -0.5], fore: [-0.1, 0.9, -0.4], thigh: [0.3, -0.25, 0.92], shin: [0.05, -1, -0.25] },
  rise: { spine: [0, 1, -0.12], neck: [0, 1, 0.1], arm: [0.25, 0.95, 0.05], fore: [-0.35, 0.9, 0.15], thigh: [0.1, -0.4, 0.9], shin: [0, -1, 0.1] },
  apex: { spine: [0, 0.9, -0.4], neck: [0, 1, 0.05], arm: [0.2, 0.75, -0.6], fore: [-0.3, 0.6, -0.7], thigh: [0.1, -0.6, 0.8], shin: [0, -1, -0.2] },
  slam: { spine: [0, 0.35, 0.95], neck: [0, 0.6, 0.8], arm: [0.05, -0.3, 0.95], fore: [-0.15, -0.9, 0.4], thigh: [0.45, -0.1, 0.88], shin: [0.1, -1, -0.15] },
};
// [from, to, t] per frame — 0-2 wind-up, 3-4 launch, 5-6 apex, 7 fall, 8-9 slam (9 = impact), 10 hold, 11-13 recover
const SEQ: [string, string, number][] = [
  ["idle", "wind", 0.4], ["idle", "wind", 0.75], ["idle", "wind", 1],
  ["wind", "rise", 0.5], ["wind", "rise", 1],
  ["rise", "apex", 0.5], ["rise", "apex", 1],
  ["apex", "apex", 1],
  ["apex", "slam", 0.4], ["apex", "slam", 1],
  ["slam", "slam", 1],
  ["slam", "idle", 0.33], ["slam", "idle", 0.66], ["slam", "idle", 1],
];

export async function bakeSmash(FW = 256, FH = 256, PX = 74, yaw = 0.95, SS = 2) {
  const inst = await instantiate("hulk");
  const B = (k: string) => inst.bones.get(k)!;
  const rest = new Map<THREE.Bone, THREE.Quaternion>();
  for (const b of inst.bones.values()) rest.set(b, b.quaternion.clone());
  const apply = (p: Pose) => {
    for (const [b, q] of rest) b.quaternion.copy(q);
    inst.root.rotation.y = 0;
    inst.root.updateMatrixWorld(true);
    const v = (d: V3, s = 1) => new THREE.Vector3(d[0] * s, d[1], d[2]);
    aimBone(B("spine"), B("spine2"), v(p.spine));
    aimBone(B("neck"), B("head"), v(p.neck));
    for (const [side, s] of [["left", 1], ["right", -1]] as const) {
      aimBone(B(`${side}arm`), B(`${side}forearm`), v(p.arm, s));
      aimBone(B(`${side}forearm`), B(`${side}hand`), v(p.fore, s));
      aimBone(B(`${side}upleg`), B(`${side}leg`), v(p.thigh, s));
      aimBone(B(`${side}leg`), B(`${side}foot`), v(p.shin, s));
    }
    return new Map([...rest.keys()].map((b) => [b, b.quaternion.clone()]));
  };
  const poses = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, apply(p)]));

  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(FW * SS, FH * SS, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.25;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0, 0);
  const scene = new THREE.Scene();
  const env = await loadEnvironment(r);
  if (env) { scene.environment = env; scene.environmentIntensity = 0.6; }
  const key = new THREE.DirectionalLight(0xfff1e0, 3.2); key.position.set(1, 3, 4);
  const rimC = new THREE.DirectionalLight(0x26f0ff, 2.6); rimC.position.set(-4, 1.5, -2);
  const rimO = new THREE.DirectionalLight(0xff7a1a, 2.2); rimO.position.set(4, 1, -2);
  scene.add(key, rimC, rimO, new THREE.HemisphereLight(0x8090a0, 0x201810, 0.7), inst.root);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  const HX = FW / 2, HY = FH * 0.56; // hips land on this pixel in every frame

  const sheet = document.createElement("canvas");
  sheet.width = FW * 7;
  sheet.height = FH * 2;
  const ctx = sheet.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const footRow: number[] = [];
  const hips = B("hips");
  SEQ.forEach(([a, b, t], i) => {
    for (const bone of rest.keys()) bone.quaternion.copy(poses[a].get(bone)!).slerp(poses[b].get(bone)!, t);
    inst.root.rotation.y = yaw;
    inst.root.updateMatrixWorld(true);
    const h = hips.getWorldPosition(new THREE.Vector3());
    // frustum bounds are relative to the camera, which sits on the hips
    cam.left = -HX / PX; cam.right = (FW - HX) / PX;
    cam.top = HY / PX; cam.bottom = -(FH - HY) / PX;
    cam.position.set(h.x, h.y, h.z + 10);
    cam.lookAt(h.x, h.y, h.z);
    cam.updateProjectionMatrix();
    const box = new THREE.Box3().setFromObject(inst.root, true);
    footRow.push(Math.round(HY + (h.y - box.min.y) * PX));
    r.render(scene, cam);
    ctx.drawImage(r.domElement, (i % 7) * FW, Math.floor(i / 7) * FH, FW, FH);
  });
  r.dispose();
  return { sheet: sheet.toDataURL("image/png"), meta: { frameWidth: FW, frameHeight: FH, frames: SEQ.length, hipsX: HX, hipsY: HY, footRow, impactFrame: 9 } };
}
