use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::window::Color;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

impl WindowState {
    /// Checks that the saved window bounds are sane and within visible desktop range.
    pub fn is_valid(&self) -> bool {
        self.width >= 400
            && self.width <= 12_000
            && self.height >= 300
            && self.height <= 12_000
            && self.x > -10_000
            && self.x < 20_000
            && self.y > -10_000
            && self.y < 20_000
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThemeState {
    pub theme: String,
}

pub fn window_state_file(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join("window-state.json")
}

pub fn theme_state_file(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join("theme-state.json")
}

pub fn load_window_state(user_data_dir: &Path) -> Option<WindowState> {
    let raw = fs::read_to_string(window_state_file(user_data_dir)).ok()?;
    let state: WindowState = serde_json::from_str(&raw).ok()?;
    if state.is_valid() {
        Some(state)
    } else {
        None
    }
}

pub fn save_window_state(user_data_dir: &Path, state: &WindowState) {
    if !state.is_valid() {
        return;
    }
    let _ = fs::create_dir_all(user_data_dir);
    if let Ok(json) = serde_json::to_string(state) {
        let _ = fs::write(window_state_file(user_data_dir), json);
    }
}

pub fn load_theme_state(user_data_dir: &Path) -> String {
    let Ok(raw) = fs::read_to_string(theme_state_file(user_data_dir)) else {
        return "system".to_string();
    };
    let Ok(parsed) = serde_json::from_str::<ThemeState>(&raw) else {
        return "system".to_string();
    };
    match parsed.theme.as_str() {
        "dark" | "light" | "system" => parsed.theme,
        _ => "system".to_string(),
    }
}

pub fn save_theme_state(user_data_dir: &Path, theme: &str) {
    if !matches!(theme, "dark" | "light" | "system") {
        return;
    }
    let _ = fs::create_dir_all(user_data_dir);
    let payload = ThemeState {
        theme: theme.to_string(),
    };
    if let Ok(json) = serde_json::to_string(&payload) {
        let _ = fs::write(theme_state_file(user_data_dir), json);
    }
}

/// Native window background color matching `desktop/main.cjs`:
/// `#1e1e1e` in dark mode, `#081e42` in light mode.
pub fn background_color_for_dark(dark: bool) -> Color {
    if dark {
        Color(0x1e, 0x1e, 0x1e, 0xff)
    } else {
        Color(0x08, 0x1e, 0x42, 0xff)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = env::temp_dir().join(format!("auranotes-winstate-{label}-{nanos}"));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn test_window_state_roundtrip_and_validation() {
        let dir = temp_dir("bounds");
        assert!(load_window_state(&dir).is_none());

        let valid = WindowState {
            x: 120,
            y: 80,
            width: 1440,
            height: 900,
            maximized: false,
        };
        save_window_state(&dir, &valid);
        assert_eq!(load_window_state(&dir), Some(valid.clone()));

        // Invalid dimensions should be rejected and not overwrite valid state
        let invalid = WindowState {
            x: 0,
            y: 0,
            width: 50,
            height: 50,
            maximized: false,
        };
        save_window_state(&dir, &invalid);
        assert_eq!(load_window_state(&dir), Some(valid));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_theme_state_persistence() {
        let dir = temp_dir("theme");
        assert_eq!(load_theme_state(&dir), "system");

        save_theme_state(&dir, "dark");
        assert_eq!(load_theme_state(&dir), "dark");

        save_theme_state(&dir, "light");
        assert_eq!(load_theme_state(&dir), "light");

        // Invalid theme ignored
        save_theme_state(&dir, "neon-pink");
        assert_eq!(load_theme_state(&dir), "light");

        assert_eq!(background_color_for_dark(true), Color(0x1e, 0x1e, 0x1e, 0xff));
        assert_eq!(background_color_for_dark(false), Color(0x08, 0x1e, 0x42, 0xff));

        let _ = fs::remove_dir_all(&dir);
    }
}
