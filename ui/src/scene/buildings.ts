/**
 * Infrastructure models (PLAN.md Fase 4, DESIGN.md §4.1 `Building`).
 *
 * Fase 16: the meshes come from the Blender `.glb` models (`scene/models.ts`);
 * each builder fills a `content` group (child of the entity root, which owns
 * the transform) with the model parts of a construction phase — a part named
 * `pN_*` shows from phase N on:
 *
 *  - phase 0 "foundations": slab only;
 *  - phase 1 "structure": + walls / floor structure;
 *  - phase 2 "finishing": + roof, windows and door.
 *
 * Building storeys: `*_floor` parts are one storey and repeat once per floor,
 * `*_top` parts go up with the floor count (`floor_height` from the model
 * extras). The lot only has phase-0 parts. Every part is a deep clone, so
 * callers that need variants (e.g. the semi-transparent drag preview) can
 * mutate materials freely after building.
 */
import type * as THREE from "three";

import type { BuildingKind } from "../state/store";
import { deepClone, modelExtras, modelParts } from "./models";

/** Default floor count of a building (parametrizable via entity params). */
export const DEFAULT_FLOORS = 4;

const PART = /^p(\d)(?:_(floor|top))?/;

/**
 * (Re)builds the content of an entity for its current phase. The caller
 * disposes the previous children first (`clearGroup` in `scene/entities.ts`).
 */
export function buildContent(
  content: THREE.Group,
  kind: BuildingKind,
  phase: number,
  params: Record<string, number> = {},
): void {
  const floors = kind === "building" ? Math.max(1, params.floors ?? DEFAULT_FLOORS) : 1;
  const floorHeight = Number(modelExtras(kind).floor_height ?? 0);
  for (const part of modelParts(kind)) {
    const match = PART.exec(part.name);
    if (!match || Number(match[1]) > phase) continue;
    const role = match[2];
    const copies = role === "floor" ? floors : 1;
    for (let f = 0; f < copies; f++) {
      const copy = deepClone(part);
      const level = role === "floor" ? f : role === "top" ? floors - 1 : 0;
      copy.position.y += level * floorHeight;
      content.add(copy);
    }
  }
}
