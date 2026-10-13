/**
 * Catalog drag & drop into the viewport (PLAN.md Fase 4; DESIGN.md §6
 * "Drag & drop", §8 animations A4/A5 and §12 tool `dragging`).
 *
 *  - The catalog items (left panel) call `startEntityDrag`/`endEntityDrag`;
 *    the dragged kind lives in module state because `dataTransfer.getData`
 *    is unreadable during `dragover` (HTML5 DnD).
 *  - While the drag is over the viewport, a semi-transparent ghost (A4,
 *    GSAP fade) of the procedural model follows the cursor, snapped to the
 *    terrain height. Off-terrain or outside the viewport the ghost hides.
 *  - On drop the entity spawns via `EntityRegistry.spawn` (single creation
 *    entry point — the `AddEntity` undo command of Fase 10 will wrap it) at
 *    the raycast point with `y = snapY(x, z)`, and the content group plays
 *    the A5 drop bounce (Anime.js, easeOutElastic).
 *  - The store tool is `dragging` for the whole gesture (§12) so selection
 *    and the brush stay out of the way; it returns to `select` on drop or
 *    cancel. `Esc` cancels the drag natively (the browser fires `dragend`
 *    on the source), and dropping outside the viewport is a no-op.
 */
import anime from "animejs";
import gsap from "gsap";
import * as THREE from "three";

import { prefersReducedMotion } from "../anim/reduced-motion";
import { buildContent, DEFAULT_FLOORS } from "../scene/buildings";
import type { EntityRegistry } from "../scene/entities";
import { buildNetworkContent } from "../scene/network-models";
import type { Terrain } from "../scene/terrain";
import {
  identityTransform,
  isNetworkKind,
  store,
  CUSTOM_GLB_KIND,
  type BuildingKind,
  type NetworkKind,
} from "../state/store";

const GHOST_OPACITY = 0.55; // semi-transparent preview (A4)
const A4_DURATION = 0.2; // seconds — DESIGN.md §8.1 (A4, power2.out)
const A5_DURATION_MS = 350; // DESIGN.md §8.1 (A5, easeOutElastic(1,.7))
const DROP_PHASE = 2; // entities drop finished (fundações → estrutura → acabamento)

const BUILDING_KINDS = new Set<string>(["house", "building", "lot"]);

/**
 * Kinds draggable from the catalog: procedural buildings, network elements
 * (Fase 6) and the imported .glb (Fase 5).
 */
export type DraggableKind = BuildingKind | NetworkKind | typeof CUSTOM_GLB_KIND;

/** Kind being dragged from the catalog (`null` outside a catalog drag). */
let draggedKind: DraggableKind | null = null;

export function isBuildingKind(kind: string): kind is BuildingKind {
  return BUILDING_KINDS.has(kind);
}

/** Called by the catalog item's `dragstart`: records the kind, arms the tool. */
export function startEntityDrag(e: DragEvent, kind: DraggableKind): void {
  draggedKind = kind;
  if (e.dataTransfer) {
    e.dataTransfer.setData("text/plain", kind);
    e.dataTransfer.effectAllowed = "copy";
  }
  store.setTool("dragging"); // DESIGN.md §12: only one tool at a time
}

/**
 * Called by the catalog item's `dragend` — fires after every drop and after
 * a cancel (`Esc` or drop outside a valid target), so it is the single
 * cleanup point for the tool state and the ghost.
 */
export function endEntityDrag(): void {
  draggedKind = null;
  activeSession?.removeGhost(true);
  if (store.tool === "dragging") store.setTool("select"); // §12: back to select
}

export interface EntityDragDropDeps {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: THREE.Scene;
  terrain: Terrain;
  registry: EntityRegistry;
}

interface Session {
  removeGhost(immediate?: boolean): void;
}

let activeSession: Session | null = null;

/** Collects the materials of a ghost subtree (meshes + line segments). */
function collectMaterials(root: THREE.Object3D): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      const material = obj.material;
      for (const m of Array.isArray(material) ? material : [material]) materials.push(m);
    }
  });
  return materials;
}

/** Disposes geometries/materials of a discarded ghost subtree. */
function disposeGhost(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
      const material = obj.material;
      for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    }
  });
}

/** A5 (Anime.js): the dropped entity "settles" with a subtle scale bounce. */
export function playDropBounce(content: THREE.Group): void {
  if (prefersReducedMotion()) return; // §8.3: keep only the final state
  content.scale.setScalar(1.15);
  anime({
    targets: content.scale,
    x: 1,
    y: 1,
    z: 1,
    duration: A5_DURATION_MS,
    easing: "easeOutElastic(1, .7)",
  });
}

