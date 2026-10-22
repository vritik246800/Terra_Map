/**
 * Layers in the scene (Fase 10, UX.md §1.1): applies the visibility of the
 * fixed layers — terrain (+ vegetation, Fase 17 details), infrastructures (+ roads), network
 * (elements + cables), markers — after every store change, and plays A17 when a layer comes back.
 * Picking rules for hidden/locked layers live in `store.isPickable`.
 */
import type * as THREE from "three";

import { a17LayerIn } from "../anim/scene";
import { LAYER_IDS, layerOfKind, store, type LayerId } from "../state/store";
import type { CableRegistry } from "./cables";
import type { EntityRegistry } from "./entities";
import type { RoadRegistry } from "./roads";
import type { Terrain } from "./terrain";
import type { TerrainDetails } from "./terrain-details";
import type { VegetationLayer } from "./vegetation";

export function initLayers(deps: {
  registry: EntityRegistry;
  cables: CableRegistry;
  terrain: Terrain;
  roads: RoadRegistry;
  vegetation: VegetationLayer;
  details: TerrainDetails;
}): void {
  const { registry, cables, terrain, roads, vegetation, details } = deps;
  const wasVisible = Object.fromEntries(LAYER_IDS.map((id) => [id, true])) as Record<
    LayerId,
    boolean
  >;

  store.subscribe(() => {
    // Fase 11: vegetation on the terrain layer, roads on infrastructures (Q_LIST.md Q18);
    // the water plane's visibility lives in scene/environment.ts.
    const objects: Record<LayerId, THREE.Object3D[]> = {
      terrain: [terrain.mesh, ...vegetation.objects, ...details.objects], // + Fase 17 details
      infra: store.allRoads().flatMap((r) => roads.getObject(r.id) ?? []),
      net: [],
      markers: [],
    };
    for (const n of store.networkGraph().nodes) {
      const object = registry.getObject(n.id);
      if (object) objects[layerOfKind(n.kind)].push(object);
    }
    for (const c of store.allCables()) {
      const object = cables.getObject(c.id);
      if (object) objects.net.push(object);
    }
    for (const id of LAYER_IDS) {
      const visible = store.layer(id).visible;
      for (const o of objects[id]) o.visible = visible;
      if (visible && !wasVisible[id]) a17LayerIn(objects[id]);
      wasVisible[id] = visible;
    }
  });
}
