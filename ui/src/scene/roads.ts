/**
 * Road registry (Fase 11, DESIGN.md §1.7): owns the road meshes. Roads are
 * selectable (merged into the selection pickables, `userData.entityId` = road
 * id), belong to the Infraestruturas layer and get the same emissive
 * highlight as cables when selected. Paths are rebuilt after every terrain
 * change.
 *
 * Fase 17 (Q_LIST.md Q42) — elevation and bridges: each stretch between two
 * points runs on a straight line from end to end (terrain height + the lift
 * of each end) and never dips below the relief, so crossing a valley gives a
 * level bridge and «Bridge height» lifts the whole road into a viaduct. The
 * deck is a slab (top, sides, underside) sampled every metre, level across
 * its width, with lane markings; where it runs more than `PIER_MIN_GAP` above
 * the ground it gets Blender piers, pier caps and concrete barriers
 * (instanced children of the deck mesh).
 *
 * Fase 18 (Q_LIST.md Q48–Q50) — joined roads and editable points: every point
 * has its own lift. `snap` finds where a new road joins another (a point
 * within ROAD_SNAP_M, else the road under the pointer) and `lay` builds it: a
 * join in the middle of a stretch adds a shared point there (at the deck
 * height, so that road keeps its shape) and carrying on from an end with the
 * same width fuses into that road. Points at the same spot are one joint:
 * `lift` raises them together and the markings stop around it. The selected
 * road shows its points as handles; `pickPart` turns a click on a handle or
 * on the road into the chosen point / side (`store.roadPart`).
 */
import * as THREE from "three";

import { MAX_ROAD_ELEVATION, store, type RoadInfo, type RoadPoint } from "../state/store";
import { idNumber } from "./entities";
import { mergedGeometry } from "./merge-content";
import { cloneModel, type ModelKind } from "./models";
import type { Terrain } from "./terrain";

const ROAD_COLOR = 0x4a4a4f;
const MARKING_COLOR = 0xf2f2ee;
const SELECTED_EMISSIVE = 0x0071e3; // --accent
const SAMPLE_STEP = 1; // m
const LIFT = 0.05; // m above the relief
/** Deck slab thickness (m) — also how far the side skirts reach on the ground. */
const DECK_THICKNESS = 0.9;
/** Gap under the deck (m) from which a stretch is a bridge (piers + barriers). */
export const PIER_MIN_GAP = 2;
const PIER_SPACING = 12; // m
const BARRIER_LENGTH = 2; // m, the guardrail model's length along X
const DASH = 3; // m, dashed centre line: 3 m paint, 3 m gap
/** A new road's point within this distance of another road's point joins it (Fases 17–18). */
export const ROAD_SNAP_M = 4;
/** Points closer than this are one joint (Fase 18). */
const JOINT_M = 0.01;
/** Handle sizes, as a fraction of the view height (DESIGN.md §1.12: ~16 / ~22 px). */
const HANDLE_SIZE = 0.016;
const HANDLE_SIZE_CHOSEN = 0.022;

/** One sample of the road axis. */
export interface RoadSample {
  x: number;
  z: number;
  /** Unit direction of the stretch. */
  dx: number;
  dz: number;
  /** Deck surface height and the ground under the axis. */
  y: number;
  ground: number;
  /** Distance along the road (m). */
  s: number;
}

/** Fase 18: where a new road joins another (`RoadRegistry.snap`). */
export interface RoadSnap {
  x: number;
  z: number;
  /** Lift there: the point's, or the deck line's above the ground (0–30 m). */
  elevation: number;
  roadId: string;
  /** Point index, or the stretch `index` → `index + 1` when `onSide`. */
  index: number;
  onSide: boolean;
  /** First/last point of its road (a stretch from there carries the road on). */
  isEnd: boolean;
  /** Unit direction from the join into the road (the ∠ label). */
  dx: number;
  dz: number;
}

type Xz = { x: number; z: number };

/** Same spot = one joint (Fase 18). */
export function sameSpot(a: Xz, b: Xz): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < JOINT_M;
}

/** Closest point to `p` on the segment a→b: where (`t` 0–1 from a) and how far. */
export function onSegment(p: Xz, a: Xz, b: Xz): Xz & { t: number; d: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)),
  );
  const x = a.x + dx * t;
  const z = a.z + dz * t;
  return { x, z, t, d: Math.hypot(x - p.x, z - p.z) };
}

