/**
 * Road frontage (Fase 17, Q_LIST.md Q40 — Cities: Skylines zoning): houses and
 * buildings go next to a road, facing it.
 *
 *  - `frontage(point, halfDepth)` finds the nearest stretch of road (on the
 *    ground — not over a bridge) within `ZONE_REACH` of the point and returns
 *    where the building sits: beside the road edge + a 1.5 m pavement, on
 *    the side of the point, its front (+Z of the model) turned to the road.
 *  - `ZoneOverlay` draws the zone cells (4 × 4 m, three rows each side) along
 *    every road while a house/building is being dragged.
 */
import * as THREE from "three";

import { store, type RoadInfo } from "../state/store";
import { PIER_MIN_GAP, sampleRoad, type RoadSample } from "./roads";
import type { Terrain } from "./terrain";

/** How far from the road axis a drop still counts as «next to the road» (m). */
export const ZONE_REACH = 30;
const PAVEMENT = 1.5; // m between the road edge and the building
const CELL = 4; // m
const ROWS = 3;
const CELL_COLOR = 0xdfe8f2;

export interface Frontage {
  x: number;
  z: number;
  /** Rotation around Y (radians) that turns the model's front to the road. */
  rotationY: number;
  roadId: string;
}

/** Ground-level samples of every road (bridges and viaducts have no frontage). */
function groundSamples(terrain: Terrain): Array<{ road: RoadInfo; p: RoadSample }> {
  const out: Array<{ road: RoadInfo; p: RoadSample }> = [];
  const heightAt = (x: number, z: number) => terrain.getHeight(x, z);
  for (const road of store.allRoads()) {
    for (const p of sampleRoad(road, heightAt)) {
      if (p.y - p.ground < PIER_MIN_GAP) out.push({ road, p });
    }
  }
  return out;
}

export function frontage(
  terrain: Terrain,
  point: { x: number; z: number },
  halfDepth: number,
): Frontage | null {
  let best: { road: RoadInfo; p: RoadSample; d: number } | null = null;
  for (const { road, p } of groundSamples(terrain)) {
    const d = Math.hypot(point.x - p.x, point.z - p.z);
    if (d <= ZONE_REACH + road.width / 2 && (!best || d < best.d)) best = { road, p, d };
  }
  if (!best) return null;
  const { road, p } = best;
  // Normal of the stretch (left of travel), pointing to the side of the point.
  let nx = -p.dz;
  let nz = p.dx;
  if ((point.x - p.x) * nx + (point.z - p.z) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  const offset = road.width / 2 + PAVEMENT + halfDepth;
  return {
    x: p.x + nx * offset,
    z: p.z + nz * offset,
    rotationY: Math.atan2(-nx, -nz), // model +Z → towards the road
    roadId: road.id,
  };
}

export class ZoneOverlay {
  private mesh: THREE.InstancedMesh | null = null;

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
  ) {}

  /** Number of cells shown (tests). */
  get cells(): number {
    return this.mesh?.visible ? this.mesh.count : 0;
  }

  show(): void {
    this.hide();
    const matrices: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(CELL - 0.4, 1, CELL - 0.4);
    let lastS = -Infinity;
    let lastRoad = "";
    for (const { road, p } of groundSamples(this.terrain)) {
      if (road.id !== lastRoad) {
        lastRoad = road.id;
        lastS = -Infinity;
      }
      if (p.s - lastS < CELL) continue;
      lastS = p.s;
      q.setFromAxisAngle(up, Math.atan2(-p.dz, p.dx));
      for (const side of [-1, 1]) {
        for (let row = 0; row < ROWS; row++) {
          const off = side * (road.width / 2 + PAVEMENT + CELL / 2 + row * CELL);
          const x = p.x - p.dz * off;
          const z = p.z + p.dx * off;
          const at = new THREE.Vector3(x, this.terrain.getHeight(x, z) + 0.08, z);
          matrices.push(new THREE.Matrix4().compose(at, q, scale));
        }
      }
    }
    if (matrices.length === 0) return;
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: CELL_COLOR,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        depthTest: false, // a guide over the map: slopes must not cut the flat cells
      }),
      matrices.length,
    );
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.name = "road-zones";
    mesh.renderOrder = 1;
    mesh.raycast = () => {};
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  hide(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.mesh = null;
  }
}
