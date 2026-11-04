use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_BACKUPS: usize = 20;

/// Resolves the AuraNotes user data directory (`~/Library/Application Support/AuraNotes` on macOS)
/// and automatically migrates from `~/Library/Application Support/GlassNotes` if needed.
pub fn resolve_and_migrate_user_data_dir(app_data_root: &Path) -> PathBuf {
    let aura_dir = app_data_root.join("AuraNotes");
    let glass_dir = app_data_root.join("GlassNotes");

    if !aura_dir.exists() && glass_dir.exists() {
        if let Err(e) = copy_dir_recursive(&glass_dir, &aura_dir) {
            eprintln!("Migrazione dati da GlassNotes non riuscita: {e}");
        }
    }
    let _ = fs::create_dir_all(&aura_dir);
    aura_dir
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            fs::copy(entry.path(), dst_path)?;
        }
    }
    Ok(())
}

pub fn backups_dir(user_data_dir: &Path) -> PathBuf {
    user_data_dir.join("Backups")
}

/// Checks if a filename matches `^(glassnotes|auranotes)-.*\.json$`.
pub fn is_rolling_backup_filename(name: &str) -> bool {
    (name.starts_with("auranotes-") || name.starts_with("glassnotes-"))
        && name.ends_with(".json")
        && name.len() > "auranotes-.json".len()
}

/// Formats a UTC timestamp (`YYYY-MM-DD-HH-MM`) matching `new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16)`.
pub fn format_utc_stamp(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let rem = unix_secs % 86_400;
    let hour = rem / 3_600;
    let minute = (rem % 3_600) / 60;

    // Howard Hinnant civil_from_days algorithm
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!("{year:04}-{m:02}-{d:02}-{hour:02}-{minute:02}")
}

pub fn current_utc_stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_utc_stamp(secs)
}

/// Writes `json` atomically to `auranotes-<stamp>.json` inside `dir` and rotates old backups
/// so at most `MAX_BACKUPS` (20) files matching `^(glassnotes|auranotes)-.*\.json$` remain.
pub fn write_backup_with_stamp(dir: &Path, json: &str, stamp: &str) -> Result<PathBuf, String> {
    if json.len() < 2 {
        return Err("Backup vuoto".to_string());
    }
    fs::create_dir_all(dir).map_err(|e| format!("Impossibile creare la cartella dei backup: {e}"))?;

    let filename = format!("auranotes-{stamp}.json");
    let file_path = dir.join(&filename);
    let tmp_path = dir.join(format!("{filename}.tmp"));

    fs::write(&tmp_path, json.as_bytes())
        .map_err(|e| format!("Impossibile scrivere il file di backup temporaneo: {e}"))?;
    fs::rename(&tmp_path, &file_path)
        .map_err(|e| format!("Impossibile finalizzare il file di backup: {e}"))?;

    rotate_backups(dir, MAX_BACKUPS)?;

    Ok(file_path)
}

pub fn backup_sort_key(name: &str) -> (&str, &str) {
    let suffix = name
        .strip_prefix("auranotes-")
        .or_else(|| name.strip_prefix("glassnotes-"))
        .unwrap_or(name);
    (suffix, name)
}

pub fn rotate_backups(dir: &Path, max_backups: usize) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Errore lettura cartella backup: {e}"))?;
    let mut matching: Vec<String> = entries
        .filter_map(|res| res.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| is_rolling_backup_filename(name))
        .collect();

    matching.sort_by(|a, b| backup_sort_key(a).cmp(&backup_sort_key(b)));

    if matching.len() > max_backups {
        let to_remove = matching.len() - max_backups;
        for old_name in matching.into_iter().take(to_remove) {
            let _ = fs::remove_file(dir.join(old_name));
        }
    }
    Ok(())
}

pub fn open_backups_in_finder(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Impossibile creare la cartella dei backup: {e}"))?;
    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .arg(dir)
            .status()
            .map_err(|e| format!("Impossibile aprire il Finder: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_test_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = env::temp_dir().join(format!("auranotes-test-{label}-{nanos}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_format_utc_stamp() {
        // 2026-11-03T18:45:00Z -> 1793731500
        assert_eq!(format_utc_stamp(1_793_731_500), "2026-11-03-18-45");
        // Unix epoch
        assert_eq!(format_utc_stamp(0), "1970-01-01-00-00");
    }

    #[test]
    fn test_rejects_empty_backup() {
        let dir = temp_test_dir("empty");
        assert_eq!(
            write_backup_with_stamp(&dir, "", "2026-11-03-18-00"),
            Err("Backup vuoto".to_string())
        );
        assert_eq!(
            write_backup_with_stamp(&dir, "{", "2026-11-03-18-00"),
            Err("Backup vuoto".to_string())
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_atomic_write_and_20_file_rotation() {
        let dir = temp_test_dir("rotation");
        // Also place a legacy glassnotes backup and an unrelated file
        fs::write(dir.join("glassnotes-2025-01-01-00-00.json"), "{}").unwrap();
        fs::write(dir.join("unrelated.txt"), "keep").unwrap();

        for i in 1..=25 {
            let stamp = format!("2026-11-03-18-{i:02}");
            let res = write_backup_with_stamp(&dir, &format!("{{\"seq\":{i}}}"), &stamp);
            assert!(res.is_ok());
        }

        let mut remaining: Vec<String> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| is_rolling_backup_filename(n))
            .collect();
        remaining.sort();

        assert_eq!(remaining.len(), 20);
        // Oldest 6 (glassnotes-2025 + auranotes 01..=05) should have been pruned; 06..=25 kept
        assert_eq!(remaining.first().unwrap(), "auranotes-2026-11-03-18-06.json");
        assert_eq!(remaining.last().unwrap(), "auranotes-2026-11-03-18-25.json");
        // Unrelated file untouched and no .tmp leftover
        assert!(dir.join("unrelated.txt").exists());
        let has_tmp = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().ends_with(".tmp"));
        assert!(!has_tmp);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_glassnotes_to_auranotes_migration() {
        let root = temp_test_dir("migration");
        let glass = root.join("GlassNotes");
        fs::create_dir_all(glass.join("Backups")).unwrap();
        fs::write(
            glass.join("Backups").join("glassnotes-2026-01-01-12-00.json"),
            "{\"ok\":true}",
        )
        .unwrap();

        let aura = resolve_and_migrate_user_data_dir(&root);
        assert_eq!(aura, root.join("AuraNotes"));
        assert!(aura
            .join("Backups")
            .join("glassnotes-2026-01-01-12-00.json")
            .exists());

        let _ = fs::remove_dir_all(&root);
    }
}
