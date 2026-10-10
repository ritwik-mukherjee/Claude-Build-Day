// Dev-time bake: renders each body region of a real rigged glTF character (segmented by skin
// weights) into a sprite whose joint anchors land exactly on the 2D ragdoll's constraint pivots.
// Run via scripts/bake/run.mjs against the dev server; output goes to public/assets/sprites/<id>/.
import * as THREE from "three";
import { instantiate, loadEnvironment, boneKey, type ModelId } from "../../src/chamber/models";
import { armsDown, makeFists } from "./pose";

type Part = "torso" | "head" | "uarmL" | "farmL" | "thighL" | "shinL" | "uarmR" | "farmR" | "thighR" | "shinR";
interface Dims { torso: [number, number]; head: number; uarm: [number, number]; farm: [number, number]; thigh: [number, number]; shin: [number, number] }
interface RigSpec { roots: Record<string, Part>; j: Record<string, string> }

// screen-left ("L", drawn behind) = the model's right side in a front view
const RIGS: Partial<Record<ModelId, RigSpec>> = {
  hulk: {
    roots: { hips: "torso", rightupleg: "thighL", rightleg: "shinL", leftupleg: "thighR", leftleg: "shinR", neck: "head", rightarm: "uarmL", rightforearm: "farmL", leftarm: "uarmR", leftforearm: "farmR" },
    j: { shL: "rightarm", elL: "rightforearm", wrL: "righthand", hipL: "rightupleg", knL: "rightleg", anL: "rightfoot", shR: "leftarm", elR: "leftforearm", wrR: "lefthand", hipR: "leftupleg", knR: "leftleg", anR: "leftfoot" },
  },
};