/** Stretch of `points` nearest to `p` (index of its first point). */
function nearestSide(points: RoadPoint[], p: Xz): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = onSegment(p, points[i], points[i + 1]).d;
    if (d < bestD) [best, bestD] = [i, d];
  }
  return best;
}

/** White dot with a `--chip` rim, tinted by each handle's material (DESIGN.md §1.12). */
let dot: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  if (dot) return dot;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  if (g) {
    g.beginPath();
    g.arc(32, 32, 26, 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = "rgba(20, 22, 26, 0.86)"; // --chip
    g.stroke();
  }
  dot = new THREE.CanvasTexture(canvas);
  dot.colorSpace = THREE.SRGBColorSpace;
  return dot;
}

/** Shared bridge part geometries/material (lazy — the models load before the scene). */
const parts = new Map<ModelKind, THREE.BufferGeometry>();
let partMaterial: THREE.Material | null = null;
function part(kind: ModelKind): THREE.BufferGeometry {
  let geometry = parts.get(kind);
  if (!geometry) {
    geometry = mergedGeometry(cloneModel(kind)) ?? new THREE.BufferGeometry();
    parts.set(kind, geometry);
  }
  return geometry;
}
function bridgeMaterial(): THREE.Material {
  return (partMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
}

/**
 * Samples a road's axis every metre with its deck height (Fase 17 profile):
 * the straight line between the stretch ends (ground + each end's lift,
 * Fase 18), lifted wherever the ground under the deck (centre and both
 * edges) is higher.
 */
export function sampleRoad(
  info: Pick<RoadInfo, "points" | "width">,
  heightAt: (x: number, z: number) => number,
): RoadSample[] {
  const samples: RoadSample[] = [];
  const half = info.width / 2;
  let s = 0;
  info.points.slice(1).forEach((b, i) => {
    const a = info.points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len === 0) return;
    const steps = Math.max(1, Math.ceil(len / SAMPLE_STEP));
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    const ya = heightAt(a.x, a.z) + a.elevation;
    const yb = heightAt(b.x, b.z) + b.elevation;
    for (let k = samples.length ? 1 : 0; k <= steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const ground = heightAt(x, z);
      const under = Math.max(
        ground,
        heightAt(x + dz * half, z - dx * half),
        heightAt(x - dz * half, z + dx * half),
      );
      samples.push({
        x,
        z,
        dx,
        dz,
        ground,
        y: Math.max(ya + (yb - ya) * t, under) + LIFT,
        s: s + len * t,
      });
    }
    s += len;
  });
  return samples;
}

