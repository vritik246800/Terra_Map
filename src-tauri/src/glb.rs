//! `.glb` file IO (PLAN.md Fase 5, DESIGN.md §9.1).
//!
//! The native dialogs (tauri-plugin-dialog, filter `*.glb`) pick the path;
//! pure helpers do the actual disk IO so they stay unit-testable without an
//! `AppHandle`. Returning `None` from the dialog wrappers means the user
//! cancelled — never an error.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::error::AppError;

const GLB_FILTER_NAME: &str = "Modelo 3D";
const GLB_EXTENSION: &str = "glb";
const DEFAULT_FILE_NAME: &str = "maquete.glb";

/// Contents of a `.glb` file picked by the user in the open dialog.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickedGlb {
    /// File stem — used as the catalog label of the imported model.
    pub name: String,
    pub bytes: Vec<u8>,
}

/// Writes `.glb` bytes to `path` (unit-testable half of `save_glb`).
pub fn write_glb(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Reads a `.glb` file (unit-testable half of `open_glb_dialog`).
pub fn read_glb(path: &Path) -> Result<PickedGlb, AppError> {
    let bytes = std::fs::read(path)?;
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("modelo")
        .to_string();
    Ok(PickedGlb { name, bytes })
}

/// Extracts a local path from a dialog `FilePath` (desktop always yields Path).
fn dialog_path(file: tauri_plugin_dialog::FilePath) -> Result<PathBuf, AppError> {
    file.as_path()
        .map(Path::to_path_buf)
        .ok_or(AppError::InvalidFilePath)
}

/// Native save dialog (filter `*.glb`) + write. `Ok(None)` = user cancelled.
pub fn save_glb_with_dialog(app: &AppHandle, bytes: &[u8]) -> Result<Option<String>, AppError> {
    let picked = app
        .dialog()
        .file()
        .add_filter(GLB_FILTER_NAME, &[GLB_EXTENSION])
        .set_file_name(DEFAULT_FILE_NAME)
        .blocking_save_file();
    let Some(file) = picked else { return Ok(None) };
    let path = dialog_path(file)?;
    write_glb(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Native open dialog (filter `*.glb`) + read. `Ok(None)` = user cancelled.
pub fn open_glb_with_dialog(app: &AppHandle) -> Result<Option<PickedGlb>, AppError> {
    let picked = app
        .dialog()
        .file()
        .add_filter(GLB_FILTER_NAME, &[GLB_EXTENSION])
        .blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = dialog_path(file)?;
    read_glb(&path).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("terra-map-glb-test-{}-{name}", std::process::id()))
    }

    #[test]
    fn write_then_read_round_trip() {
        let path = temp_path("roundtrip.glb");
        let bytes = b"glTF fake binary payload".to_vec();
        write_glb(&path, &bytes).unwrap();

        let picked = read_glb(&path).unwrap();
        assert_eq!(picked.bytes, bytes);
        assert!(picked.name.ends_with("roundtrip"));

        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn read_missing_file_errors() {
        assert!(read_glb(&temp_path("does-not-exist.glb")).is_err());
    }

    #[test]
    fn picked_glb_serializes_for_the_bridge() {
        let picked = PickedGlb {
            name: "antena".into(),
            bytes: vec![1, 2, 3],
        };
        let json = serde_json::to_value(&picked).unwrap();
        assert_eq!(json["name"], "antena");
        assert_eq!(json["bytes"], serde_json::json!([1, 2, 3]));
    }
}
