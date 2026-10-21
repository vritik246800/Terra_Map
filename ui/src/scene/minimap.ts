/**
 * Minimap (Fase 9, UX.md §5): a top-down orthographic view of the whole
 * terrain drawn by its own small WebGLRenderer (no shadows, grid/axes
 * hidden) into a canvas that `components/Viewport.tsx` mounts in the glass
 * overlay. An `--accent` dot marks the orbit target; a click moves the camera
 * there keeping its angle and distance (A21).
 *
 * ponytail: a second WebGL context re-uploads the scene's geometries — fine
 * at maquete scale; render the main renderer into a render target instead if
 * GPU memory ever matters.
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { a21CameraTo } from "../anim/scene";
import type { Terrain } from "./terrain";

/** Height of the minimap camera above the terrain (meters). */
const CAMERA_HEIGHT = 1000;

export interface Minimap {
  /** Canvas + target dot, mounted by `components/Viewport.tsx`. */
  host: HTMLElement;
  /** Draws a frame (the viewport loop calls it every few frames). */
  render(): void;
}

export interface MinimapDeps {
  scene: THREE.Scene;
  terrain: Terrain;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Hidden while the minimap renders (grid, axes). */
  helpers: THREE.Object3D[];
}

export function createMinimap(deps: MinimapDeps): Minimap {
  const { scene, terrain, camera, controls, helpers } = deps;

  const host = document.createElement("div");
  host.className = "minimap-map";
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const dot = document.createElement("span");
  dot.className = "minimap-target";
  host.appendChild(dot);

  // North (−Z) up: the camera looks straight down with +Y as "up" → −Z.
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_HEIGHT * 2);
  ortho.position.set(0, CAMERA_HEIGHT, 0);
  ortho.up.set(0, 0, -1);
  ortho.lookAt(0, 0, 0);

  new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) renderer.setSize(width, height, false);
  }).observe(host);

  /** Canvas fraction (0–1, origin top-left) ↔ world x/z of the terrain square. */
  function toWorld(u: number, v: number): { x: number; z: number } {
    const size = terrain.current.size;
    return { x: (u - 0.5) * size, z: (v - 0.5) * size };
  }

  renderer.domElement.addEventListener("click", (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const { x, z } = toWorld(
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    );
    const target = new THREE.Vector3(x, terrain.getHeight(x, z), z);
    const offset = camera.position.clone().sub(controls.target);
    a21CameraTo(camera, controls, target.clone().add(offset), target);
  });

  return {
    host,
    render() {
      const half = terrain.current.size / 2;
      ortho.left = -half;
      ortho.right = half;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.updateProjectionMatrix();

      const visible = helpers.map((h) => h.visible);
      for (const h of helpers) h.visible = false;
      const fog = scene.fog; // Fase 11: from 1000 m up the fog would hide everything
      scene.fog = null;
      renderer.render(scene, ortho);
      scene.fog = fog;
      helpers.forEach((h, i) => (h.visible = visible[i]));

      const t = controls.target;
      dot.style.left = `${(t.x / (2 * half) + 0.5) * 100}%`;
      dot.style.top = `${(t.z / (2 * half) + 0.5) * 100}%`;
    },
  };
}
