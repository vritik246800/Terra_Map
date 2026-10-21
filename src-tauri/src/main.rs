// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod error;
mod glb;
mod network;
mod project;
mod project_file;
mod report;
mod terrain;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(project_file::ProjectSession::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                project_file::on_close_requested(window, api);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            commands::generate_terrain,
            commands::save_terrain_preset,
            commands::list_terrain_presets,
            commands::load_terrain_preset,
            commands::save_glb,
            commands::open_glb_dialog,
            commands::shortest_path,
            commands::antenna_coverage,
            commands::export_simulation_csv,
            commands::save_project,
            commands::open_project,
            commands::commit_open,
            commands::autosave_project,
            commands::load_autosave,
            commands::clear_autosave,
            commands::set_dirty,
            commands::close_window,
            commands::project_report,
            commands::export_report_pdf,
            commands::export_bom_csv,
            commands::terrain_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
