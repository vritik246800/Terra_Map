/**
 * Camera shortcuts and quick views (PLAN.md Fase 2, DESIGN.md §10 and §14).
 *
 *  - `F`: frames the selected object (bounding box + 20% margin);
 *  - `Home`: returns to the initial isometric view;
 *  - `1` / `2` / `3`: top / front / isometric views;
 *  - Fase 13 (UX.md §2, Q_LIST.md Q25): `N` / `Shift+N` steps through the
 *    elements (selects it in `select` mode, frames it with A21 in any tool);
 *    the canvas host is focusable (`Tab`) and shows a crosshair — arrows pan,
 *    `Shift`+arrows orbit, `+`/`−` zoom and `Space` "clicks" the crosshair,
 *    so every tool works from the keyboard.
 *  - Fase 16 (UX.md §4, Q_LIST.md Q38): `H` switches the left mouse button
 *    between rotating and moving (pan) the camera — `cameraMouseButtons`;
 *    the remap itself is applied by `tools/brush.ts`, which owns the buttons.
 *
 * All transitions use animation A21 (GSAP, 400ms, power2.inOut), tweening the
 * camera position and the OrbitControls target. With reduced motion the
 * camera jumps straight to the final state (DESIGN.md §8.3).
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { a21CameraTo, a21Stop } from "../anim/scene";
import { t } from "../state/i18n";
import { store, type CameraMode } from "../state/store";
import { shouldIgnoreShortcut } from "./shortcuts";

const D = 80;
/** Keyboard camera steps (Fase 13): pan = 6% of the distance, orbit 10°/6°, zoom ×0.85. */
const PAN_STEP = 0.06;
const ORBIT_STEP = THREE.MathUtils.degToRad(10);
const TILT_STEP = THREE.MathUtils.degToRad(6);
const ZOOM_STEP = 0.85;

/** Quick views (DESIGN.md §14). */
const VIEWS = {
  top: new THREE.Vector3(0, D * 1.4, 0.01), // 90° above the center
  front: new THREE.Vector3(0, 6, D * 1.4), // 0° elevation
  iso: new THREE.Vector3(D, D, D), // 45° azimuth / 35.26° elevation
} as const;

/** OrbitControls buttons per camera mode: the left one rotates or pans, the right does the other. */
export function cameraMouseButtons(mode: CameraMode): OrbitControls["mouseButtons"] {
  const pan = mode === "pan";
  return {
    LEFT: pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: pan ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
  };
}

export interface CameraControllerDeps {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Resolves an entity id to its scene object (undefined if unknown). */
  getObject(id: string): THREE.Object3D | undefined;
  /** Fase 13: focusable viewport host (crosshair) and the canvas the tools listen on. */
  host: HTMLElement;
  canvas: HTMLCanvasElement;
}

/**
 * Wires the camera keyboard shortcuts. Returns a cleanup function that
 * removes the listener.
 */
export function initCameraShortcuts(deps: CameraControllerDeps): () => void {
  const { camera, controls, getObject, host, canvas } = deps;
  /** Element last reached with `N` outside `select` mode (no selection there). */
  let navigated: string | null = null;

  /** A21: animated transition of camera position + controls target. */
  function flyTo(pos: THREE.Vector3, target: THREE.Vector3 = new THREE.Vector3()): void {
    a21CameraTo(camera, controls, pos, target);
  }

  /** `F` / `N`: frames an object — target = bbox center, fit distance + 20% margin. */
  function focusOn(id: string | null): void {
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

  /** `N` / `Shift+N`: next/previous element (creation order, pickable layers only). */
  function step(direction: 1 | -1): void {
    const ids = store
      .networkGraph()
      .nodes.map((n) => n.id)
      .filter((id) => store.isPickable(id));
    if (ids.length === 0) return;
    const selecting = store.tool === "select";
    const current = ids.indexOf((selecting ? store.selected : navigated) ?? "");
    const next = ids[(current + direction + ids.length) % ids.length];
    navigated = next;
    if (selecting) store.select(next);
    focusOn(next);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (shouldIgnoreShortcut(e)) return;

    switch (e.key) {
      case "f":
      case "F":
        focusOn(store.selected);
        break;
      case "n":
      case "N":
        step(e.shiftKey ? -1 : 1);
        break;
      case "h":
      case "H":
        store.setCameraMode(store.cameraMode === "pan" ? "orbit" : "pan");
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

  // ---- Fase 13: keyboard camera + crosshair click on the focused viewport ----

  host.tabIndex = 0;
  host.setAttribute("role", "application");
  host.setAttribute("aria-label", t("viewport.canvas"));
  host.addEventListener("focus", () => host.setAttribute("aria-label", t("viewport.canvas")));

  /** Moves camera + target together, along the ground, relative to the view. */
  function pan(right: number, forward: number): void {
    a21Stop(camera, controls);
    const offset = camera.position.clone().sub(controls.target);
    const ahead = offset.clone().negate().setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(ahead, camera.up).normalize();
    const delta = side
      .multiplyScalar(right)
      .addScaledVector(ahead, forward)
      .multiplyScalar(offset.length() * PAN_STEP);
    camera.position.add(delta);
    controls.target.add(delta);
  }

  /** Orbits around the target (azimuth / elevation), within the orbit limits. */
  function orbit(azimuth: number, tilt: number): void {
    a21Stop(camera, controls);
    const spherical = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(controls.target),
    );
    spherical.theta -= azimuth * ORBIT_STEP;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi - tilt * TILT_STEP,
      0.05,
      controls.maxPolarAngle,
    );
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
  }

  function zoom(factor: number): void {
    a21Stop(camera, controls);
    const offset = camera.position.clone().sub(controls.target);
    const length = THREE.MathUtils.clamp(
      offset.length() * factor,
      controls.minDistance,
      controls.maxDistance,
    );
    camera.position.copy(controls.target).add(offset.setLength(length));
  }

  /**
   * `Space`: the same pointerdown/up a mouse click at the crosshair makes, so
   * every tool (selection, cable, marker, ruler, road, brushes) answers it.
   * The orbit controls sit it out (they would capture the synthetic pointer).
   */
  function clickCrosshair(): void {
    const rect = canvas.getBoundingClientRect();
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };
    const enabled = controls.enabled;
    controls.enabled = false;
    // A synthetic pointer has nothing to capture; some engines throw when a
    // listener (TransformControls) asks to capture it. Shadow both methods
    // with no-ops on the instance for this dispatch only.
    canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
    try {
      canvas.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    } finally {
      Reflect.deleteProperty(canvas, "setPointerCapture"); // back to the prototype's
      Reflect.deleteProperty(canvas, "releasePointerCapture");
      controls.enabled = enabled;
    }
  }

  const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };

  host.addEventListener("keydown", (e) => {
    if (e.target !== host || e.ctrlKey || e.metaKey || e.altKey) return;
    const arrow = ARROWS[e.key];
    if (arrow) {
      if (e.shiftKey) orbit(arrow[0], arrow[1]);
      else pan(arrow[0], arrow[1]);
    } else if (e.key === "+" || e.key === "=") zoom(ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoom(1 / ZOOM_STEP);
    else if (e.key === " ") clickCrosshair();
    else return;
    e.preventDefault();
  });

  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}

/** Initial camera placement: the isometric view (DESIGN.md §14). */
export function initialCameraPosition(): THREE.Vector3 {
  return VIEWS.iso.clone();
}
