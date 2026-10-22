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
 *  - Fase 17 (Q_LIST.md Q40): with «Snap buildings to roads» on, houses and
 *    buildings only go next to a road — the zone cells show along the roads,
 *    the ghost snaps beside the nearest road facing it, and turns red (drop
 *    refused with a toast) when no road is within reach.
 */
import * as THREE from "three";

import { a4GhostIn, a4GhostOut, a5DropBounce } from "../anim/scene";
import { buildContent, DEFAULT_FLOORS } from "../scene/buildings";
import type { EntityRegistry } from "../scene/entities";
import { buildNetworkContent } from "../scene/network-models";
import type { Terrain } from "../scene/terrain";
import { frontage, type ZoneOverlay } from "../scene/zones";
import { t } from "../state/i18n";
import { layerBlockReason } from "../state/labels";
import {
  identityTransform,
  isNetworkKind,
  layerOfKind,
  store,
  CUSTOM_GLB_KIND,
  type BuildingKind,
  type EntityInfo,
  type NetworkKind,
} from "../state/store";
import { prefs } from "../state/prefs";
import { showToast } from "../state/toasts";

const GHOST_OPACITY = 0.55; // semi-transparent preview (A4)
const DROP_PHASE = 2; // entities drop finished (fundações → estrutura → acabamento)

const BUILDING_KINDS = new Set<string>(["house", "building", "lot"]);
/** Fase 17: kinds that need a road frontage (the lot is land, it goes anywhere). */
const FRONTAGE_KINDS = new Set<string>(["house", "building"]);
const INVALID_TINT = 0xff3b30; // --danger: no road within reach

/** Does this kind snap to roads right now (preference on)? */
function needsRoad(kind: DraggableKind): boolean {
  return FRONTAGE_KINDS.has(kind) && prefs.snapToRoads;
}

/** Half of the model depth (local Z) — its distance from the road edge. */
const halfDepths = new Map<string, number>();
function halfDepth(kind: BuildingKind): number {
  let d = halfDepths.get(kind);
  if (d === undefined) {
    const probe = new THREE.Group();
    buildContent(probe, kind, DROP_PHASE, { floors: DEFAULT_FLOORS });
    const size = new THREE.Box3().setFromObject(probe).getSize(new THREE.Vector3());
    d = size.z / 2;
    disposeGhost(probe);
    halfDepths.set(kind, d);
  }
  return d;
}

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
/** Fase 13: the keyboard/click alternative to dragging (UX.md §2). */
export function placeEntityAtCenter(kind: DraggableKind): void {
  activeSession?.placeAtCenter(kind);
}

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
  /** Fase 17: zone cells shown while a house/building is dragged. */
  zones: ZoneOverlay;
}

interface Session {
  removeGhost(immediate?: boolean): void;
  placeAtCenter(kind: DraggableKind): void;
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

/**
 * Wires the viewport side of the catalog drag & drop (ghost preview + drop).
 * Returns a cleanup function that removes the listeners and any live ghost.
 */
export function initEntityDragDrop(deps: EntityDragDropDeps): () => void {
  const { canvas, camera, scene, terrain, registry, zones } = deps;
  const raycaster = new THREE.Raycaster();

  let ghost: THREE.Group | null = null;
  let ghostMaterials: THREE.Material[] = [];

  /** Raycasts a screen position to a terrain point; `null` when off-terrain. */
  function pickTerrain(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
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
    a4GhostIn(ghostMaterials, GHOST_OPACITY);
    if (needsRoad(kind)) zones.show(); // Fase 17
  }

  /** Fase 17: red ghost = no road within reach. */
  function tintGhost(invalid: boolean): void {
    for (const m of ghostMaterials) {
      if (m instanceof THREE.MeshStandardMaterial) m.emissive.setHex(invalid ? INVALID_TINT : 0);
    }
  }

  function removeGhost(immediate = false): void {
    zones.hide();
    const current = ghost;
    if (!current) return;
    ghost = null;
    ghostMaterials = [];

    const dispose = (): void => {
      scene.remove(current);
      disposeGhost(current);
    };

    a4GhostOut(collectMaterials(current), dispose, immediate);
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
    const kind = draggedKind;
    const front = needsRoad(kind)
      ? frontage(terrain, point, halfDepth(kind as BuildingKind))
      : null;
    const at = front ?? point;
    ghost.position.set(at.x, registry.snapY(at.x, at.z), at.z);
    ghost.rotation.y = front?.rotationY ?? 0;
    tintGhost(needsRoad(kind) && !front);
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
    spawnAt(kind, point);
  }

  /** Fase 13: click/Enter on a catalog item places it at the center of the view, selected. */
  function placeAtCenter(kind: DraggableKind): void {
    const rect = canvas.getBoundingClientRect();
    const point = pickTerrain({
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    if (!point) {
      showToast(t("catalog.offTerrain"), "info");
      return;
    }
    const info = spawnAt(kind, point);
    if (info) store.select(info.id);
  }

  /** Drop and click share this: layer check, grid snap, spawn on the relief, A5. */
  function spawnAt(kind: DraggableKind, point: THREE.Vector3): EntityInfo | null {
    const blocked = layerBlockReason(layerOfKind(kind)); // Fase 10
    if (blocked) {
      showToast(blocked, "info");
      return null;
    }

    const transform = identityTransform();
    if (needsRoad(kind)) {
      // Fase 17: beside the nearest road, facing it — or refused.
      const front = frontage(terrain, point, halfDepth(kind as BuildingKind));
      if (!front) {
        showToast(t("catalog.needsRoad"), "info");
        return null;
      }
      transform.position = { x: front.x, y: registry.snapY(front.x, front.z), z: front.z };
      transform.rotation.y = THREE.MathUtils.radToDeg(front.rotationY);
    } else {
      // Fase 10: grid snap on the drop position.
      const x = store.snapToGrid(point.x);
      const z = store.snapToGrid(point.z);
      transform.position = { x, y: registry.snapY(x, z), z };
    }
    // Fase 5: the custom .glb spawns from the imported template.
    const info =
      kind === CUSTOM_GLB_KIND
        ? (() => {
            const template = registry.getCustomGlbTemplate();
            return template ? registry.spawnCustomGlb(template.scene, transform) : null;
          })()
        : registry.spawn(kind, transform, DROP_PHASE);
    if (!info) return null;
    const content = registry.getContent(info.id);
    if (content) a5DropBounce(content);
    return info;
  }

  activeSession = { removeGhost, placeAtCenter };

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
