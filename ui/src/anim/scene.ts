/**
 * 3D animations of the DESIGN.md §2.1 catalog (centralized in Fase 9 —
 * STYLE_GUIDE.md §4), with the library the catalog names:
 *
 *  - A4 (GSAP): drag ghost fades in/out (200ms `power2.out`);
 *  - A5 (Anime.js): dropped entity settles with a scale bounce (350ms
 *    `easeOutElastic(1,.7)`);
 *  - A6 (Anime.js): selection ring pops in (300ms `easeOutQuad`) and pulses;
 *  - A12 (Anime.js): the optimal path "draws itself" (draw range grows along
 *    the tube, 900ms `easeInOutQuad`) and then pulses its opacity;
 *  - A13 (Anime.js): a marker pin falls from the "sky" (400ms `easeOutBounce`);
 *  - A14 (Anime.js): the coverage heatmap expands from the antenna (600ms);
 *  - A16 (GSAP): undo/redo flashes the affected objects (150ms `power1.out`);
 *  - A17 (Anime.js): a layer shown again fades + scales 0.98 → 1 (300ms);
 *  - A18 (GSAP): the hour of the day tweens; light, sky and fog follow (800ms);
 *  - A19 (Anime.js): the ruler line draws to the 2nd point while its label
 *    counts from 0 to the distance (400ms `easeOutQuad`);
 *  - A22 (GSAP): presentation flight around the maquete (24 s per turn);
 *  - A21 (GSAP): camera position + orbit target tween (400ms `power2.inOut`).
 *
 * With `prefers-reduced-motion` each keeps only the final state (§2.3).
 */
import anime from "animejs";
import gsap from "gsap";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { prefersReducedMotion } from "./reduced-motion";

const A4_DURATION = 0.2;
const A5_DURATION = 350;
const A6_IN_DURATION = 300;
const A6_PULSE_DURATION = 700;
const A12_DURATION = 900;
const A13_DURATION = 400;
const A13_DROP_HEIGHT = 12;
const A21_DURATION = 0.4;
const A16_DURATION = 0.15;
const A18_DURATION = 0.8;
const A22_TURN = 24;
const A17_DURATION = 300;
const A19_DURATION = 400;
/** --accent at ~40% as an emissive flash (A16). */
const A16_COLOR = new THREE.Color(0x0071e3).multiplyScalar(0.4);
const A14_DURATION = 600;
const PULSE_OPACITY: [number, number] = [0.9, 0.55];

/** A12 on a path tube; returns a stop function (call before disposing). */
export function a12DrawPath(mesh: THREE.Mesh): () => void {
  const geometry = mesh.geometry;
  const material = mesh.material as THREE.Material;
  const total = geometry.index?.count ?? geometry.getAttribute("position").count;
  if (prefersReducedMotion()) {
    geometry.setDrawRange(0, total);
    material.opacity = PULSE_OPACITY[0];
    return () => {};
  }

  const progress = { t: 0 };
  geometry.setDrawRange(0, 0);
  anime({
    targets: progress,
    t: 1,
    duration: A12_DURATION,
    easing: "easeInOutQuad",
    // Whole triangles only (3 indices each).
    update: () => geometry.setDrawRange(0, Math.floor((progress.t * total) / 3) * 3),
    complete: () => {
      anime({
        targets: material,
        opacity: PULSE_OPACITY,
        duration: A12_DURATION,
        easing: "easeInOutQuad",
        direction: "alternate",
        loop: true,
      });
    },
  });
  return () => anime.remove([progress, material]);
}

/** A14: scales the coverage group in X/Z from the antenna center. */
export function a14Expand(group: THREE.Object3D): void {
  if (prefersReducedMotion()) {
    group.scale.set(1, 1, 1);
    return;
  }
  group.scale.set(0.001, 1, 0.001);
  anime({ targets: group.scale, x: 1, z: 1, duration: A14_DURATION, easing: "easeOutQuad" });
}

/** A4 in: the drag ghost fades up to `opacity`. */
export function a4GhostIn(materials: THREE.Material[], opacity: number): void {
  if (prefersReducedMotion()) {
    for (const m of materials) m.opacity = opacity;
    return;
  }
  gsap.to(materials, { opacity, duration: A4_DURATION, ease: "power2.out" });
}

/** A4 out: the ghost fades away, then `done` disposes it (immediately when asked). */
export function a4GhostOut(materials: THREE.Material[], done: () => void, immediate = false): void {
  gsap.killTweensOf(materials);
  if (immediate || prefersReducedMotion()) {
    done();
    return;
  }
  gsap.to(materials, { opacity: 0, duration: A4_DURATION, ease: "power2.out", onComplete: done });
}

/** A5: the dropped entity "settles" with a subtle scale bounce. */
export function a5DropBounce(content: THREE.Object3D): void {
  if (prefersReducedMotion()) return;
  content.scale.setScalar(1.15);
  anime({
    targets: content.scale,
    x: 1,
    y: 1,
    z: 1,
    duration: A5_DURATION,
    easing: "easeOutElastic(1, .7)",
  });
}

