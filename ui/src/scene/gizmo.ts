/**
 * Transform gizmo (PLAN.md Fase 4, DESIGN.md §10 shortcuts and §12 state
 * `gizmoDrag`).
 *
 *  - Wraps a `TransformControls` attached to the selected entity's root
 *    object; it detaches (and hides its helper) when nothing is selected or
 *    when a tool other than `select` is active (brush, catalog drag).
 *  - Modes: `W` translate, `E` rotate, `T` scale (DESIGN.md §10 — `R` is
 *    reserved for the ruler tool of Fase 12). Shortcuts run under the same
 *    UI-focus guard as the other viewport shortcuts.
 *  - While dragging, the OrbitControls are disabled (`dragging-changed`).
 *  - Continuous Y snap: in translate mode every `objectChange` re-pins
 *    `position.y` to the terrain height (`registry.snapY`), so dragging over
 *    sloped terrain follows the relief (X/Z free, Y snapped).
 *  - On drag end the live object transform is committed to the store
 *    (`commitTransform`) and the collision warnings are refreshed.
 *  - The gizmo helper is added to the scene but never to the registry
 *    `pickables`, so the raycast selection ignores it; `isBusy()` lets the
 *    selection skip plain clicks that land on a gizmo handle (they would
 *    otherwise read as "click on empty space" and clear the selection).
 *
 * Since three r169 `TransformControls` is not itself an `Object3D`: its
 * visual helper is added via `getHelper()`.
 */
import * as THREE from "three";
import {
  TransformControls,
  type TransformControlsMode,
} from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { store } from "../state/store";
import type { EntityRegistry } from "./entities";
import { shouldIgnoreShortcut } from "./shortcuts";

/** Snap to objects (Fase 10): align X/Z to another entity closer than this. */
const OBJECT_SNAP_M = 0.5;

/** Mode shortcuts (DESIGN.md §10): W mover, E rodar, T escalar. */
const MODE_KEYS: Record<string, TransformControlsMode> = {
  w: "translate",
  e: "rotate",
  t: "scale",
};

export interface GizmoDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  controls: OrbitControls;
  registry: EntityRegistry;
}

export interface GizmoHandle {
  /** True while the pointer is pressed on a gizmo handle (selection skips it). */
  isBusy(): boolean;
  /** Scene helper (hidden in the report snapshot — Fase 12). */
  readonly helper: THREE.Object3D;
  dispose(): void;
}

export function initGizmo(deps: GizmoDeps): GizmoHandle {
  const { canvas, camera, scene, controls, registry } = deps;

  const gizmo = new TransformControls(camera, canvas);
  const helper = gizmo.getHelper();
  scene.add(helper);

  /** Pointer pressed on a gizmo handle — a plain click must not deselect. */
  let busy = false;
  /** Fase 10: start positions of the whole selection while translating. */
  let batch: Array<{ id: string; object: THREE.Object3D; start: THREE.Vector3 }> = [];

  /** Attaches to the primary selection; detaches with no selection/other tool. */
  function syncAttachment(): void {
    const id = store.selected;
    const object =
      id !== null && store.tool === "select" && store.isPickable(id)
        ? registry.getObject(id)
        : undefined;
    if (object) gizmo.attach(object);
    else gizmo.detach();
    gizmo.setTranslationSnap(store.snap.grid || null); // Fase 10: grid snap
  }

  gizmo.addEventListener("dragging-changed", (e) => {
    const dragging = e.value as boolean;
    controls.enabled = !dragging; // orbit off while dragging the gizmo
    if (dragging) {
      batch = store.selection.flatMap((id) => {
        const object = registry.getObject(id);
        return object ? [{ id, object, start: object.position.clone() }] : [];
      });
      return;
    }
    // Drag end: commit the live transforms scene → store (one undo entry) + collisions.
    const primary = gizmo.object?.userData.entityId;
    const ids = new Set(batch.map((b) => b.id));
    if (typeof primary === "string") ids.add(primary);
    for (const id of ids) registry.commitTransform(id);
    registry.updateCollisionWarnings();
    batch = [];
  });

  /** Snap to objects (Fase 10): X/Z align with the nearest other entity center. */
  function snapToObjects(object: THREE.Object3D): void {
    if (!store.snap.objects) return;
    const moving = new Set(batch.map((b) => b.object));
    moving.add(object);
    let bestX = OBJECT_SNAP_M;
    let bestZ = OBJECT_SNAP_M;
    let x = object.position.x;
    let z = object.position.z;
    for (const other of registry.pickables) {
      if (moving.has(other)) continue;
      const dx = Math.abs(other.position.x - object.position.x);
      const dz = Math.abs(other.position.z - object.position.z);
      if (dx < bestX) [bestX, x] = [dx, other.position.x];
      if (dz < bestZ) [bestZ, z] = [dz, other.position.z];
    }
    object.position.x = x;
    object.position.z = z;
  }

  // Continuous Y snap while translating (PLAN.md Fase 4): X/Z free (grid /
  // object snap, Fase 10), Y follows the relief; the rest of a multi-selection
  // moves by the same X/Z delta.
  gizmo.addEventListener("objectChange", () => {
    const object = gizmo.object;
    if (!object || gizmo.mode !== "translate") return;
    snapToObjects(object);
    object.position.y = registry.snapY(object.position.x, object.position.z);
    const lead = batch.find((b) => b.object === object);
    if (!lead) return;
    const dx = object.position.x - lead.start.x;
    const dz = object.position.z - lead.start.z;
    for (const b of batch) {
      if (b.object === object) continue;
      b.object.position.x = b.start.x + dx;
      b.object.position.z = b.start.z + dz;
      b.object.position.y = registry.snapY(b.object.position.x, b.object.position.z);
    }
  });

  function onPointerDown(): void {
    // `axis` is the hovered handle (null when the pointer is off the gizmo).
    if (gizmo.axis !== null) busy = true;
  }

  function onPointerUp(): void {
    busy = false; // window listener: runs after the canvas selection handler
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!gizmo.object || shouldIgnoreShortcut(e)) return;
    const mode = MODE_KEYS[e.key.toLowerCase()];
    if (mode) gizmo.setMode(mode);
  }

  const unsubscribe = store.subscribe(syncAttachment);

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeydown);

  return {
    isBusy: () => busy,
    helper,
    dispose(): void {
      unsubscribe();
      gizmo.detach();
      scene.remove(helper);
      gizmo.dispose();
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeydown);
    },
  };
}
