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
mod update;

/// Id of the app menu's own Quit item (Fase 18, `Q_LIST.md` Q53).
const QUIT_MENU_ID: &str = "quit";

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(project_file::ProjectSession::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                project_file::on_close_requested(window, api);
            }
        })
        .on_menu_event(|app, event| {
            if event.id() == QUIT_MENU_ID {
                project_file::on_quit_requested(app);
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu);
    builder
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
            commands::is_newer_version,
            commands::open_releases_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The default macOS menu with its Quit (Cmd+Q) routed through the unsaved
/// changes guard: the predefined item terminates at once (tao 0.37 has no
/// `applicationShouldTerminate`), so the work since the last autosave was lost.
#[cfg(target_os = "macos")]
fn app_menu(handle: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};

    let menu = Menu::default(handle)?;
    if let Some(MenuItemKind::Submenu(app)) = menu.items()?.first() {
        let quit = app.items()?.len().saturating_sub(1); // the default app menu ends with Quit
        app.remove_at(quit)?;
        let label = format!("Quit {}", handle.package_info().name);
        app.append(&MenuItem::with_id(
            handle,
            QUIT_MENU_ID,
            label,
            true,
            Some("CmdOrCtrl+Q"),
        )?)?;
    }
    Ok(menu)
}