export async function bake(id: ModelId, D: Dims, SS = 4, fistFlip = 1): Promise<Record<string, string>> {
  const rig = RIGS[id]!;
  const inst = await instantiate(id);
  inst.root.updateMatrixWorld(true);
  if (id === "hulk") {
    // natural stance before segmenting: arms down (clean shoulder/elbow deformation) and fists
    armsDown(inst.bones);
    makeFists(inst.bones, fistFlip);
    inst.root.updateMatrixWorld(true);
  }
  const W = (k: string) => inst.bones.get(k)!.getWorldPosition(new THREE.Vector3());
  const J = (k: string) => W(rig.j[k]);
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const env = await loadEnvironment(r);
  if (env) { scene.environment = env; scene.environmentIntensity = 0.6; }
  const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(-2, 3, 4);
  const rimC = new THREE.DirectionalLight(0x26f0ff, 2.2); rimC.position.set(-4, 1, -2);
  const rimO = new THREE.DirectionalLight(0xff7a1a, 2.0); rimO.position.set(4, 1, -2);
  scene.add(key, rimC, rimO, new THREE.HemisphereLight(0x8090a0, 0x201810, 0.7));
  scene.add(inst.root);

  // per-vertex part weights from the skin
  const meshes: THREE.SkinnedMesh[] = [];
  inst.root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && meshes.push(o as THREE.SkinnedMesh));
  const partOfBone = (b: THREE.Object3D | null): Part => {
    while (b) { const p = rig.roots[boneKey(b.name)]; if (p) return p; b = b.parent; }
    return "torso";
  };
  const orig = new Map(meshes.map((m) => [m, m.geometry]));
  const filtered = (m: THREE.SkinnedMesh, part: Part) => {
    const g = orig.get(m)!;
    const bp = m.skeleton.bones.map(partOfBone);
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const n = g.attributes.position.count;
    const wv = new Float32Array(n);
    for (let v = 0; v < n; v++) for (let c = 0; c < 4; c++) if (bp[si.getComponent(v, c)] === part) wv[v] += sw.getComponent(v, c);
    const idx = g.index ? Array.from(g.index.array) : [...Array(n).keys()];
    const out: number[] = [];
    // limbs take a generous share of the joint skin (full deltoid / knee caps) so they overlap the torso
    const th = part === "torso" || part === "head" ? 0.3 : 0.12;
    for (let t = 0; t < idx.length; t += 3) if (wv[idx[t]] >= th || wv[idx[t + 1]] >= th || wv[idx[t + 2]] >= th) out.push(idx[t], idx[t + 1], idx[t + 2]);
    const ng = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(g.attributes)) ng.setAttribute(k, a);
    ng.setIndex(out);
    return { ng, verts: new Set(out) };
  };

  const [tw, th] = D.torso;
  const shY = -th / 2 + 7, hipY = th / 2 - 3;
  const ua = D.uarm[1] / 2 - 3, fa = D.farm[1] / 2 - 3, tg = D.thigh[1] / 2 - 3, sh = D.shin[1] / 2 - 4;
  const mid = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).multiplyScalar(0.5);
  const shMid = mid(J("shL"), J("shR")), hipMid = mid(J("hipL"), J("hipR"));
  const sTorso = (hipY - shY) / new THREE.Vector2(shMid.x - hipMid.x, shMid.y - hipMid.y).length();
  const ground = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z);
  // anchors: [world A, rig y of A, world B, rig y of B] (rig x = 0, +y down); head uses torso scale
  const spec: Record<Part, [THREE.Vector3, number, THREE.Vector3, number, number?]> = {
    torso: [shMid, shY, hipMid, hipY],
    head: [shMid.clone().add(new THREE.Vector3(0, 6 / sTorso + 1, 0)), D.head - 1 - sTorso, shMid.clone().add(new THREE.Vector3(0, 6 / sTorso, 0)), D.head - 1],
    uarmL: [J("shL"), -ua, J("elL"), ua], farmL: [J("elL"), -fa, J("wrL"), fa], thighL: [J("hipL"), -tg, J("knL"), tg], shinL: [J("knL"), -sh, ground(J("anL")), D.shin[1] / 2 - 2],
    uarmR: [J("shR"), -ua, J("elR"), ua], farmR: [J("elR"), -fa, J("wrR"), fa], thighR: [J("hipR"), -tg, J("knR"), tg], shinR: [J("knR"), -sh, ground(J("anR")), D.shin[1] / 2 - 2],
  };
  const out: Record<string, string> = {};
  const tmp = new THREE.Vector3();
  for (const part of Object.keys(spec) as Part[]) {
    const [A, ya, B, yb] = spec[part];
    const axis = new THREE.Vector3(A.x - B.x, A.y - B.y, 0);
    const len = axis.length();
    axis.normalize(); // world "up" of this sprite
    const s = (yb - ya) / len; // px per world unit
    const right = new THREE.Vector3(-axis.y, axis.x, 0).negate(); // screen right
    right.set(axis.y, -axis.x, 0);
    // body centre in world: A shifted by -ya px along -axis (rig +y = down = -axis)
    const C = A.clone().add(axis.clone().multiplyScalar(ya / s));
    let hx = 4, hy = 4;
    for (const m of meshes) {
      const { ng, verts } = filtered(m, part);
      m.geometry = ng;
      for (const v of verts) {
        m.getVertexPosition(v, tmp);
        tmp.applyMatrix4(m.matrixWorld).sub(C);
        hx = Math.max(hx, Math.abs(tmp.dot(right)) * s);
        hy = Math.max(hy, Math.abs(tmp.dot(axis)) * s);
      }
    }
    const w = Math.ceil(hx * 2 + 4), h = Math.ceil(hy * 2 + 4);
    const cam = new THREE.OrthographicCamera(-w / 2 / s, w / 2 / s, h / 2 / s, -h / 2 / s, 0.01, 20);
    cam.position.copy(C).add(new THREE.Vector3(0, 0, 6));
    cam.up.copy(axis);
    cam.lookAt(C);
    r.setSize(w * SS, h * SS, false);
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(r.domElement, 0, 0, w, h);
    out[part] = cv.toDataURL("image/png");
    for (const m of meshes) { m.geometry.dispose(); m.geometry = orig.get(m)!; }
  }
  r.dispose();
  void tw;
  return out;
}
