/**
 * Bridge to the Rust core — all `invoke` calls go through this module.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Health-check: verifies the Rust ↔ TypeScript bridge is alive. */
export const ping = () => invoke<string>("ping");

// ---- Terrain (PLAN.md Fase 3) ----

/** Generation parameters stored with a terrain preset (DESIGN.md §4). */
export interface TerrainPresetParams {
  seed: number;
  amplitude: number;
  frequency: number;
  size: number;
  resolution: number;
}

/** Terrain preset file as stored on disk by the Rust core. */
export interface TerrainPresetFile {
  name: string;
  /** Base preset id (`flat | mountains | valley | custom`). */
  preset: string;
  params: TerrainPresetParams;
  /** `base64:` + float32 LE heightmap (see `scene/terrain.ts`). */
  heightmap?: string;
}

/** Summary of a saved preset, used to fill the catalog list. */
export interface PresetSummary {
  name: string;
  preset: string;
  /** File stem on disk; pass it back to `loadTerrainPreset`. */
  file: string;
}

/**
 * Generates a heightmap in the Rust core (`res * res` heights in meters,
 * row-major). `amplitude`/`frequency` only apply to the `custom` preset.
 */
export const generateTerrain = (
  preset: string,
  size: number,
  res: number,
  seed: number,
  amplitude?: number,
  frequency?: number,
) => invoke<number[]>("generate_terrain", { preset, size, res, seed, amplitude, frequency });

/** Saves a terrain preset under `<app_data_dir>/presets/`. */
export const saveTerrainPreset = (preset: TerrainPresetFile) =>
  invoke<void>("save_terrain_preset", { preset });

/** Lists saved terrain presets (name + base preset + file stem). */
export const listTerrainPresets = () => invoke<PresetSummary[]>("list_terrain_presets");

/** Loads a terrain preset by the file stem from `listTerrainPresets`. */
export const loadTerrainPreset = (file: string) =>
  invoke<TerrainPresetFile>("load_terrain_preset", { file });

// ---- GLB import/export (PLAN.md Fase 5, DESIGN.md §9.1) ----

/** Contents of a `.glb` file picked in the native open dialog. */
export interface PickedGlb {
  /** File stem — used as the catalog label of the imported model. */
  name: string;
  bytes: number[];
}

/**
 * Shows the native save dialog (filter `*.glb`) and writes the bytes in the
 * Rust core. Returns the written path, or `null` when the user cancelled.
 */
export const saveGlb = (bytes: Uint8Array) =>
  invoke<string | null>("save_glb", { bytes: [...bytes] });

/**
 * Shows the native open dialog (filter `*.glb`) and reads the picked file in
 * the Rust core. Returns `null` when the user cancelled.
 */
export const openGlbDialog = () => invoke<PickedGlb | null>("open_glb_dialog");

// ---- Network simulator (ROADMAP.md F07, FEATURE_SIMULADOR_REDES.md) ----

/** Dynamic props as sent to the core (same shape as the store's). */
export type NetworkProps = Record<string, number | string | boolean>;

/** Dijkstra criterion (FEATURE_SIMULADOR_REDES.md §2.1). */
export type SimWeight = "distance" | "cost" | "latency" | "attenuation";

/** Traffic-light status of a link or coverage cell. */
export type SimStatus = "ok" | "warn" | "danger";

/** Snapshot of the network graph: entities are nodes, cables are edges. */
export interface NetworkInput {
  nodes: Array<{ id: string; kind: string; props: NetworkProps; active: boolean }>;
  edges: Array<{
    id: string;
    fromId: string;
    toId: string;
    cableType: "fiber" | "copper" | "coax";
    /** Measured cable length (m). */
    length: number;
    props: NetworkProps;
    active: boolean;
  }>;
}

export interface LinkBudget {
  ptxDbm: number;
  gainDb: number;
  lossDb: number;
  marginDb: number;
  prxDbm: number;
  sensitivityDbm: number;
  headroomDb: number;
  status: SimStatus;
}

