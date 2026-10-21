//! Project file (Fase 8, `MODELO_DADOS.md` §3): versioned JSON.
//!
//! Opened files are hostile input: `migrate` checks the version (missing or
//! newer → friendly error, never a silent refusal) and `validate` checks the
//! whole graph (terrain + heightmap size, unique ids, kinds, phases, cable and
//! marker targets, embedded `.glb` models). Paths only come from native
//! dialogs; the current path lives here (`ProjectSession`), never in the
//! frontend. Writes are atomic (temp file + rename) so a crash mid-save never
//! corrupts the previous file.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Window};
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;
use crate::project::{preset_file_stem, TerrainPresetParams};

/// Current project format version (`MODELO_DADOS.md` §3).
pub const CURRENT_VERSION: u64 = 1;
const PROJECT_FILTER_NAME: &str = "Terra_Map project";
const PROJECT_EXTENSION: &str = "json";
const DEFAULT_STEM: &str = "project";
const AUTOSAVE_FILE: &str = "autosave.json";
/// Event sent to the window when closing with unsaved changes.
pub const CLOSE_REQUESTED_EVENT: &str = "close-requested";

const TERRAIN_PRESETS: [&str; 4] = ["flat", "mountains", "valley", "custom"];
const BUILDING_KINDS: [&str; 4] = ["house", "building", "lot", "customGlb"];
const NETWORK_KINDS: [&str; 8] = [
    "antenna", "router", "switch", "olt", "onu", "splitter", "pole", "box",
];
const CABLE_TYPES: [&str; 3] = ["fiber", "copper", "coax"];
const CABLE_ROUTES: [&str; 3] = ["underground", "aerial", "direct"];
const LAYER_IDS: [&str; 4] = ["terrain", "infra", "net", "markers"];
const PLANT_KINDS: [&str; 2] = ["tree", "bush"];
const MAX_PLANTS: usize = 50_000;
const MAX_ROAD_WIDTH: f64 = 100.0;
const MAX_PLANT_SCALE: f64 = 20.0;
const MAX_RESOLUTION: u32 = 1024;
const MAX_SIZE: u32 = 10_000;
const BASE64_PREFIX: &str = "base64:";

pub type Props = serde_json::Map<String, serde_json::Value>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Transform {
    pub position: Vec3,
    /// Degrees (edited by spinners).
    pub rotation: Vec3,
    pub scale: Vec3,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerrainData {
    pub preset: String,
    pub params: TerrainPresetParams,
    /// `base64:` + float32 LE heights, `resolution²` values, row-major.
    pub heightmap: String,
    /// Fase 11: `base64:` + one byte per vertex (0 = altitude gradient,
    /// 1 grass, 2 dirt, 3 sand, 4 rock, 5 snow); absent = all automatic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_map: Option<String>,
}

/// Water plane (Fase 11).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Water {
    pub enabled: bool,
    /// World height of the water surface (m).
    pub level: f64,
}

/// Environment settings (Fase 11) — not undoable, saved with the project.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Environment {
    /// Hour of the day, 0–24.
    pub hour: f64,
    /// Fog density, 0 (none) – 1 (dense).
    pub fog: f64,
    pub water: Water,
}

