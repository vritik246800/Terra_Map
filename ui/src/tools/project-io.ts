/**
 * Project save/open (Fase 8, MODELO_DADOS.md §3, UX.md §2).
 *
 *  - `serialize` turns the store + scene into a `ProjectFile` (terrain
 *    heightmap and the original bytes of imported `.glb` models embedded as
 *    `base64:` — never re-exported, so a round trip is byte-identical);
 *  - `load` rebuilds the scene from a file the core already migrated and
 *    validated — everything that can still fail (`.glb` parse, heightmap
 *    decode) runs before the current scene is cleared;
 *  - save / save as / open go through the core's native dialogs; the core
 *    keeps the current path and only adopts an opened file after `load`
 *    succeeded (`commitOpen`);
 *  - autosave every 60 s while dirty, recovery prompt on start, and the
 *    unsaved-changes prompt before closing the window or opening another
 *    project (the core blocks the close while `dirty`, see `setDirty`).
 */
import type * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  autosaveProject,
  clearAutosave,
  closeWindow,
  commitOpen,
  loadAutosave,
  onCloseRequested,
  openProject,
  PROJECT_VERSION,
  saveProject,
  setDirty,
  type ProjectFile,
} from "../net/bridge";
import type { CableRegistry } from "../scene/cables";
import type { EntityRegistry } from "../scene/entities";
import type { RoadRegistry } from "../scene/roads";
import {
  decodeBytes,
  decodeHeightmap,
  encodeBytes,
  encodeHeightmap,
  type Terrain,
} from "../scene/terrain";
import {
  cloneTransform,
  CUSTOM_GLB_KIND,
  DEFAULT_ENVIRONMENT,
  isNetworkKind,
  LAYER_IDS,
  MARKER_KIND,
  store,
  type CableRoute,
  type CableType,
  type TerrainPresetId,
} from "../state/store";
import { t } from "../state/i18n";
import { errorText, showToast } from "../state/toasts";
import type { HistoryActions } from "./history";

const AUTOSAVE_INTERVAL_MS = 60_000;

export interface ProjectActions {
  /** Returns true when the project reached the disk (false = cancelled/failed). */
  save(saveAs?: boolean): Promise<boolean>;
  open(): Promise<void>;
  /** Startup: offers the recovery copy left by a crash. */
  checkRecovery(): Promise<void>;
  resolveRecovery(choice: "recover" | "discard"): Promise<void>;
  resolveUnsaved(choice: "save" | "discard" | "cancel"): Promise<void>;
}

export interface ProjectDeps {
  terrain: Terrain;
  registry: EntityRegistry;
  cables: CableRegistry;
  roads: RoadRegistry;
  /** Fase 10: an opened/recovered project starts with an empty undo history. */
  history: Pick<HistoryActions, "reset">;
}

