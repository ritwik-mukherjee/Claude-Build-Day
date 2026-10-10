// Three.js "Mutation Chamber": a short 3D cinematic that plays between a validated mutation
// plan and its application. The Phaser loop sleeps while this runs (one renderer at a time),
// the REAL executor is invoked at the climax, and its per-operation results are what we show.
// Everything (geometry, materials, textures, env map, renderer, listeners) is disposed at the end.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { MutationPlan, Operation } from "../../shared/mutations";
import { COLOR_HEX } from "../../shared/mutations";

export interface ApplyResult {
  op: Operation;
  ok: boolean;
}
export interface ChamberOpts {
  source: string;
  low: boolean;
  sleepGame: () => void;
  wakeGame: () => void;
  /** runs the real mutation executor; called exactly once */
  apply: () => Promise<ApplyResult[]>;
}

const LABEL: Record<string, string> = {
  rocket_booster: "ROCKET BOOSTER",
  chain_weapon: "CHAIN HAMMER",
  shield: "ENERGY SHIELD",
  spring_legs: "SPRING LEGS",
  armor_plating: "ARMOR PLATING",
  boxing_glove: "SPRING BOXING GLOVE",
};

const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  outBack: (t: number) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2),
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Throws if WebGL is unavailable (caller falls back to the 2D cinematic). */
export async function runChamber(plan: MutationPlan, opts: ChamberOpts): Promise<ApplyResult[]> {
  const stage = document.getElementById("stage")!;
  const root = document.createElement("div");
  root.id = "chamber";
  root.innerHTML = `
    <div class="ch-top"><span class="ch-tag">MUTATION CHAMBER</span><span class="ch-src">PLAN · ${opts.source.toUpperCase()}</span></div>
    <div class="ch-list"></div>
    <div class="ch-summary"></div>
    <div class="ch-flash"></div>
    <div class="ch-skip">click to skip</div>`;
  stage.appendChild(root);

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !opts.low, powerPreference: "default", alpha: false });
  } catch (e) {
    root.remove();
    throw e;
  }
  const W = () => stage.clientWidth,
    H = () => stage.clientHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.low ? 1 : 1.5));
  renderer.setSize(W(), H());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  root.prepend(renderer.domElement);

  // The 2D game stops rendering while the chamber owns the GPU.
  opts.sleepGame();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03060a);
  scene.fog = new THREE.Fog(0x03060a, 10, 30);
  const camera = new THREE.PerspectiveCamera(48, W() / H(), 0.1, 100);
  camera.position.set(0, 2.2, 15);

  // Reflections from a procedural room environment (skipped in reduced-effects mode).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = opts.low ? null : pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  // ---------------- shared materials ----------------
  const M = {
    steel: new THREE.MeshStandardMaterial({ color: 0x8a96a2, metalness: 0.95, roughness: 0.28, envMapIntensity: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.9, roughness: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.25, emissive: 0x3a2400 }),
    holo: new THREE.MeshBasicMaterial({ color: 0x26f0ff, wireframe: true, transparent: true, opacity: 0.35 }),
    cyanGlow: new THREE.MeshBasicMaterial({ color: 0x26f0ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    orangeGlow: new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  const disposables: { dispose(): void }[] = [pmrem, ...(envTex ? [envTex] : []), ...Object.values(M)];
  const geo = <T extends THREE.BufferGeometry>(g: T) => (disposables.push(g), g);
  const mat = <T extends THREE.Material>(m: T) => (disposables.push(m), m);

  // glow sprite texture (radial gradient)
  const gc = document.createElement("canvas");
  gc.width = gc.height = 128;
  const gx = gc.getContext("2d")!;
  const grd = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  gx.fillStyle = grd;
  gx.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(gc);
  disposables.push(glowTex);
  const glow = (color: number, scale: number) => {
    const s = new THREE.Sprite(mat(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    s.scale.setScalar(scale);
    return s;
  };

  // ---------------- lights ----------------
  scene.add(new THREE.HemisphereLight(0x2a4a60, 0x080404, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 6, 6);
  scene.add(key);
  const cyanL = new THREE.PointLight(0x26f0ff, 30, 20, 2);
  scene.add(cyanL);
  const orangeL = new THREE.PointLight(0xff7a1a, 0, 18, 2);
  orangeL.position.set(0, -2.5, 1.5);
  scene.add(orangeL);

  // ---------------- environment ----------------
  const grid = new THREE.GridHelper(40, 40, 0x26f0ff, 0x0a3a44);
  grid.position.y = -3.2;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  disposables.push(grid.geometry, grid.material as THREE.Material);
  scene.add(grid);
  const floorGlow = glow(0x26f0ff, 9);
  floorGlow.position.set(0, -3.1, 0);
  floorGlow.scale.set(14, 3, 1);
  scene.add(floorGlow);

  // ---------------- holographic core + rings ----------------
  const core = new THREE.Group();
  scene.add(core);
  const shell = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(1.15, 1)), M.steel);
  const wire = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(1.5, 1)), M.holo);
  const heart = new THREE.Mesh(geo(new THREE.SphereGeometry(0.62, 24, 16)), M.cyanGlow);
  const coreGlow = glow(0x26f0ff, 4.5);
  core.add(shell, wire, heart, coreGlow);
  const rings: THREE.Mesh[] = [];
  [
    [2.2, 0x26f0ff, 0.04],
    [2.8, 0xff7a1a, 0.03],
    [3.5, 0x26f0ff, 0.02],
  ].forEach(([r, c, t], i) => {
    const m = new THREE.Mesh(geo(new THREE.TorusGeometry(r as number, t as number, 8, 96)), mat(new THREE.MeshBasicMaterial({ color: c as number, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })));
    m.rotation.x = Math.PI / 2 + i * 0.5;
    m.rotation.y = i * 0.7;
    rings.push(m);
    core.add(m);
  });

  // energy particles orbiting the core
  const N = opts.low ? 220 : 600;
  const pos = new Float32Array(N * 3);
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    seeds[i * 3] = 2.4 + Math.random() * 4; // radius
    seeds[i * 3 + 1] = Math.random() * Math.PI * 2; // angle
    seeds[i * 3 + 2] = (Math.random() - 0.5) * 2.6; // height
  }
  const pGeo = geo(new THREE.BufferGeometry());
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pMat = mat(new THREE.PointsMaterial({ color: 0x7af8ff, size: 0.06, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  const points = new THREE.Points(pGeo, pMat);
  scene.add(points);

  // ---------------- procedural parts ----------------
  type Part = { obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; spin: THREE.Vector3; t0: number; flames: THREE.Object3D[]; idx: number };
  const parts: Part[] = [];
  const tint = (op: Operation) => COLOR_HEX[op.color];

  function booster(op: Operation) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.32, 0.36, 1.3, 20)), mat(new THREE.MeshStandardMaterial({ color: tint(op), metalness: 0.8, roughness: 0.3 })));
    const nozzle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.3, 0.46, 0.4, 20, 1, true)), M.dark);
    nozzle.position.y = -0.85;
    const band = new THREE.Mesh(geo(new THREE.TorusGeometry(0.36, 0.05, 8, 24)), M.gold);
    band.rotation.x = Math.PI / 2;
    band.position.y = -0.5;
    const cap = new THREE.Mesh(geo(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), M.steel);
    cap.position.y = 0.65;
    const flame = new THREE.Mesh(geo(new THREE.ConeGeometry(0.3, 1.6, 16, 1, true)), M.orangeGlow);
    flame.rotation.x = Math.PI;
    flame.position.y = -1.85;
    flame.scale.set(1, 0.001, 1);
    const fg = glow(0xff7a1a, 0.001);
    fg.position.y = -1.2;
    g.add(body, nozzle, band, cap, flame, fg);
    return { g, flames: [flame, fg] };
  }
  function hammer(op: Operation) {
    const g = new THREE.Group();
    const s = 0.6 + 0.25 * op.size;
    const head = new THREE.Mesh(geo(new THREE.BoxGeometry(1.7 * s, 1.0 * s, 1.0 * s)), mat(new THREE.MeshStandardMaterial({ color: 0x59636d, metalness: 0.9, roughness: 0.35 })));
    const capL = new THREE.Mesh(geo(new THREE.BoxGeometry(0.22 * s, 1.1 * s, 1.1 * s)), M.gold);
    capL.position.x = -0.9 * s;
    const capR = capL.clone();
    capR.position.x = 0.9 * s;
    g.add(head, capL, capR);
    const flames: THREE.Object3D[] = [];
    if (op.rocket > 0) {
      const f = new THREE.Mesh(geo(new THREE.ConeGeometry(0.25, 1.2, 12, 1, true)), M.orangeGlow);
      f.rotation.z = Math.PI / 2;
      f.position.x = -1.6 * s;
      f.scale.set(1, 0.001, 1);
      g.add(f);
      flames.push(f);
    }
    return { g, flames };
  }
  function chainLinks(count: number) {
    const g = new THREE.Group();
    const lg = geo(new THREE.TorusGeometry(0.16, 0.05, 6, 12));
    for (let i = 0; i < count; i++) {
      const l = new THREE.Mesh(lg, M.steel);
      l.position.x = i * 0.27;
      l.rotation.x = i % 2 ? Math.PI / 2 : 0;
      g.add(l);
    }
    return g;
  }
  function helix(turns: number, r: number, h: number, thick: number, material: THREE.Material) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= turns * 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, (i / (turns * 16)) * h, Math.sin(a) * r));
    }
    return new THREE.Mesh(geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, thick, 6)), material);
  }
  function glove(op: Operation) {
    const g = new THREE.Group();
    const red = mat(new THREE.MeshStandardMaterial({ color: tint(op), metalness: 0.2, roughness: 0.45 }));
    const fist = new THREE.Mesh(geo(new THREE.SphereGeometry(0.75, 24, 16)), red);
    fist.scale.set(1.15, 0.9, 0.9);
    const thumb = new THREE.Mesh(geo(new THREE.SphereGeometry(0.28, 12, 8)), red);
    thumb.position.set(0.2, -0.45, 0.45);
    const cuff = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.45, 0.45, 0.4, 20)), mat(new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 })));
    cuff.rotation.z = Math.PI / 2;
    cuff.position.x = -0.85;
    const spring = helix(6, 0.25, 1.6, 0.05, M.steel);
    spring.rotation.z = Math.PI / 2;
    spring.position.x = -1.05;
    g.add(fist, thumb, cuff, spring);
    const flames: THREE.Object3D[] = [];
    if (op.rocket > 0) {
      const f = new THREE.Mesh(geo(new THREE.ConeGeometry(0.22, 1, 12, 1, true)), M.orangeGlow);
      f.rotation.z = Math.PI / 2;
      f.position.set(-0.6, 0.6, 0);
      f.scale.set(1, 0.001, 1);
      g.add(f);
      flames.push(f);
    }
    return { g, flames };
  }
  function shieldPart(op: Operation) {
    const g = new THREE.Group();
    const hex = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.5, 1.5, 0.06, 6)), mat(new THREE.MeshBasicMaterial({ color: tint(op), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })));
    hex.rotation.x = Math.PI / 2;
    const edges = new THREE.LineSegments(geo(new THREE.EdgesGeometry(hex.geometry)), mat(new THREE.LineBasicMaterial({ color: tint(op) })));
    edges.rotation.x = Math.PI / 2;
    g.add(hex, edges);
    return { g, flames: [] as THREE.Object3D[] };
  }
  function armor(op: Operation) {
    const g = new THREE.Group();
    const m = mat(new THREE.MeshStandardMaterial({ color: tint(op), metalness: 0.85, roughness: 0.3 }));
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.45, 1.45, 0.9, 16, 1, true, i * (Math.PI / 2) + 0.15, Math.PI / 2 - 0.3)), m);
      p.material.side = THREE.DoubleSide;
      g.add(p);
    }
    return { g, flames: [] as THREE.Object3D[] };
  }

  // Build an assembly slot for every non-remove operation
  const ops = plan.operations;
  const builds = ops.filter((o) => o.op !== "remove");
  builds.forEach((op, k) => {
    let made: { g: THREE.Object3D; flames: THREE.Object3D[] };
    let to = new THREE.Vector3();
    switch (op.component) {
      case "rocket_booster": {
        const n = op.count;
        const grp = new THREE.Group();
        const flames: THREE.Object3D[] = [];
        for (let i = 0; i < n; i++) {
          const b = booster(op);
          const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2.6;
          b.g.position.set(a, 0, -0.2 + Math.abs(a) * -0.15);
          b.g.rotation.z = -a * 0.12;
          b.g.scale.setScalar(0.7 + 0.15 * op.size);
          grp.add(b.g);
          flames.push(...b.flames);
        }
        made = { g: grp, flames };
        to = new THREE.Vector3(0, -2.1, -0.4);
        break;
      }
      case "chain_weapon": {
        const h = hammer(op);
        const links = chainLinks(Math.round(5 + 3 * op.length));
        const grp = new THREE.Group();
        links.position.x = 1.35;
        h.g.position.x = 1.35 + links.children.length * 0.27 + 0.9;
        grp.add(links, h.g);
        made = { g: grp, flames: h.flames };
        to = new THREE.Vector3(0, 0.2, 0);
        break;
      }
      case "boxing_glove": {
        made = glove(op);
        made.g.rotation.y = Math.PI;
        to = new THREE.Vector3(-3.2, 0.2, 0.2);
        break;
      }
      case "shield": {
        made = shieldPart(op);
        to = new THREE.Vector3(0, 0, 2.1);
        break;
      }
      case "spring_legs": {
        const grp = new THREE.Group();
        const a = helix(5, 0.3, 1.4, 0.06, M.steel);
        const b = a.clone();
        a.position.set(-0.7, -3, 0);
        b.position.set(0.7, -3, 0);
        grp.add(a, b);
        made = { g: grp, flames: [] };
        break;
      }
      default:
        made = armor(op);
    }
    const from = new THREE.Vector3((k % 2 ? 1 : -1) * (9 + k * 2), 4 - k * 3, -6 + k * 3);
    made.g.position.copy(from);
    scene.add(made.g);
    parts.push({ obj: made.g, from, to, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), t0: 0.7 + k * 0.55, flames: made.flames, idx: ops.indexOf(op) });
  });

  // ---------------- DOM text: real plan data ----------------
  const list = root.querySelector(".ch-list") as HTMLElement;
  const rows = ops.map((o) => {
    const d = document.createElement("div");
    d.className = "ch-row";
    const count = o.component === "rocket_booster" && o.count > 1 ? `${o.count}× ` : "";
    const rocket = o.rocket > 0 ? ` · rocket ${o.rocket.toFixed(1)}` : "";
    d.innerHTML = `<b>${o.op.toUpperCase()}</b> ${count}${LABEL[o.component]} <small>@ ${o.socket.replace("_", " ")} · size ${o.size.toFixed(1)} · power ${o.power.toFixed(1)}${rocket}</small><em>QUEUED</em>`;
    list.appendChild(d);
    return d;
  });
  const summaryEl = root.querySelector(".ch-summary") as HTMLElement;
  const flashEl = root.querySelector(".ch-flash") as HTMLElement;

  // ---------------- timeline ----------------
  const T_APPLY = 0.75 + Math.max(1, builds.length) * 0.55 + 0.35;
  const T_IGNITE = T_APPLY + 0.2;
  const T_PORTAL = T_IGNITE + 1.0;
  const T_END = T_PORTAL + 0.6;
  let results: ApplyResult[] | null = null;
  let applying: Promise<void> | null = null;
  let skip = false;
  let anyOk = false;

  const doApply = () => {
    if (applying) return applying;
    rows.forEach((r) => ((r.querySelector("em") as HTMLElement).textContent = "MOUNTING…"));
    applying = opts
      .apply()
      .catch((e) => {
        console.error("[chamber] executor failed", e);
        return ops.map((op) => ({ op, ok: false }));
      })
      .then((res) => {
      results = res;
      anyOk = res.some((r) => r.ok);
      res.forEach((r, i) => {
        const em = rows[i]?.querySelector("em") as HTMLElement | undefined;
        if (!em) return;
        em.textContent = r.ok ? (r.op.op === "remove" ? "✓ EJECTED" : "✓ MOUNTED") : "✗ FAULT";
        rows[i].classList.add(r.ok ? "ok" : "bad");
      });
      if (!anyOk) summaryEl.classList.add("bad");
    });
    return applying;
  };

  const onSkip = () => (skip = true);
  const onResize = () => {
    renderer.setSize(W(), H());
    camera.aspect = W() / H();
    camera.updateProjectionMatrix();
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSkip();
  root.addEventListener("click", onSkip);
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);

  // typewriter summary
  let typed = 0;
  const summary = plan.summary;

  // Compile shaders up front so the first animated frame doesn't stall (and render once).
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  let last = performance.now();
  let clock = 0;
  let raf = 0;
  const shake = new THREE.Vector3();

  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      // Timeline advances by clamped frame deltas: a stutter slows the shot instead of skipping it.
      const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
      last = now;
      clock += dt;
      if (skip && clock < T_APPLY) clock = T_APPLY; // jump ahead, but still apply for real
      const t = clock;

      // fade in
      root.style.opacity = String(clamp01(t / 0.35));
      root.dataset.t = t.toFixed(2); // exposed for automated tests
      // summary typewriter
      if (typed < summary.length) {
        typed = Math.min(summary.length, typed + 2);
        summaryEl.textContent = summary.slice(0, typed);
      }

      // core + rings + particles
      core.rotation.y += dt * 0.6;
      wire.rotation.x -= dt * 0.8;
      rings.forEach((r, i) => {
        r.rotation.z += dt * (0.8 + i * 0.5) * (i % 2 ? -1 : 1);
        r.rotation.x += dt * 0.2 * (i + 1);
      });
      const ignite = clamp01((t - T_IGNITE) / 0.5);
      for (let i = 0; i < N; i++) {
        const r = seeds[i * 3] * (1 - 0.6 * ignite) + ignite * 6 * (i % 3);
        const a = seeds[i * 3 + 1] + t * (0.4 + 1.6 / seeds[i * 3]);
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = seeds[i * 3 + 2] + Math.sin(a * 2 + i) * 0.2;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
      pGeo.attributes.position.needsUpdate = true;
      heart.scale.setScalar(1 + Math.sin(t * 6) * 0.06 + ignite * 0.35);
      coreGlow.scale.setScalar(4.5 + Math.sin(t * 5) * 0.3 + ignite * 2.5);
      coreGlow.material.opacity = 1 - ignite * 0.45;
      cyanL.intensity = 30 + ignite * 25;

      // parts fly in and snap
      for (const p of parts) {
        const k = clamp01((t - p.t0) / 0.55);
        const e = ease.outBack(k);
        p.obj.position.lerpVectors(p.from, p.to, Math.min(1.05, e));
        p.obj.rotation.set(p.spin.x * (1 - ease.outCubic(k)), p.spin.y * (1 - ease.outCubic(k)), p.spin.z * (1 - ease.outCubic(k)));
        if (k >= 1 && !p.obj.userData.snapped) {
          p.obj.userData.snapped = true;
          shake.set(0.12, 0.12, 0);
          const row = rows[p.idx];
          if (row && !results) (row.querySelector("em") as HTMLElement).textContent = "LOCKED";
          rings[0].scale.setScalar(1.25);
        }
        // ignition: flames grow only if the executor actually mounted something
        if (anyOk) for (const f of p.flames) f instanceof THREE.Sprite ? f.scale.setScalar(ignite * (2.5 + Math.random() * 0.6)) : f.scale.set(1, Math.max(0.001, ignite * (1 + Math.random() * 0.25)), 1);
      }
      rings[0].scale.lerp(new THREE.Vector3(1, 1, 1), 0.12);

      // real execution at the climax
      if (t >= T_APPLY && !applying) void doApply();

      // camera: slow orbit dolly-in, then a hard push on ignition
      const orbit = t * 0.25;
      const dist = 15 - 6 * ease.inOut(clamp01(t / T_APPLY)) - (anyOk ? 4 * ease.outCubic(ignite) : 0);
      camera.position.set(Math.sin(orbit) * dist * 0.45, 2.2 - 1.2 * clamp01(t / T_APPLY) + shake.y * (Math.random() - 0.5), Math.cos(orbit) * dist);
      camera.position.x += shake.x * (Math.random() - 0.5);
      shake.multiplyScalar(0.85);
      camera.fov = 48 + (anyOk ? 16 * ignite : 0);
      camera.updateProjectionMatrix();
      camera.lookAt(0, -0.2, 0);
      orangeL.intensity = anyOk ? ignite * 70 : 0;

      // flash + portal back to the arena
      if (t >= T_IGNITE && t < T_IGNITE + 0.25 && anyOk) flashEl.style.opacity = String(0.7 * (1 - (t - T_IGNITE) / 0.25));
      else flashEl.style.opacity = "0";
      if (t >= T_PORTAL) {
        if (!root.classList.contains("portal")) {
          opts.wakeGame(); // arena resumes behind the portal
          root.classList.add("portal");
        }
        root.style.setProperty("--hole", `${ease.inOut(clamp01((t - T_PORTAL) / 0.6)) * 150}%`);
      }

      renderer.render(scene, camera);

      if (t >= T_END && results) {
        resolve();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }).finally(() => {
    // ---------------- teardown ----------------
    cancelAnimationFrame(raf);
    root.removeEventListener("click", onSkip);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const d of disposables) d.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    root.remove();
    opts.wakeGame();
  });
  return results ?? [];
}
