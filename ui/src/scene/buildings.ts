/**
 * Procedural infrastructure models (PLAN.md Fase 4, DESIGN.md §4.1 `Building`).
 *
 * Each builder fills a `content` group (child of the entity root, which owns
 * the transform) with the meshes for a construction phase:
 *
 *  - phase 0 "fundações": concrete slab only;
 *  - phase 1 "estrutura": slab + walls / floor structure;
 *  - phase 2 "acabamento": + roof, windows and door.
 *
 * The lot ignores the phase (it is a flat marked area by definition).
 * All meshes cast and receive shadows. Materials are created per build, so
 * callers that need variants (e.g. the semi-transparent drag preview) can
 * mutate them freely after building.
 */
import * as THREE from "three";

import type { BuildingKind } from "../state/store";

/** Scene 3D palette for infrastructures (not UI tokens — like §7.5 terrain colors). */
const COLORS = {
  slab: 0xb9b9bf, // concrete
  walls: 0xf3f1ec, // warm off-white
  structure: 0xd8d5cf, // unfinished concrete structure
  roof: 0xa15c48, // terracotta
  glass: 0x4a6b8a, // windows
  door: 0x7a5b3f, // wood
  lot: 0xcfc9b8, // marked ground
  lotLine: 0x8a8578, // boundary lines
} as const;

/** Default floor count of a building (parametrizable via entity params). */
export const DEFAULT_FLOORS = 4;

function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** House: 8×7 m footprint, 3 m walls, gable roof (PLAN.md Fase 4 snippet). */
function buildHouse(content: THREE.Group, phase: number): void {
  content.add(box(8.4, 0.4, 7.4, COLORS.slab, 0, 0.2, 0)); // foundations

  if (phase >= 1) {
    content.add(box(8, 3, 7, COLORS.walls, 0, 1.9, 0)); // walls
  }

  if (phase >= 2) {
    // Gable roof: triangular prism extruded along Z, with a small overhang.
    const halfWidth = 8 / 2 + 0.5;
    const shape = new THREE.Shape();
    shape.moveTo(-halfWidth, 0);
    shape.lineTo(halfWidth, 0);
    shape.lineTo(0, 2.2);
    shape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: 8, bevelEnabled: false });
    roofGeo.translate(0, 0, -4);
    const roof = new THREE.Mesh(
      roofGeo,
      new THREE.MeshStandardMaterial({ color: COLORS.roof, roughness: 0.85, metalness: 0 }),
    );
    roof.position.y = 3.4; // top of the walls
    roof.castShadow = true;
    roof.receiveShadow = true;
    content.add(roof);

    // Windows (front/back) and door (front, +Z side).
    for (const side of [1, -1]) {
      for (const x of [-2.2, 2.2]) {
        content.add(box(1.2, 1.2, 0.1, COLORS.glass, x, 1.9, side * (7 / 2 + 0.03)));
      }
    }
    content.add(box(1.1, 2.2, 0.12, COLORS.door, 0, 1.5, 7 / 2 + 0.04));
  }
}

/** Building (prédio): 11×11 m footprint, one 3 m floor per level. */
function buildTower(content: THREE.Group, phase: number, floors: number): void {
  content.add(box(12.4, 0.5, 12.4, COLORS.slab, 0, 0.25, 0)); // foundations

  for (let f = 0; f < floors; f++) {
    const baseY = 0.5 + f * 3;
    if (phase >= 1) {
      content.add(box(11, 3, 11, COLORS.structure, 0, baseY + 1.5, 0));
    }
    if (phase >= 2) {
      // Continuous glass band around each floor (finishing).
      content.add(box(11.2, 1.3, 11.2, COLORS.glass, 0, baseY + 1.9, 0));
    }
  }

  if (phase >= 2) {
    const top = 0.5 + floors * 3;
    content.add(box(11.4, 0.6, 11.4, COLORS.structure, 0, top + 0.3, 0)); // parapet
    content.add(box(1.6, 2.4, 0.15, COLORS.door, 0, 1.7, 11 / 2 + 0.05)); // entrance
  }
}

/** Lot (terreno urbano): flat marked area, 16×12 m, with boundary lines. */
function buildLot(content: THREE.Group): void {
  const slab = box(16, 0.12, 12, COLORS.lot, 0, 0.06, 0);
  slab.castShadow = false; // flat on the ground — only receives
  content.add(slab);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(slab.geometry),
    new THREE.LineBasicMaterial({ color: COLORS.lotLine }),
  );
  edges.position.copy(slab.position);
  content.add(edges);
}

/**
 * (Re)builds the procedural content of an entity for its current phase.
 * The caller disposes the previous children first (`clearGroup` in
 * `scene/entities.ts`).
 */
export function buildContent(
  content: THREE.Group,
  kind: BuildingKind,
  phase: number,
  params: Record<string, number> = {},
): void {
  if (kind === "house") buildHouse(content, phase);
  else if (kind === "building") buildTower(content, phase, params.floors ?? DEFAULT_FLOORS);
  else buildLot(content); // lot: phase is trivially ignored
}
