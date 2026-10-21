/**
 * Presentation mode (Fase 11, UX.md §2, A22): the viewport goes full window,
 * the panels fade out (`body.is-presenting`, CSS) and the camera orbits the
 * maquete. `Esc` or a click ends it and flies the camera back (A21).
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { a21CameraTo, a22Orbit } from "../anim/scene";

export interface PresentationActions {
  start(): void;
  stop(): void;
}

export function createPresentation(deps: {
  camera: THREE.Camera;
  controls: OrbitControls;
}): PresentationActions {
  const { camera, controls } = deps;
  let stopOrbit: (() => void) | null = null;
  let saved: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") stop();
  }

  function stop(): void {
    if (!stopOrbit || !saved) return;
    stopOrbit();
    stopOrbit = null;
    document.body.classList.remove("is-presenting");
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pointerdown", stop, true);
    controls.enabled = true;
    a21CameraTo(camera, controls, saved.position, saved.target);
    saved = null;
  }

  return {
    start() {
      if (stopOrbit) return;
      saved = { position: camera.position.clone(), target: controls.target.clone() };
      document.body.classList.add("is-presenting");
      controls.enabled = false;
      // Orbit the scene center from a 35° elevation at the current distance.
      const distance = camera.position.distanceTo(controls.target);
      const elevation = THREE.MathUtils.degToRad(35);
      camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance);
      camera.lookAt(0, 0, 0);
      stopOrbit = a22Orbit(camera, controls, new THREE.Vector3(0, 0, 0));
      // Capture phase: no tool or shortcut sees the exit key/click.
      window.addEventListener("keydown", onKey, true);
      setTimeout(() => window.addEventListener("pointerdown", stop, true), 0);
    },
    stop,
  };
}