impl Default for Environment {
    fn default() -> Self {
        Self {
            hour: 12.0,
            fog: 0.0,
            water: Water {
                enabled: false,
                level: 0.0,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct RoadPoint {
    pub x: f64,
    pub z: f64,
}

/// Road drawn by points over the relief (Fase 11).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Road {
    pub id: String,
    pub points: Vec<RoadPoint>,
    pub width: f64,
}

/// One tree or bush of the vegetation brush (Fase 11).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Plant {
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub scale: f64,
    /// Rotation around Y (radians).
    pub rotation: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Building {
    pub id: String,
    pub kind: String,
    pub transform: Transform,
    pub phase: u8,
    #[serde(default)]
    pub params: HashMap<String, f64>,
    /// `customGlb` only: id of the embedded model in `customModels`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id: String,
    pub kind: String,
    pub transform: Transform,
    pub phase: u8,
    #[serde(default)]
    pub dynamic_props: Props,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cable {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub cable_type: String,
    pub route: String,
    /// Empty = computed from the route (relief / catenary).
    #[serde(default)]
    pub path: Vec<Vec3>,
    #[serde(default)]
    pub dynamic_props: Props,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,
    pub transform: Transform,
    pub label: String,
    #[serde(default)]
    pub note: String,
}

/// Visibility/lock of one of the fixed layers (Fase 10).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub visible: bool,
    pub locked: bool,
}

/// One metric of a saved scenario (Fase 12): a stable key (`cost`,
/// `latencyMs`…) — the UI and the PDF translate it — and its value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScenarioMetric {
    pub key: String,
    pub value: f64,
}

/// Metrics snapshot for the scenario comparator (Fase 12, `Q_LIST.md` Q21).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Scenario {
    pub name: String,
    pub metrics: Vec<ScenarioMetric>,
}

/// Imported `.glb` model embedded in the project (`Q_LIST.md` Q09).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomModel {
    pub id: String,
    pub name: String,
    /// `base64:` + `.glb` bytes.
    pub glb: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub version: u64,
    pub id: String,
    pub name: String,
    pub terrain: TerrainData,
    #[serde(default)]
    pub buildings: Vec<Building>,
    #[serde(default)]
    pub elements: Vec<Element>,
    #[serde(default)]
    pub cables: Vec<Cable>,
    #[serde(default)]
    pub markers: Vec<Marker>,
    #[serde(default)]
    pub custom_models: Vec<CustomModel>,
    /// Missing layers are visible and unlocked (Fase 10).
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub environment: Environment,
    #[serde(default)]
    pub roads: Vec<Road>,
    #[serde(default)]
    pub vegetation: Vec<Plant>,
    #[serde(default)]
    pub scenarios: Vec<Scenario>,
}

fn invalid<T>(msg: impl Into<String>) -> Result<T, AppError> {
    Err(AppError::InvalidProject(msg.into()))
}

/// Length of the base64 text of `bytes` bytes (with padding).
fn base64_len(bytes: usize) -> usize {
    bytes.div_ceil(3) * 4
}

