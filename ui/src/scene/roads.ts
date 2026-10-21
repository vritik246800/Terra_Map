/**
 * Road registry (Fase 11, DESIGN.md §1.7): owns the road meshes. A road is a
 * ribbon of `width` along its polyline, sampled every metre and draped over
 * the relief (+5 cm). Roads are selectable (merged into the selection
 * pickables, `userData.entityId` = road id), belong to the Infraestruturas
 * layer and get the same emissive highlight as cables when selected. Paths
 * are rebuilt after every terrain change.
 */
import * as THREE from "three";

import { store, type RoadInfo } from "../state/store";
import { idNumber } from "./entities";
import type { Terrain } from "./terrain";

const ROAD_COLOR = 0x4a4a4f;
const SELECTED_EMISSIVE = 0x0071e3; // --accent
const SAMPLE_STEP = 1; // m
const LIFT = 0.05; // m above the relief

export class RoadRegistry {
  private objects = new Map<string, THREE.Mesh>();
  private roots: THREE.Object3D[] = [];
  private counter = 0;
  private seenTerrainRevision = 0;

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
  ) {
    store.subscribeSelection(() => this.syncHighlight());
    store.subscribe(() => {
      if (store.terrainRevision === this.seenTerrainRevision) return;
      this.seenTerrainRevision = store.terrainRevision;
      for (const id of this.objects.keys()) this.rebuild(id);
    });
  }

  get pickables(): THREE.Object3D[] {
    return this.roots;
  }

  getObject(id: string): THREE.Mesh | undefined {
    return this.objects.get(id);
  }

  newId(): string {
    return `road_${++this.counter}`;
  }

  /** Creates a road from points (≥ 2) — the road tool's single entry point. */
  add(points: RoadInfo["points"], width: number): RoadInfo {
    const info: RoadInfo = { id: this.newId(), points: points.map((p) => ({ ...p })), width };
    this.attach(info);
    return info;
  }

  /** Re-creates a road with its saved id (project open, undo, Fase 11). */
  restore(info: RoadInfo): void {
    this.counter = Math.max(this.counter, idNumber(info.id));
    this.attach(info);
  }

  remove(id: string): void {
    const mesh = this.objects.get(id);
    if (!mesh) return;
    this.objects.delete(id);
    this.roots.splice(this.roots.indexOf(mesh), 1);
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    store.unregisterRoad(id);
  }

  clear(): void {
    for (const id of [...this.objects.keys()]) this.remove(id);
  }

  /** Rebuilds the ribbon (points/width edited, relief changed). */
  rebuild(id: string): void {
    const info = store.getRoadInfo(id);
    const mesh = this.objects.get(id);
    if (!info || !mesh) return;
    mesh.geometry.dispose();
    mesh.geometry = this.buildGeometry(info);
  }

  /** Length of the polyline on the ground plane (m). */
  getLength(id: string): number {
    const pts = store.getRoadInfo(id)?.points ?? [];
    return pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.z - pts[i].z), 0);
  }

  private attach(info: RoadInfo): void {
    const mesh = new THREE.Mesh(
      this.buildGeometry(info),
      new THREE.MeshStandardMaterial({
        color: ROAD_COLOR,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    mesh.name = info.id;
    mesh.userData.entityId = info.id;
    mesh.receiveShadow = true;
    this.objects.set(info.id, mesh);
    this.roots.push(mesh);
    this.scene.add(mesh);
    store.registerRoad(info);
    this.syncHighlight();
  }

  /** Ribbon along the polyline: two vertices (left/right) per sample. */
  private buildGeometry(info: RoadInfo): THREE.BufferGeometry {
    const samples: Array<{ x: number; z: number; dx: number; dz: number }> = [];
    info.points.slice(1).forEach((b, i) => {
      const a = info.points[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len === 0) return;
      const steps = Math.max(1, Math.ceil(len / SAMPLE_STEP));
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      for (let s = samples.length ? 1 : 0; s <= steps; s++) {
        const t = s / steps;
        samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx, dz });
      }
    });
    const half = info.width / 2;
    const positions: number[] = [];
    for (const p of samples) {
      // Perpendicular on XZ: (−dz, dx).
      for (const side of [-1, 1]) {
        const x = p.x - p.dz * half * side;
        const z = p.z + p.dx * half * side;
        positions.push(x, this.terrain.getHeight(x, z) + LIFT, z);
      }
    }
    const index: number[] = [];
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // counter-clockwise from above
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }

  private syncHighlight(): void {
    for (const [id, mesh] of this.objects) {
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(
        store.isSelected(id) ? SELECTED_EMISSIVE : 0,
      );
    }
  }
}
