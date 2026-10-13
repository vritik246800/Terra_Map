/**
 * Entity registry (PLAN.md Fase 4, DESIGN.md §4.1 `Building`).
 *
 * Owns the scene objects of every infrastructure (house/building/lot plus
 * imported `.glb` models, Fase 5 — spawned from a reusable template clone)
 * and keeps them in sync with the entity data in the store:
 *
 *  - `spawn` creates the object hierarchy `root (transform + userData.entityId)
 *    → content (procedural meshes per phase)` and registers the entity data;
 *    it is the single creation entry point, so Fase 10 can wrap it in an
 *    `AddEntity` command without touching the callers (drop, duplicate,
 *    project load).
 *  - `syncTransform` / `applyPhase` / `commitTransform` push state store ↔
 *    scene in both directions (spinners write the store, the gizmo writes
 *    the object and commits on release).
 *  - `updateCollisionWarnings` does the simple footprint overlap check
 *    (world AABBs on XZ — non-blocking warning, PLAN.md Fase 4) and shows a
 *    red ring under every colliding entity.
 *
 * `pickables` is a live array shared with `scene/selection.ts`; `getObject`
 * feeds the camera focus (`F`). Fase 6 network elements will register here
 * (or in a sibling registry) with the same contract.
 */
import * as THREE from "three";

import {
  cloneTransform,
  CUSTOM_GLB_KIND,
  isNetworkKind,
  MARKER_KIND,
  store,
  type BuildingKind,
  type EntityInfo,
  type EntityKind,
  type TransformData,
  DEFAULT_NETWORK_PROPS,
} from "../state/store";
import { buildContent } from "./buildings";
import { buildMarkerContent, buildNetworkContent } from "./network-models";
import type { Terrain } from "./terrain";

const COLLISION_RING_COLOR = 0xff3b30; // --danger (DESIGN.md §7.1)

/** Disposes geometries/materials of a subtree (entity removal, phase rebuild). */
function disposeChildren(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
      const material = obj.material;
      for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    } else if (obj instanceof THREE.Sprite) {
      // Marker label sprites carry a CanvasTexture (Fase 6).
      obj.material.map?.dispose();
      obj.material.dispose();
    }
  });
}

export class EntityRegistry {
  private objects = new Map<string, THREE.Group>();
  private contents = new Map<string, THREE.Group>();
  /** Live array of entity roots — the raycast selection reads from it. */
  private roots: THREE.Object3D[] = [];
  private collisionRings = new Map<string, THREE.Mesh>();
  /** Source models of spawned `.glb` entities (cloned per entity, Fase 5). */
  private customTemplates = new Map<string, THREE.Object3D>();
  /** Last imported `.glb` model — the reusable "personalizado" catalog item. */
  private currentTemplate: { name: string; scene: THREE.Object3D } | null = null;
  private counter = 0;

  /**
   * Fase 6 hooks, wired by the viewport: notify the CableRegistry so cable
   * paths follow entity moves and cables are removed with their endpoints.
   */
  onEntityChanged: ((id: string) => void) | null = null;
  onEntityRemoved: ((id: string) => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
  ) {}

  get pickables(): THREE.Object3D[] {
    return this.roots;
  }

  getObject(id: string): THREE.Group | undefined {
    return this.objects.get(id);
  }

  /** Content group of an entity (target of the A5 drop bounce). */
  getContent(id: string): THREE.Group | undefined {
    return this.contents.get(id);
  }

  /**
   * Creates an entity with a stable id (`bld_<n>`), adds it to the scene and
   * registers its data in the store. Single creation entry point — the
   * future `AddEntity` undo command (Fase 10) wraps this.
   *
   * Builders by kind: procedural buildings (`buildings.ts`), network
   * elements and markers (`network-models.ts`, Fase 6). Network elements get
   * their default dynamic props (DESIGN.md §4.2).
   */
  spawn(kind: EntityKind, transform: TransformData, phase: number): EntityInfo {
    const info: EntityInfo = {
      id: `bld_${++this.counter}`,
      kind,
      phase,
      transform: cloneTransform(transform),
      params: {},
      dynamicProps: isNetworkKind(kind) ? { ...DEFAULT_NETWORK_PROPS[kind] } : {},
      colliding: false,
    };
    if (kind === "building") info.params.floors = 4; // DEFAULT_FLOORS

    const content = new THREE.Group();
    this.buildContentFor(info, content);
    this.attach(info, content);
    return info;
  }