fn is_base64(text: &str) -> bool {
    text.bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

fn check_transform(id: &str, t: &Transform) -> Result<(), AppError> {
    let s = t.scale;
    if s.x <= 0.0 || s.y <= 0.0 || s.z <= 0.0 {
        return invalid(format!("invalid scale on {id}"));
    }
    Ok(())
}

fn check_phase(id: &str, phase: u8) -> Result<(), AppError> {
    if phase > 2 {
        return invalid(format!("invalid phase {phase} on {id} (0–2)"));
    }
    Ok(())
}

impl ProjectFile {
    /// Validates everything the frontend relies on to rebuild the scene.
    pub fn validate(&self) -> Result<(), AppError> {
        let t = &self.terrain;
        if !TERRAIN_PRESETS.contains(&t.preset.as_str()) {
            return invalid(format!("unknown terrain preset: {}", t.preset));
        }
        let p = &t.params;
        if !(2..=MAX_RESOLUTION).contains(&p.resolution) || p.size == 0 || p.size > MAX_SIZE {
            return invalid("terrain dimensions out of bounds");
        }
        let heights = (p.resolution as usize).pow(2);
        match t.heightmap.strip_prefix(BASE64_PREFIX) {
            Some(b64) if b64.len() == base64_len(heights * 4) && is_base64(b64) => {}
            _ => return invalid("terrain heightmap invalid or of the wrong size"),
        }
        if let Some(map) = &t.material_map {
            match map.strip_prefix(BASE64_PREFIX) {
                Some(b64) if b64.len() == base64_len(heights) && is_base64(b64) => {}
                _ => return invalid("terrain material map invalid or of the wrong size"),
            }
        }

        let env = &self.environment;
        if !(0.0..=24.0).contains(&env.hour)
            || !(0.0..=1.0).contains(&env.fog)
            || !env.water.level.is_finite()
            || env.water.level.abs() > 1000.0
        {
            return invalid("environment settings out of bounds");
        }
        if self.vegetation.len() > MAX_PLANTS {
            return invalid(format!("too much vegetation (max. {MAX_PLANTS})"));
        }
        for p in &self.vegetation {
            if !PLANT_KINDS.contains(&p.kind.as_str())
                || !(p.scale > 0.0 && p.scale <= MAX_PLANT_SCALE)
            {
                return invalid(format!("invalid plant: {}", p.kind));
            }
        }
        if self.scenarios.len() > 50 {
            return invalid("too many scenarios (max. 50)");
        }
        for sc in &self.scenarios {
            if sc.name.trim().is_empty()
                || sc.name.chars().count() > 80
                || sc.metrics.len() > 32
                || sc
                    .metrics
                    .iter()
                    .any(|m| m.key.is_empty() || m.key.len() > 40)
            {
                return invalid(format!("invalid scenario: “{}”", sc.name));
            }
        }
        for r in &self.roads {
            if r.points.len() < 2 || !(r.width > 0.0 && r.width <= MAX_ROAD_WIDTH) {
                return invalid(format!("invalid road: {}", r.id));
            }
        }

        let mut layers = HashSet::new();
        for l in &self.layers {
            if !LAYER_IDS.contains(&l.id.as_str()) || !layers.insert(l.id.as_str()) {
                return invalid(format!("unknown or repeated layer: {}", l.id));
            }
        }

        let mut ids = HashSet::new();
        let all_ids = self
            .buildings
            .iter()
            .map(|b| &b.id)
            .chain(self.elements.iter().map(|e| &e.id))
            .chain(self.markers.iter().map(|m| &m.id))
            .chain(self.cables.iter().map(|c| &c.id))
            .chain(self.roads.iter().map(|r| &r.id));
        for id in all_ids {
            if id.is_empty() || !ids.insert(id.as_str()) {
                return invalid(format!("repeated or empty id: “{id}”"));
            }
        }

        let mut models = HashSet::new();
        for m in &self.custom_models {
            if !models.insert(m.id.as_str()) {
                return invalid(format!("repeated model: {}", m.id));
            }
            match m.glb.strip_prefix(BASE64_PREFIX) {
                Some(b64) if !b64.is_empty() && is_base64(b64) => {}
                _ => return invalid(format!("invalid .glb model: {}", m.name)),
            }
        }

        for b in &self.buildings {
            if !BUILDING_KINDS.contains(&b.kind.as_str()) {
                return invalid(format!("unknown kind on {}: {}", b.id, b.kind));
            }
            check_phase(&b.id, b.phase)?;
            check_transform(&b.id, &b.transform)?;
            if b.kind == "customGlb" && !b.model_id.as_deref().is_some_and(|m| models.contains(m)) {
                return invalid(format!("{} refers to a missing .glb model", b.id));
            }
        }
        for e in &self.elements {
            if !NETWORK_KINDS.contains(&e.kind.as_str()) {
                return invalid(format!("unknown kind on {}: {}", e.id, e.kind));
            }
            check_phase(&e.id, e.phase)?;
            check_transform(&e.id, &e.transform)?;
        }

        let entities: HashSet<&str> = self
            .buildings
            .iter()
            .map(|b| b.id.as_str())
            .chain(self.elements.iter().map(|e| e.id.as_str()))
            .chain(self.markers.iter().map(|m| m.id.as_str()))
            .collect();
        for m in &self.markers {
            check_transform(&m.id, &m.transform)?;
            if let Some(target) = &m.target_id {
                if !entities.contains(target.as_str()) {
                    return invalid(format!(
                        "marker {} points to {target}, which does not exist",
                        m.id
                    ));
                }
            }
        }
        for c in &self.cables {
            if !entities.contains(c.from_id.as_str()) || !entities.contains(c.to_id.as_str()) {
                return invalid(format!("cable {} connects to a missing element", c.id));
            }
            if !CABLE_TYPES.contains(&c.cable_type.as_str())
                || !CABLE_ROUTES.contains(&c.route.as_str())
            {
                return invalid(format!("invalid type or route on cable {}", c.id));
            }
        }
        Ok(())
    }
}

/// Brings any supported version up to `CURRENT_VERSION`, then validates.
pub fn migrate(raw: serde_json::Value) -> Result<ProjectFile, AppError> {
    let Some(version) = raw.get("version").and_then(serde_json::Value::as_u64) else {
        return invalid("file without “version” — not a Terra_Map project");
    };
    let project: ProjectFile = match version {
        // Future formats add arms here (v1 → v2 …), never a silent refusal.
        1 => serde_json::from_value(raw).or_else(|e| invalid(format!("invalid format: {e}")))?,
        v if v > CURRENT_VERSION => {
            return invalid(format!(
                "version {v} is newer than the supported one ({CURRENT_VERSION}) — update the app"
            ))
        }
        v => return invalid(format!("unknown version {v}")),
    };
    project.validate()?;
    Ok(project)
}

/// Reads, migrates and validates a project file.
pub fn read_project(path: &Path) -> Result<ProjectFile, AppError> {
    let raw = std::fs::read_to_string(path)?;
    let value = serde_json::from_str(&raw).or_else(|e| invalid(format!("not valid JSON: {e}")))?;
    migrate(value)
}

/// Validates and writes a project atomically (temp file + rename).
pub fn write_project(path: &Path, project: &ProjectFile) -> Result<(), AppError> {
    project.validate()?;
    let json = serde_json::to_string_pretty(project)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Per-window session: path of the open project and the unsaved flag.
///
/// An opened file only becomes the current path once the frontend rebuilt the
/// scene (`commit_open`): if the rebuild fails, the next save must not
/// overwrite the file that failed to load.
#[derive(Default)]
pub struct ProjectSession {
    path: Mutex<Option<PathBuf>>,
    pending: Mutex<Option<PathBuf>>,
    dirty: AtomicBool,
}

impl ProjectSession {
    fn path(&self) -> Option<PathBuf> {
        self.path.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn set_path(&self, path: PathBuf) {
        *self.path.lock().unwrap_or_else(|e| e.into_inner()) = Some(path);
        self.set_dirty(false);
    }

    /// Makes the last opened file the current path (scene rebuilt).
    pub fn commit_open(&self) {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(path) = pending {
            self.set_path(path);
        }
    }

    pub fn set_dirty(&self, dirty: bool) {
        self.dirty.store(dirty, Ordering::Relaxed);
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty.load(Ordering::Relaxed)
    }
}

/// Result of `open_project`: the file name (for the toast) and the project.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub file_name: String,
    pub project: ProjectFile,
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Saves to the current path, or asks for one (first save / "Save as").
/// `Ok(None)` = the user cancelled the dialog.
pub fn save_project(
    app: &AppHandle,
    session: &ProjectSession,
    project: &ProjectFile,
    save_as: bool,
) -> Result<Option<String>, AppError> {
    project.validate()?;
    let target = match session.path() {
        Some(path) if !save_as => path,
        _ => {
            let stem = preset_file_stem(&project.name).unwrap_or_else(|_| DEFAULT_STEM.into());
            let picked = app
                .dialog()
                .file()
                .add_filter(PROJECT_FILTER_NAME, &[PROJECT_EXTENSION])
                .set_file_name(format!("{stem}.{PROJECT_EXTENSION}"))
                .blocking_save_file();
            let Some(file) = picked else { return Ok(None) };
            file.as_path()
                .ok_or(AppError::InvalidFilePath)?
                .to_path_buf()
        }
    };
    write_project(&target, project)?;
    session.set_path(target.clone());
    // The work is safe on disk; a stale autosave only costs a recovery prompt.
    let _ = clear_autosave(app);
    Ok(Some(file_name(&target)))
}

/// Native open dialog + read/migrate/validate. `Ok(None)` = cancelled.
pub fn open_project(
    app: &AppHandle,
    session: &ProjectSession,
) -> Result<Option<OpenedProject>, AppError> {
    let picked = app
        .dialog()
        .file()
        .add_filter(PROJECT_FILTER_NAME, &[PROJECT_EXTENSION])
        .blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file
        .as_path()
        .ok_or(AppError::InvalidFilePath)?
        .to_path_buf();
    let project = read_project(&path)?;
    *session.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.clone());
    Ok(Some(OpenedProject {
        file_name: file_name(&path),
        project,
    }))
}

fn autosave_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::NoAppDataDir)?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(AUTOSAVE_FILE))
}

