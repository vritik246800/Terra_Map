/**
 * Minimal typed pub/sub store (PLAN.md Fases 2–4).
 *
 * Holds:
 *  - the currently selected `entityId` plus the data of scene entities
 *    (kind, construction phase, transform, collision flag — DESIGN.md §4.1
 *    `Building`/`Transform`);
 *  - the active tool (`select` | `brush` | `dragging` — DESIGN.md §12);
 *  - brush settings (radius/intensity) and the terrain state (active preset,
 *    custom generation params);
 *  - the name of the imported `.glb` available in the catalog (Fase 5);
 *  - network & telecom state (Fase 6): the cables edge list (`CableInfo`,
 *    the in-memory network graph — nodes are the entities), per-element
 *    dynamic props (DESIGN.md §4.2) and the cable tool settings;
 *  - simulator state (Fase 7): origin/destination, Dijkstra criterion, last
 *    result, simulated failures and the antenna coverage map. Failures are
 *    simulation-only — never saved with the project (Q_LIST.md Q07);
 *  - project identity and unsaved state (Fase 8): name/id, a `revision`
 *    bumped by every project mutation (entities, cables, terrain) and the
 *    revision last saved — `dirty` is their difference — plus the open modal;
 *  - productivity (Fase 10): multi-selection (`selection`, last = primary
 *    `selected`), layers (visibility/lock per fixed layer), snap settings,
 *    the layers panel toggle and a terrain revision the undo history reads;
 *  - environment (Fase 11): hour/fog/water (saved, not undoable), roads,
 *    vegetation and the settings of the material/vegetation/road tools;
 *  - measurement and reports (Fase 12): the ruler points (temporary) and the
 *    saved scenarios (in the project, not undoable).
 *
 * Two listener channels keep notifications focused: `subscribeSelection`
 * fires only on selection changes, `subscribe` fires on any state change
 * (panels, gizmo, selection ring). Commands/undo arrive in Fase 10
 * (DESIGN.md §11) — no mutation history here yet.
 */

import type { CoverageResult, PathResult, Scenario, SimWeight } from "../net/bridge";
import { t } from "./i18n";

/** Kinds of infrastructure placeable from the catalog (Fase 4). */
export type BuildingKind = "house" | "building" | "lot";

/** Kinds of network & telecom elements (PLAN.md Fase 6, DESIGN.md §4.1). */
export type NetworkKind =
  "antenna" | "router" | "switch" | "olt" | "onu" | "splitter" | "pole" | "box";

export const NETWORK_KINDS: ReadonlySet<string> = new Set<NetworkKind>([
  "antenna",
  "router",
  "switch",
  "olt",
  "onu",
  "splitter",
  "pole",
  "box",
]);

export function isNetworkKind(kind: string): kind is NetworkKind {
  return NETWORK_KINDS.has(kind);
}

/** Kind of the imported `.glb` catalog model (PLAN.md Fase 5). */
export const CUSTOM_GLB_KIND = "customGlb";

/** Kind of terrain/infra markers — pins with a label and a note (Fase 6). */
export const MARKER_KIND = "marker";

/** Every placeable entity kind (procedural, imported .glb, marker). */
export type EntityKind = BuildingKind | NetworkKind | typeof CUSTOM_GLB_KIND | typeof MARKER_KIND;

/** Value of a dynamic network property (DESIGN.md §4.2). */
export type DynamicValue = number | string | boolean;

/**
 * Default dynamic props seeded on spawn (DESIGN.md §4.2) — they make the
 * Fase 7 simulations meaningful out of the box and are editable in the panel.
 */
export const DEFAULT_NETWORK_PROPS: Record<NetworkKind, Record<string, DynamicValue>> = {
  antenna: { frequency: 3500, power: 43, gain: 18, range: 500 },
  router: { bandwidth: 1000, latency: 1 },
  switch: { bandwidth: 1000, latency: 0.5 },
  // Fase 7 link budget (Q_LIST.md Q08): OLT launch power, ONU sensitivity (GPON B+).
  olt: { bandwidth: 10000, latency: 1, power: 5 },
  onu: { bandwidth: 1000, power: 2, sensitivity: -28 },
  splitter: { splitRatio: "1:32", attenuation: 17 },
  pole: {},
  box: {},
};

