/**
 * Terrain brush tool (PLAN.md Fase 3, DESIGN.md §6 and §12 state `brush`).
 *
 *  - Activated from the catalog ("Pincel") or with `B`; `Esc`/`B` returns to
 *    `select` (DESIGN.md §12). Only one tool is active at a time (store).
 *  - A circular cursor (accent ring, radius = brush radius) follows the
 *    mouse over the terrain.
 *  - Left-drag raises the terrain; `Shift` + left-drag lowers it. Each dab
 *    uses gaussian falloff (`Terrain.applyStroke`); dabs are spaced along
 *    the drag so a stroke stays smooth.
 *  - A drag gesture (pointerdown → pointerup) is one logical stroke — the
 *    boundary for the future `TerrainStroke` undo command (Fase 10,
 *    DESIGN.md §11).
 *  - While the tool is active the left mouse button is unmapped from
 *    OrbitControls (rotate moves to the right button) so camera orbit never
 *    fights a stroke; the original mapping is restored on `select`.
 */
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { store } from "../state/store";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import type { Terrain } from "../scene/terrain";

const RING_COLOR = 0x0071e3; // --accent (DESIGN.md §7.1)

/** Minimum world-space distance between two dabs of the same stroke. */
const DAB_SPACING_RATIO = 0.25; // of the brush radius
const DAB_SPACING_MIN = 0.5; // meters

export interface BrushDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  controls: OrbitControls;
  terrain: Terrain;
  /**
   * Fase 6: called once at the end of each stroke gesture — underground
   * cables re-follow the freshly sculpted relief (viewport wires it to
   * `CableRegistry.rebuildAll`).
   */
  onStrokeEnd?: () => void;
}

/**
 * Wires the brush tool. Returns a cleanup function that removes listeners
 * and the cursor ring.
 */
export function initBrush(deps: BrushDeps): () => void {
  const { canvas, camera, scene, controls, terrain } = deps;
  const raycaster = new THREE.Raycaster();

  // ---- Circular cursor ----
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 48),
    new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.name = "brush-cursor";
  ring.rotation.x = -Math.PI / 2; // flat on the terrain
  ring.visible = false;
  scene.add(ring);

  const savedMouseButtons = { ...controls.mouseButtons };
  let stroking = false;
  let lastDab: { x: number; z: number } | null = null;

  /** Raycasts the pointer to a terrain point; `null` when off-terrain. */
  function pickTerrain(e: PointerEvent): THREE.Vector3 | null {
    const rect = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(p, camera);
    return raycaster.intersectObject(terrain.mesh, false)[0]?.point ?? null;
  }

  function syncCursor(): void {
    const active = store.tool === "brush";
    ring.scale.setScalar(store.brush.radius);
    if (!active) {
      ring.visible = false;
      canvas.style.cursor = "";
      return;
    }
    canvas.style.cursor = "none"; // the ring is the cursor (DESIGN.md §12)
  }

  function applyDab(point: THREE.Vector3, dir: 1 | -1): void {
    terrain.applyStroke(point.x, point.z, store.brush.radius, store.brush.intensity, dir);
    lastDab = { x: point.x, z: point.z };
    // Keep the ring riding the freshly sculpted surface.
    ring.position.set(point.x, terrain.getHeight(point.x, point.z) + 0.05, point.z);
  }

  function onPointerDown(e: PointerEvent): void {
    if (store.tool !== "brush" || e.button !== 0) return;
    const point = pickTerrain(e);
    if (!point) return;
    stroking = true; // gesture start — one undo command in Fase 10
    canvas.setPointerCapture(e.pointerId);
    applyDab(point, e.shiftKey ? -1 : 1);
  }

  function onPointerMove(e: PointerEvent): void {
    if (store.tool !== "brush") return;
    const point = pickTerrain(e);
    if (!point) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    if (!stroking) {
      ring.position.set(point.x, point.y + 0.05, point.z);
      return;
    }
    const spacing = Math.max(DAB_SPACING_MIN, store.brush.radius * DAB_SPACING_RATIO);
    if (lastDab && Math.hypot(point.x - lastDab.x, point.z - lastDab.z) < spacing) return;
    applyDab(point, e.shiftKey ? -1 : 1);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!stroking || e.button !== 0) return;
    stroking = false; // gesture end
    lastDab = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    deps.onStrokeEnd?.(); // Fase 6: underground cables re-follow the relief
  }

  function onPointerLeave(): void {
    ring.visible = false;
  }

  function onKeydown(e: KeyboardEvent): void {
    if (shouldIgnoreShortcut(e)) return;
    if (e.key === "b" || e.key === "B") {
      store.setTool(store.tool === "brush" ? "select" : "brush"); // §12: B toggles
    } else if (e.key === "Escape" && store.tool === "brush") {
      store.setTool("select"); // §12: Esc always returns to select
    }
  }

  /** Applies/removes the OrbitControls remap while the brush is active. */
  function syncControls(): void {
    if (store.tool === "brush") {
      controls.mouseButtons = {
        LEFT: null, // left button belongs to the brush
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
    } else {
      controls.mouseButtons = { ...savedMouseButtons };
    }
    syncCursor();
  }

  const unsubscribe = store.subscribe(syncControls);
  syncControls();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("keydown", onKeydown);

  return () => {
    unsubscribe();
    controls.mouseButtons = { ...savedMouseButtons };
    scene.remove(ring);
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
    canvas.style.cursor = "";
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("keydown", onKeydown);
  };
}