/**
 * Wires the viewport side of the catalog drag & drop (ghost preview + drop).
 * Returns a cleanup function that removes the listeners and any live ghost.
 */
export function initEntityDragDrop(deps: EntityDragDropDeps): () => void {
  const { canvas, camera, scene, terrain, registry } = deps;
  const raycaster = new THREE.Raycaster();

  let ghost: THREE.Group | null = null;
  let ghostMaterials: THREE.Material[] = [];

  /** Raycasts the drag position to a terrain point; `null` when off-terrain. */
  function pickTerrain(e: DragEvent): THREE.Vector3 | null {
    const rect = canvas.getBoundingClientRect();
    const p = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(p, camera);
    return raycaster.intersectObject(terrain.mesh, false)[0]?.point ?? null;
  }

  /** Builds the semi-transparent ghost for the dragged kind (A4 fade-in). */
  function ensureGhost(kind: DraggableKind): void {
    if (ghost) return;
    ghost = new THREE.Group();
    ghost.name = "drag-ghost";
    if (kind === CUSTOM_GLB_KIND) {
      // Fase 5: ghost is a clone of the imported .glb template.
      const template = registry.getCustomGlbTemplate();
      if (!template) {
        ghost = null;
        return;
      }
      ghost.add(template.scene.clone(true));
    } else if (isNetworkKind(kind)) {
      // Fase 6: ghost of the network element model (antenna, router, …).
      buildNetworkContent(ghost, kind, DROP_PHASE);
    } else {
      const params: Record<string, number> = {};
      if (kind === "building") params.floors = DEFAULT_FLOORS;
      buildContent(ghost, kind, DROP_PHASE, params);
    }

    ghost.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
      }
    });
    ghostMaterials = collectMaterials(ghost);
    for (const m of ghostMaterials) {
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = 0;
    }
    scene.add(ghost);

    if (prefersReducedMotion()) {
      for (const m of ghostMaterials) m.opacity = GHOST_OPACITY;
    } else {
      gsap.to(ghostMaterials, {
        opacity: GHOST_OPACITY,
        duration: A4_DURATION,
        ease: "power2.out",
      });
    }
  }

  function removeGhost(immediate = false): void {
    const current = ghost;
    if (!current) return;
    ghost = null;
    ghostMaterials = [];

    const dispose = (): void => {
      scene.remove(current);
      disposeGhost(current);
    };

    if (immediate || prefersReducedMotion()) {
      gsap.killTweensOf(collectMaterials(current));
      dispose();
      return;
    }
    // A4 fade-out.
    gsap.to(collectMaterials(current), {
      opacity: 0,
      duration: A4_DURATION,
      ease: "power2.out",
      onComplete: dispose,
    });
  }

  function onDragOver(e: DragEvent): void {
    if (!draggedKind) return;
    e.preventDefault(); // required to allow the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";

    const point = pickTerrain(e);
    if (!point) {
      if (ghost) ghost.visible = false;
      return;
    }
    ensureGhost(draggedKind);
    if (!ghost) return;
    ghost.visible = true;
    ghost.position.set(point.x, registry.snapY(point.x, point.z), point.z);
  }

  function onDragLeave(): void {
    if (ghost) ghost.visible = false;
  }

  function onDrop(e: DragEvent): void {
    if (!draggedKind) return;
    e.preventDefault();
    const kind = draggedKind;

    const point = pickTerrain(e);
    removeGhost();
    if (!point) return; // dropped off-terrain: no-op

    const transform = identityTransform();
    transform.position = { x: point.x, y: registry.snapY(point.x, point.z), z: point.z };
    // Fase 5: the custom .glb spawns from the imported template.
    const info =
      kind === CUSTOM_GLB_KIND
        ? (() => {
            const template = registry.getCustomGlbTemplate();
            return template ? registry.spawnCustomGlb(template.scene, transform) : null;
          })()
        : registry.spawn(kind, transform, DROP_PHASE);
    if (!info) return;
    const content = registry.getContent(info.id);
    if (content) playDropBounce(content);
  }

  activeSession = { removeGhost };

  canvas.addEventListener("dragover", onDragOver);
  canvas.addEventListener("dragleave", onDragLeave);
  canvas.addEventListener("drop", onDrop);

  return () => {
    removeGhost(true);
    if (activeSession?.removeGhost === removeGhost) activeSession = null;
    canvas.removeEventListener("dragover", onDragOver);
    canvas.removeEventListener("dragleave", onDragLeave);
    canvas.removeEventListener("drop", onDrop);
  };
}
