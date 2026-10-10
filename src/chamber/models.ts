// Shared loading for the imported 3D character models + cinematic environment.
// glTF parse results are cached (CPU side) and cloned per use; GPU resources belong to
// whichever renderer draws them and are disposed with that scene.
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

export type ModelId = "hulk" | "kratos" | "doraemon";

export interface ModelSpec {
  url: string;
  /** world-space height after normalisation */
  height: number;
  /** extra yaw so the model faces the camera */
  yaw: number;
  /** material tweaks per model (the glTFs ship base colour only, or full PBR) */
  tune?: (m: THREE.MeshStandardMaterial) => void;
  /** rest-pose adjustment through the real skeleton (models without animation clips) */
  pose?: (bones: Map<string, THREE.Bone>) => void;
  credit: string;
}

/** GLTFLoader sanitises node names (spaces → "_", ":" removed); normalise to "arm right elbow" style keys */
export const boneKey = (name: string) =>
  name
    .replace(/^mixamorig:?/i, "")
    .replace(/_\d+$/, "")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLowerCase();

/** Rotate `bone` so the bone→child segment points along `dir` (world space). Axis-agnostic. */
export function aimBone(bone: THREE.Bone | undefined, child: THREE.Object3D | undefined, dir: THREE.Vector3) {
  if (!bone || !child || !bone.parent) return;
  bone.updateWorldMatrix(true, true);
  const a = bone.getWorldPosition(new THREE.Vector3());
  const cur = child.getWorldPosition(new THREE.Vector3()).sub(a).normalize();
  const target = dir.clone().normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(cur, target);
  const world = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

/** Lower T-posed arms into a ready stance (sign of x is taken from the rig itself). */
function armsDown(b: Map<string, THREE.Bone>, upper: [string, string], fore: [string, string], hand: [string, string]) {
  for (let s = 0; s < 2; s++) {
    const up = b.get(upper[s]),
      el = b.get(fore[s]),
      wr = b.get(hand[s]);
    if (!up || !el || !wr) continue;
    const side = Math.sign(el.getWorldPosition(new THREE.Vector3()).x - up.getWorldPosition(new THREE.Vector3()).x) || 1;
    aimBone(up, el, new THREE.Vector3(side * 0.32, -1, 0.08));
    aimBone(el, wr, new THREE.Vector3(side * 0.12, -0.75, 0.6)); // forearms forward: fists up
  }
}

const BASE = `${import.meta.env.BASE_URL}assets/models`;

export const MODEL_SPECS: Record<ModelId, ModelSpec> = {
  hulk: {
    url: `${BASE}/hulk/scene.gltf`,
    height: 2.35,
    yaw: 0,
    tune: (m) => {
      m.roughness = 0.62;
      m.metalness = 0.0;
    },
    credit: "“HULK RIGGED WITH ANIMATION” by Kapider22 (CC BY 4.0)",
  },
  kratos: {
    url: `${BASE}/kratos/scene.gltf`,
    height: 2.2,
    yaw: 0,
    tune: (m) => {
      const n = (m.name || "").toLowerCase();
      if (n.includes("armorgold") || n.includes("metal")) {
        m.metalness = 0.85;
        m.roughness = 0.32;
      } else {
        m.metalness = 0.0;
        m.roughness = 0.68;
      }
    },
    pose: (b) => armsDown(b, ["arm right shoulder 2", "arm left shoulder 2"], ["arm right elbow", "arm left elbow"], ["arm right wrist", "arm left wrist"]),
    credit: "“God of War 3 Kratos - Rigged and Texture” by S4int0fSSG (CC BY 4.0)",
  },
  doraemon: {
    url: `${BASE}/doraemon/scene.gltf`,
    height: 1.75,
    yaw: 0,
    credit: "“Doraemon 3D” by arc98tect (CC BY 4.0)",
  },
};

const loader = new GLTFLoader();
const cache = new Map<ModelId, Promise<GLTF>>();

export function loadModel(id: ModelId): Promise<GLTF> {
  let p = cache.get(id);
  if (!p) {
    p = loader.loadAsync(MODEL_SPECS[id].url);
    p.catch(() => cache.delete(id)); // allow a retry after a failed load
    cache.set(id, p);
  }
  return p;
}

export interface CharacterInstance {
  root: THREE.Group; // normalised: feet at y=0, centred, facing +z
  mixer?: THREE.AnimationMixer;
  clips: THREE.AnimationClip[];
  bones: Map<string, THREE.Bone>;
}

/** Clone the cached glTF (skeleton-safe), apply material tuning and normalise scale/placement. */
export async function instantiate(id: ModelId): Promise<CharacterInstance> {
  const gltf = await loadModel(id);
  const spec = MODEL_SPECS[id];
  const model = SkeletonUtils.clone(gltf.scene) as THREE.Object3D;
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((o as THREE.Bone).isBone) bones.set(boneKey(o.name), o as THREE.Bone);
    if (mesh.isMesh) {
      mesh.frustumCulled = false; // skinned bounds are unreliable while animating
      const tuned = (m: THREE.Material) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        spec.tune?.(c);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tuned) : tuned(mesh.material);
    }
  });
  const root = new THREE.Group();
  root.add(model);
  if (!gltf.animations.length) {
    model.updateMatrixWorld(true);
    spec.pose?.(bones);
  }
  model.rotation.y = spec.yaw;
  // normalise using the posed (skinned) vertex positions
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const k = spec.height / Math.max(0.0001, size.y);
  model.scale.multiplyScalar(k);
  model.updateMatrixWorld(true);
  box.setFromObject(model, true);
  const c = box.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= box.min.y;
  const mixer = gltf.animations.length ? new THREE.AnimationMixer(model) : undefined;
  return { root, mixer, clips: gltf.animations, bones };
}

/** Dispose every GPU resource below `obj` (geometries, materials, textures). */
export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      mat.dispose();
    }
  });
}

/** Warehouse HDRI → PMREM environment; resolves null if it can't be loaded (caller keeps lights only). */
export async function loadEnvironment(renderer: THREE.WebGLRenderer): Promise<THREE.Texture | null> {
  try {
    const hdr = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}assets/cinematic/warehouse_2k.hdr`);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
    pmrem.dispose();
    return env;
  } catch (e) {
    console.warn("[3d] HDRI unavailable", e);
    return null;
  }
}

/** Blue metal plate PBR set (diffuse / GL normal / AO-rough-metal) for pedestals and props. */
export function loadMetal(repeat = 2) {
  const tl = new THREE.TextureLoader();
  const base = `${import.meta.env.BASE_URL}assets/cinematic`;
  const set = (t: THREE.Texture, srgb = false) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const arm = set(tl.load(`${base}/metal_arm.jpg`));
  return new THREE.MeshStandardMaterial({
    map: set(tl.load(`${base}/metal_diff.jpg`), true),
    normalMap: set(tl.load(`${base}/metal_nor.jpg`)),
    aoMap: arm,
    roughnessMap: arm,
    metalnessMap: arm,
    metalness: 1,
    roughness: 1,
  });
}
