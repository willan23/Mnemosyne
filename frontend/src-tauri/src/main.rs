#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|err| err.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) URLs can be opened.".into());
    }
    open::that(parsed.as_str()).map_err(|err| err.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Mnemosyne Desktop Shell initialization
            // Hotkeys, Tray icon, and Deep links can be configured here
            #[cfg(desktop)]
            {
                use tauri::{Emitter, Manager};
                use tauri_plugin_global_shortcut::ShortcutState;

                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;

                // Ctrl/Cmd+Shift+M: restaura a janela (mesmo minimizada) e foca a captura no Universo.
                match tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts(["CommandOrControl+Shift+M"])
                {
                    Ok(builder) => {
                        if let Err(err) = app.handle().plugin(
                            builder
                                .with_handler(|app, _shortcut, event| {
                                    if event.state != ShortcutState::Pressed {
                                        return;
                                    }
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.unminimize();
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                        let _ = window.emit("mnemosyne-capture", ());
                                    }
                                })
                                .build(),
                        ) {
                            eprintln!("global shortcut indisponível: {err}");
                        }
                    }
                    Err(err) => {
                        eprintln!("global shortcut indisponível: {err}");
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_external_url])
        .run(tauri::generate_context!())
        .expect("Error while running Mnemosyne Cognitive OS");
}
