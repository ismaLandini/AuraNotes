use crate::backup::{
    backups_dir, current_utc_stamp, open_backups_in_finder, write_backup_with_stamp,
};
use crate::pdf::sanitize_pdf_filename;
use crate::window_state::{background_color_for_dark, save_theme_state};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, Theme, WebviewWindow};

pub struct AppState {
    pub user_data_dir: PathBuf,
    pub flushed: Arc<AtomicBool>,
    pub closing: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub user_data: String,
    pub backups: String,
}

#[tauri::command]
pub fn write_backup(json: String, state: State<'_, AppState>) -> Result<String, String> {
    let dir = backups_dir(&state.user_data_dir);
    let stamp = current_utc_stamp();
    let path = write_backup_with_stamp(&dir, &json, &stamp)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_backups(state: State<'_, AppState>) -> Result<(), String> {
    let dir = backups_dir(&state.user_data_dir);
    open_backups_in_finder(&dir)
}

#[tauri::command]
pub fn save_pdf(window: WebviewWindow, title: String) -> Result<Option<String>, String> {
    let safe_title = sanitize_pdf_filename(&title);
    // Update document.title to the sanitized title and trigger macOS native print/PDF sheet
    let script = format!(
        "(() => {{ const prev = document.title; document.title = {}; window.print(); setTimeout(() => {{ document.title = prev; }}, 1000); }})();",
        serde_json::to_string(&safe_title).unwrap_or_else(|_| "\"AuraNotes\"".to_string())
    );
    window
        .eval(&script)
        .map_err(|e| format!("Impossibile avviare l'esportazione PDF: {e}"))?;
    Ok(None)
}

#[tauri::command]
pub fn get_app_info(app: AppHandle, state: State<'_, AppState>) -> AppInfo {
    let version = app.package_info().version.to_string();
    let user_data = state.user_data_dir.to_string_lossy().into_owned();
    let backups = backups_dir(&state.user_data_dir)
        .to_string_lossy()
        .into_owned();
    AppInfo {
        version,
        user_data,
        backups,
    }
}

#[tauri::command]
pub fn set_theme(
    window: WebviewWindow,
    theme: String,
    dark: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if matches!(theme.as_str(), "dark" | "light" | "system") {
        save_theme_state(&state.user_data_dir, &theme);
        let native_theme = match theme.as_str() {
            "dark" => Some(Theme::Dark),
            "light" => Some(Theme::Light),
            _ => None,
        };
        let _ = window.set_theme(native_theme);
    }

    let is_dark = dark.unwrap_or_else(|| {
        if theme == "dark" {
            true
        } else if theme == "light" {
            false
        } else {
            matches!(window.theme(), Ok(Theme::Dark))
        }
    });
    let _ = window.set_background_color(Some(background_color_for_dark(is_dark)));
    Ok(())
}

#[tauri::command]
pub fn flush_done(app: AppHandle, state: State<'_, AppState>) {
    if !state.flushed.swap(true, Ordering::SeqCst) {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.close();
        }
    }
}

pub fn is_allowed_external_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !is_allowed_external_url(trimmed) {
        return Err("URL esterno non consentito".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg(trimmed)
            .status()
            .map_err(|e| format!("Impossibile aprire il link esterno: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_allowed_external_url() {
        assert!(is_allowed_external_url("https://example.com"));
        assert!(is_allowed_external_url("HTTP://example.com/test"));
        assert!(is_allowed_external_url("mailto:info@auranotes.it"));
        assert!(!is_allowed_external_url("file:///etc/passwd"));
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url(""));
    }
}
