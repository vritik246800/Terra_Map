/**
 * Cable tool `C` (PLAN.md Fase 6, DESIGN.md §12 states `cable`/`cableDestino`).
 *
 * First click picks the origin entity (selected → A6 ring marks it), second
 * click on a different entity creates the cable with the type/route chosen in
 * the properties panel (`store.cableTool`) and returns to `select` with the
 * new cable selected. Clicking empty space is ignored; `Esc` (or `C` again)
 * cancels back to `select`. A camera drag never counts as a click (same
 * 4 px threshold as the selection).
 */
import * as THREE from "three";

import { store } from "../state/store";
import { t } from "../state/i18n";
import { showToast } from "../state/toasts";
import type { CableRegistry } from "../scene/cables";
import type { EntityRegistry } from "../scene/entities";
import { shouldIgnoreShortcut } from "../scene/shortcuts";

/** Max pointer travel (px) between down/up for the gesture to count as a click. */
const CLICK_THRESHOLD_PX = 4;

export interface CableToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  /** Entity pickables (network elements, infrastructures — the graph nodes). */
  pickables: THREE.Object3D[];
  registry: EntityRegistry;
  cables: CableRegistry;
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

/** Wires the cable tool. Returns a cleanup function that removes listeners. */
export function initCableTool(deps: CableToolDeps): () => void {
  const { canvas, camera, pickables, cables } = deps;
  const raycaster = new THREE.Raycaster();

  /** Origin entity waiting for its destination (state `cableDestino`). */
  let pendingFrom: string | null = null;
  let downX = 0;
  let downY = 0;

  function cancel(): void {
    pendingFrom = null;
    if (store.tool === "cable") store.setTool("select");
  }

  function pickEntity(e: PointerEvent): string | null {
    const rect = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(p, camera);
    // Fase 10: elements of hidden/locked layers are not cable endpoints.
    for (const hit of raycaster.intersectObjects(pickables, true)) {
      const id = findEntityId(hit.object);
      if (id && store.isPickable(id)) return id;
    }
    return null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || store.tool !== "cable") return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX) return;

    const id = pickEntity(e);
    if (!id) return; // empty space: keep waiting (Esc cancels)

    if (!pendingFrom) {
      pendingFrom = id;
      store.select(id); // A6 ring marks the chosen origin
      return;
    }
    if (id === pendingFrom) {
      showToast(t("toast.cableSame"), "info");
      return;
    }

    const { cableType, route } = store.cableTool;
    const cable = cables.addCable(pendingFrom, id, cableType, route);
    pendingFrom = null;
    store.setTool("select"); // §12: cableDestino → select on creation
    store.select(cable.id);
    showToast(t("toast.cableCreated"), "success");
  }

  function onKeydown(e: KeyboardEvent): void {
    if (shouldIgnoreShortcut(e)) return;
    if (e.key === "c" || e.key === "C") {
      if (store.tool === "cable") cancel();
      else {
        pendingFrom = null;
        store.setTool("cable");
      }
    } else if (e.key === "Escape" && store.tool === "cable") {
      cancel();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeydown);

  return () => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeydown);
  };
}
