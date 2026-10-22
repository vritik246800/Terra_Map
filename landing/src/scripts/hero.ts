// Hero scene (Fase 15): a low-poly terrain with a village, an FTTH network and
// an antenna on the ridge. Every cable carries light pulses; the optimal route
// (antenna → OLT → splitter → home) glows green, like the simulator's path.
// Fase 17 (Q_LIST.md Q47): the village, trees, poles and the antenna are the
// app's Blender models (public/models/*.glb), loaded after the first frame.
import * as THREE from "three";

import { cloneModel, loadModel } from "./models";

const SIZE = 240;
const SEG = 120;

// Value noise + fBm (same family as the app's procedural terrain).
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < 5; i++) {
    sum += vnoise(x * f, y * f, seed + i) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}
const gauss = (dx: number, dz: number, r: number) => Math.exp(-(dx * dx + dz * dz) / (2 * r * r));

function height(x: number, z: number): number {
  const village = gauss(x - 6, z - 22, 30);
  const ridge =
    40 * gauss(x + 38, z + 72, 30) +
    30 * gauss(x - 46, z + 84, 28) +
    20 * gauss(x - 96, z + 30, 22) +
    18 * gauss(x + 98, z + 4, 24);
  const rough = 7 * fbm(x / 34 + 9, z / 34 + 3, 3) * (1 - 0.85 * village);
  const lake = -10 * gauss(x + 52, z - 34, 15);
  return ridge + rough + lake + 1.2;
}

// Altitude colours (DESIGN.md §1.5, stretched to this relief).
const STOPS: [number, THREE.Color][] = [
  [-2, new THREE.Color("#6b8f4f")],
  [3, new THREE.Color("#7da05c")],
  [9, new THREE.Color("#8a6f4d")],
  [20, new THREE.Color("#8d8d93")],
  [34, new THREE.Color("#f4f6f8")],
];
function colorAt(h: number, out: THREE.Color): THREE.Color {
  if (h <= STOPS[0][0]) return out.copy(STOPS[0][1]);
  for (let i = 1; i < STOPS.length; i++) {
    const [h1, c1] = STOPS[i];
    if (h <= h1) {
      const [h0, c0] = STOPS[i - 1];
      return out.copy(c0).lerp(c1, (h - h0) / (h1 - h0));
    }
  }
  return out.copy(STOPS[STOPS.length - 1][1]);
}