/** A6: entrance pop of the selection ring, then a subtle continuous pulse. */
export function a6RingIn(ring: THREE.Object3D): void {
  if (prefersReducedMotion()) return;
  ring.scale.setScalar(1.3);
  anime({
    targets: ring.scale,
    x: 1,
    y: 1,
    duration: A6_IN_DURATION,
    easing: "easeOutQuad",
    complete: () => {
      if (!ring.parent) return; // removed meanwhile
      anime({
        targets: ring.scale,
        x: 1.06,
        y: 1.06,
        duration: A6_PULSE_DURATION,
        easing: "easeInOutSine",
        direction: "alternate",
        loop: true,
      });
    },
  });
}

/** Stops A6 before the ring is disposed. */
export function a6RingStop(ring: THREE.Object3D): void {
  anime.remove(ring.scale);
}

/** A13: the pin drops from the "sky" and settles with a bounce. */
export function a13PinDrop(content: THREE.Object3D): void {
  if (prefersReducedMotion()) return;
  content.position.y = A13_DROP_HEIGHT;
  anime({ targets: content.position, y: 0, duration: A13_DURATION, easing: "easeOutBounce" });
}

/** A21: camera position + orbit target transition (views, focus, minimap). */
export function a21CameraTo(
  camera: THREE.Camera,
  controls: OrbitControls,
  position: THREE.Vector3,
  target: THREE.Vector3,
): void {
  gsap.killTweensOf([camera.position, controls.target]);
  if (prefersReducedMotion()) {
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
    return;
  }
  const tween = { duration: A21_DURATION, ease: "power2.inOut" };
  gsap.to(camera.position, { x: position.x, y: position.y, z: position.z, ...tween });
  gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, ...tween });
}

/** Stops a running A21 (keyboard camera moves take over — Fase 13). */
export function a21Stop(camera: THREE.Camera, controls: OrbitControls): void {
  gsap.killTweensOf([camera.position, controls.target]);
}

/** Standard materials of an object tree (flash/fade targets). */
function standardMaterials(objects: THREE.Object3D[]): THREE.MeshStandardMaterial[] {
  const found = new Set<THREE.MeshStandardMaterial>();
  for (const root of objects) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m instanceof THREE.MeshStandardMaterial) found.add(m);
      }
    });
  }
  return [...found];
}

/** A16: subtle emissive flash on the objects an undo/redo touched. */
export function a16Flash(objects: THREE.Object3D[]): void {
  if (prefersReducedMotion()) return;
  for (const m of standardMaterials(objects)) {
    const base = m.emissive.clone();
    gsap.killTweensOf(m.emissive);
    gsap.fromTo(
      m.emissive,
      { r: A16_COLOR.r, g: A16_COLOR.g, b: A16_COLOR.b },
      { r: base.r, g: base.g, b: base.b, duration: A16_DURATION, ease: "power1.out" },
    );
  }
}

/** A17: objects of a layer shown again fade in and scale 0.98 → 1. */
export function a17LayerIn(objects: THREE.Object3D[]): void {
  if (prefersReducedMotion() || objects.length === 0) return;
  for (const o of objects) o.scale.multiplyScalar(0.98);
  anime({
    targets: objects.map((o) => o.scale),
    x: (_t: unknown, i: number) => objects[i].scale.x / 0.98,
    y: (_t: unknown, i: number) => objects[i].scale.y / 0.98,
    z: (_t: unknown, i: number) => objects[i].scale.z / 0.98,
    duration: A17_DURATION,
    easing: "easeOutQuad",
  });
  for (const m of standardMaterials(objects)) {
    const { opacity, transparent } = m;
    m.transparent = true;
    m.opacity = 0;
    anime({
      targets: m,
      opacity,
      duration: A17_DURATION,
      easing: "easeOutQuad",
      complete: () => {
        m.transparent = transparent;
      },
    });
  }
}

/** A18: tweens `proxy.hour` to `target`; `onUpdate` re-lights the scene each frame. */
export function a18HourTo(proxy: { hour: number }, target: number, onUpdate: () => void): void {
  gsap.killTweensOf(proxy);
  if (prefersReducedMotion()) {
    proxy.hour = target;
    onUpdate();
    return;
  }
  gsap.to(proxy, { hour: target, duration: A18_DURATION, ease: "power1.inOut", onUpdate });
}

/** A19: drives `update(t)` from 0 to 1 (the caller draws line + label). Returns a stop function. */
export function a19Measure(update: (t: number) => void): () => void {
  if (prefersReducedMotion()) {
    update(1);
    return () => {};
  }
  const state = { t: 0 };
  update(0);
  anime({
    targets: state,
    t: 1,
    duration: A19_DURATION,
    easing: "easeOutQuad",
    update: () => update(state.t),
  });
  return () => anime.remove(state);
}

/**
 * A22: endless orbit of the camera around `center` (radius/height kept from
 * the start position). Returns a stop function. Reduced motion: no orbit.
 */
export function a22Orbit(
  camera: THREE.Camera,
  controls: OrbitControls,
  center: THREE.Vector3,
): () => void {
  if (prefersReducedMotion()) return () => {};
  const offset = camera.position.clone().sub(center);
  const radius = Math.hypot(offset.x, offset.z);
  const height = offset.y;
  const state = { angle: Math.atan2(offset.z, offset.x) };
  const tween = gsap.to(state, {
    angle: state.angle + Math.PI * 2,
    duration: A22_TURN,
    ease: "none",
    repeat: -1,
    onUpdate: () => {
      camera.position.set(
        center.x + Math.cos(state.angle) * radius,
        center.y + height,
        center.z + Math.sin(state.angle) * radius,
      );
      controls.target.copy(center);
    },
  });
  return () => tween.kill();
}
