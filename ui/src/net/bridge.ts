/**
 * Bridge to the Rust core — all `invoke` calls go through this module.
 */
import { invoke } from "@tauri-apps/api/core";

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
