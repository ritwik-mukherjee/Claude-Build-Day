// Reusable 3D character showcase (select screen "Imported 3D fighters").
// One WebGLRenderer, created on demand; render loop runs only while active; everything
// is disposed (incl. forceContextLoss) when the showcase is closed.
import * as THREE from "three";
import { disposeObject, instantiate, loadEnvironment, loadMetal, MODEL_SPECS, type CharacterInstance, type ModelId } from "./models";

const ACCENT: Record<ModelId, number> = { hulk: 0x5dbb3a, kratos: 0xe0402a, doraemon: 0x2a9df4 };

export class CharacterShowcase {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private timer = new THREE.Timer();
  private current: { id: ModelId; inst: CharacterInstance; t: number } | null = null;
  private leaving: { inst: CharacterInstance; t: number } | null = null;
  private pedestal: THREE.Mesh;
  private accentLight: THREE.PointLight;
  private ring: THREE.Mesh;
  private running = false;
  private reqId = 0;
  private resizeObs: ResizeObserver;
  onStatus?: (id: ModelId, state: "loading" | "ready" | "error", msg?: string) => void;

  constructor(
    private host: HTMLElement,
    private low = false,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, alpha: true, powerPreference: "default" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.4, 5.3);
    this.camera.lookAt(0, 1.08, 0);

    // lighting: warm key, cyan + orange rims (arena palette), soft fill
    const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
    key.position.set(2.5, 4, 3.5);
    const rimC = new THREE.DirectionalLight(0x26f0ff, 3.2);
    rimC.position.set(-3.5, 2.5, -3);
    const rimO = new THREE.DirectionalLight(0xff7a1a, 2.4);
    rimO.position.set(3.5, 1.5, -3);
    this.accentLight = new THREE.PointLight(0xffffff, 6, 6, 2);
    this.accentLight.position.set(0, 0.25, 1.4);
    this.scene.add(key, rimC, rimO, this.accentLight, new THREE.HemisphereLight(0x1a2a36, 0x050302, 0.6));

    // pedestal using the uploaded metal plate PBR maps + an emissive ring
    const metal = loadMetal(1.5);
    this.pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.4, 0.28, 48), metal);
    this.pedestal.position.y = -0.14;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: 0x26f0ff }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.005;
    this.scene.add(this.pedestal, this.ring);

    void loadEnvironment(this.renderer).then((env) => {
      if (!env) return;
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.55;
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Swap to a character: the old one sinks, the new one rises onto the pedestal. */
  async show(id: ModelId) {
    if (this.current?.id === id) return;
    const reqId = ++this.reqId;
    if (this.current) {
      this.leaving && this.drop(this.leaving.inst);
      this.leaving = { inst: this.current.inst, t: 0 };
      this.current = null;
    }
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(ACCENT[id]);
    this.accentLight.color.setHex(ACCENT[id]);
    this.onStatus?.(id, "loading");
    try {
      const inst = await instantiate(id);
      if (reqId !== this.reqId) return void disposeObject(inst.root); // superseded by a newer selection
      if (inst.mixer && inst.clips[0]) inst.mixer.clipAction(inst.clips[0]).play();
      this.scene.add(inst.root);
      this.current = { id, inst, t: 0 };
      this.onStatus?.(id, "ready");
    } catch (e) {
      console.warn(`[showcase] ${id} failed`, e);
      if (reqId === this.reqId) this.onStatus?.(id, "error", (e as Error).message);
    }
  }

  private drop(inst: CharacterInstance) {
    this.scene.remove(inst.root);
    inst.mixer?.stopAllAction();
    disposeObject(inst.root);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    this.renderer.setAnimationLoop((ts) => this.frame(ts));
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private frame(ts: number) {
    this.timer.update(ts);
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();
    const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, x), 3);
    if (this.leaving) {
      this.leaving.t += dt;
      const k = ease(this.leaving.t / 0.35);
      this.leaving.inst.root.position.y = -2.4 * k;
      this.leaving.inst.root.rotation.y += dt * 6;
      if (this.leaving.t > 0.35) {
        this.drop(this.leaving.inst);
        this.leaving = null;
      }
    }
    if (this.current) {
      const c = this.current;
      c.t += dt;
      const k = ease(c.t / 0.7);
      c.inst.root.position.y = -2.4 * (1 - k);
      // slow deliberate turntable; brief fast spin on entry settles into it
      c.inst.root.rotation.y = -0.5 + Math.sin(t * 0.35) * 0.65 + (1 - k) * 3;
      if (c.inst.mixer) c.inst.mixer.update(dt);
      else c.inst.root.children[0].position.y += Math.sin(t * 1.6) * 0.0009; // subtle idle breathing
    }
    this.ring.scale.setScalar(1 + Math.sin(t * 2) * 0.01);
    this.renderer.render(this.scene, this.camera);
  }

  /** Render one still of a model (for cards / victory portraits). */
  async snapshot(id: ModelId, w = 220, h = 230): Promise<string> {
    const inst = await instantiate(id);
    const rt = new THREE.WebGLRenderTarget(w * 2, h * 2, { colorSpace: THREE.SRGBColorSpace });
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, 50);
    cam.position.set(0, 1.25, 6.2);
    cam.lookAt(0, 1.08, 0);
    const vis = [this.pedestal.visible, this.ring.visible, this.current?.inst.root.visible, this.leaving?.inst.root.visible];
    this.pedestal.visible = this.ring.visible = false;
    if (this.current) this.current.inst.root.visible = false;
    if (this.leaving) this.leaving.inst.root.visible = false;
    inst.root.rotation.y = -0.35;
    if (inst.mixer && inst.clips[0]) {
      inst.mixer.clipAction(inst.clips[0]).play();
      inst.mixer.update(0.8);
    }
    this.scene.add(inst.root);
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const px = new Uint8Array(w * 2 * h * 2 * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, w * 2, h * 2, px);
    this.renderer.setRenderTarget(null);
    this.scene.remove(inst.root);
    disposeObject(inst.root);
    rt.dispose();
    [this.pedestal.visible, this.ring.visible] = [vis[0]!, vis[1]!];
    if (this.current) this.current.inst.root.visible = true;
    if (this.leaving) this.leaving.inst.root.visible = true;
    // flip rows (GL origin is bottom-left) into a 2D canvas
    const cv = document.createElement("canvas");
    cv.width = w * 2;
    cv.height = h * 2;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(w * 2, h * 2);
    const row = w * 2 * 4;
    for (let y = 0; y < h * 2; y++) img.data.set(px.subarray((h * 2 - 1 - y) * row, (h * 2 - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL("image/png");
  }

  get credit() {
    return this.current ? MODEL_SPECS[this.current.id].credit : "";
  }

  dispose() {
    this.stop();
    this.resizeObs.disconnect();
    if (this.current) this.drop(this.current.inst);
    if (this.leaving) this.drop(this.leaving.inst);
    disposeObject(this.scene);
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
