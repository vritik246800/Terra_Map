/**
 * Undo/redo (Fase 10, MODELO_DADOS.md §2, UX.md §2).
 *
 * Instead of wrapping every call site in a Command, the history diffs
 * snapshots: whenever the project revision moves, the changes made in that
 * tick (one user action — a drop, a delete cascade, a gizmo commit, a paste)
 * become one entry holding the before/after state of every entity and cable
 * that changed, plus the terrain (config + heightmap) when it changed.
 * Undo/redo writes the other side back through the registries, so the scene,
 * the store and the cables stay consistent. Consecutive edits of the same
 * elements within a second (holding a spinner) merge into one entry; a new
 * action clears the redo side; 100 entries max.
 *
 * Fase 11: roads (diffed like cables), vegetation (the store replaces the
 * whole list per brush gesture, so a reference change is the diff) and the
 * terrain material map (part of the terrain snapshot) are recorded too.
 *
 * Not recorded (Q_LIST.md Q13, Q16): selection, camera, layers, project
 * name, simulator, collision flags, hour/fog/water.
 */
import type * as THREE from "three";

import { a16Flash } from "../anim/scene";
import type { CableRegistry } from "../scene/cables";
import type { EntityRegistry } from "../scene/entities";
import type { RoadRegistry } from "../scene/roads";
import { isUiControlFocused } from "../scene/shortcuts";
import type { Terrain, TerrainConfig } from "../scene/terrain";
import { t, type MessageKey } from "../state/i18n";
import { kindLabel } from "../state/labels";
import {
  cloneCableInfo,
  cloneEntityInfo,
  CUSTOM_GLB_KIND,
  store,
  type CableInfo,
  type EntityInfo,
  type Plant,
  type RoadInfo,
} from "../state/store";

const MAX_ENTRIES = 100;
/** Edits of the same elements closer than this merge into one entry. */
const MERGE_WINDOW_MS = 1000;

interface Snap<T> {
  info: T;
  /** Canonical JSON (sorted keys, no collision flag) for change detection. */
  json: string;
  template?: THREE.Object3D;
}

interface Change<T> {
  id: string;
  before?: Snap<T>;
  after?: Snap<T>;
}

interface TerrainSnap {
  config: TerrainConfig;
  heights: Float32Array;
  materials: Uint8Array;
}

interface Entry {
  time: number;
  entities: Change<EntityInfo>[];
  cables: Change<CableInfo>[];
  roads: Change<RoadInfo>[];
  terrain?: { before: TerrainSnap; after: TerrainSnap };
  vegetation?: { before: readonly Plant[]; after: readonly Plant[] };
}

export interface HistoryActions {
  undo(): void;
  redo(): void;
  /** Applies undo/redo until `position` entries are applied. */
  jumpTo(position: number): void;
  /** Labels, oldest first. */
  readonly labels: readonly string[];
  /** Number of applied entries (the rest is the redo side). */
  readonly position: number;
  /** Forgets everything (startup, after opening/recovering a project). */
  reset(): void;
}

/** JSON with sorted keys at every level, so equal data gives equal text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

function diff<T>(before: Map<string, Snap<T>>, after: Map<string, Snap<T>>): Change<T>[] {
  const changes: Change<T>[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (!a || a.json !== b.json) changes.push({ id, before: b, after: a });
  }
  for (const [id, a] of after) if (!before.has(id)) changes.push({ id, after: a });
  return changes;
}

/**
 * Short label of an entry ("Adicionar Casa", "Eliminar 3 elementos"…), built
 * when read so it follows the current language (Fase 13).
 */
function labelOf(entry: Entry): string {
  const { entities, cables, roads } = entry;
  const all = [...entities, ...cables, ...roads];
  if (all.length === 0) {
    return t(
      entry.terrain
        ? "history.terrain"
        : entry.vegetation
          ? "history.vegetation"
          : "history.change",
    );
  }
  const verb = all.every((c) => !c.before)
    ? "history.add"
    : all.every((c) => !c.after)
      ? "history.delete"
      : "history.edit";
  const count = (n: number, one: MessageKey, many: MessageKey) =>
    n === 1 ? t(one) : t(many, { n });
  let what: string;
  if (entities.length === 0 && cables.length === 0) {
    what = count(roads.length, "history.road", "history.roads");
  } else if (entities.length === 0) {
    what = count(cables.length, "history.cable", "history.cables");
  } else if (entities.length === 1) {
    const kind = (entities[0].after ?? entities[0].before)?.info.kind;
    what = kind ? kindLabel(kind) : t("history.element");
  } else {
    what = t("history.elements", { n: entities.length });
  }
  return t(verb, { what });
}