export interface Vec3Data {
  x: number;
  y: number;
  z: number;
}

/** DESIGN.md §4.1 `Transform` — rotation in degrees (edited by spinners). */
export interface TransformData {
  position: Vec3Data;
  rotation: Vec3Data;
  scale: Vec3Data;
}

export interface EntityInfo {
  id: string;
  /** Stable kind key (e.g. "house", "building", "olt"); the UI maps it to a label. */
  kind: string;
  /** Construction phase: 0 fundações, 1 estrutura, 2 acabamento (DESIGN.md §6). */
  phase: number;
  transform: TransformData;
  /** Numeric params of the procedural model (e.g. `floors` of a building). */
  params: Record<string, number>;
  /** Editable key-value network properties (DESIGN.md §4.2; Fase 6). */
  dynamicProps: Record<string, DynamicValue>;
  /** True while the footprint overlaps another infrastructure (warning, non-blocking). */
  colliding: boolean;
  /** Marker label/note (kind `marker`, Fase 6). */
  label?: string;
  note?: string;
  /** Entity a marker was placed on (kind `marker`; undefined = on the terrain). */
  targetId?: string;
}

/** Cable edge between two entities (PLAN.md Fase 6, DESIGN.md §4.1 `Cable`). */
export type CableType = "fiber" | "copper" | "coax";
export type CableRoute = "underground" | "aerial" | "direct";

export interface CableInfo {
  id: string;
  /** Endpoint entity ids (nodes of the network graph). */
  fromId: string;
  toId: string;
  cableType: CableType;
  route: CableRoute;
  /** Editable key-value properties (DESIGN.md §4.2). */
  dynamicProps: Record<string, DynamicValue>;
}

/**
 * Default dynamic props per cable type (DESIGN.md §4.2): attenuation in
 * dB/km, bandwidth in Mbps, costPerMeter in €.
 */
export const DEFAULT_CABLE_PROPS: Record<CableType, Record<string, DynamicValue>> = {
  fiber: { bandwidth: 10000, attenuation: 0.35, costPerMeter: 1.2 },
  copper: { bandwidth: 1000, attenuation: 24, costPerMeter: 0.8 },
  coax: { bandwidth: 1000, attenuation: 14, costPerMeter: 0.6 },
};