export interface PathMetrics {
  lengthM: number;
  latencyMs: number;
  /** Bottleneck bandwidth (Mbps); `null` when no element defines it. */
  bandwidthMbps: number | null;
  cost: number;
  attenuationDb: number;
  linkBudget: LinkBudget | null;
}

export interface PathResult {
  /** Node ids origin → destination; `edges[i]` links `nodes[i]` → `nodes[i + 1]`. */
  nodes: string[];
  edges: string[];
  weight: SimWeight;
  totalWeight: number;
  metrics: PathMetrics;
}

export interface CoverageResult {
  /** Cells per side; cell `i = gz * resolution + gx`. */
  resolution: number;
  /** Grid spans `[x − halfExtent, x + halfExtent]` (same in z). */
  halfExtent: number;
  prxDbm: Array<number | null>;
  status: Array<SimStatus | null>;
  sensitivityDbm: number;
  coveredRatio: number;
}

/** Optimal path by Dijkstra in the core; `null` when there is no active path. */
export const shortestPath = (network: NetworkInput, from: string, to: string, weight: SimWeight) =>
  invoke<PathResult | null>("shortest_path", { network, from, to, weight });

/** Coverage map of an antenna (FSPL + diffraction over the relief). */
export const antennaCoverage = (
  antenna: { x: number; z: number; txHeight: number; props: NetworkProps },
  terrain: { size: number; resolution: number; heights: number[] },
) => invoke<CoverageResult>("antenna_coverage", { antenna, terrain });

/**
 * Shows the native save dialog (filter `*.csv`) and writes the result as
 * CSV in the core. Returns the written path, or `null` when cancelled.
 */
export const exportSimulationCsv = (result: PathResult) =>
  invoke<string | null>("export_simulation_csv", { result });

// ---- Project file (ROADMAP.md F08, MODELO_DADOS.md §3) ----

export interface Vec3File {
  x: number;
  y: number;
  z: number;
}

export interface TransformFile {
  position: Vec3File;
  rotation: Vec3File;
  scale: Vec3File;
}

/** Versioned project file — validated/migrated by the core on open. */
export interface ProjectFile {
  version: number;
  id: string;
  name: string;
  terrain: {
    preset: string;
    params: TerrainPresetParams;
    heightmap: string;
    /** Fase 11: `base64:` + one material byte per vertex (0 = automatic). */
    materialMap?: string;
  };
  buildings: Array<{
    id: string;
    kind: string;
    transform: TransformFile;
    phase: number;
    params: Record<string, number>;
    /** `customGlb` only: id in `customModels`. */
    modelId?: string;
  }>;
  elements: Array<{
    id: string;
    kind: string;
    transform: TransformFile;
    phase: number;
    dynamicProps: NetworkProps;
  }>;
  cables: Array<{
    id: string;
    fromId: string;
    toId: string;
    cableType: string;
    route: string;
    /** Empty = computed from the route. */
    path: Vec3File[];
    dynamicProps: NetworkProps;
  }>;
  markers: Array<{
    id: string;
    targetId?: string;
    transform: TransformFile;
    label: string;
    note: string;
  }>;
  /** Imported `.glb` models embedded as `base64:` (Q_LIST.md Q09). */
  customModels: Array<{ id: string; name: string; glb: string }>;
  /** Layer visibility/lock (Fase 10); missing layers are visible and unlocked. */
  layers: Array<{ id: string; visible: boolean; locked: boolean }>;
  /** Fase 11: hour/fog/water — saved, not undoable. */
  environment: { hour: number; fog: number; water: { enabled: boolean; level: number } };
  roads: Array<{ id: string; points: Array<{ x: number; z: number }>; width: number }>;
  vegetation: Array<{ kind: string; x: number; z: number; scale: number; rotation: number }>;
  /** Fase 12: metric snapshots for the scenario comparator (Q_LIST.md Q21). */
  scenarios: Scenario[];
}