  /**
   * Spawns a marker pin (Fase 6): a finished entity of kind `marker` with a
   * default label and, when dropped on another infrastructure, the id of the
   * entity it annotates (`targetId`). Reuses the shared spawn tail (`attach`)
   * like `spawn` — markers are excluded from collision checks by design.
   */
  spawnMarker(transform: TransformData, targetId?: string): EntityInfo {
    const info: EntityInfo = {
      id: `bld_${++this.counter}`,
      kind: MARKER_KIND,
      phase: 2, // markers have no construction phases
      transform: cloneTransform(transform),
      params: {},
      dynamicProps: {},
      colliding: false,
      label: `Marcador ${this.counter}`,
    };
    if (targetId !== undefined) info.targetId = targetId;

    const content = new THREE.Group();
    this.buildContentFor(info, content);
    this.attach(info, content);
    return info;
  }

  /** Picks the procedural builder for an entity kind (phase rebuilds too). */
  private buildContentFor(info: EntityInfo, content: THREE.Group): void {
    if (info.kind === MARKER_KIND) {
      buildMarkerContent(content, info.label ?? info.id);
    } else if (isNetworkKind(info.kind)) {
      buildNetworkContent(content, info.kind, info.phase);
    } else {
      buildContent(content, info.kind as BuildingKind, info.phase, info.params);
    }
  }

  /**
   * Spawns an imported `.glb` model (PLAN.md Fase 5): the content is a clone
   * of `template` (geometries/materials are shared between clones). The
   * template is kept per entity so `applyPhase`/`duplicate` can re-clone it,
   * and as the current catalog template so the model stays reusable from the
   * "Modelo personalizado" catalog item.
   */
  spawnCustomGlb(template: THREE.Object3D, transform: TransformData): EntityInfo {
    const info: EntityInfo = {
      id: `bld_${++this.counter}`,
      kind: CUSTOM_GLB_KIND,
      phase: 2, // imported models are "finished" (no construction phases)
      transform: cloneTransform(transform),
      params: {},
      dynamicProps: {},
      colliding: false,
    };
    this.customTemplates.set(info.id, template);
    const content = new THREE.Group();
    content.add(this.cloneCustomTemplate(template));
    this.attach(info, content);
    return info;
  }

  /** Registers the last imported `.glb` as the reusable catalog template. */
  setCustomGlbTemplate(name: string, scene: THREE.Object3D): void {
    this.currentTemplate = { name, scene };
  }

  /** The reusable "Modelo personalizado" template (`null` before the first import). */
  getCustomGlbTemplate(): { name: string; scene: THREE.Object3D } | null {
    return this.currentTemplate;
  }

  /** Template of a spawned `.glb` entity (used by duplicate, Ctrl/Cmd+D). */
  getEntityTemplate(id: string): THREE.Object3D | undefined {
    return this.customTemplates.get(id);
  }

  /** Clones a `.glb` template (sharing geometries/materials), enabling shadows. */
  private cloneCustomTemplate(template: THREE.Object3D): THREE.Object3D {
    const clone = template.clone(true); // shares geometries/materials
    clone.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    return clone;
  }

  /** Shared spawn tail: wraps content in a root and registers everything. */
  private attach(info: EntityInfo, content: THREE.Group): void {
    const root = new THREE.Group();
    root.name = info.id;
    root.userData.entityId = info.id;
    content.name = `${info.id}:content`;
    root.add(content);

    this.objects.set(info.id, root);
    this.contents.set(info.id, content);
    this.roots.push(root);
    this.scene.add(root);
    store.registerEntity(info);
    this.syncTransform(info.id);
    this.updateCollisionWarnings();
  }

  /** Removes an entity from the scene and the store, disposing its resources. */
  remove(id: string): void {
    const root = this.objects.get(id);
    if (!root) return;
    this.onEntityRemoved?.(id); // Fase 6: cascade-removes connected cables
    const isCustomGlb = this.customTemplates.delete(id);
    this.objects.delete(id);
    this.contents.delete(id);
    const index = this.roots.indexOf(root);
    if (index >= 0) this.roots.splice(index, 1);
    this.scene.remove(root);
    // .glb clones share geometry/materials with the template — never dispose.
    if (!isCustomGlb) disposeChildren(root);
    this.removeCollisionRing(id);
    store.unregisterEntity(id);
    if (store.selected === id) store.select(null);
    this.updateCollisionWarnings();
  }

