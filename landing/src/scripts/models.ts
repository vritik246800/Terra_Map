// Blender models on the landing (Fase 17, Q_LIST.md Q47): the same .glb files
// the app loads (ui/models/build_models.py copies them to public/models/).
//  - `loadModel` caches the glTF scenes;
//  - `initBuildShowcase` raises the app's building phase by phase as the page
//    scrolls (foundations → storeys → finishing) and turns with the pointer;
//  - `initDevices` spins a network device in each glass card (one shared
//    WebGL renderer drawn into each card's 2D canvas) — hover speeds it up,
//    dragging turns it.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const cache = new Map<string, Promise<THREE.Group>>();
const loader = new GLTFLoader();

export function loadModel(kind: string): Promise<THREE.Group> {
  let p = cache.get(kind);
  if (!p) {
    p = loader.loadAsync(`/models/${kind}.glb`).then((gltf) => gltf.scene);
    cache.set(kind, p);
  }
  return p;
}

/** Deep copy with its own materials (fades and tints never leak between copies). */
export function cloneModel(source: THREE.Object3D): THREE.Object3D {
  const copy = source.clone(true);
  copy.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = (o.material as THREE.Material).clone();
      o.castShadow = o.receiveShadow = true;
    }
  });
  return copy;
}

function lights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x18221d, 1.4));
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.4);
  sun.position.set(-8, 14, 10);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7cf5c4, 1.1);
  rim.position.set(10, 6, -12);
  scene.add(rim);
}

/** Pointer drag → yaw, with a little inertia; returns the current yaw. */
function dragYaw(el: HTMLElement, onActive?: (active: boolean) => void): () => number {
  let yaw = 0;
  let velocity = 0;
  let last: number | null = null;
  el.addEventListener("pointerdown", (e) => {
    last = e.clientX;
    el.setPointerCapture(e.pointerId);
    onActive?.(true);
  });
  el.addEventListener("pointermove", (e) => {
    if (last === null) return;
    velocity = (e.clientX - last) * 0.012;
    yaw += velocity;
    last = e.clientX;
  });
  const end = () => {
    last = null;
    onActive?.(false);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  return () => {
    if (last === null) {
      yaw += velocity;
      velocity *= 0.94;
    }
    return yaw;
  };
}

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface BuildShowcase {
  /** 0 = empty plot, 1 = finished building. */
  setProgress(p: number): void;
}

const FLOORS = 5;

export async function initBuildShowcase(canvas: HTMLCanvasElement | null): Promise<BuildShowcase | null> {
  if (!canvas) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  lights(scene);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 300);
  const pivot = new THREE.Group();
  scene.add(pivot);

  // ground disc + soft contact shadow
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(15, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1d2a24, roughness: 1, transparent: true, opacity: 0.85 }),
  );
  pivot.add(disc);

  const model = await loadModel("building");
  const floorHeight = Number(model.userData.floor_height ?? 2.8);
  /** Parts in build order, each with the progress at which it lands. */
  const parts: Array<{ obj: THREE.Object3D; at: number; baseY: number }> = [];
  const add = (src: THREE.Object3D, level: number, at: number) => {
    const obj = cloneModel(src);
    obj.position.y += level * floorHeight;
    pivot.add(obj);
    parts.push({ obj, at, baseY: obj.position.y });
  };
  for (const part of model.children) {
    const [, phase, role] = /^p(\d)(?:_(floor|top))?/.exec(part.name) ?? [];
    if (phase === undefined) continue;
    if (role === "floor") {
      for (let f = 0; f < FLOORS; f++) add(part, f, phase === "1" ? 0.12 + (f / FLOORS) * 0.5 : 0.66 + (f / FLOORS) * 0.2);
    } else if (role === "top") add(part, FLOORS - 1, 0.9);
    else add(part, 0, phase === "0" ? 0.02 : 0.88);
  }

  let progress = still() ? 1 : 0;
  const yaw = dragYaw(canvas);
  const place = () => {
    for (const { obj, at, baseY } of parts) {
      const t = THREE.MathUtils.clamp((progress - at) / 0.08, 0, 1);
      const e = 1 - (1 - t) ** 3; // ease-out
      obj.visible = t > 0;
      obj.position.y = baseY + (1 - e) * 6;
      obj.scale.setScalar(0.92 + 0.08 * e);
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          m.transparent = e < 1;
          m.opacity = e;
        }
      });
    }
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const clock = new THREE.Clock();
  const frame = () => {
    const t = clock.getElapsedTime();
    pivot.rotation.y = -0.6 + yaw() + (still() ? 0 : t * 0.12);
    const top = 0.4 + FLOORS * floorHeight + 3;
    camera.position.set(0, top * 0.75 + 6, 44);
    camera.lookAt(0, top * 0.42, 0);
    place();
    renderer.render(scene, camera);
  };
  let visible = false;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  renderer.setAnimationLoop(() => {
    if (visible && !document.hidden) frame();
  });
  frame();
  return {
    setProgress(p) {
      if (!still()) progress = p;
    },
  };
}

