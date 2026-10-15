/**
 * Cable registry (PLAN.md Fase 6, DESIGN.md §4.1 `Cable`).
 *
 * Owns the scene meshes of every cable — the edges of the in-memory network
 * graph (nodes = entities, kept in the store). A cable is a `TubeGeometry`
 * along a path sampled between its two endpoints:
 *
 *  - `underground`: follows the terrain relief at +0.15 m (visible trace);
 *  - `aerial`: straight between the top of each endpoint's bounding box with
 *    a parabolic catenary sag (2% of the distance at mid-span);
 *  - `direct`: straight line between the endpoint origins.
 *
 * The path is recomputed whenever an endpoint moves (the EntityRegistry calls
 * `rebuildFor` via its `onEntityChanged` hook) and cables are cascade-removed
 * with their endpoints (`removeCablesOf` via `onEntityRemoved`). Cable color
 * follows the type (fiber/copper/coax); the selected cable gets an emissive
 * highlight instead of the A6 ground ring (a ring under a long cable reads
 * badly), driven by the store's selection channel.
 */
import * as THREE from "three";

import {
  DEFAULT_CABLE_PROPS,
  store,
  type CableInfo,
  type CableRoute,
  type CableType,
} from "../state/store";
import type { EntityRegistry } from "./entities";
import type { Terrain } from "./terrain";

/** Samples along a cable path. */
const PATH_SAMPLES = 32;
/** Tube radius in meters. */
const CABLE_RADIUS = 0.12;
/** Catenary sag at mid-span, as a fraction of the span (PLAN.md Fase 6). */
const AERIAL_SAG = 0.02;
/** Height offset of the visible "underground" trace above the relief. */
const UNDERGROUND_OFFSET = 0.15;

/** Cable color per type (scene 3D palette, not UI tokens). */
const CABLE_COLORS: Record<CableType, number> = {
  fiber: 0x0071e3, // --accent
  copper: 0xb87333, // copper
  coax: 0x3a3a3c, // dark gray
};

export class CableRegistry {
  private objects = new Map<string, THREE.Mesh>();
  /** Live array of cable meshes — merged into the selection pickables. */
  private roots: THREE.Object3D[] = [];
  private counter = 0;

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
    private entities: EntityRegistry,
  ) {
    // Selected cable gets an emissive highlight (cables have no A6 ring).
    store.subscribeSelection(() => this.syncHighlight());
  }

  get pickables(): THREE.Object3D[] {
    return this.roots;
  }

  getObject(id: string): THREE.Mesh | undefined {
    return this.objects.get(id);
  }

  /** World-space length of a cable's current path (panel display + Fase 7). */
  getLength(id: string): number | undefined {
    const mesh = this.objects.get(id);
    if (!mesh) return undefined;
    const curve = mesh.userData.curve as THREE.CatmullRomCurve3 | undefined;
    return curve?.getLength();
  }

  /**
   * Creates a cable between two entities and registers it in the store.
   * Single creation entry point — the `AddCable` undo command of Fase 10
   * wraps this.
   */
  addCable(fromId: string, toId: string, cableType: CableType, route: CableRoute): CableInfo {
    const info: CableInfo = {
      id: `cab_${++this.counter}`,
      fromId,
      toId,
      cableType,
      route,
      dynamicProps: { ...DEFAULT_CABLE_PROPS[cableType] },
    };
    const mesh = this.buildMesh(info);
    if (!mesh) throw new Error(`cable endpoints not found: ${fromId} → ${toId}`);
    this.attach(info, mesh);
    return info;
  }

  /** Removes a cable mesh and its store entry. */
  remove(id: string): void {
    const mesh = this.objects.get(id);
    if (!mesh) return;
    this.objects.delete(id);
    const index = this.roots.indexOf(mesh);
    if (index >= 0) this.roots.splice(index, 1);
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    store.unregisterCable(id);
  }

  /** Removes every cable connected to an entity (entity deletion cascade). */
  removeCablesOf(entityId: string): void {
    for (const cable of store.cablesOf(entityId)) this.remove(cable.id);
  }

  /** Recomputes the paths of every cable connected to an entity. */
  rebuildFor(entityId: string): void {
    for (const cable of store.cablesOf(entityId)) this.rebuildMesh(cable.id);
  }

  /** Rebuilds every cable (e.g. after a brush stroke changed the relief). */
  rebuildAll(): void {
    for (const id of this.objects.keys()) this.rebuildMesh(id);
  }

  /** Rebuilds the mesh after a type/route change (cable editor in the panel). */
  rebuildMesh(id: string): void {
    const info = store.getCableInfo(id);
    const mesh = this.objects.get(id);
    if (!info || !mesh) return;
    const next = this.buildMesh(info);
    if (!next) return; // an endpoint is gone; the removal cascade handles it
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.geometry = next.geometry;
    mesh.material = next.material;
    mesh.userData.curve = next.userData.curve;
    this.syncHighlight();
  }

  private attach(info: CableInfo, mesh: THREE.Mesh): void {
    this.objects.set(info.id, mesh);
    this.roots.push(mesh);
    this.scene.add(mesh);
    store.registerCable(info);
    this.syncHighlight();
  }

  /** Endpoint anchors per route: aerial links bbox tops, others the origins. */
  private anchors(info: CableInfo): { a: THREE.Vector3; b: THREE.Vector3 } | null {
    const rootA = this.entities.getObject(info.fromId);
    const rootB = this.entities.getObject(info.toId);
    if (!rootA || !rootB) return null;
    const a = rootA.position.clone();
    const b = rootB.position.clone();
    if (info.route === "aerial") {
      a.y = new THREE.Box3().setFromObject(rootA).max.y;
      b.y = new THREE.Box3().setFromObject(rootB).max.y;
    }
    return { a, b };
  }

  /** Samples the cable path per route (PLAN.md Fase 6 logic snippet). */
  private computePath(info: CableInfo): THREE.Vector3[] | null {
    const anchors = this.anchors(info);
    if (!anchors) return null;
    const { a, b } = anchors;
    const distance = a.distanceTo(b);

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < PATH_SAMPLES; i++) {
      const t = i / (PATH_SAMPLES - 1);
      const p = a.clone().lerp(b, t);
      if (info.route === "underground") {
        p.y = this.terrain.getHeight(p.x, p.z) + UNDERGROUND_OFFSET;
      } else if (info.route === "aerial") {
        p.y -= 4 * t * (1 - t) * distance * AERIAL_SAG; // parabola, max at mid-span
      }
      points.push(p);
    }
    return points;
  }

  /** Builds the cable tube mesh; null when an endpoint no longer exists. */
  private buildMesh(info: CableInfo): THREE.Mesh | null {
    const points = this.computePath(info);
    if (!points) return null;
    const curve = new THREE.CatmullRomCurve3(points);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, PATH_SAMPLES * 2, CABLE_RADIUS, 6),
      new THREE.MeshStandardMaterial({ color: CABLE_COLORS[info.cableType], roughness: 0.6 }),
    );
    mesh.name = info.id;
    mesh.userData.entityId = info.id;
    mesh.userData.curve = curve;
    mesh.castShadow = true;
    return mesh;
  }

  /** Emissive highlight on the selected cable (cables have no A6 ring). */
  private syncHighlight(): void {
    for (const [id, mesh] of this.objects) {
      const info = store.getCableInfo(id);
      if (!info) continue;
      const material = mesh.material as THREE.MeshStandardMaterial;
      const selected = store.selected === id;
      material.emissive.setHex(selected ? CABLE_COLORS[info.cableType] : 0);
      material.emissiveIntensity = selected ? 0.7 : 0;
    }
  }
}