/// Writes the crash-recovery copy (`<app_data_dir>/autosave.json`).
pub fn autosave_project(app: &AppHandle, project: &ProjectFile) -> Result<(), AppError> {
    write_project(&autosave_path(app)?, project)
}

/// The recovery copy left by a crash, if any. An unreadable copy is deleted
/// (it can never be recovered) and reported.
pub fn load_autosave(app: &AppHandle) -> Result<Option<ProjectFile>, AppError> {
    let path = autosave_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    match read_project(&path) {
        Ok(project) => Ok(Some(project)),
        Err(err) => {
            let _ = std::fs::remove_file(&path);
            Err(err)
        }
    }
}

pub fn clear_autosave(app: &AppHandle) -> Result<(), AppError> {
    let path = autosave_path(app)?;
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Window close guard: with unsaved changes, keep the window open and let the
/// frontend ask (save / discard / cancel); `close_window` then destroys it.
pub fn on_close_requested(window: &Window, api: &tauri::CloseRequestApi) {
    if window.state::<ProjectSession>().is_dirty() {
        api.prevent_close();
        let _ = window.emit(CLOSE_REQUESTED_EVENT, ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const IDENTITY: Transform = Transform {
        position: Vec3 {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        },
        rotation: Vec3 {
            x: 0.0,
            y: 0.0,
            z: 0.0,
        },
        scale: Vec3 {
            x: 1.0,
            y: 1.0,
            z: 1.0,
        },
    };

    fn sample() -> ProjectFile {
        ProjectFile {
            version: CURRENT_VERSION,
            id: "proj_1".into(),
            name: "Bairro Norte".into(),
            terrain: TerrainData {
                preset: "flat".into(),
                params: TerrainPresetParams {
                    seed: 42,
                    amplitude: 10.0,
                    frequency: 1.0,
                    size: 200,
                    resolution: 2,
                },
                // 4 float32 zeros = 16 bytes.
                heightmap: "base64:AAAAAAAAAAAAAAAAAAAAAA==".into(),
                material_map: Some("base64:AAECAw==".into()),
            },
            buildings: vec![
                Building {
                    id: "bld_1".into(),
                    kind: "house".into(),
                    transform: IDENTITY,
                    phase: 2,
                    params: HashMap::new(),
                    model_id: None,
                },
                Building {
                    id: "bld_4".into(),
                    kind: "customGlb".into(),
                    transform: IDENTITY,
                    phase: 2,
                    params: HashMap::new(),
                    model_id: Some("mdl_1".into()),
                },
            ],
            elements: vec![
                Element {
                    id: "bld_2".into(),
                    kind: "olt".into(),
                    transform: IDENTITY,
                    phase: 2,
                    dynamic_props: json!({ "power": 5 })
                        .as_object()
                        .cloned()
                        .unwrap_or_default(),
                },
                Element {
                    id: "bld_3".into(),
                    kind: "onu".into(),
                    transform: IDENTITY,
                    phase: 1,
                    dynamic_props: Props::new(),
                },
            ],
            cables: vec![Cable {
                id: "cab_1".into(),
                from_id: "bld_2".into(),
                to_id: "bld_3".into(),
                cable_type: "fiber".into(),
                route: "underground".into(),
                path: vec![],
                dynamic_props: Props::new(),
            }],
            markers: vec![Marker {
                id: "bld_5".into(),
                target_id: Some("bld_1".into()),
                transform: IDENTITY,
                label: "Cliente A".into(),
                note: String::new(),
            }],
            custom_models: vec![CustomModel {
                id: "mdl_1".into(),
                name: "torre".into(),
                glb: "base64:Z2xURg==".into(),
            }],
            layers: vec![Layer {
                id: "net".into(),
                visible: false,
                locked: true,
            }],
            environment: Environment {
                hour: 19.5,
                fog: 0.3,
                water: Water {
                    enabled: true,
                    level: 1.5,
                },
            },
            roads: vec![Road {
                id: "road_1".into(),
                points: vec![RoadPoint { x: 0.0, z: 0.0 }, RoadPoint { x: 10.0, z: 5.0 }],
                width: 4.0,
            }],
            vegetation: vec![Plant {
                kind: "tree".into(),
                x: 3.0,
                z: -2.0,
                scale: 1.2,
                rotation: 0.5,
            }],
            scenarios: vec![Scenario {
                name: "Base".into(),
                metrics: vec![ScenarioMetric {
                    key: "cost".into(),
                    value: 5930.0,
                }],
            }],
        }
    }

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("terra-map-test-{name}.json"))
    }

    #[test]
    fn sample_is_valid() {
        sample().validate().unwrap();
    }

    #[test]
    fn write_then_read_round_trip_is_identical() {
        let path = temp_path("round-trip");
        write_project(&path, &sample()).unwrap();
        assert_eq!(read_project(&path).unwrap(), sample());
        assert!(!path.with_extension("json.tmp").exists()); // atomic rename
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn json_is_camel_case() {
        let value = serde_json::to_value(sample()).unwrap();
        assert!(value["customModels"].is_array());
        assert_eq!(value["cables"][0]["fromId"], "bld_2");
        assert_eq!(value["elements"][0]["dynamicProps"]["power"], 5);
        assert_eq!(value["buildings"][1]["modelId"], "mdl_1");
        assert!(value["buildings"][0].get("modelId").is_none());
    }

    #[test]
    fn version_is_required_and_newer_is_rejected() {
        let mut value = serde_json::to_value(sample()).unwrap();
        value.as_object_mut().unwrap().remove("version");
        assert!(matches!(migrate(value), Err(AppError::InvalidProject(_))));

        let mut newer = serde_json::to_value(sample()).unwrap();
        newer["version"] = json!(CURRENT_VERSION + 1);
        let err = migrate(newer).unwrap_err().to_string();
        assert!(err.contains("is newer than the supported"), "{err}");

        let mut zero = serde_json::to_value(sample()).unwrap();
        zero["version"] = json!(0);
        assert!(migrate(zero).is_err());
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let mut value = serde_json::to_value(sample()).unwrap();
        value["futureThing"] = json!({ "x": 1 });
        assert_eq!(migrate(value).unwrap(), sample());
    }

    #[test]
    fn invalid_json_is_a_friendly_error() {
        let path = temp_path("garbage");
        std::fs::write(&path, "{ not json").unwrap();
        let err = read_project(&path).unwrap_err().to_string();
        assert!(err.contains("JSON"), "{err}");
        let _ = std::fs::remove_file(path);
    }

    fn assert_invalid(mutate: impl FnOnce(&mut ProjectFile)) {
        let mut project = sample();
        mutate(&mut project);
        assert!(
            matches!(project.validate(), Err(AppError::InvalidProject(_))),
            "{project:?}"
        );
    }

    #[test]
    fn rejects_broken_terrain() {
        assert_invalid(|p| p.terrain.heightmap = "base64:AAAA".into());
        assert_invalid(|p| p.terrain.heightmap = "AAAAAAAAAAAAAAAAAAAAAA==".into());
        assert_invalid(|p| p.terrain.params.resolution = 1);
        assert_invalid(|p| p.terrain.preset = "lava".into());
    }

    #[test]
    fn rejects_duplicate_ids_and_dangling_references() {
        assert_invalid(|p| p.elements[1].id = "bld_1".into());
        assert_invalid(|p| p.cables[0].to_id = "ghost".into());
        assert_invalid(|p| p.markers[0].target_id = Some("ghost".into()));
        assert_invalid(|p| p.buildings[1].model_id = Some("mdl_9".into()));
        assert_invalid(|p| p.custom_models[0].glb = "data".into());
    }

    #[test]
    fn rejects_bad_kinds_phases_and_scales() {
        assert_invalid(|p| p.buildings[0].kind = "castle".into());
        assert_invalid(|p| p.elements[0].kind = "modem".into());
        assert_invalid(|p| p.elements[0].phase = 3);
        assert_invalid(|p| p.buildings[0].transform.scale.y = 0.0);
        assert_invalid(|p| p.cables[0].route = "tunnel".into());
        assert_invalid(|p| p.layers[0].id = "roads".into());
        assert_invalid(|p| p.layers.push(p.layers[0].clone()));
        assert_invalid(|p| p.environment.hour = 25.0);
        assert_invalid(|p| p.environment.fog = -0.1);
        assert_invalid(|p| p.roads[0].points.truncate(1));
        assert_invalid(|p| p.roads[0].width = 0.0);
        assert_invalid(|p| p.roads[0].id = "bld_1".into()); // ids are global
        assert_invalid(|p| p.vegetation[0].kind = "cactus".into());
        assert_invalid(|p| p.vegetation[0].scale = 0.0);
        assert_invalid(|p| p.scenarios[0].name = "  ".into());
        assert_invalid(|p| p.scenarios[0].metrics[0].key = String::new());
        // 4 vertices → 4 bytes → 8 base64 chars.
        assert_invalid(|p| p.terrain.material_map = Some("base64:AAA=".into()));
    }

    #[test]
    fn write_refuses_an_invalid_project() {
        let path = temp_path("refused");
        let mut project = sample();
        project.cables[0].from_id = "ghost".into();
        assert!(write_project(&path, &project).is_err());
        assert!(!path.exists());
    }

    /// Contract with the frontend: a project written by `ui/src/tools/project-io.ts`
    /// (captured by the Fase 8 smoke test) must open as-is.
    #[test]
    fn frontend_written_project_is_valid() {
        let raw: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/frontend-project.json")).unwrap();
        let project = migrate(raw.clone()).unwrap();
        assert_eq!(project.terrain.params.resolution, 128);
        assert!(project.layers.is_empty()); // written before Fase 10: defaults apply
        assert_eq!(project.environment, Environment::default()); // and before Fase 11
        assert!(project.roads.is_empty() && project.vegetation.is_empty());
        assert_eq!(project.markers.len(), 1);
        assert_eq!(project.custom_models.len(), 1);
        // Re-serializing keeps every field the frontend wrote (numbers may
        // change representation, 0 → 0.0, so compare the key paths).
        fn paths(v: &serde_json::Value, prefix: String, out: &mut Vec<String>) {
            match v {
                serde_json::Value::Object(map) => {
                    for (k, child) in map {
                        paths(child, format!("{prefix}.{k}"), out);
                    }
                }
                serde_json::Value::Array(items) => {
                    for (i, child) in items.iter().enumerate() {
                        paths(child, format!("{prefix}[{i}]"), out);
                    }
                }
                _ => out.push(prefix),
            }
        }
        let (mut written, mut kept) = (Vec::new(), Vec::new());
        paths(&raw, String::new(), &mut written);
        paths(
            &serde_json::to_value(&project).unwrap(),
            String::new(),
            &mut kept,
        );
        // Every path the frontend wrote survives (defaults may add new ones).
        let missing: Vec<_> = written.iter().filter(|p| !kept.contains(p)).collect();
        assert!(missing.is_empty(), "{missing:?}");
    }

    /// Same contract with Fase 11 content written by the frontend: water,
    /// a road, vegetation and a painted material map.
    #[test]
    fn frontend_written_environment_project_is_valid() {
        let raw: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/frontend-project-f11.json")).unwrap();
        let project = migrate(raw).unwrap();
        assert!(project.environment.water.enabled);
        assert_eq!(project.roads.len(), 1);
        assert!(project.vegetation.len() > 20);
        assert!(project.terrain.material_map.is_some());
    }

    #[test]
    fn base64_length_matches_padding() {
        assert_eq!(base64_len(16), 24);
        assert_eq!(base64_len(3), 4);
        assert_eq!(base64_len(4), 8);
    }

    #[test]
    fn session_tracks_path_and_dirty() {
        let session = ProjectSession::default();
        assert!(session.path().is_none());
        session.set_dirty(true);
        assert!(session.is_dirty());
        session.set_path(PathBuf::from("/tmp/x.json"));
        assert!(!session.is_dirty()); // a save/open leaves the project clean
        assert_eq!(session.path(), Some(PathBuf::from("/tmp/x.json")));
    }

    #[test]
    fn opened_path_only_counts_after_commit() {
        let session = ProjectSession::default();
        *session.pending.lock().unwrap() = Some(PathBuf::from("/tmp/opened.json"));
        assert!(session.path().is_none()); // rebuild not confirmed yet
        session.commit_open();
        assert_eq!(session.path(), Some(PathBuf::from("/tmp/opened.json")));
        session.commit_open(); // nothing pending: keeps the path
        assert_eq!(session.path(), Some(PathBuf::from("/tmp/opened.json")));
    }
}