export function createHistory(deps: {
  registry: EntityRegistry;
  cables: CableRegistry;
  terrain: Terrain;
  roads: RoadRegistry;
}): HistoryActions {
  const { registry, cables, terrain, roads } = deps;
  const entries: Entry[] = [];
  let position = 0;
  let lastEntities = new Map<string, Snap<EntityInfo>>();
  let lastCables = new Map<string, Snap<CableInfo>>();
  let lastRoads = new Map<string, Snap<RoadInfo>>();
  let lastVegetation: readonly Plant[] = store.vegetation;
  let lastTerrain: TerrainSnap = snapTerrain();
  let seenRevision = store.projectRevision;
  let seenTerrainRevision = store.terrainRevision;
  let scheduled = false;
  let applying = false;

  function snapTerrain(): TerrainSnap {
    return {
      config: { ...terrain.current },
      heights: terrain.heights.slice(),
      materials: terrain.materialMap.slice(),
    };
  }

  function captureEntities(): Map<string, Snap<EntityInfo>> {
    const map = new Map<string, Snap<EntityInfo>>();
    for (const n of store.networkGraph().nodes) {
      const info = cloneEntityInfo(n);
      const template = n.kind === CUSTOM_GLB_KIND ? registry.getEntityTemplate(n.id) : undefined;
      map.set(n.id, { info, json: canonical(info), template });
    }
    return map;
  }

  function captureCables(): Map<string, Snap<CableInfo>> {
    const map = new Map<string, Snap<CableInfo>>();
    for (const c of store.allCables()) {
      const info = cloneCableInfo(c);
      map.set(c.id, { info, json: canonical(info) });
    }
    return map;
  }

  function captureRoads(): Map<string, Snap<RoadInfo>> {
    const map = new Map<string, Snap<RoadInfo>>();
    for (const r of store.allRoads()) {
      const info = { ...r, points: r.points.map((p) => ({ ...p })) };
      map.set(r.id, { info, json: canonical(info) });
    }
    return map;
  }

  /** Baseline = the current scene (after an undo/redo or a reset). */
  function rebase(): void {
    lastEntities = captureEntities();
    lastCables = captureCables();
    lastRoads = captureRoads();
    lastVegetation = store.vegetation;
    lastTerrain = snapTerrain();
    seenRevision = store.projectRevision;
    seenTerrainRevision = store.terrainRevision;
  }

  function commit(): void {
    scheduled = false;
    if (applying) return;
    const nowEntities = captureEntities();
    const nowCables = captureCables();
    const nowRoads = captureRoads();
    const entities = diff(lastEntities, nowEntities);
    const cablesChanged = diff(lastCables, nowCables);
    const roadsChanged = diff(lastRoads, nowRoads);
    const vegetationChange =
      store.vegetation !== lastVegetation
        ? { before: lastVegetation, after: store.vegetation }
        : undefined;
    lastVegetation = store.vegetation;
    lastRoads = nowRoads;
    let terrainChange: Entry["terrain"];
    if (store.terrainRevision !== seenTerrainRevision) {
      const now = snapTerrain();
      terrainChange = { before: lastTerrain, after: now };
      lastTerrain = now;
      seenTerrainRevision = store.terrainRevision;
    }
    lastEntities = nowEntities;
    lastCables = nowCables;
    if (
      entities.length === 0 &&
      cablesChanged.length === 0 &&
      roadsChanged.length === 0 &&
      !terrainChange &&
      !vegetationChange
    ) {
      return;
    }

    const entry: Entry = {
      time: performance.now(),
      entities,
      cables: cablesChanged,
      roads: roadsChanged,
      terrain: terrainChange,
      vegetation: vegetationChange,
    };
    entries.splice(position); // a new action clears the redo side
    const top = entries.at(-1);
    if (top && canMerge(top, entry)) {
      top.entities = top.entities.map((c, i) => ({ ...c, after: entry.entities[i].after }));
      top.cables = top.cables.map((c, i) => ({ ...c, after: entry.cables[i].after }));
      top.roads = top.roads.map((c, i) => ({ ...c, after: entry.roads[i].after }));
      top.time = entry.time;
    } else {
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries.shift();
    }
    position = entries.length;
    store.notifyChange();
  }

  /** Same elements edited again (no add/remove, no terrain) within the window. */
  function canMerge(top: Entry, next: Entry): boolean {
    if (top.terrain || next.terrain || next.time - top.time > MERGE_WINDOW_MS) return false;
    if (top.vegetation || next.vegetation) return false;
    const pure = (cs: Change<unknown>[]) => cs.every((c) => c.before && c.after);
    const ids = (cs: Change<unknown>[]) => cs.map((c) => c.id).join("|");
    return (
      pure(top.entities) &&
      pure(next.entities) &&
      pure(top.cables) &&
      pure(next.cables) &&
      pure(top.roads) &&
      pure(next.roads) &&
      ids(top.entities) === ids(next.entities) &&
      ids(top.cables) === ids(next.cables) &&
      ids(top.roads) === ids(next.roads)
    );
  }

  /** Writes one side of an entry back into the scene. */
  function apply(entry: Entry, side: "before" | "after"): void {
    applying = true;
    for (const c of entry.cables) {
      if (!c[side] && store.getCableInfo(c.id)) cables.remove(c.id);
    }
    for (const r of entry.roads) {
      if (!r[side] && store.getRoadInfo(r.id)) roads.remove(r.id);
    }
    for (const e of entry.entities) {
      if (!e[side] && store.getEntityInfo(e.id)) registry.remove(e.id);
    }
    for (const e of entry.entities) {
      const target = e[side];
      if (!target) continue;
      const info = cloneEntityInfo(target.info);
      if (!store.getEntityInfo(e.id)) {
        registry.restore(info, target.template);
      } else {
        const { phase, transform, params, dynamicProps, label, note } = info;
        store.updateEntity(e.id, { phase, transform, params, dynamicProps, label, note });
        registry.syncTransform(e.id);
        registry.applyPhase(e.id);
      }
    }
    for (const c of entry.cables) {
      const target = c[side];
      if (!target) continue;
      const info = cloneCableInfo(target.info);
      if (!store.getCableInfo(c.id)) {
        cables.restore(info);
      } else {
        const { cableType, route, dynamicProps } = info;
        store.updateCable(c.id, { cableType, route, dynamicProps });
        cables.rebuildMesh(c.id);
      }
    }
    if (entry.terrain) {
      const t = entry.terrain[side];
      terrain.restoreState(t.config, t.heights, t.materials);
      store.setTerrainPreset(t.config.preset);
      cables.rebuildAll();
      for (const r of store.allRoads()) roads.rebuild(r.id); // drape again
    }
    for (const r of entry.roads) {
      const target = r[side];
      if (!target) continue;
      const info = { ...target.info, points: target.info.points.map((p) => ({ ...p })) };
      if (!store.getRoadInfo(r.id)) {
        roads.restore(info);
      } else {
        store.updateRoad(r.id, { points: info.points, width: info.width });
        roads.rebuild(r.id);
      }
    }
    if (entry.vegetation) store.setVegetation([...entry.vegetation[side]]);
    registry.updateCollisionWarnings();
    rebase();
    applying = false;

    // A16: flash what changed (entities and cables still in the scene).
    const objects = [...entry.entities, ...entry.cables, ...entry.roads]
      .map((c) => registry.getObject(c.id) ?? cables.getObject(c.id) ?? roads.getObject(c.id))
      .filter((o): o is NonNullable<typeof o> => !!o);
    a16Flash(objects);
    store.notifyChange();
  }

  function undo(): void {
    if (position === 0) return;
    position--;
    apply(entries[position], "before");
  }

  function redo(): void {
    if (position === entries.length) return;
    apply(entries[position], "after");
    position++;
  }

  store.subscribe(() => {
    if (applying || store.projectRevision === seenRevision) return;
    seenRevision = store.projectRevision;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(commit); // everything changed in this tick = one entry
    }
  });

  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || isUiControlFocused(e)) return;
    if (e.key.toLowerCase() !== "z") return;
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  });

  return {
    undo,
    redo,
    jumpTo(target) {
      while (position > target && position > 0) undo();
      while (position < target && position < entries.length) redo();
    },
    get labels() {
      return entries.map(labelOf);
    },
    get position() {
      return position;
    },
    reset() {
      entries.length = 0;
      position = 0;
      rebase();
      store.notifyChange();
    },
  };
}
