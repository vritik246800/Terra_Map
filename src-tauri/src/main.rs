// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod error;
mod glb;
mod project;
mod terrain;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::generate_terrain,
            commands::save_terrain_preset,
            commands::list_terrain_presets,
            commands::load_terrain_preset,
            commands::save_glb,
            commands::open_glb_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