  /** Applies the stored transform to the scene object (spinner/panel edits). */
  syncTransform(id: string): void {
    const info = store.getEntityInfo(id);
    const root = this.objects.get(id);
    if (!info || !root) return;
    const { position, rotation } = info.transform;
    root.position.set(position.x, position.y, position.z);
    root.rotation.set(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(rotation.y),
      THREE.MathUtils.degToRad(rotation.z),
    );
    this.onEntityChanged?.(id); // Fase 6: connected cables re-path
  }

  /** Rebuilds the procedural content for the stored phase/params. */
  applyPhase(id: string): void {
    const info = store.getEntityInfo(id);
    const content = this.contents.get(id);
    if (!info || !content) return;
    // Imported .glb models have no phases: re-clone the stored template.
    // No disposeChildren here — clones share resources with the template.
    if (info.kind === CUSTOM_GLB_KIND) {
      const template = this.customTemplates.get(id);
      if (!template) return;
      content.clear();
      content.add(this.cloneCustomTemplate(template));
      return;
    }
    disposeChildren(content);
    content.clear();
    this.buildContentFor(info, content);
    this.onEntityChanged?.(id); // geometry (and bbox) may have changed
  }

  /** Commits the object's live transform to the store (gizmo drag end). */
  commitTransform(id: string): void {
    const root = this.objects.get(id);
    if (!root) return;
    store.updateEntity(id, {
      transform: {
        position: { x: root.position.x, y: root.position.y, z: root.position.z },
        rotation: {
          x: THREE.MathUtils.radToDeg(root.rotation.x),
          y: THREE.MathUtils.radToDeg(root.rotation.y),
          z: THREE.MathUtils.radToDeg(root.rotation.z),
        },
        scale: { x: root.scale.x, y: root.scale.y, z: root.scale.z },
      },
    });
    this.onEntityChanged?.(id); // Fase 6: connected cables re-path
  }

  /**
   * Simple collision check (PLAN.md Fase 4): world AABB overlap on XZ between
   * every pair of entities. Non-blocking — colliding entities get a red ring
   * and a flag in the store (warning badge in the properties panel). Markers
   * (Fase 6) are excluded — pins sit freely on terrain and on other
   * infrastructures by design.
   */
  updateCollisionWarnings(): void {
    const ids = [...this.objects.keys()].filter(
      (id) => store.getEntityInfo(id)?.kind !== MARKER_KIND,
    );
    const boxes = new Map<string, THREE.Box3>();
    for (const id of ids) {
      boxes.set(id, new THREE.Box3().setFromObject(this.objects.get(id)!));
    }

    const colliding = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = boxes.get(ids[i])!;
        const b = boxes.get(ids[j])!;
        const overlap =
          a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z;
        if (overlap) {
          colliding.add(ids[i]);
          colliding.add(ids[j]);
        }
      }
    }

    let changed = false;
    for (const id of ids) {
      const is = colliding.has(id);
      changed = store.setEntityColliding(id, is) || changed;
      this.syncCollisionRing(id, is);
    }
    if (changed) store.notifyChange();
  }

  /** Red ring under a colliding entity (warning visual, --danger). */
  private syncCollisionRing(id: string, colliding: boolean): void {
    const existing = this.collisionRings.get(id);
    if (!colliding) {
      if (existing) this.removeCollisionRing(id);
      return;
    }
    const root = this.objects.get(id);
    if (!root) return;

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;

    let ring = existing;
    if (!ring) {
      ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 48),
        new THREE.MeshBasicMaterial({
          color: COLLISION_RING_COLOR,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.name = `${id}:collision-ring`;
      ring.rotation.x = -Math.PI / 2; // flat on the ground
      this.collisionRings.set(id, ring);
      this.scene.add(ring);
    }
    ring.scale.setScalar(radius * 1.15 + 0.3);
    ring.position.set(center.x, box.min.y + 0.03, center.z);
  }

  private removeCollisionRing(id: string): void {
    const ring = this.collisionRings.get(id);
    if (!ring) return;
    this.scene.remove(ring);
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
    this.collisionRings.delete(id);
  }

  /** Terrain height snap used by drop/duplicate/spinner moves. */
  snapY(x: number, z: number): number {
    return this.terrain.getHeight(x, z);
  }
}