/** Flat band `lift` above the deck (top only): road tool preview and chosen side (Fase 18). */
export function bandGeometry(
  samples: RoadSample[],
  width: number,
  lift: number,
): THREE.BufferGeometry {
  const half = width / 2;
  const positions: number[] = [];
  for (const p of samples) {
    positions.push(p.x + p.dz * half, p.y + lift, p.z - p.dx * half);
    positions.push(p.x - p.dz * half, p.y + lift, p.z + p.dx * half);
  }
  const index: number[] = [];
  for (let k = 0; k + 1 < samples.length; k++) {
    const a = k * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

export class RoadRegistry {
  private objects = new Map<string, THREE.Mesh>();
  private roots: THREE.Object3D[] = [];
  private counter = 0;
  private seenTerrainRevision = 0;
  /** Fase 18: point handles + chosen side of the selected road (off in the minimap and report image). */
  readonly editHelpers = new THREE.Group();
  private handles: THREE.Sprite[] = [];
  private handleKey = "";

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
  ) {
    this.editHelpers.name = "road-edit";
    scene.add(this.editHelpers);
    store.subscribeSelection(() => this.syncHighlight());
    store.subscribe(() => {
      if (store.terrainRevision !== this.seenTerrainRevision) {
        this.seenTerrainRevision = store.terrainRevision;
        for (const id of this.objects.keys()) this.rebuild(id);
      }
      this.syncHandles();
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

  /** Creates a road from points (≥ 2, each with its lift). */
  add(points: RoadPoint[], width: number): RoadInfo {
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
    const info = store.getRoadInfo(id);
    if (!mesh) return;
    this.objects.delete(id);
    this.roots.splice(this.roots.indexOf(mesh), 1);
    this.scene.remove(mesh);
    this.disposeChildren(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    store.unregisterRoad(id);
    if (info) this.rebuildJoined(info.points); // Fase 18: the markings come back at its joints
  }

  /**
   * Fase 18 (Q_LIST.md Q48): where a new road at `p` joins another — the
   * nearest point of any road within ROAD_SNAP_M, else the road under `p`
   * (its axis, within half its width); null = free ground.
   */
  snap(p: Xz): RoadSnap | null {
    let best: RoadSnap | null = null;
    let bestD = ROAD_SNAP_M;
    for (const road of store.allRoads()) {
      const pts = road.points;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d > bestD) continue;
        const into = pts[i === 0 ? 1 : i - 1]; // towards the rest of the road
        const len = Math.hypot(into.x - q.x, into.z - q.z) || 1;
        bestD = d;
        best = {
          x: q.x,
          z: q.z,
          elevation: q.elevation,
          roadId: road.id,
          index: i,
          onSide: false,
          isEnd: i === 0 || i === pts.length - 1,
          dx: (into.x - q.x) / len,
          dz: (into.z - q.z) / len,
        };
      }
    }
    if (best) return best;
    bestD = Infinity;
    const ground = (q: Xz) => this.terrain.getHeight(q.x, q.z);
    for (const road of store.allRoads()) {
      const pts = road.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        const on = onSegment(p, a, b);
        if (on.d > road.width / 2 || on.d >= bestD) continue;
        const ya = ground(a) + a.elevation;
        const line = ya + (ground(b) + b.elevation - ya) * on.t; // deck line there
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        bestD = on.d;
        best = {
          x: on.x,
          z: on.z,
          elevation: Math.max(0, Math.min(MAX_ROAD_ELEVATION, line - ground(on))),
          roadId: road.id,
          index: i,
          onSide: true,
          isEnd: false,
          dx: (b.x - a.x) / len,
          dz: (b.z - a.z) / len,
        };
      }
    }
    return best;
  }

  /**
   * Fase 18 (Q_LIST.md Q48): lays a road through `points` (≥ 2, each with its
   * lift), joined to the roads in `snaps` (one per point, null = free): a snap
   * in the middle of a stretch adds that point to the other road; a first or
   * last point on an end of a road with the same width carries that road on
   * (ends on two such roads fuse them into one). Returns the road that holds
   * the new stretch.
   */
  lay(points: RoadPoint[], width: number, snaps: Array<RoadSnap | null>): RoadInfo {
    points.forEach((p, i) => {
      const snap = snaps[i];
      if (snap?.onSide) this.insertPoint(snap.roadId, p);
    });
    /** Road of the same width ending at `p`, and whether `p` is its first point. */
    const endAt = (snap: RoadSnap | null | undefined, p: RoadPoint) => {
      const road = snap && !snap.onSide ? store.getRoadInfo(snap.roadId) : undefined;
      if (!road || road.width !== width) return null;
      if (sameSpot(road.points[0], p)) return { road, first: true };
      if (sameSpot(road.points[road.points.length - 1], p)) return { road, first: false };
      return null;
    };
    const head = endAt(snaps[0], points[0]);
    const tail = endAt(snaps.at(-1), points[points.length - 1]);
    let line = points;
    let target = head?.road;
    if (head) {
      // that road, turned to end where the stretch starts
      line = [
        ...(head.first ? [...head.road.points].reverse() : head.road.points),
        ...line.slice(1),
      ];
    }
    if (tail && tail.road !== target) {
      // the road at the other end, turned to start where the stretch ends
      line = [
        ...line,
        ...(tail.first ? tail.road.points : [...tail.road.points].reverse()).slice(1),
      ];
      if (target) this.remove(tail.road.id);
      else target = tail.road;
    }
    if (!target) return this.add(line, width);
    store.updateRoad(target.id, { points: line.map((p) => ({ ...p })) });
    this.rebuild(target.id);
    this.rebuildJoined(line, target.id);
    return target;
  }

  /**
   * Fase 18 (Q_LIST.md Q49/Q50): moves points `indices` of road `id` so the
   * lowest goes to `height` and the rest keep their offsets; the points of any
   * road at the same spot (joints) take the same lift.
   */
  lift(id: string, indices: number[], height: number): void {
    const info = store.getRoadInfo(id);
    if (!info) return;
    const delta = height - Math.min(...indices.map((i) => info.points[i].elevation));
    const moved = indices.map((i) => {
      const p = info.points[i];
      return { ...p, elevation: Math.max(0, Math.min(MAX_ROAD_ELEVATION, p.elevation + delta)) };
    });
    for (const road of store.allRoads()) {
      const points = road.points.map((q) => {
        const m = moved.find((p) => sameSpot(p, q));
        return m ? { ...q, elevation: m.elevation } : q;
      });
      if (points.every((q, i) => q === road.points[i])) continue;
      store.updateRoad(road.id, { points });
      this.rebuild(road.id);
    }
  }

  /**
   * Fase 18 (Q_LIST.md Q49): a plain click while this road alone is selected —
   * on a handle it chooses that point, on the road the side under the pointer.
   * False when the click is not on the selected road (the selection takes it).
   */
  pickPart(raycaster: THREE.Raycaster, hitId: string | null): boolean {
    const id = store.selection.length === 1 ? store.selected : null;
    const info = id ? store.getRoadInfo(id) : undefined;
    const mesh = id ? this.objects.get(id) : undefined;
    if (!info || !mesh) return false;
    const handle = raycaster.intersectObjects(this.handles, false)[0];
    if (handle) {
      store.setRoadPart({ kind: "point", index: handle.object.userData.index as number });
      return true;
    }
    const hit = hitId === info.id ? raycaster.intersectObject(mesh, false)[0] : undefined;
    if (!hit) return false;
    store.setRoadPart({ kind: "side", index: nearestSide(info.points, hit.point) });
    return true;
  }

  clear(): void {
    for (const id of [...this.objects.keys()]) this.remove(id);
  }

  /** Rebuilds the deck and bridge parts (points/width/elevation edited, relief changed). */
  rebuild(id: string): void {
    const info = store.getRoadInfo(id);
    const mesh = this.objects.get(id);
    if (!info || !mesh) return;
    mesh.geometry.dispose();
    this.disposeChildren(mesh);
    this.build(info, mesh);
  }

  /** Length of the polyline on the ground plane (m). */
  getLength(id: string): number {
    const pts = store.getRoadInfo(id)?.points ?? [];
    return pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.z - pts[i].z), 0);
  }

  /** Highest gap between deck and ground (m) — panel and tests (Fase 17). */
  getMaxClearance(id: string): number {
    const info = store.getRoadInfo(id);
    if (!info) return 0;
    const heightAt = (x: number, z: number) => this.terrain.getHeight(x, z);
    return Math.max(0, ...sampleRoad(info, heightAt).map((p) => p.y - LIFT - p.ground));
  }

  /** Number of piers of a road (tests). */
  getPierCount(id: string): number {
    const piers = this.objects.get(id)?.getObjectByName(`${id}:piers`);
    return piers instanceof THREE.InstancedMesh ? piers.count : 0;
  }

  /** Fase 18: adds `p` to the stretch of `roadId` it lies on — a shared point (no-op on a point). */
  private insertPoint(roadId: string, p: RoadPoint): void {
    const road = store.getRoadInfo(roadId);
    if (!road || road.points.some((q) => sameSpot(q, p))) return;
    const points = road.points.map((q) => ({ ...q }));
    points.splice(nearestSide(points, p) + 1, 0, { ...p });
    store.updateRoad(roadId, { points });
    this.rebuild(roadId);
  }

  /** Fase 18: rebuilds the roads with a point at one of `points` (markings at the joints). */
  private rebuildJoined(points: Xz[], except?: string): void {
    for (const road of store.allRoads()) {
      if (road.id !== except && road.points.some((q) => points.some((p) => sameSpot(p, q))))
        this.rebuild(road.id);
    }
  }

  /** Fase 18: the other roads that share a point with `info`. */
  private joinedTo(info: RoadInfo): RoadInfo[] {
    return store
      .allRoads()
      .filter(
        (r) => r.id !== info.id && r.points.some((q) => info.points.some((p) => sameSpot(p, q))),
      );
  }

  private attach(info: RoadInfo): void {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({
        color: ROAD_COLOR,
        roughness: 0.95,
        side: THREE.DoubleSide, // the slab is seen from below on bridges
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    mesh.name = info.id;
    mesh.userData.entityId = info.id;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.build(info, mesh);
    this.objects.set(info.id, mesh);
    this.roots.push(mesh);
    this.scene.add(mesh);
    store.registerRoad(info);
    this.syncHighlight();
    this.rebuildJoined(info.points, info.id); // Fase 18: their markings stop at the joints
  }

  /** Bridge parts/markings are children; their geometries are shared or owned per road. */
  private disposeChildren(mesh: THREE.Mesh): void {
    for (const child of [...mesh.children]) {
      mesh.remove(child);
      if (child instanceof THREE.InstancedMesh) child.dispose();
      else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
  }

  private build(info: RoadInfo, mesh: THREE.Mesh): void {
    const samples = sampleRoad(info, (x, z) => this.terrain.getHeight(x, z));
    mesh.geometry = this.deckGeometry(samples, info.width);
    // Fase 18: joints = shared points, kept clear for half the widest road there + 0.5 m.
    const joined = this.joinedTo(info);
    const joints = info.points.flatMap((p) => {
      const widths = joined.filter((r) => r.points.some((q) => sameSpot(p, q))).map((r) => r.width);
      return widths.length ? [{ x: p.x, z: p.z, r: Math.max(...widths) / 2 + 0.5 }] : [];
    });
    const markings = this.markings(samples, info.width, joints);
    if (markings) mesh.add(markings);
    this.addBridgeParts(info, samples, mesh, joined);
  }

  /** Slab along the axis: top + two sides + underside, 4 vertices per sample. */
  private deckGeometry(samples: RoadSample[], width: number): THREE.BufferGeometry {
    const half = width / 2;
    const positions: number[] = [];
    for (const p of samples) {
      const depth = Math.min(DECK_THICKNESS, Math.max(0.1, p.y - p.ground + 0.1));
      // left/right of the travel direction, so the top winds counter-clockwise from above
      const lx = p.x + p.dz * half;
      const lz = p.z - p.dx * half;
      const rx = p.x - p.dz * half;
      const rz = p.z + p.dx * half;
      positions.push(lx, p.y, lz, rx, p.y, rz, rx, p.y - depth, rz, lx, p.y - depth, lz);
    }
    const index: number[] = [];
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = i * 4;
      const b = a + 4;
      // top (0-1), right side (1-2), bottom (2-3), left side (3-0)
      for (const [u, v] of [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ]) {
        index.push(a + u, a + v, b + u, a + v, b + v, b + u);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(index);
    const flat = geometry.toNonIndexed(); // crisp slab edges
    geometry.dispose();
    flat.computeVertexNormals();
    return flat;
  }

  /** Dashed centre line + solid edge lines, 2 cm above the deck; none around the joints (Fase 18). */
  private markings(
    samples: RoadSample[],
    width: number,
    joints: Array<Xz & { r: number }>,
  ): THREE.Mesh | null {
    if (samples.length < 2) return null;
    const positions: number[] = [];
    const strip = (offset: number, w: number, dashed: boolean) => {
      for (let i = 0; i + 1 < samples.length; i++) {
        const a = samples[i];
        const b = samples[i + 1];
        if (dashed && Math.floor(a.s / DASH) % 2 === 1) continue;
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        if (joints.some((j) => Math.hypot(mid.x - j.x, mid.z - j.z) < j.r)) continue;
        const quad = [a, b].flatMap((p) => {
          const cx = p.x - p.dz * offset;
          const cz = p.z + p.dx * offset;
          return [
            [cx - p.dz * (w / 2), p.y + 0.02, cz + p.dx * (w / 2)],
            [cx + p.dz * (w / 2), p.y + 0.02, cz - p.dx * (w / 2)],
          ];
        });
        const [a0, a1, b0, b1] = quad;
        positions.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
      }
    };
    strip(0, 0.15, true);
    if (width >= 5) {
      strip(width / 2 - 0.35, 0.12, false);
      strip(-(width / 2 - 0.35), 0.12, false);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: MARKING_COLOR,
        roughness: 0.8,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    mesh.name = "markings";
    mesh.receiveShadow = true;
    mesh.raycast = () => {}; // the deck is the pick target
    return mesh;
  }

  /**
   * Piers + caps every PIER_SPACING m and barriers along both edges where it is a bridge;
   * Fase 18: no barrier on the deck of a joined road (it would close the junction).
   */
  private addBridgeParts(
    info: RoadInfo,
    samples: RoadSample[],
    mesh: THREE.Mesh,
    joined: RoadInfo[],
  ): void {
    const half = info.width / 2;
    const isBridge = (p: RoadSample) => p.y - LIFT - p.ground > PIER_MIN_GAP;
    const onJoined = (at: Xz) =>
      joined.some((r) =>
        r.points.some((b, i) => i > 0 && onSegment(at, r.points[i - 1], b).d < r.width / 2 - 0.3),
      );
    const piers: THREE.Matrix4[] = [];
    const caps: THREE.Matrix4[] = [];
    const barriers: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let nextPier = PIER_SPACING / 2;
    let nextBarrier = 0;

    for (const p of samples) {
      if (!isBridge(p)) {
        nextPier = p.s + PIER_SPACING / 2;
        nextBarrier = p.s;
        continue;
      }
      if (p.s >= nextPier) {
        nextPier = p.s + PIER_SPACING;
        const bottom = p.y - DECK_THICKNESS - 0.7; // under the cap
        const columns = info.width > 9 ? [-info.width / 4, info.width / 4] : [0];
        q.setFromAxisAngle(up, Math.atan2(-p.dx, -p.dz)); // model X across the road
        for (const off of columns) {
          const x = p.x - p.dz * off;
          const z = p.z + p.dx * off;
          const ground = this.terrain.getHeight(x, z);
          const height = Math.max(0.5, bottom - ground);
          piers.push(
            m.clone().compose(new THREE.Vector3(x, ground, z), q, new THREE.Vector3(1, height, 1)),
          );
        }
        caps.push(
          m
            .clone()
            .compose(new THREE.Vector3(p.x, bottom, p.z), q, new THREE.Vector3(info.width, 1, 1)),
        );
      }
      if (p.s >= nextBarrier) {
        nextBarrier = p.s + BARRIER_LENGTH;
        q.setFromAxisAngle(up, Math.atan2(-p.dz, p.dx)); // model X along the road
        for (const side of [-1, 1]) {
          const off = side * (half - 0.3);
          const at = new THREE.Vector3(p.x - p.dz * off + p.dx, p.y, p.z + p.dx * off + p.dz);
          if (!onJoined(at)) barriers.push(m.clone().compose(at, q, new THREE.Vector3(1, 1, 1)));
        }
      }
    }

    const add = (kind: ModelKind, list: THREE.Matrix4[], name: string) => {
      if (list.length === 0) return;
      const instanced = new THREE.InstancedMesh(part(kind), bridgeMaterial(), list.length);
      list.forEach((matrix, i) => instanced.setMatrixAt(i, matrix));
      instanced.name = `${info.id}:${name}`;
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.computeBoundingSphere();
      // dispose() frees only the instance buffers — the geometry/material are shared.
      mesh.add(instanced);
    };
    add("bridge_pier", piers, "piers");
    add("bridge_cap", caps, "caps");
    add("guardrail", barriers, "barriers");
  }

  /** Selected = emissive accent; with a point/side chosen the handle/band shows it instead (Fase 18). */
  private syncHighlight(): void {
    const part = store.roadPart;
    for (const [id, mesh] of this.objects) {
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(
        store.isSelected(id) && !part ? SELECTED_EMISSIVE : 0,
      );
    }
  }

  /** Fase 18: handles on the points of the selected road (select tool) + the chosen side band. */
  private syncHandles(): void {
    const id = store.tool === "select" && store.selection.length === 1 ? store.selected : null;
    const info = id ? store.getRoadInfo(id) : undefined;
    const part = store.roadPart;
    const key = info
      ? JSON.stringify([info.id, info.points, info.width, part, store.terrainRevision])
      : "";
    if (key === this.handleKey) return;
    this.handleKey = key;
    for (const child of [...this.editHelpers.children]) {
      this.editHelpers.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
      ((child as THREE.Mesh | THREE.Sprite).material as THREE.Material).dispose();
    }
    this.handles = [];
    if (!info) return;
    const heightAt = (x: number, z: number) => this.terrain.getHeight(x, z);
    info.points.forEach((p, index) => {
      const chosen = part?.kind === "point" && part.index === index;
      const handle = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: dotTexture(),
          color: chosen ? SELECTED_EMISSIVE : 0xffffff,
          sizeAttenuation: false, // same size on screen at any zoom
          depthTest: false,
        }),
      );
      handle.scale.setScalar(chosen ? HANDLE_SIZE_CHOSEN : HANDLE_SIZE);
      handle.position.set(p.x, heightAt(p.x, p.z) + p.elevation + 0.3, p.z);
      handle.renderOrder = 4;
      handle.userData.index = index;
      this.handles.push(handle);
      this.editHelpers.add(handle);
    });
    if (part?.kind === "side") {
      const side = { points: info.points.slice(part.index, part.index + 2), width: info.width };
      const band = new THREE.Mesh(
        bandGeometry(sampleRoad(side, heightAt), info.width, 0.08),
        new THREE.MeshBasicMaterial({
          color: SELECTED_EMISSIVE,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      band.renderOrder = 3;
      band.raycast = () => {};
      this.editHelpers.add(band);
    }
  }
}
