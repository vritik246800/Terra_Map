/**
 * Raycast selection (PLAN.md Fase 2, DESIGN.md §6 and §12 tool `select`).
 *
 *  - Click on an object selects it; click on empty space or `Esc` clears;
 *  - a camera drag (orbit/pan) never counts as a click — the pointerdown/
 *    pointerup distance must stay under a small threshold;
 *  - a plain click on a gizmo handle (`isGizmoBusy`) never counts as a click
 *    on empty space — it would otherwise clear the selection;
 *  - the selected object gets highlight A6 (Anime.js): a pulsing ring under
 *    it, created and removed with the selection. With reduced motion the
 *    ring is static (DESIGN.md §8.3). Cables (Fase 6) are the exception: they
 *    are pickable via `extraPickables` but get an emissive highlight from the
 *    CableRegistry instead of the ring.
 */
import anime from "animejs";
import * as THREE from "three";

import { prefersReducedMotion } from "../anim/reduced-motion";
import { store } from "../state/store";
import { shouldIgnoreShortcut } from "./shortcuts";

/** Max pointer travel (px) between down/up for the gesture to count as a click. */
const CLICK_THRESHOLD_PX = 4;

const RING_COLOR = 0x0071e3; // --accent (DESIGN.md §7.1)

export interface SelectionDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  pickables: THREE.Object3D[];
  /** Live array of cable meshes (Fase 6) — raycast along with the entities. */
  extraPickables?: THREE.Object3D[];
  /** True while a gizmo handle is pressed — plain clicks on it must not deselect. */
  isGizmoBusy?: () => boolean;
}

/** Walks up the hierarchy looking for the entity id of a picked object. */
function findEntityId(object: THREE.Object3D): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const id = current.userData.entityId;
    if (typeof id === "string") return id;
    current = current.parent;
  }
  return null;
}

/** Builds the flat accent ring placed under the selected object (A6). */
function createRing(object: THREE.Object3D): THREE.Mesh {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;

  const inner = radius * 1.15;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(inner, inner + Math.max(radius * 0.12, 0.15), 48),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.name = "selection-ring";
  ring.rotation.x = -Math.PI / 2; // flat on the ground plane
  ring.position.set(center.x, box.min.y + 0.02, center.z); // under the object
  return ring;
}

/**
 * Wires pointer selection on the canvas and the selection highlight.
 * Returns a cleanup function that removes listeners and the ring.
 */
export function initSelection(deps: SelectionDeps): () => void {
  const { canvas, camera, scene, pickables, extraPickables } = deps;
  const raycaster = new THREE.Raycaster();

  let ring: THREE.Mesh | null = null;
  let downX = 0;
  let downY = 0;

  function removeRing(): void {
    if (!ring) return;
    anime.remove(ring.scale);
    scene.remove(ring);
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
    ring = null;
  }

  /** A6: creates the pulsing ring under the newly selected object. */
  function showRing(): void {
    removeRing();
    const id = store.selected;
    if (!id) return;
    // Cables get an emissive highlight from the CableRegistry, not the ring.
    if (store.getCableInfo(id)) return;
    const object = pickables.find((o) => findEntityId(o) === id);
    if (!object) return;

    ring = createRing(object);
    scene.add(ring);

    if (prefersReducedMotion()) return;

    // Entrance pop, then a subtle continuous pulse.
    ring.scale.setScalar(1.3);
    anime({
      targets: ring.scale,
      x: 1,
      y: 1,
      duration: 300,
      easing: "easeOutQuad",
      complete: () => {
        if (!ring) return;
        anime({
          targets: ring.scale,
          x: 1.06,
          y: 1.06,
          duration: 700,
          easing: "easeInOutSine",
          direction: "alternate",
          loop: true,
        });
      },
    });
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;
    // Selection only happens with the `select` tool (DESIGN.md §12).
    if (store.tool !== "select") return;
    // A press on a gizmo handle is not a click on empty space.
    if (deps.isGizmoBusy?.()) return;
    // A camera drag (orbit/pan) is not a click.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX) return;

    const rect = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(p, camera);
    const targets = extraPickables ? [...pickables, ...extraPickables] : pickables;
    const hit = raycaster.intersectObjects(targets, true)[0];
    store.select(hit ? findEntityId(hit.object) : null); // null = empty space
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && !shouldIgnoreShortcut(e)) store.select(null);
  }

  const unsubscribe = store.subscribeSelection(showRing);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeydown);

  return () => {
    unsubscribe();
    removeRing();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeydown);
  };
}
