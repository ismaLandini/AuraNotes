#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod commands;
mod menu;
mod pdf;
mod window_state;

use backup::{backups_dir, open_backups_in_finder, resolve_and_migrate_user_data_dir};
use commands::AppState;
use menu::{build_italian_menu, is_frontend_menu_command};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, Theme, Window, WindowEvent};
use window_state::{
    background_color_for_dark, load_theme_state, load_window_state, save_window_state, WindowState,
};

fn resolve_app_support_root(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(data_dir) = app.path().data_dir() {
        return data_dir;
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Library/Application Support");
    }
    PathBuf::from(".")
}

fn capture_and_save_window_state(win: &Window, user_data_dir: &Path) {
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let Ok(pos) = win.outer_position() else {
        return;
    };
    let Ok(size) = win.inner_size() else {
        return;
    };
    let logical_pos = pos.to_logical::<i32>(scale);
    let logical_size = size.to_logical::<u32>(scale);
    let maximized = win.is_maximized().unwrap_or(false);

    let state = WindowState {
        x: logical_pos.x,
        y: logical_pos.y,
        width: logical_size.width,
        height: logical_size.height,
        maximized,
    };
    save_window_state(user_data_dir, &state);
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let app_support = resolve_app_support_root(app_handle);
            let user_data_dir = resolve_and_migrate_user_data_dir(&app_support);

            let state = AppState {
                user_data_dir: user_data_dir.clone(),
                flushed: Arc::new(AtomicBool::new(false)),
                closing: Arc::new(AtomicBool::new(false)),
            };
            app.manage(state);

            // Build and set native Italian application menu
            if let Ok(app_menu) = build_italian_menu(app_handle) {
                let _ = app.set_menu(app_menu);
            }

            let menu_user_data = user_data_dir.clone();
            app.on_menu_event(move |app_handle, event| {
                let id = event.id().as_ref();
                if id == "open-backups" {
                    let _ = open_backups_in_finder(&backups_dir(&menu_user_data));
                } else if is_frontend_menu_command(id) {
                    let _ = app_handle.emit("glassnotes:menu", id);
                }
            });

            // Restore window state & theme on the main window
            if let Some(win) = app.get_webview_window("main") {
                let initial_theme = load_theme_state(&user_data_dir);
                let native_theme = match initial_theme.as_str() {
                    "dark" => Some(Theme::Dark),
                    "light" => Some(Theme::Light),
                    _ => None,
                };
                let _ = win.set_theme(native_theme);

                let is_dark = match initial_theme.as_str() {
                    "dark" => true,
                    "light" => false,
                    _ => matches!(win.theme(), Ok(Theme::Dark)),
                };
                let _ = win.set_background_color(Some(background_color_for_dark(is_dark)));

                if let Some(saved) = load_window_state(&user_data_dir) {
                    let scale = win.scale_factor().unwrap_or(1.0);
                    let phys_size = PhysicalSize::new(
                        (f64::from(saved.width) * scale).round() as u32,
                        (f64::from(saved.height) * scale).round() as u32,
                    );
                    let phys_pos = PhysicalPosition::new(
                        (f64::from(saved.x) * scale).round() as i32,
                        (f64::from(saved.y) * scale).round() as i32,
                    );
                    let _ = win.set_size(phys_size);
                    let _ = win.set_position(phys_pos);
                    if saved.maximized {
                        let _ = win.maximize();
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            let state = window.state::<AppState>();
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    capture_and_save_window_state(window, &state.user_data_dir);
                }
                WindowEvent::ThemeChanged(theme) => {
                    let is_dark = matches!(theme, Theme::Dark);
                    let _ = window.set_background_color(Some(background_color_for_dark(is_dark)));
                }
                WindowEvent::CloseRequested { api, .. } => {
                    capture_and_save_window_state(window, &state.user_data_dir);
                    if state.flushed.load(Ordering::SeqCst) {
                        return;
                    }
                    api.prevent_close();
                    if !state.closing.swap(true, Ordering::SeqCst) {
                        let _ = window.emit("glassnotes:flush-request", ());
                        let win_clone = window.clone();
                        let flushed_clone = Arc::clone(&state.flushed);
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_secs(5));
                            if !flushed_clone.swap(true, Ordering::SeqCst) {
                                let _ = win_clone.close();
                            }
                        });
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::write_backup,
            commands::open_backups,
            commands::save_pdf,
            commands::get_app_info,
            commands::set_theme,
            commands::flush_done,
            commands::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("Errore durante l'avvio di AuraNotes");
}
