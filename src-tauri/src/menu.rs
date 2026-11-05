use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const APP_NAME: &str = "AuraNotes";

pub const MENU_COMMANDS: &[&str] = &[
    "settings",
    "new-page",
    "import-pdf",
    "export-pdf",
    "export-section-pdf",
    "export-notebook-pdf",
    "export-backup",
    "import-backup",
    "search",
    "toggle-sidebar",
    "shortcuts",
];

pub fn is_frontend_menu_command(id: &str) -> bool {
    MENU_COMMANDS.contains(&id)
}

pub fn build_italian_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // 1. AuraNotes menu
    let about = PredefinedMenuItem::about(app, Some(&format!("Informazioni su {APP_NAME}")), None)?;
    let settings = MenuItem::with_id(app, "settings", "Impostazioni…", true, Some("CmdOrCtrl+,"))?;
    let hide = PredefinedMenuItem::hide(app, Some(&format!("Nascondi {APP_NAME}")))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("Nascondi altre"))?;
    let show_all = PredefinedMenuItem::show_all(app, Some("Mostra tutte"))?;
    let quit = PredefinedMenuItem::quit(app, Some(&format!("Esci da {APP_NAME}")))?;
    let sep = || PredefinedMenuItem::separator(app);

    let app_submenu = Submenu::with_items(
        app,
        APP_NAME,
        true,
        &[
            &about,
            &sep()?,
            &settings,
            &sep()?,
            &hide,
            &hide_others,
            &show_all,
            &sep()?,
            &quit,
        ],
    )?;

    // 2. File menu
    let new_page = MenuItem::with_id(
        app,
        "new-page",
        "Nuova pagina",
        true,
        Some("CmdOrCtrl+Alt+N"),
    )?;
    let import_pdf = MenuItem::with_id(
        app,
        "import-pdf",
        "Importa PDF…",
        true,
        Some("CmdOrCtrl+Shift+P"),
    )?;
    let export_pdf = MenuItem::with_id(
        app,
        "export-pdf",
        "Esporta PDF…",
        true,
        Some("CmdOrCtrl+P"),
    )?;
    let export_section_pdf = MenuItem::with_id(
        app,
        "export-section-pdf",
        "Esporta sezione in PDF…",
        true,
        Some("CmdOrCtrl+Alt+Shift+P"),
    )?;
    let export_notebook_pdf = MenuItem::with_id(
        app,
        "export-notebook-pdf",
        "Esporta quaderno in PDF…",
        true,
        Some("CmdOrCtrl+Alt+P"),
    )?;
    let export_backup = MenuItem::with_id(app, "export-backup", "Esporta backup…", true, None::<&str>)?;
    let import_backup = MenuItem::with_id(app, "import-backup", "Importa backup…", true, None::<&str>)?;
    let open_backups = MenuItem::with_id(
        app,
        "open-backups",
        "Mostra cartella dei backup automatici",
        true,
        None::<&str>,
    )?;
    let close_win = PredefinedMenuItem::close_window(app, Some("Chiudi finestra"))?;

    let file_submenu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_page,
            &import_pdf,
            &sep()?,
            &export_pdf,
            &export_section_pdf,
            &export_notebook_pdf,
            &sep()?,
            &export_backup,
            &import_backup,
            &open_backups,
            &sep()?,
            &close_win,
        ],
    )?;

    // 3. Modifica menu
    let undo = PredefinedMenuItem::undo(app, Some("Annulla"))?;
    let redo = PredefinedMenuItem::redo(app, Some("Ripeti"))?;
    let cut = PredefinedMenuItem::cut(app, Some("Taglia"))?;
    let copy = PredefinedMenuItem::copy(app, Some("Copia"))?;
    let paste = PredefinedMenuItem::paste(app, Some("Incolla"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("Seleziona tutto"))?;
    let search = MenuItem::with_id(app, "search", "Cerca…", true, Some("CmdOrCtrl+K"))?;

    let edit_submenu = Submenu::with_items(
        app,
        "Modifica",
        true,
        &[
            &undo,
            &redo,
            &sep()?,
            &cut,
            &copy,
            &paste,
            &select_all,
            &sep()?,
            &search,
        ],
    )?;

    // 4. Vista menu
    let toggle_sidebar = MenuItem::with_id(
        app,
        "toggle-sidebar",
        "Pannelli di navigazione",
        true,
        Some("CmdOrCtrl+Shift+B"),
    )?;
    let shortcuts = MenuItem::with_id(
        app,
        "shortcuts",
        "Scorciatoie da tastiera",
        true,
        Some("CmdOrCtrl+/"),
    )?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, Some("Schermo intero"))?;

    let view_submenu = Submenu::with_items(
        app,
        "Vista",
        true,
        &[&toggle_sidebar, &shortcuts, &sep()?, &fullscreen],
    )?;

    // 5. Finestra menu
    let minimize = PredefinedMenuItem::minimize(app, Some("Minimizza"))?;
    let maximize = PredefinedMenuItem::maximize(app, Some("Ingrandisci"))?;
    let close_win_2 = PredefinedMenuItem::close_window(app, Some("Chiudi finestra"))?;

    let window_submenu = Submenu::with_items(
        app,
        "Finestra",
        true,
        &[&minimize, &maximize, &sep()?, &close_win_2],
    )?;

    Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frontend_menu_commands() {
        for cmd in [
            "settings",
            "new-page",
            "import-pdf",
            "export-pdf",
            "export-section-pdf",
            "export-notebook-pdf",
            "export-backup",
            "import-backup",
            "search",
            "toggle-sidebar",
            "shortcuts",
        ] {
            assert!(is_frontend_menu_command(cmd));
        }
        assert!(!is_frontend_menu_command("open-backups"));
        assert!(!is_frontend_menu_command("unknown"));
    }
}