/** One shared renderer draws every visible device card (2D canvases). */
export async function initDevices(canvases: HTMLCanvasElement[]): Promise<void> {
  if (canvases.length === 0) return;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const cards = await Promise.all(
    canvases.map(async (canvas) => {
      const scene = new THREE.Scene();
      lights(scene);
      const obj = cloneModel(await loadModel(canvas.dataset.model ?? "router"));
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      obj.position.sub(center); // centred on the origin, so it spins in place
      const holder = new THREE.Group();
      holder.add(obj);
      scene.add(holder);
      const radius = size.length() / 2;
      const camera = new THREE.PerspectiveCamera(30, 1, radius / 50, radius * 20);
      // far enough that tall gear (antenna, pole) still fits with the hover lift
      camera.position.set(0, radius * 0.8, radius * 4.4);
      camera.lookAt(0, 0, 0);
      const card = canvas.closest<HTMLElement>(".device") ?? canvas;
      let hover = false;
      card.addEventListener("pointerenter", () => (hover = true));
      card.addEventListener("pointerleave", () => (hover = false));
      const yaw = dragYaw(canvas);
      const state = { canvas, scene, camera, holder, yaw, spin: 0, lift: 0, visible: false, hover: () => hover };
      new IntersectionObserver(([e]) => (state.visible = e.isIntersecting)).observe(canvas);
      return state;
    }),
  );

  const clock = new THREE.Clock();
  const frame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    for (const c of cards) {
      if (!c.visible && !still()) continue;
      const w = c.canvas.clientWidth;
      const h = c.canvas.clientHeight;
      if (w === 0 || h === 0) continue;
      const px = Math.round(w * renderer.getPixelRatio());
      const py = Math.round(h * renderer.getPixelRatio());
      if (c.canvas.width !== px || c.canvas.height !== py) {
        c.canvas.width = px;
        c.canvas.height = py;
      }
      renderer.setSize(w, h, false);
      c.camera.aspect = w / h;
      c.camera.updateProjectionMatrix();
      const target = c.hover() ? 1 : 0;
      c.lift += (target - c.lift) * 0.1;
      if (!still()) c.spin += dt * (0.5 + c.lift * 2.2);
      c.holder.rotation.y = c.spin + c.yaw();
      c.holder.position.y = c.lift * 0.05 * c.camera.position.z;
      renderer.render(c.scene, c.camera);
      const ctx = c.canvas.getContext("2d");
      ctx?.clearRect(0, 0, px, py);
      ctx?.drawImage(renderer.domElement, 0, 0, px, py);
    }
  };
  if (still()) {
    frame();
    return;
  }
  renderer.setAnimationLoop(() => {
    if (!document.hidden) frame();
  });
}
