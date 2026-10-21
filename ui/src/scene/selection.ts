/**
 * Raycast selection (PLAN.md Fase 2, DESIGN.md §6 and §12 tool `select`).
 *
 *  - Click on an object selects it; click on empty space or `Esc` clears;
 *  - a camera drag (orbit/pan) never counts as a click — the pointerdown/
 *    pointerup distance must stay under a small threshold;
 *  - a plain click on a gizmo handle (`isGizmoBusy`) never counts as a click
 *    on empty space — it would otherwise clear the selection;
 *  - every selected object gets highlight A6: a pulsing ring under it that
 *    follows the object when it moves. Cables (Fase 6) are the exception:
 *    they are pickable via `extraPickables` but get an emissive highlight
 *    from the CableRegistry instead of the ring;
 *  - Fase 10: `Shift`+click toggles an object in the selection; `Shift`+drag
 *    on empty space draws a marquee and adds every entity whose center falls
 *    inside (the orbit controls are off during the gesture); objects of
 *    hidden or locked layers are never picked (`store.isPickable`).
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { a6RingIn, a6RingStop } from "../anim/scene";
import { store } from "../state/store";
import { shouldIgnoreShortcut } from "./shortcuts";

/** Max depth (m) an element hit may sit behind a cable hit and still win. */
const ENDPOINT_SLACK_M = 0.5;
/** Max pointer travel (px) between down/up for the gesture to count as a click. */
const CLICK_THRESHOLD_PX = 4;

const RING_COLOR = 0x0071e3; // --accent (DESIGN.md §7.1)

export interface SelectionDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  pickables: THREE.Object3D[];
  /** Live arrays of cable (Fase 6) and road (Fase 11) meshes — raycast along with the entities. */
  extraPickables?: THREE.Object3D[][];
  /** True while a gizmo handle is pressed — plain clicks on it must not deselect. */
  isGizmoBusy?: () => boolean;
  /** Disabled while a marquee is drawn (Fase 10). */
  controls: OrbitControls;
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

/** Puts a ring under its object (creation and when the object moves). */
function placeRing(ring: THREE.Object3D, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  ring.position.set(center.x, box.min.y + 0.02, center.z);
}

/** Builds the flat accent ring placed under the selected object (A6). */
function createRing(object: THREE.Object3D): THREE.Mesh {
  const box = new THREE.Box3().setFromObject(object);
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
  placeRing(ring, object);
  return ring;
}

/**
 * Wires pointer selection on the canvas and the selection highlight.
 * Returns a cleanup function that removes listeners and the rings.
 */
