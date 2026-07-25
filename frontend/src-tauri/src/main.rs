#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // Mnemosyne Desktop Shell initialization
            // Hotkeys, Tray icon, and Deep links can be configured here
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("Error while running Mnemosyne Cognitive OS");
}
