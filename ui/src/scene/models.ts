/**
 * 3D models made in Blender (Fase 16, `ui/models/build_models.py`).
 *
 * `loadModels` fetches every `.glb` of `public/models/` once, before the scene
 * is built (`main.tsx`); `cloneModel` then hands builders a deep copy with
 * its own geometries and materials, so per-entity changes (phase opacity,
 * drag ghost, `mergeContent` disposing the sources) never touch the cache.
 *
 * Top-level nodes carry the construction phase in their name (`p0_*`,
 * `p1_*`, `p2_*`); see `scene/buildings.ts` for the building storeys.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const MODEL_KINDS = [
  "house",
  "building",
  "lot",
  "antenna",
  "router",
  "switch",
  "olt",
  "onu",
  "splitter",
  "pole",
  "box",
  "marker",
  "tree",
  "bush",
  // Fase 17: terrain details of the material brush and bridge parts.
  "detail_grass",
  "detail_snow",
  "detail_rock",
  "detail_dirt",
  "detail_sand",
  "bridge_pier",
  "bridge_cap",
  "guardrail",
] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

const templates = new Map<ModelKind, THREE.Group>();

/** URL of a file in `public/models/` (`.glb` model or `.png` catalog thumbnail). */
export function modelUrl(file: string): string {
  return `${import.meta.env.BASE_URL}models/${file}`;
}

/** Loads every model; a missing one is logged and later clones come out empty. */
export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    MODEL_KINDS.map(async (kind) => {
      try {
        templates.set(kind, (await loader.loadAsync(modelUrl(`${kind}.glb`))).scene);
      } catch (err) {
        console.error(`[models] failed to load ${kind}.glb:`, err);
      }
    }),
  );
}

/** Scene extras of a model (Blender scene custom properties, e.g. `floor_height`). */
export function modelExtras(kind: ModelKind): Record<string, unknown> {
  return templates.get(kind)?.userData ?? {};
}

/** Deep copy of an object: geometries and materials are cloned too. */
export function deepClone<T extends THREE.Object3D>(source: T): T {
  const copy = source.clone(true);
  copy.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry = obj.geometry.clone();
      obj.material = Array.isArray(obj.material)
        ? obj.material.map((m) => m.clone())
        : obj.material.clone();
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return copy;
}

/** Top-level parts of a model (phase nodes), not yet cloned. */
export function modelParts(kind: ModelKind): readonly THREE.Object3D[] {
  return templates.get(kind)?.children ?? [];
}

/** Deep copy of a whole model (an empty group if it failed to load). */
export function cloneModel(kind: ModelKind): THREE.Group {
  const template = templates.get(kind);
  return template ? deepClone(template) : new THREE.Group();
}
