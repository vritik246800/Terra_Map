/**
 * Camera shortcuts and quick views (PLAN.md Fase 2, DESIGN.md §10 and §14).
 *
 *  - `F`: frames the selected object (bounding box + 20% margin);
 *  - `Home`: returns to the initial isometric view;
 *  - `1` / `2` / `3`: top / front / isometric views.
 *
 * All transitions use animation A21 (GSAP, 400ms, power2.inOut), tweening the
 * camera position and the OrbitControls target. With reduced motion the
 * camera jumps straight to the final state (DESIGN.md §8.3).
 */
import gsap from "gsap";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { prefersReducedMotion } from "../anim/reduced-motion";
import { store } from "../state/store";
import { shouldIgnoreShortcut } from "./shortcuts";

const D = 80;

/** Quick views (DESIGN.md §14). */
const VIEWS = {
  top: new THREE.Vector3(0, D * 1.4, 0.01), // 90° above the center
  front: new THREE.Vector3(0, 6, D * 1.4), // 0° elevation
  iso: new THREE.Vector3(D, D, D), // 45° azimuth / 35.26° elevation
} as const;

const A21_DURATION = 0.4; // seconds — DESIGN.md §8.1 (A21)

export interface CameraControllerDeps {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Resolves an entity id to its scene object (undefined if unknown). */
  getObject(id: string): THREE.Object3D | undefined;
}

/**
 * Wires the camera keyboard shortcuts. Returns a cleanup function that
 * removes the listener.
 */
export function initCameraShortcuts(deps: CameraControllerDeps): () => void {
  const { camera, controls, getObject } = deps;

  /** A21: animated transition of camera position + controls target. */
  function flyTo(pos: THREE.Vector3, target: THREE.Vector3 = new THREE.Vector3()): void {
    gsap.killTweensOf([camera.position, controls.target]);

    if (prefersReducedMotion()) {
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }

    const tween = { duration: A21_DURATION, ease: "power2.inOut" };
    gsap.to(camera.position, { x: pos.x, y: pos.y, z: pos.z, ...tween });
    gsap.to(controls.target, { x: target.x, y: target.y, z: target.z, ...tween });
  }

  /** `F`: frames the selected object — target = bbox center, fit distance + 20% margin. */
  function focusSelected(): void {
    const id = store.selected;
    if (!id) return;
    const object = getObject(id);
    if (!object) return;

    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    // Distance that fits the bounding sphere in the fov, + 20% margin.
    const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
    const distance = Math.max((radius / Math.sin(halfFov)) * 1.2, 1);

    // Keep the current viewing direction, just move closer/farther.
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() === 0) direction.set(1, 1, 1).normalize();

    flyTo(center.clone().addScaledVector(direction, distance), center);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (shouldIgnoreShortcut(e)) return;

    switch (e.key) {
      case "f":
      case "F":
        focusSelected();
        break;
      case "Home":
        flyTo(VIEWS.iso.clone());
        break;
      case "1":
        flyTo(VIEWS.top.clone());
        break;
      case "2":
        flyTo(VIEWS.front.clone());
        break;
      case "3":
        flyTo(VIEWS.iso.clone());
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}

/** Initial camera placement: the isometric view (DESIGN.md §14). */
export function initialCameraPosition(): THREE.Vector3 {
  return VIEWS.iso.clone();
}
