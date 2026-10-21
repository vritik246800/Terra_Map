//! Tauri commands exposed to the frontend.
//!
//! Every command follows the same bridge pattern: thin wrappers here,
//! real logic in dedicated modules.
//!
//! Commands that show a native file dialog are `#[tauri::command(async)]`:
//! a plain sync command runs on the main thread, and `blocking_*_file()`
//! waits there for a dialog that needs that same thread — the app froze
//! (`ERRORS.md` E45). `(async)` runs them on Tauri's thread pool.

use tauri::{AppHandle, State, Window};

use crate::error::AppError;
use crate::glb::{self, PickedGlb};
use crate::network::graph::{NetworkInput, Weight};
use crate::network::metrics::{AntennaInput, CoverageResult, TerrainGrid};
use crate::network::{self, PathResult};
use crate::project::{self, PresetSummary, TerrainPresetFile};
use crate::project_file::{self, OpenedProject, ProjectFile, ProjectSession};
use crate::report::{self, Point2, ProfilePoint, ReportData, ReportInput};
use crate::terrain::{self, TerrainPreset};
use crate::update;

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
#[tauri::command(async)]
pub fn save_glb(app: AppHandle, bytes: Vec<u8>) -> Result<Option<String>, AppError> {
    glb::save_glb_with_dialog(&app, &bytes)
}

/// Opens a `.glb` file via a native open dialog (filter `*.glb`).
/// Returns its contents, or `None` when the user cancelled (Fase 5).
#[tauri::command(async)]
pub fn open_glb_dialog(app: AppHandle) -> Result<Option<PickedGlb>, AppError> {
    glb::open_glb_with_dialog(&app)
}

/// Optimal cable path between two network elements (Dijkstra, Fase 7).
/// Returns `None` when there is no active path.
#[tauri::command]
pub fn shortest_path(
    network: NetworkInput,
    from: &str,
    to: &str,
    weight: Weight,
) -> Result<Option<PathResult>, AppError> {
    network::shortest_path(network, from, to, weight)
}

/// Coverage map of an antenna over the terrain relief (Fase 7).
#[tauri::command]
pub fn antenna_coverage(
    antenna: AntennaInput,
    terrain: TerrainGrid,
) -> Result<CoverageResult, AppError> {
    network::metrics::antenna_coverage(&antenna, &terrain)
}

/// Saves a simulation result as CSV via a native save dialog (filter
/// `*.csv`). Returns the written path, or `None` when the user cancelled.
#[tauri::command(async)]
pub fn export_simulation_csv(
    app: AppHandle,
    result: PathResult,
) -> Result<Option<String>, AppError> {
    network::export::save_csv_with_dialog(&app, &result)
}

/// Saves the project (Fase 8): to the current path, or via a native save
/// dialog on the first save / `save_as`. Returns the file name, or `None`
/// when the user cancelled.
#[tauri::command(async)]
pub fn save_project(
    app: AppHandle,
    session: State<'_, ProjectSession>,
    project: ProjectFile,
    save_as: bool,
) -> Result<Option<String>, AppError> {
    project_file::save_project(&app, &session, &project, save_as)
}

/// Opens a project via a native open dialog (migrated + validated).
#[tauri::command(async)]
pub fn open_project(
    app: AppHandle,
    session: State<'_, ProjectSession>,
) -> Result<Option<OpenedProject>, AppError> {
    project_file::open_project(&app, &session)
}

/// The frontend rebuilt the opened project: its file becomes the current path.
#[tauri::command]
pub fn commit_open(session: State<'_, ProjectSession>) {
    session.commit_open();
}

/// Writes the crash-recovery copy of the project (autosave, every 60 s).
#[tauri::command]
pub fn autosave_project(app: AppHandle, project: ProjectFile) -> Result<(), AppError> {
    project_file::autosave_project(&app, &project)
}

/// Recovery copy left by a crash, if any.
#[tauri::command]
pub fn load_autosave(app: AppHandle) -> Result<Option<ProjectFile>, AppError> {
    project_file::load_autosave(&app)
}

/// Deletes the recovery copy (saved, discarded or recovered work).
#[tauri::command]
pub fn clear_autosave(app: AppHandle) -> Result<(), AppError> {
    project_file::clear_autosave(&app)
}

/// Frontend → core: unsaved changes flag (drives the close guard).
#[tauri::command]
pub fn set_dirty(session: State<'_, ProjectSession>, dirty: bool) {
    session.set_dirty(dirty);
}

/// Closes the window for good (after the unsaved-changes prompt).
#[tauri::command]
pub fn close_window(window: Window) -> Result<(), AppError> {
    window
        .destroy()
        .map_err(|e| AppError::Window(e.to_string()))
}

/// Statistics + bill of materials of the project (Fase 12).
#[tauri::command]
pub fn project_report(input: ReportInput) -> Result<ReportData, AppError> {
    report::project_report(&input)
}

/// PDF report (stats, BOM, simulation, scenarios, maquete image) via a native
/// save dialog. Returns the file name, or `None` when cancelled.
#[tauri::command(async)]
pub fn export_report_pdf(
    app: AppHandle,
    input: ReportInput,
    image: Option<Vec<u8>>,
) -> Result<Option<String>, AppError> {
    report::export_pdf(&app, &input, image)
}

/// BOM as CSV via a native save dialog. `None` when cancelled.
#[tauri::command(async)]
pub fn export_bom_csv(app: AppHandle, input: ReportInput) -> Result<Option<String>, AppError> {
    report::export_bom_csv(&app, &input)
}

/// Terrain heights along a straight line (Fase 12 — profile chart).
#[tauri::command]
pub fn terrain_profile(
    terrain: TerrainGrid,
    from: Point2,
    to: Point2,
) -> Result<Vec<ProfilePoint>, AppError> {
    report::terrain_profile(&terrain, from, to)
}

/// Fase 14: is the latest GitHub release tag newer than this build?
#[tauri::command]
pub fn is_newer_version(app: AppHandle, tag: &str) -> bool {
    update::is_newer(tag, &app.package_info().version.to_string())
}

/// Fase 14: opens the latest release page in the browser (fixed URL).
#[tauri::command(async)]
pub fn open_releases_page() -> Result<(), AppError> {
    update::open_releases_page()
}