export function initSelection(deps: SelectionDeps): () => void {
  const { canvas, camera, scene, pickables, extraPickables, controls } = deps;
  const raycaster = new THREE.Raycaster();

  const rings = new Map<string, THREE.Mesh>();
  let downX = 0;
  let downY = 0;
  /** Marquee being drawn (Fase 10): start point + overlay element. */
  let marquee: { x: number; y: number; el: HTMLDivElement } | null = null;

  const objectOf = (id: string) => pickables.find((o) => findEntityId(o) === id);

  function removeRing(id: string): void {
    const ring = rings.get(id);
    if (!ring) return;
    a6RingStop(ring);
    scene.remove(ring);
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
    rings.delete(id);
  }

  /** A6 on every selected entity (cables get the CableRegistry highlight). */
  function syncRings(): void {
    const wanted = new Set(store.selection.filter((id) => store.getEntityInfo(id)));
    for (const id of [...rings.keys()]) if (!wanted.has(id)) removeRing(id);
    for (const id of wanted) {
      if (rings.has(id)) continue;
      const object = objectOf(id);
      if (!object) continue;
      const ring = createRing(object);
      scene.add(ring);
      rings.set(id, ring);
      a6RingIn(ring);
    }
  }

  /** Rings follow their objects (spinners, gizmo commit, undo). */
  function followRings(): void {
    for (const [id, ring] of rings) {
      const object = objectOf(id);
      if (object) placeRing(ring, object);
    }
  }

  /** Entity or cable under the pointer, skipping hidden/locked layers. */
  function pickAt(clientX: number, clientY: number): string | null {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const first = (objects: THREE.Object3D[]) =>
      raycaster.intersectObjects(objects, true).find((h) => {
        const id = findEntityId(h.object);
        return id !== null && store.isPickable(id);
      });
    const entityHit = first(pickables);
    const cableHit = extraPickables ? first(extraPickables.flat()) : undefined;
    // Cables end inside small elements (ONU, splitter): an element right
    // behind the cable hit wins, so it stays selectable where cables arrive.
    const hit =
      cableHit && (!entityHit || entityHit.distance > cableHit.distance + ENDPOINT_SLACK_M)
        ? cableHit
        : entityHit;
    return hit ? findEntityId(hit.object) : null;
  }

  // Capture phase: runs before OrbitControls so a Shift+drag on empty space
  // becomes a marquee instead of a pan.
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    if (!e.shiftKey || store.tool !== "select" || pickAt(e.clientX, e.clientY)) return;
    controls.enabled = false;
    const el = document.createElement("div");
    el.className = "selection-marquee";
    canvas.parentElement?.appendChild(el);
    marquee = { x: e.clientX, y: e.clientY, el };
    drawMarquee(e.clientX, e.clientY);
  }

  function drawMarquee(x: number, y: number): void {
    if (!marquee) return;
    const host = canvas.getBoundingClientRect();
    Object.assign(marquee.el.style, {
      left: `${Math.min(x, marquee.x) - host.left}px`,
      top: `${Math.min(y, marquee.y) - host.top}px`,
      width: `${Math.abs(x - marquee.x)}px`,
      height: `${Math.abs(y - marquee.y)}px`,
    });
  }

  function onPointerMove(e: PointerEvent): void {
    drawMarquee(e.clientX, e.clientY);
  }

  /** Ends the marquee: adds every pickable entity whose center is inside. */
  function finishMarquee(e: PointerEvent): void {
    if (!marquee) return;
    const { x, y, el } = marquee;
    marquee = null;
    el.remove();
    controls.enabled = true;
    const rect = canvas.getBoundingClientRect();
    const [x0, x1] = [Math.min(x, e.clientX), Math.max(x, e.clientX)];
    const [y0, y1] = [Math.min(y, e.clientY), Math.max(y, e.clientY)];
    const ids = pickables.flatMap((root) => {
      const id = findEntityId(root);
      if (!id || !store.isPickable(id)) return [];
      const p = root.getWorldPosition(new THREE.Vector3()).project(camera);
      const sx = rect.left + ((p.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - p.y) / 2) * rect.height;
      return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && p.z < 1 ? [id] : [];
    });
    if (ids.length > 0) store.selectMany(ids, true);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (marquee) {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX;
      finishMarquee(e);
      if (moved) return; // a Shift+click on empty space falls through
    }
    // Selection only happens with the `select` tool (DESIGN.md §12).
    if (store.tool !== "select") return;
    // A press on a gizmo handle is not a click on empty space.
    if (deps.isGizmoBusy?.()) return;
    // A camera drag (orbit/pan) is not a click.
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX) return;

    const id = pickAt(e.clientX, e.clientY);
    if (e.shiftKey) {
      if (id) store.toggleSelect(id); // Shift+click on empty space keeps the selection
      return;
    }
    store.select(id); // null = empty space
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && !shouldIgnoreShortcut(e)) store.select(null);
  }

  const unsubscribeSelection = store.subscribeSelection(syncRings);
  const unsubscribe = store.subscribe(followRings);

  canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
  window.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeydown);

  return () => {
    unsubscribeSelection();
    unsubscribe();
    for (const id of [...rings.keys()]) removeRing(id);
    canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
    window.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeydown);
  };
}
