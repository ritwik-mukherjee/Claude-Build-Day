// dev-only: front-view preview render of a model (for choosing bake landmarks)
import * as THREE from "three";
import { instantiate, loadEnvironment, type ModelId } from "../../src/chamber/models";
export async function preview(id: ModelId, yaw = 0, size = 600) {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(size, size);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x404850);
  const env = await loadEnvironment(r);
  if (env) scene.environment = env;
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const inst = await instantiate(id);
  inst.root.rotation.y = yaw;
  scene.add(inst.root);
  const cam = new THREE.OrthographicCamera(-1.4, 1.4, 2.5, -0.3, 0.1, 20);
  cam.position.set(0, 0, 6);
  scene.add(new THREE.GridHelper(4, 16, 0xff0000, 0x888888));
  // horizontal grid lines every 0.1 for landmark reading
  const g = new THREE.Group();
  for (let y = 0; y <= 2.4; y += 0.1) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.4, y, 2), new THREE.Vector3(-1.2, y, 2)]), new THREE.LineBasicMaterial({ color: y % 0.5 < 0.05 ? 0xffff00 : 0xffffff }));
    g.add(l);
  }
  for (let x = -1.4; x <= 1.4; x += 0.1) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, -0.3, 2), new THREE.Vector3(x, -0.2, 2)]), new THREE.LineBasicMaterial({ color: Math.abs(x % 0.5) < 0.05 ? 0xffff00 : 0xffffff }));
    g.add(l);
  }
  scene.add(g);
  r.render(scene, cam);
  const url = r.domElement.toDataURL("image/png");
  r.dispose();
  return url;
}