/** Transform of a freshly placed entity (identity). */
export function identityTransform(): TransformData {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

/** Deep-enough copy: transform data is plain numbers. */
export function cloneTransform(t: TransformData): TransformData {
  return {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  };
}

/** Independent copy of an entity's data (undo snapshots, copy/paste — Fase 10). */
export function cloneEntityInfo(info: EntityInfo): EntityInfo {
  return {
    ...info,
    transform: cloneTransform(info.transform),
    params: { ...info.params },
    dynamicProps: { ...info.dynamicProps },
    colliding: false,
  };
}

/** Independent copy of a cable's data (Fase 10). */
export function cloneCableInfo(info: CableInfo): CableInfo {
  return { ...info, dynamicProps: { ...info.dynamicProps } };
}

/** Tools of the state machine in DESIGN.md §12 (dragging = catalog drag & drop). */
export type ToolId =
  "select" | "brush" | "paint" | "vegetation" | "road" | "cable" | "marker" | "ruler" | "dragging";

/** Camera drag with the left button (Fase 16): rotate around the target or pan. */
export type CameraMode = "orbit" | "pan";

/** Ruler measurement (Fase 12): temporary — never saved nor undone (Q_LIST.md Q22). */
export interface RulerState {
  from: Vec3Data | null;
  /** Set by the 2nd click; the next click starts a new measurement. */
  to: Vec3Data | null;
}

/** Terrain material of the paint brush (Fase 11): 0 = altitude gradient. */
export type MaterialId = 0 | 1 | 2 | 3 | 4 | 5;

export interface EnvironmentState {
  /** Hour of the day, 0–24 (A18). */
  hour: number;
  /** Fog density 0–1. */
  fog: number;
  water: { enabled: boolean; level: number };
}

/** Road drawn by points over the relief (Fase 11, MODELO_DADOS.md §1.1). */
export interface RoadInfo {
  id: string;
  points: Array<{ x: number; z: number }>;
  width: number;
}

export type PlantKind = "tree" | "bush";

/** One instance of the vegetation brush (Fase 11). */
export interface Plant {
  kind: PlantKind;
  x: number;
  z: number;
  scale: number;
  /** Rotation around Y (radians). */
  rotation: number;
}

export const DEFAULT_ENVIRONMENT: EnvironmentState = {
  hour: 12,
  fog: 0,
  water: { enabled: false, level: 0 },
};

/** Terrain presets known to the app (DESIGN.md §4.1 `Terrain.preset`). */
export type TerrainPresetId = "flat" | "mountains" | "valley" | "custom";

/** User-facing parameters of the `custom` terrain preset (PLAN.md Fase 3). */
export interface CustomTerrainParams {
  seed: number;
  amplitude: number;
  frequency: number;
  size: number;
}

export const DEFAULT_CUSTOM_PARAMS: CustomTerrainParams = {
  seed: 42,
  amplitude: 10,
  frequency: 1,
  size: 200,
};

/** Simulator state (Fase 7, FEATURE_SIMULADOR_REDES.md). */
export interface SimulationState {
  fromId: string | null;
  toId: string | null;
  weight: SimWeight;
  /** Last Dijkstra result; `null` before a run or when there was no path. */
  result: PathResult | null;
  /** True when the last run found no active path. */
  noPath: boolean;
  /** Entity/cable ids in simulated failure (skipped by Dijkstra). */
  failed: Set<string>;
  coverage: { antennaId: string; result: CoverageResult } | null;
}

/** Fixed layers (Fase 10, MODELO_DADOS.md §1.1). */
export type LayerId = "terrain" | "infra" | "net" | "markers";
export const LAYER_IDS: readonly LayerId[] = ["terrain", "infra", "net", "markers"];

/** Layer of an entity kind (cables are always `net`). */
export function layerOfKind(kind: string): LayerId {
  if (kind === MARKER_KIND) return "markers";
  return isNetworkKind(kind) ? "net" : "infra";
}

export interface LayerState {
  visible: boolean;
  locked: boolean;
}

/** Grid snap step in meters (0 = off) — Fase 10. */
export type SnapGrid = 0 | 0.25 | 0.5 | 1;

/** Modals of the app (Fase 8, UX.md §1.1). */
export type ModalId =
  "shortcuts" | "guide" | "recovery" | "unsaved" | "report" | "profile" | "onboarding" | "update";

type Listener = () => void;

/** Selected ids in selection order; the last one is the primary (`selected`). */
let selectedIds: string[] = [];
const layers: Record<LayerId, LayerState> = {
  terrain: { visible: true, locked: false },
  infra: { visible: true, locked: false },
  net: { visible: true, locked: false },
  markers: { visible: true, locked: false },
};
const snap: { grid: SnapGrid; objects: boolean } = { grid: 0, objects: false };
let layersPanelOpen = false;
/** Fase 16 (Q_LIST.md Q38): what the left mouse button does to the camera. */
let cameraMode: CameraMode = "orbit";
let terrainRevision = 0;
// Fase 11
const environment: EnvironmentState = {
  ...DEFAULT_ENVIRONMENT,
  water: { ...DEFAULT_ENVIRONMENT.water },
};
let environmentPanelOpen = false;
const paintTool: { material: MaterialId } = { material: 1 };
const vegetationTool: { kind: PlantKind; density: number } = { kind: "tree", density: 0.05 };
const roadTool = { width: 4 };
const roads = new Map<string, RoadInfo>();
let vegetation: Plant[] = [];
// Fase 12
const ruler: RulerState = { from: null, to: null };
let scenarios: Scenario[] = [];
let activeTool: ToolId = "select";
let terrainPreset: TerrainPresetId = "flat";
let customGlbName: string | null = null;
const customParams: CustomTerrainParams = { ...DEFAULT_CUSTOM_PARAMS };
const brush = { radius: 6, intensity: 0.5 };
const cableTool: { cableType: CableType; route: CableRoute } = {
  cableType: "fiber",
  route: "underground",
};

const simulation: SimulationState = {
  fromId: null,
  toId: null,
  weight: "distance",
  result: null,
  noPath: false,
  failed: new Set(),
  coverage: null,
};

/** Drops every simulator reference to a deleted entity/cable (silent). */
function forgetInSimulation(id: string): void {
  simulation.failed.delete(id);
  if (simulation.fromId === id) simulation.fromId = null;
  if (simulation.toId === id) simulation.toId = null;
  if (simulation.result?.nodes.includes(id) || simulation.result?.edges.includes(id)) {
    simulation.result = null; // stale path
  }
  if (simulation.coverage?.antennaId === id) simulation.coverage = null;
}

let projectName = t("app.untitled");
let projectId = `proj_${Date.now().toString(36)}`;
/** Bumped by every project mutation; `savedRevision` = last saved/opened. */
let revision = 0;
let savedRevision = 0;
let modal: ModalId | null = null;

/** Bumped on every notification — the React snapshot (`state/use-store.ts`). */
let version = 0;

const listeners = new Set<Listener>();
const selectionListeners = new Set<Listener>();
const entities = new Map<string, EntityInfo>();
const cables = new Map<string, CableInfo>();

/** Layer of an entity, cable or road id. */
function layerOfId(id: string): LayerId {
  const info = entities.get(id);
  if (info) return layerOfKind(info.kind);
  return roads.has(id) ? "infra" : "net";
}

function notifySelection(): void {
  selectionListeners.forEach((l) => l());
  notify();
}

/** Drops a deleted id from the selection (silent; the caller notifies). */
function forgetSelected(id: string): boolean {
  const index = selectedIds.indexOf(id);
  if (index < 0) return false;
  selectedIds.splice(index, 1);
  selectionListeners.forEach((l) => l());
  return true;
}

function notify(): void {
  version++;
  listeners.forEach((l) => l());
}

export const store = {
  /** Selects only `id` (`null` clears) and notifies subscribers. */
  select(id: string | null): void {
    const next = id === null ? [] : [id];
    if (next.length === selectedIds.length && next[0] === selectedIds[0]) return; // no-op
    selectedIds = next;
    notifySelection();
  },

  /** Shift+click (Fase 10): adds `id` to the selection, or removes it. */
  toggleSelect(id: string): void {
    if (!forgetSelected(id)) selectedIds.push(id);
    notifySelection();
  },

  /** Replaces the selection (`add` = union with the current one, marquee). */
  selectMany(ids: string[], add = false): void {
    const base = add ? selectedIds.filter((id) => !ids.includes(id)) : [];
    selectedIds = [...base, ...ids];
    notifySelection();
  },

  /** Primary selection (the last one selected), or null. */
  get selected(): string | null {
    return selectedIds.at(-1) ?? null;
  },

  /** Every selected entity/cable id, primary last. */
  get selection(): readonly string[] {
    return selectedIds;
  },

  isSelected(id: string): boolean {
    return selectedIds.includes(id);
  },

  /** Registers the data of an entity present in the scene (Fase 4). */
  registerEntity(info: EntityInfo): void {
    entities.set(info.id, info);
    revision++;
    notify();
  },

  /** Removes an entity from the registry (deletion — scene cleanup is the registry's job). */
  unregisterEntity(id: string): void {
    if (!entities.delete(id)) return;
    forgetInSimulation(id);
    forgetSelected(id);
    revision++;
    notify();
  },

  getEntityInfo(id: string): EntityInfo | undefined {
    return entities.get(id);
  },

  /** Applies a partial update to an entity (phase, transform, params) and notifies. */
  updateEntity(
    id: string,
    patch: Partial<
      Pick<EntityInfo, "phase" | "transform" | "params" | "dynamicProps" | "label" | "note">
    >,
  ): void {
    const info = entities.get(id);
    if (!info) return;
    Object.assign(info, patch);
    revision++;
    notify();
  },

  // ---- Cables (Fase 6: edges of the in-memory network graph) ----

  /** Registers a cable (scene mesh is the CableRegistry's job) and notifies. */
  registerCable(info: CableInfo): void {
    cables.set(info.id, info);
    revision++;
    notify();
  },

  /** Removes a cable from the graph. */
  unregisterCable(id: string): void {
    if (!cables.delete(id)) return;
    forgetInSimulation(id);
    revision++;
    forgetSelected(id);
    notify();
  },

  getCableInfo(id: string): CableInfo | undefined {
    return cables.get(id);
  },

  /** Cables connected to an entity (either endpoint). */
  cablesOf(entityId: string): CableInfo[] {
    return [...cables.values()].filter((c) => c.fromId === entityId || c.toId === entityId);
  },

  /** All cables — the edge list of the network graph (Fase 7 feeds it to Rust). */
  allCables(): CableInfo[] {
    return [...cables.values()];
  },

  /**
   * Serializable snapshot of the network graph (Fases 7/8 feed it to the
   * Rust simulations): entities are the nodes, cables the edges. Returns
   * copies of the current maps so callers can freely serialize/mutate them.
   */
  networkGraph(): { nodes: EntityInfo[]; edges: CableInfo[] } {
    return { nodes: [...entities.values()], edges: [...cables.values()] };
  },

  /** Applies a partial update to a cable (type, route, dynamicProps) and notifies. */
  updateCable(
    id: string,
    patch: Partial<Pick<CableInfo, "cableType" | "route" | "dynamicProps">>,
  ): void {
    const info = cables.get(id);
    if (!info) return;
    Object.assign(info, patch);
    revision++;
    notify();
  },

  /**
   * Sets the collision flag without notifying — collision checks run in
   * batches during moves; the caller triggers `notifyChange()` once at the
   * end if any flag actually changed (avoids a notification storm per frame).
   * Returns true when the flag changed.
   */
  setEntityColliding(id: string, colliding: boolean): boolean {
    const info = entities.get(id);
    if (!info || info.colliding === colliding) return false;
    info.colliding = colliding;
    return true;
  },

  /** Triggers a general notification (e.g. after a batch of silent mutations). */
  notifyChange(): void {
    notify();
  },

  // ---- Tools (DESIGN.md §12) ----

  /** Activates a tool; only one tool is active at a time. */
  setTool(tool: ToolId): void {
    if (tool === activeTool) return;
    if (activeTool === "ruler") ruler.from = ruler.to = null; // leaving the ruler clears it
    activeTool = tool;
    notify();
  },

  get tool(): ToolId {
    return activeTool;
  },

  // ---- Cable tool settings (Fase 6: type + route chosen in the panel) ----

  get cableTool(): Readonly<{ cableType: CableType; route: CableRoute }> {
    return cableTool;
  },

  setCableType(cableType: CableType): void {
    if (cableType === cableTool.cableType) return;
    cableTool.cableType = cableType;
    notify();
  },

  setCableRoute(route: CableRoute): void {
    if (route === cableTool.route) return;
    cableTool.route = route;
    notify();
  },

  // ---- Simulator (Fase 7) ----

  get simulation(): Readonly<SimulationState> {
    return simulation;
  },

  /** Sets the origin (`from`) or destination (`to`) of the path to simulate. */
  setSimEndpoint(role: "from" | "to", id: string | null): void {
    if (role === "from") simulation.fromId = id;
    else simulation.toId = id;
    notify();
  },

  setSimWeight(weight: SimWeight): void {
    if (weight === simulation.weight) return;
    simulation.weight = weight;
    notify();
  },

  /** Stores the last Dijkstra result (`null` + `noPath` = no active path). */
  setSimResult(result: PathResult | null, noPath = false): void {
    simulation.result = result;
    simulation.noPath = noPath;
    notify();
  },

  /** Toggles the simulated failure of an entity or cable. */
  toggleFailed(id: string): void {
    if (!simulation.failed.delete(id)) simulation.failed.add(id);
    notify();
  },

  setCoverage(coverage: SimulationState["coverage"]): void {
    simulation.coverage = coverage;
    notify();
  },

  /** Resets the simulator: endpoints, result, failures and coverage. */
  clearSimulation(): void {
    simulation.fromId = simulation.toId = null;
    simulation.failed.clear();
    simulation.result = null;
    simulation.noPath = false;
    simulation.coverage = null;
    notify();
  },

  // ---- Brush settings (DESIGN.md §6: radius step 1, intensity step 0.1) ----

  get brush(): Readonly<{ radius: number; intensity: number }> {
    return brush;
  },

  setBrushRadius(radius: number): void {
    brush.radius = radius;
    notify();
  },

  setBrushIntensity(intensity: number): void {
    brush.intensity = intensity;
    notify();
  },

  // ---- Terrain state ----

  get terrainPreset(): TerrainPresetId {
    return terrainPreset;
  },

  setTerrainPreset(preset: TerrainPresetId): void {
    terrainPreset = preset;
    notify();
  },

  // ---- Custom .glb model (PLAN.md Fase 5) ----

  /** Name of the imported `.glb` available in the catalog; `null` before the first import. */
  get customGlbName(): string | null {
    return customGlbName;
  },

  setCustomGlbName(name: string): void {
    if (name === customGlbName) return;
    customGlbName = name;
    notify();
  },

  get customParams(): Readonly<CustomTerrainParams> {
    return customParams;
  },

  setCustomParams(patch: Partial<CustomTerrainParams>): void {
    Object.assign(customParams, patch);
    notify();
  },

  // ---- Project (Fase 8) ----

  get projectName(): string {
    return projectName;
  },

  setProjectName(name: string): void {
    if (name === projectName) return;
    projectName = name;
    revision++;
    notify();
  },

  get projectId(): string {
    return projectId;
  },

  /** Identity of an opened/recovered project (not a user edit). */
  setProjectIdentity(id: string, name: string): void {
    projectId = id;
    projectName = name;
    notify();
  },

  /** Terrain edits (brush stroke, preset, heightmap): the undo history snapshots the terrain. */
  markTerrainChanged(): void {
    terrainRevision++;
    revision++;
    notify();
  },

  get terrainRevision(): number {
    return terrainRevision;
  },

  get projectRevision(): number {
    return revision;
  },

  /** True while there are changes not yet saved. */
  get dirty(): boolean {
    return revision !== savedRevision;
  },

  /** The project at `rev` (default: now) is on disk. */
  markSaved(rev = revision): void {
    savedRevision = rev;
    notify();
  },

  get modal(): ModalId | null {
    return modal;
  },

  openModal(id: ModalId): void {
    if (modal === id) return;
    modal = id;
    notify();
  },

  closeModal(): void {
    if (modal === null) return;
    modal = null;
    notify();
  },

  // ---- Layers, snap, layers panel (Fase 10) ----

  layer(id: LayerId): Readonly<LayerState> {
    return layers[id];
  },

  setLayer(id: LayerId, patch: Partial<LayerState>): void {
    Object.assign(layers[id], patch);
    // Hidden/locked layers drop out of the selection.
    if (!layers[id].visible || layers[id].locked) {
      const keep = selectedIds.filter((s) => layerOfId(s) !== id);
      if (keep.length !== selectedIds.length) {
        selectedIds = keep;
        selectionListeners.forEach((l) => l());
      }
    }
    notify();
  },

  /** Layer of any selectable id (entity, cable or road). */
  layerOf(id: string): LayerId {
    return layerOfId(id);
  },

  /** True when an entity/cable/road can be picked (its layer is visible and unlocked). */
  isPickable(id: string): boolean {
    const layer = layers[layerOfId(id)];
    return layer.visible && !layer.locked;
  },

  /** Rounds a coordinate to the snap grid (no-op with the grid off). */
  snapToGrid(v: number): number {
    return snap.grid > 0 ? Math.round(v / snap.grid) * snap.grid : v;
  },

  get snap(): Readonly<{ grid: SnapGrid; objects: boolean }> {
    return snap;
  },

  setSnap(patch: Partial<{ grid: SnapGrid; objects: boolean }>): void {
    Object.assign(snap, patch);
    notify();
  },

  get layersPanelOpen(): boolean {
    return layersPanelOpen;
  },

  toggleLayersPanel(): void {
    layersPanelOpen = !layersPanelOpen;
    notify();
  },

  get cameraMode(): CameraMode {
    return cameraMode;
  },

  setCameraMode(mode: CameraMode): void {
    cameraMode = mode;
    notify();
  },

  // ---- Environment, roads, vegetation (Fase 11) ----

  get environment(): Readonly<EnvironmentState> {
    return environment;
  },

  /** Hour/fog/water — saved with the project, not undoable (Q_LIST.md Q16). */
  setEnvironment(patch: Partial<EnvironmentState>): void {
    Object.assign(environment, patch);
    revision++;
    notify();
  },

  get environmentPanelOpen(): boolean {
    return environmentPanelOpen;
  },

  setEnvironmentPanel(open: boolean): void {
    environmentPanelOpen = open;
    notify();
  },

  get paintTool(): Readonly<{ material: MaterialId }> {
    return paintTool;
  },

  setPaintMaterial(material: MaterialId): void {
    paintTool.material = material;
    notify();
  },

  get vegetationTool(): Readonly<{ kind: PlantKind; density: number }> {
    return vegetationTool;
  },

  setVegetationTool(patch: Partial<{ kind: PlantKind; density: number }>): void {
    Object.assign(vegetationTool, patch);
    notify();
  },

  get roadTool(): Readonly<{ width: number }> {
    return roadTool;
  },

  setRoadWidth(width: number): void {
    roadTool.width = width;
    notify();
  },

  registerRoad(info: RoadInfo): void {
    roads.set(info.id, info);
    revision++;
    notify();
  },

  unregisterRoad(id: string): void {
    if (!roads.delete(id)) return;
    revision++;
    forgetSelected(id);
    notify();
  },

  updateRoad(id: string, patch: Partial<Pick<RoadInfo, "points" | "width">>): void {
    const info = roads.get(id);
    if (!info) return;
    Object.assign(info, patch);
    revision++;
    notify();
  },

  getRoadInfo(id: string): RoadInfo | undefined {
    return roads.get(id);
  },

  allRoads(): RoadInfo[] {
    return [...roads.values()];
  },

  get vegetation(): readonly Plant[] {
    return vegetation;
  },

  /** Replaces the whole vegetation list (one brush gesture or an undo). */
  setVegetation(next: Plant[]): void {
    vegetation = next;
    revision++;
    notify();
  },

  // ---- Ruler, scenarios (Fase 12) ----

  get ruler(): Readonly<RulerState> {
    return ruler;
  },

  setRuler(from: Vec3Data | null, to: Vec3Data | null): void {
    ruler.from = from;
    ruler.to = to;
    notify();
  },

  /** Saved metric snapshots — part of the project, outside the undo (Q_LIST.md Q22). */
  get scenarios(): readonly Scenario[] {
    return scenarios;
  },

  addScenario(scenario: Scenario): void {
    scenarios = [...scenarios, scenario];
    revision++;
    notify();
  },

  removeScenario(index: number): void {
    scenarios = scenarios.filter((_, i) => i !== index);
    revision++;
    notify();
  },

  /** Opening/recovering a project. */
  setScenarios(next: Scenario[]): void {
    scenarios = next;
    revision++;
    notify();
  },

  // ---- Subscriptions ----

  /** Changes on every notification; state objects are mutated in place. */
  get version(): number {
    return version;
  },

  /** Subscribes to any state change; returns an unsubscribe function. */
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },

  /** Subscribes to selection changes only; returns an unsubscribe function. */
  subscribeSelection(l: Listener): () => void {
    selectionListeners.add(l);
    return () => {
      selectionListeners.delete(l);
    };
  },
};
