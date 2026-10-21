//! Shared error type for the Rust core (AGENTS.md: typed errors via thiserror).
//!
//! Serialized as a plain message string so the frontend can surface it
//! directly in the UI (friendly English text, after a prefix from `t()`).

use serde::Serialize;

/// Errors returned by Tauri commands.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("unknown terrain preset: {0}")]
    UnknownTerrainPreset(String),

    #[error("invalid terrain parameters: {0}")]
    InvalidTerrainParams(String),

    #[error("invalid preset name: {0}")]
    InvalidPresetName(String),

    #[error("preset not found: {0}")]
    PresetNotFound(String),

    #[error("app data folder unavailable")]
    NoAppDataDir,

    #[error("the file dialog did not return a local path")]
    InvalidFilePath,

    #[error("invalid project: {0}")]
    InvalidProject(String),

    #[error("invalid report: {0}")]
    InvalidReport(String),

    #[error("invalid network: {0}")]
    InvalidNetwork(String),

    #[error("unknown network element: {0}")]
    UnknownNode(String),

    #[error("window error: {0}")]
    Window(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Tauri requires command errors to be `Serialize`; send the display text.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