export function createProjectActions(deps: ProjectDeps): ProjectActions {
  const { terrain, registry, cables, roads, history } = deps;
  /** What the unsaved-changes prompt is guarding. */
  let pending: "close" | "open" | null = null;
  let recovery: ProjectFile | null = null;
  let autosavedRevision = -1;

  async function serialize(): Promise<ProjectFile> {
    const project: ProjectFile = {
      version: PROJECT_VERSION,
      id: store.projectId,
      name: store.projectName,
      terrain: {
        preset: terrain.current.preset,
        params: {
          seed: terrain.current.seed,
          amplitude: terrain.current.amplitude,
          frequency: terrain.current.frequency,
          size: terrain.current.size,
          resolution: terrain.current.resolution,
        },
        heightmap: encodeHeightmap(terrain.heights),
        // Fase 11: only when something was painted (absent = all automatic).
        ...(terrain.materialMap.some((m) => m !== 0)
          ? { materialMap: encodeBytes(terrain.materialMap) }
          : {}),
      },
      buildings: [],
      elements: [],
      cables: [],
      markers: [],
      customModels: [],
      layers: LAYER_IDS.map((id) => ({ id, ...store.layer(id) })),
      environment: {
        hour: store.environment.hour,
        fog: store.environment.fog,
        water: { ...store.environment.water },
      },
      roads: store
        .allRoads()
        .map((r) => ({ id: r.id, points: r.points.map((p) => ({ ...p })), width: r.width })),
      vegetation: store.vegetation.map((p) => ({ ...p })),
      scenarios: store.scenarios.map((sc) => ({
        name: sc.name,
        metrics: sc.metrics.map((m) => ({ ...m })),
      })),
    };
    // One embedded model per distinct template (clones share it).
    const modelIds = new Map<THREE.Object3D, string>();
    const { nodes, edges } = store.networkGraph();

    for (const n of nodes) {
      const transform = cloneTransform(n.transform);
      if (n.kind === MARKER_KIND) {
        project.markers.push({
          id: n.id,
          ...(n.targetId ? { targetId: n.targetId } : {}),
          transform,
          label: n.label ?? "",
          note: n.note ?? "",
        });
      } else if (isNetworkKind(n.kind)) {
        project.elements.push({
          id: n.id,
          kind: n.kind,
          transform,
          phase: n.phase,
          dynamicProps: { ...n.dynamicProps },
        });
      } else {
        const building: ProjectFile["buildings"][number] = {
          id: n.id,
          kind: n.kind,
          transform,
          phase: n.phase,
          params: { ...n.params },
        };
        const template = n.kind === CUSTOM_GLB_KIND ? registry.getEntityTemplate(n.id) : undefined;
        const source = template ? registry.getTemplateSource(template) : undefined;
        if (template && source) {
          let modelId = modelIds.get(template);
          if (!modelId) {
            modelId = `mdl_${modelIds.size + 1}`;
            modelIds.set(template, modelId);
            project.customModels.push({
              id: modelId,
              name: source.name,
              glb: encodeBytes(source.bytes),
            });
          }
          building.modelId = modelId;
        }
        project.buildings.push(building);
      }
    }
    for (const c of edges) {
      project.cables.push({
        id: c.id,
        fromId: c.fromId,
        toId: c.toId,
        cableType: c.cableType,
        route: c.route,
        path: [], // always recomputed from the route (MODELO_DADOS.md §3)
        dynamicProps: { ...c.dynamicProps },
      });
    }
    return project;
  }

  /** Rebuilds the scene from a validated file. Throws before clearing on bad data. */
  async function load(project: ProjectFile): Promise<void> {
    const { terrain: file } = project;
    const heights = decodeHeightmap(file.heightmap, file.params.resolution ** 2);
    if (!heights) throw new Error(t("toast.unreadableHeightmap"));
    const models = new Map<string, { name: string; scene: THREE.Object3D; bytes: Uint8Array }>();
    for (const m of project.customModels) {
      const bytes = decodeBytes(m.glb);
      if (!bytes) throw new Error(t("toast.unreadableModel", { name: m.name }));
      const gltf = await new GLTFLoader().parseAsync(bytes.slice().buffer, "");
      models.set(m.id, { name: m.name, scene: gltf.scene, bytes });
    }

    // Point of no return: replace the current scene.
    store.select(null);
    store.clearSimulation();
    cables.clear();
    registry.clear();
    roads.clear();

    await terrain.applyPresetFile({ name: project.name, ...file });
    const materials = file.materialMap ? decodeBytes(file.materialMap) : null;
    if (materials) terrain.setMaterialMap(materials);
    store.setTerrainPreset(file.preset as TerrainPresetId);
    const { seed, amplitude, frequency, size } = file.params;
    store.setCustomParams({ seed, amplitude, frequency, size });

    for (const m of models.values()) registry.setCustomGlbTemplate(m.name, m.scene, m.bytes);
    const lastModel = [...models.values()].pop();
    if (lastModel) store.setCustomGlbName(lastModel.name);

    const base = { params: {}, dynamicProps: {}, colliding: false };
    for (const b of project.buildings) {
      registry.restore(
        {
          ...base,
          id: b.id,
          kind: b.kind,
          phase: b.phase,
          transform: b.transform,
          params: b.params,
        },
        b.modelId ? models.get(b.modelId)?.scene : undefined,
      );
    }
    for (const e of project.elements) {
      registry.restore({ ...base, ...e, dynamicProps: e.dynamicProps });
    }
    for (const m of project.markers) {
      registry.restore({
        ...base,
        id: m.id,
        kind: MARKER_KIND,
        phase: 2,
        transform: m.transform,
        label: m.label,
        note: m.note,
        ...(m.targetId ? { targetId: m.targetId } : {}),
      });
    }
    for (const c of project.cables) {
      cables.restore({
        id: c.id,
        fromId: c.fromId,
        toId: c.toId,
        cableType: c.cableType as CableType,
        route: c.route as CableRoute,
        dynamicProps: c.dynamicProps,
      });
    }
    // Fase 11: roads, vegetation, environment (defaults for older files).
    for (const r of project.roads ?? [])
      roads.restore({ ...r, points: r.points.map((p) => ({ ...p })) });
    store.setVegetation(
      (project.vegetation ?? []).map((p) => ({ ...p, kind: p.kind === "bush" ? "bush" : "tree" })),
    );
    const env = project.environment ?? DEFAULT_ENVIRONMENT;
    store.setEnvironment({ hour: env.hour, fog: env.fog, water: { ...env.water } });
    store.setScenarios(project.scenarios ?? []); // Fase 12

    // Layers: anything the file does not mention is visible and unlocked.
    for (const id of LAYER_IDS) {
      const saved = (project.layers ?? []).find((l) => l.id === id);
      store.setLayer(id, { visible: saved?.visible ?? true, locked: saved?.locked ?? false });
    }
    store.setProjectIdentity(project.id, project.name);
    history.reset();
  }

  async function save(saveAs = false): Promise<boolean> {
    const revision = store.projectRevision;
    try {
      const fileName = await saveProject(await serialize(), saveAs);
      if (!fileName) return false; // dialog cancelled
      store.markSaved(revision);
      autosavedRevision = revision;
      showToast(t("toast.saved", { file: fileName }), "success");
      return true;
    } catch (err) {
      console.error("[projeto] falha ao guardar:", err);
      showToast(t("toast.saveFailed", { error: errorText(err) }), "danger");
      return false;
    }
  }

  async function doOpen(): Promise<void> {
    let opened;
    try {
      opened = await openProject();
    } catch (err) {
      showToast(t("toast.openFailed", { error: errorText(err) }), "danger");
      return;
    }
    if (!opened) return; // dialog cancelled
    try {
      await load(opened.project);
    } catch (err) {
      console.error("[projeto] falha ao reconstruir:", err);
      showToast(t("toast.openFailed", { error: errorText(err) }), "danger");
      return; // the core keeps the previous save target (no commitOpen)
    }
    await commitOpen();
    store.markSaved();
    autosavedRevision = store.projectRevision;
    await clearAutosave().catch(() => {});
    showToast(t("toast.opened", { file: opened.fileName }), "success");
  }

  /** Continues the action the unsaved-changes prompt was guarding. */
  async function continuePending(): Promise<void> {
    const action = pending;
    pending = null;
    store.closeModal();
    if (action === "open") await doOpen();
    if (action === "close") {
      await clearAutosave().catch(() => {});
      await closeWindow();
    }
  }

  // Core close guard: it only blocks the close while the project is dirty.
  let lastDirty = false;
  store.subscribe(() => {
    if (store.dirty === lastDirty) return;
    lastDirty = store.dirty;
    setDirty(lastDirty).catch((err: unknown) => console.error("[projeto] set_dirty:", err));
  });
  void onCloseRequested(() => {
    pending = "close";
    store.openModal("unsaved");
  }).catch((err: unknown) => console.error("[projeto] listen close-requested:", err));

  setInterval(() => {
    const revision = store.projectRevision;
    if (!store.dirty || revision === autosavedRevision) return;
    serialize()
      .then(autosaveProject)
      .then(() => {
        autosavedRevision = revision;
      })
      .catch((err: unknown) => console.error("[projeto] autosave falhou:", err));
  }, AUTOSAVE_INTERVAL_MS);

  return {
    save,

    async open() {
      if (store.dirty) {
        pending = "open";
        store.openModal("unsaved");
        return;
      }
      await doOpen();
    },

    async checkRecovery() {
      try {
        recovery = await loadAutosave();
      } catch (err) {
        showToast(t("toast.recoveryInvalid", { error: errorText(err) }), "danger");
        return;
      }
      if (recovery) store.openModal("recovery");
    },

    async resolveRecovery(choice) {
      const project = recovery;
      recovery = null;
      store.closeModal();
      if (choice === "discard" || !project) {
        await clearAutosave().catch(() => {});
        return;
      }
      try {
        await load(project);
        // Stays dirty (never saved to a file); the copy stays until a save.
        showToast(t("toast.recovered"), "info");
      } catch (err) {
        showToast(t("toast.recoverFailed", { error: errorText(err) }), "danger");
      }
    },

    async resolveUnsaved(choice) {
      if (choice === "cancel") {
        pending = null;
        store.closeModal();
        return;
      }
      if (choice === "save" && !(await save(false))) return; // cancelled or failed
      await continuePending();
    },
  };
}

/** `Ctrl/Cmd+S` save, `Ctrl/Cmd+Shift+S` save as, `Ctrl/Cmd+O` open (UX.md §4). */
export function initProjectShortcuts(actions: ProjectActions): () => void {
  function onKeydown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "s") {
      e.preventDefault();
      void actions.save(e.shiftKey);
    } else if (key === "o" && !e.shiftKey) {
      e.preventDefault();
      void actions.open();
    }
  }
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
