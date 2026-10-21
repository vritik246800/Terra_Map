/**
 * Simulator overlay (Fase 7, DESIGN.md §1.6): the optimal path highlight
 * (A12) drawn over the cables of a Dijkstra result and the antenna coverage
 * heatmap (A14) draped over the relief. Pure scene code — results come from
 * the core through `tools/simulation.ts`.
 */
import * as THREE from "three";

import { a12DrawPath, a14Expand } from "../anim/scene";
import type { CoverageResult, PathResult, SimStatus } from "../net/bridge";
import { store } from "../state/store";
import type { CableRegistry } from "./cables";
import type { Terrain } from "./terrain";

/** --ok / --warn / --danger (DESIGN.md §1.6). */
const STATUS_COLORS: Record<SimStatus, THREE.Color> = {
  ok: new THREE.Color(0x34c759),
  warn: new THREE.Color(0xff9500),
  danger: new THREE.Color(0xff3b30),
};
const PATH_RADIUS = 0.22;
const PATH_POINTS_PER_CABLE = 48;
const HEATMAP_OPACITY = 0.45;
/** Heatmap lift over the relief (avoids z-fighting with the terrain). */
const HEATMAP_OFFSET = 0.3;

export class SimOverlay {
  private path: THREE.Mesh | null = null;
  private stopPath: () => void = () => {};
  private coverage: THREE.Mesh | null = null;

  constructor(
    private scene: THREE.Scene,
    private cables: CableRegistry,
    private terrain: Terrain,
  ) {}

  /** Draws the path of a result (A12); a path without cables draws nothing. */
  showPath(result: PathResult): void {
    this.clearPath();
    const points: THREE.Vector3[] = [];
    result.edges.forEach((edgeId, i) => {
      const curve = this.cables.getCurve(edgeId);
      const info = store.getCableInfo(edgeId);
      if (!curve || !info) return;
      const hop = curve.getPoints(PATH_POINTS_PER_CABLE);
      // Cables are undirected: walk each one from the path's current node.
      if (info.fromId !== result.nodes[i]) hop.reverse();
      points.push(...(points.length ? hop.slice(1) : hop));
    });
    if (points.length < 2) return;

    const curve = new THREE.CatmullRomCurve3(points);
    this.path = new THREE.Mesh(
      new THREE.TubeGeometry(curve, points.length * 2, PATH_RADIUS, 8),
      new THREE.MeshBasicMaterial({
        color: STATUS_COLORS.ok,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    this.path.name = "sim-path";
    this.path.renderOrder = 1;
    this.scene.add(this.path);
    this.stopPath = a12DrawPath(this.path);
  }

  clearPath(): void {
    this.stopPath();
    this.stopPath = () => {};
    if (!this.path) return;
    this.scene.remove(this.path);
    this.path.geometry.dispose();
    (this.path.material as THREE.Material).dispose();
    this.path = null;
  }

  /** Coverage heatmap around (`x`, `z`) — one colored quad per cell (A14). */
  showCoverage(x: number, z: number, result: CoverageResult): void {
    this.clearCoverage();
    const { resolution: res, halfExtent } = result;
    const cell = (2 * halfExtent) / res;
    const positions: number[] = [];
    const colors: number[] = [];
    const corner = (gx: number, gz: number, color: THREE.Color): void => {
      const lx = -halfExtent + gx * cell;
      const lz = -halfExtent + gz * cell;
      positions.push(lx, this.terrain.getHeight(x + lx, z + lz) + HEATMAP_OFFSET, lz);
      colors.push(color.r, color.g, color.b);
    };
    for (let gz = 0; gz < res; gz++) {
      for (let gx = 0; gx < res; gx++) {
        const status = result.status[gz * res + gx];
        if (!status) continue;
        const color = STATUS_COLORS[status];
        // Two triangles, counter-clockwise seen from above.
        corner(gx, gz, color);
        corner(gx, gz + 1, color);
        corner(gx + 1, gz, color);
        corner(gx + 1, gz, color);
        corner(gx, gz + 1, color);
        corner(gx + 1, gz + 1, color);
      }
    }
    if (!positions.length) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.coverage = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: HEATMAP_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.coverage.name = "sim-coverage";
    this.coverage.position.set(x, 0, z);
    this.scene.add(this.coverage);
    a14Expand(this.coverage);
  }

  clearCoverage(): void {
    if (!this.coverage) return;
    this.scene.remove(this.coverage);
    this.coverage.geometry.dispose();
    (this.coverage.material as THREE.Material).dispose();
    this.coverage = null;
  }
}