const PULSE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const PULSE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSpeed;
  uniform float uPhase;
  uniform vec3 uColor;
  uniform float uBase;
  varying vec2 vUv;
  void main() {
    float head = fract(uTime * uSpeed + uPhase);
    float d = vUv.x - head;
    float trail = smoothstep(-0.28, 0.0, d) * (1.0 - smoothstep(0.0, 0.02, d));
    gl_FragColor = vec4(uColor * (uBase + trail * 1.8), uBase + trail);
  }`;

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export interface Hero {
  /** 0 = oblique view, 1 = top-down map view (driven by the page scroll). */
  setProgress(p: number): void;
}

export function initHero(canvas: HTMLCanvasElement | null): Hero | null {
  if (!canvas) return null;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    canvas.closest(".hero")?.classList.add("no-webgl");
    return null;
  }
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x08141a, 130, 330);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 900);
  scene.add(new THREE.HemisphereLight(0x9fd7ff, 0x0b1418, 1.1));
  const sun = new THREE.DirectionalLight(0xffd2a1, 2.6);
  sun.position.set(-120, 90, -60);
  scene.add(sun);

  // terrain (vertex colours, flat shading = low-poly) + survey wireframe
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const h = height(posAttr.getX(i), posAttr.getZ(i));
    posAttr.setY(i, h);
    colorAt(h, tmp).toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })));
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x9be7d4, wireframe: true, transparent: true, opacity: 0.05, depthWrite: false }));
  wire.position.y = 0.05;
  scene.add(wire);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2a8fc4, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.2 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  scene.add(water);

  // village: the app's Blender houses/buildings, trees around it (Fase 17)
  const HOMES: [number, number][] = [
    [-14, 26], [-2, 36], [12, 28], [24, 38], [-24, 40], [30, 22], [6, 46], [-10, 50], [20, 52],
  ];
  const TOWERS: [number, number][] = [[-30, 12], [36, 40]];
  const rnd = (() => {
    let seed = 7;
    return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  })();
  const placeModels = async () => {
    const [house, building, tree, bush, pole] = await Promise.all(
      ["house", "building", "tree", "bush", "pole"].map(loadModel),
    );
    const put = (src: THREE.Object3D, x: number, z: number, scale: number, yaw: number) => {
      const o = cloneModel(src);
      o.position.set(x, height(x, z) - 0.15, z);
      o.scale.setScalar(scale);
      o.rotation.y = yaw;
      scene.add(o);
    };
    HOMES.forEach(([x, z], i) => put(house, x, z, 0.7, Math.atan2(4 - x, 18 - z) + (i % 2) * 0.2));
    TOWERS.forEach(([x, z]) => put(building, x, z, 0.6, Math.atan2(-x, -z)));
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 34 + rnd() * 70;
      const x = 6 + Math.cos(a) * r;
      const z = 22 + Math.sin(a) * r;
      if (height(x, z) < 0.4 || height(x, z) > 24) continue; // no trees in the lake or on the peaks
      put(i % 4 ? tree : bush, x, z, 0.75 + rnd() * 0.5, rnd() * 6.28);
    }
    // poles carry the aerial stretch from the ridge down to the OLT
    for (let t = 0.2; t < 1; t += 0.2) {
      const p = mastTop.clone().lerp(olt, t);
      put(pole, p.x, p.z, 1, Math.atan2(olt.x - mastTop.x, olt.z - mastTop.z));
    }
  };

  // network: OLT, splitter, ONUs by the homes, antenna mast on the ridge
  const at = (x: number, z: number, lift = 0.7) => new THREE.Vector3(x, height(x, z) + lift, z);
  const olt = at(-26, 10, 1.4);
  const splitter = at(4, 18);
  const onus = HOMES.slice(0, 6).map(([x, z]) => at(x + (4 - x) * 0.2, z + (18 - z) * 0.2));
  const mastBase = at(-38, -70, 0);
  const mastTop = mastBase.clone().add(new THREE.Vector3(0, 9, 0));
  // the app's antenna (7.1 m) scaled to the 9 m mast of the route
  void loadModel("antenna").then((antenna) => {
    const o = cloneModel(antenna);
    o.position.copy(mastBase);
    o.scale.setScalar(9 / 7.1);
    scene.add(o);
    if (still) frame();
  });
  void placeModels().then(() => still && frame());

  const ground = (a: THREE.Vector3, b: THREE.Vector3, n = 24) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return at(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.6);
    });
  const aerial = (a: THREE.Vector3, b: THREE.Vector3, n = 24) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return a.clone().lerp(b, t).add(new THREE.Vector3(0, -6 * Math.sin(Math.PI * t), 0));
    });

  const materials: THREE.ShaderMaterial[] = [];
  const cable = (points: THREE.Vector3[], color: number, radius: number, speed: number, base: number) => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
      uniforms: { uTime: { value: 0 }, uSpeed: { value: speed }, uPhase: { value: Math.random() }, uColor: { value: new THREE.Color(color) }, uBase: { value: base } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    materials.push(mat);
    const curve = new THREE.CatmullRomCurve3(points);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 4, radius, 6), mat));
  };
  onus.forEach((onu, i) => i !== 2 && cable(ground(splitter, onu, 10), 0x30d5c8, 0.18, 0.35, 0.35));
  // the optimal route: one tube so the pulse runs the whole way
  cable([...aerial(mastTop, olt), ...ground(olt, splitter).slice(1), ...ground(splitter, onus[2], 10).slice(1)], 0x34c759, 0.36, 0.16, 0.5);

  const glow = glowTexture();
  const sprites: { s: THREE.Sprite; size: number; phase: number }[] = [];
  const node = (p: THREE.Vector3, color: number, size: number) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.copy(p);
    s.scale.setScalar(size);
    scene.add(s);
    sprites.push({ s, size, phase: Math.random() * Math.PI * 2 });
  };
  [mastTop, olt, splitter].forEach((p) => node(p, 0x7cf5c4, 7));
  onus.forEach((p, i) => node(p, i === 2 ? 0x7cf5c4 : 0x6fe3ff, i === 2 ? 6 : 3.6));

  // camera: slow sway + pointer parallax; scroll tilts it to a map view
  let progress = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!still)
    addEventListener("pointermove", (e) => {
      pointer.tx = e.clientX / innerWidth - 0.5;
      pointer.ty = e.clientY / innerHeight - 0.5;
    });
  const target = new THREE.Vector3(0, 6, 4);
  const place = (t: number) => {
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const azimuth = Math.sin(t * 0.07) * 0.22 + pointer.x * 0.25;
    const polar = THREE.MathUtils.lerp(1.02 + pointer.y * 0.08, 0.12, progress);
    const radius = THREE.MathUtils.lerp(132, 170, progress);
    camera.position.set(
      target.x + radius * Math.sin(polar) * Math.sin(azimuth),
      target.y + radius * Math.cos(polar),
      target.z + radius * Math.sin(polar) * Math.cos(azimuth),
    );
    camera.lookAt(target);
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
    for (const mat of materials) mat.uniforms.uTime.value = t;
    for (const { s, size, phase } of sprites) s.scale.setScalar(size * (0.85 + 0.15 * Math.sin(t * 2.4 + phase)));
    place(t);
    renderer.render(scene, camera);
  };
  if (still) {
    for (const mat of materials) mat.uniforms.uTime.value = 2.4; // a pulse mid-way
    place(0);
    renderer.render(scene, camera);
    return { setProgress: () => {} };
  }

  // render only while the hero is on screen and the tab is visible
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  renderer.setAnimationLoop(() => {
    if (visible && !document.hidden) frame();
  });
  return {
    setProgress(p) {
      progress = p;
    },
  };
}
