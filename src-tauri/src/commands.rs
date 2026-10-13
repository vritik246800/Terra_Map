//! Tauri commands exposed to the frontend.
//!
//! Every command follows the same bridge pattern: thin wrappers here,
//! real logic in dedicated modules.

use tauri::AppHandle;

use crate::error::AppError;
use crate::glb::{self, PickedGlb};
use crate::project::{self, PresetSummary, TerrainPresetFile};
use crate::terrain::{self, TerrainPreset};

/// Health-check command used to verify the Rust ↔ TypeScript bridge.
#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}

/// Generates a terrain heightmap (`res * res` heights in meters, row-major).
///
/// `amplitude`/`frequency` only apply to the `custom` preset; pass `None`
/// for the built-in presets (they use fixed signature values).
#[tauri::command]
pub fn generate_terrain(
    preset: &str,
    size: u32,
    res: u32,
    seed: u32,
    amplitude: Option<f64>,
    frequency: Option<f64>,
) -> Result<Vec<f32>, AppError> {
    terrain::generate_heightmap(
        TerrainPreset::parse(preset)?,
        size,
        res,
        seed,
        amplitude.unwrap_or(10.0),
        frequency.unwrap_or(1.0),
    )
}

/// Saves a terrain preset (JSON) under `<app_data_dir>/presets/`.
#[tauri::command]
pub fn save_terrain_preset(app: AppHandle, preset: TerrainPresetFile) -> Result<(), AppError> {
    project::save_terrain_preset(&app, &preset)
}

/// Lists saved terrain presets (name + base preset + file stem).
#[tauri::command]
pub fn list_terrain_presets(app: AppHandle) -> Result<Vec<PresetSummary>, AppError> {
    project::list_terrain_presets(&app)
}

/// Loads a terrain preset by the file stem returned by `list_terrain_presets`.
#[tauri::command]
pub fn load_terrain_preset(app: AppHandle, file: &str) -> Result<TerrainPresetFile, AppError> {
    project::load_terrain_preset(&app, file)
}

/// Saves `.glb` bytes via a native save dialog (filter `*.glb`).
/// Returns the written path, or `None` when the user cancelled (Fase 5).
#[tauri::command]
pub fn save_glb(app: AppHandle, bytes: Vec<u8>) -> Result<Option<String>, AppError> {
    glb::save_glb_with_dialog(&app, &bytes)
}

/// Opens a `.glb` file via a native open dialog (filter `*.glb`).
/// Returns its contents, or `None` when the user cancelled (Fase 5).
#[tauri::command]
pub fn open_glb_dialog(app: AppHandle) -> Result<Option<PickedGlb>, AppError> {
    glb::open_glb_with_dialog(&app)
}