/** Current project format version (matches `project_file.rs`). */
export const PROJECT_VERSION = 1;

/**
 * Saves to the current path, or via the native save dialog on the first
 * save / `saveAs`. Returns the file name, or `null` when cancelled.
 */
export const saveProject = (project: ProjectFile, saveAs: boolean) =>
  invoke<string | null>("save_project", { project, saveAs });

/** Native open dialog + validation in the core; `null` when cancelled. */
export const openProject = () =>
  invoke<{ fileName: string; project: ProjectFile } | null>("open_project");

/** The opened project was rebuilt: its file becomes the save target. */
export const commitOpen = () => invoke<void>("commit_open");

/** Crash-recovery copy (`<app_data_dir>/autosave.json`). */
export const autosaveProject = (project: ProjectFile) =>
  invoke<void>("autosave_project", { project });

/** Recovery copy left by a crash, or `null`. */
export const loadAutosave = () => invoke<ProjectFile | null>("load_autosave");

export const clearAutosave = () => invoke<void>("clear_autosave");

/** Tells the core whether there are unsaved changes (close guard). */
export const setDirty = (dirty: boolean) => invoke<void>("set_dirty", { dirty });

/** Closes the window for good (after the unsaved-changes prompt). */
export const closeWindow = () => invoke<void>("close_window");

/** The core blocked a window close because of unsaved changes. */
export const onCloseRequested = (handler: () => void) => listen("close-requested", () => handler());

// ---- Report (ROADMAP.md F12, FEATURE_RELATORIOS.md) ----

/** Named metrics snapshot; `key` is stable (`cost`, `latencyMs`…), labels are translated. */
export interface Scenario {
  name: string;
  metrics: Array<{ key: string; value: number }>;
}

/** What the core needs to compute the report — counts, meters and costs are computed there. */
export interface ReportInput {
  name: string;
  /** Display date, already formatted. */
  date: string;
  terrainSize: number;
  entities: Array<{ id: string; kind: string; props: NetworkProps }>;
  /** `length` = measured cable length (m). */
  cables: Array<{ cableType: string; route: string; length: number; props: NetworkProps }>;
  roads: Array<{ length: number }>;
  simulation: PathResult | null;
  scenarios: Scenario[];
  /** Fase 13: language of the BOM, PDF and CSV texts (Q_LIST.md Q24). */
  lang: "pt" | "en";
}

export interface ReportStats {
  areaM2: number;
  buildings: number;
  elements: number;
  markers: number;
  roads: number;
  roadLengthM: number;
  cables: Array<{ cableType: string; count: number; meters: number }>;
  cableLengthM: number;
}

export interface BomRow {
  item: string;
  quantity: number;
  /** `un` or `m`. */
  unit: string;
  unitCost: number;
  total: number;
}

export interface ReportData {
  stats: ReportStats;
  bom: { rows: BomRow[]; total: number };
}

/** One sample of the terrain profile: distance from the start (m) and height (m). */
export interface ProfilePoint {
  distance: number;
  height: number;
}

/** Statistics + bill of materials of the project. */
export const projectReport = (input: ReportInput) =>
  invoke<ReportData>("project_report", { input });

/**
 * Builds the PDF in the core (with the maquete JPEG, when given) and saves it
 * via the native dialog. Returns the file name, or `null` when cancelled.
 */
export const exportReportPdf = (input: ReportInput, image: Uint8Array | null) =>
  invoke<string | null>("export_report_pdf", { input, image: image ? [...image] : null });

/** BOM as CSV via the native save dialog; `null` when cancelled. */
export const exportBomCsv = (input: ReportInput) =>
  invoke<string | null>("export_bom_csv", { input });

/** Heights along the straight line `from → to` (101 samples). */
export const terrainProfile = (
  terrain: { size: number; resolution: number; heights: number[] },
  from: { x: number; z: number },
  to: { x: number; z: number },
) => invoke<ProfilePoint[]>("terrain_profile", { terrain, from, to });
