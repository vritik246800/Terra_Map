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
  dispose(): void;
}

export function initGizmo(deps: GizmoDeps): GizmoHandle {
  const { canvas, camera, scene, controls, registry } = deps;

  const gizmo = new TransformControls(camera, canvas);
  const helper = gizmo.getHelper();
  scene.add(helper);

  /** Pointer pressed on a gizmo handle — a plain click must not deselect. */
  let busy = false;

  /** Attaches to the selected entity; detaches with no selection/other tool. */
  function syncAttachment(): void {
    const id = store.selected;
    const object = id !== null && store.tool === "select" ? registry.getObject(id) : undefined;
    if (object) gizmo.attach(object);
    else gizmo.detach();
  }

  gizmo.addEventListener("dragging-changed", (e) => {
    const dragging = e.value as boolean;
    controls.enabled = !dragging; // orbit off while dragging the gizmo
    if (dragging) return;
    // Drag end: commit the live transform scene → store + refresh collisions.
    const id = gizmo.object?.userData.entityId;
    if (typeof id === "string") {
      registry.commitTransform(id);
      registry.updateCollisionWarnings();
    }
  });

  // Continuous Y snap while translating (PLAN.md Fase 4): X/Z free, Y follows
  // the terrain relief under the cursor.
  gizmo.addEventListener("objectChange", () => {
    const object = gizmo.object;
    if (!object || gizmo.mode !== "translate") return;
    object.position.y = registry.snapY(object.position.x, object.position.z);
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
