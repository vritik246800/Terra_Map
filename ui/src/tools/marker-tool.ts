/**
 * Marker tool `M` (PLAN.md Fase 6, DESIGN.md §12 states `marker`/`select`).
 *
 * `M` toggles the tool (`Esc` or `M` again cancels back to `select`). While
 * active, a left click (same 4 px down/up threshold as the selection) places
 * a marker pin: the raycast first tries the entity pickables — on a hit the
 * marker annotates that infrastructure (`targetId`) at the hit point; off
 * entities it falls back to the terrain mesh; empty space is ignored. The
 * new pin plays the A13 drop animation (Anime.js, easeOutBounce — the pin
 * falls from the "sky" and settles), then the tool selects the marker and
 * returns to `select` (DESIGN.md §12: `marker --> select: clique`).
 */
import anime from "animejs";
import * as THREE from "three";

import { prefersReducedMotion } from "../anim/reduced-motion";
import type { EntityRegistry } from "../scene/entities";
import { shouldIgnoreShortcut } from "../scene/shortcuts";
import type { Terrain } from "../scene/terrain";
import { identityTransform, store } from "../state/store";

/** Max pointer travel (px) between down/up for the gesture to count as a click. */
const CLICK_THRESHOLD_PX = 4;
/** A13: height (m) the pin falls from before settling (DESIGN.md §8.1). */
const A13_DROP_HEIGHT = 12;
const A13_DURATION_MS = 400; // DESIGN.md §8.1 (A13, easeOutBounce)

export interface MarkerToolDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  terrain: Terrain;
  registry: EntityRegistry;
  /** Entity pickables — a click on one annotates it with the marker. */
  pickables: THREE.Object3D[];
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

/** A13 (Anime.js): the pin drops from the "sky" and settles with a bounce. */
function playMarkerDrop(content: THREE.Group): void {
  if (prefersReducedMotion()) return; // §8.3: keep only the final state
  content.position.y = A13_DROP_HEIGHT;
  anime({
    targets: content.position,
    y: 0,
    duration: A13_DURATION_MS,
    easing: "easeOutBounce",
  });
}

/** Wires the marker tool. Returns a cleanup function that removes listeners. */
export function initMarkerTool(deps: MarkerToolDeps): () => void {
  const { canvas, camera, terrain, registry, pickables } = deps;
  const raycaster = new THREE.Raycaster();

  let downX = 0;
  let downY = 0;

  /**
   * Raycasts the pointer: entities first, terrain as fallback. `null` on
   * empty space (the click is ignored).
   */
  function pickTarget(e: PointerEvent): { point: THREE.Vector3; targetId?: string } | null {
    const rect = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(p, camera);

    const entityHit = raycaster.intersectObjects(pickables, true)[0];
    if (entityHit) {
      const targetId = findEntityId(entityHit.object);
      if (targetId) return { point: entityHit.point, targetId };
    }
    const terrainHit = raycaster.intersectObject(terrain.mesh, false)[0];
    return terrainHit ? { point: terrainHit.point } : null;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || store.tool !== "marker") return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_THRESHOLD_PX) return;

    const hit = pickTarget(e);
    if (!hit) return; // empty space: keep the tool armed (Esc cancels)

    const transform = identityTransform();
    transform.position = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    const info = registry.spawnMarker(transform, hit.targetId);

    const content = registry.getContent(info.id);
    if (content) playMarkerDrop(content);
    store.setTool("select"); // §12: marker --> select on click
    store.select(info.id);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (shouldIgnoreShortcut(e)) return;
    if (e.key === "m" || e.key === "M") {
      store.setTool(store.tool === "marker" ? "select" : "marker"); // §12: M toggles
    } else if (e.key === "Escape" && store.tool === "marker") {
      store.setTool("select"); // §12: Esc always returns to select
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
