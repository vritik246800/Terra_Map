//! Shared error type for the Rust core (AGENTS.md: typed errors via thiserror).
//!
//! Serialized as a plain message string so the frontend can surface it
//! directly in the UI (friendly error text, pt-PT layer decides wording).

use serde::Serialize;

/// Errors returned by Tauri commands.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("preset de terreno desconhecido: {0}")]
    UnknownTerrainPreset(String),

    #[error("parâmetros de terreno inválidos: {0}")]
    InvalidTerrainParams(String),

    #[error("nome de preset inválido: {0}")]
    InvalidPresetName(String),

    #[error("preset não encontrado: {0}")]
    PresetNotFound(String),

    #[error("diretoria de dados da app indisponível")]
    NoAppDataDir,

    #[error("o diálogo de ficheiros não devolveu um caminho local")]
    InvalidFilePath,

    #[error("erro de E/S: {0}")]
    Io(#[from] std::io::Error),

    #[error("erro de serialização: {0}")]
    Json(#[from] serde_json::Error),
}

/// Tauri requires command errors to be `Serialize`; send the display text.
impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
