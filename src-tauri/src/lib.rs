use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rand::Rng;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const MAIN_WINDOW_LABEL: &str = "main";

/// Solid white monogram on a transparent background — the shape macOS
/// expects for a tray/menu-bar "template" image (auto-tinted for light/dark).
/// Windows/Linux have no such convention, so they use the real, full-color
/// app icon instead so the tray icon matches the taskbar/app icon.
#[cfg(target_os = "macos")]
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");
#[cfg(not(target_os = "macos"))]
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

/// Holds everything the tray menu / shutdown path needs to talk to the
/// already-spawned Bun sidecar.
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    exited: Arc<AtomicBool>,
    port: u16,
    shutdown_token: String,
    /// Set once the sidecar's port accepts connections. Guards
    /// `show_or_create_window` against racing to build a window before the
    /// server can actually respond.
    ready: Arc<AtomicBool>,
}

fn pick_port() -> u16 {
    // 6969 matches the Docker deployment's default, so it's a good first guess.
    // Fall back to an OS-assigned free port if something else already holds it
    // (e.g. a local Docker instance of Akaun already running).
    if TcpListener::bind(("127.0.0.1", 6969)).is_ok() {
        6969
    } else {
        TcpListener::bind(("127.0.0.1", 0))
            .and_then(|l| l.local_addr())
            .map(|addr| addr.port())
            .unwrap_or(6969)
    }
}

fn random_token() -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// Normalizes every `target="_blank"` anchor click into an explicit
/// `window.open()` call. `on_new_window` is documented to fire for
/// `window.open()`; it's not 100% doc-confirmed to also fire for bare
/// `target="_blank"` link clicks across every engine, so this closes that
/// gap without touching any SvelteKit source file.
const NORMALIZE_BLANK_LINKS_SCRIPT: &str = r#"
document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[target="_blank"]');
    if (a && a.href) {
        e.preventDefault();
        window.open(a.href, '_blank');
    }
}, true);
"#;

/// Builds the main embedded window pointed at the sidecar's own URL. Must
/// only be called from the main thread.
fn build_main_window(app: &AppHandle, port: u16) -> tauri::Result<()> {
    let url = format!("http://127.0.0.1:{port}/")
        .parse()
        .expect("sidecar URL is always well-formed");
    let opener_app = app.clone();

    let window = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Akaun")
        .inner_size(1280.0, 860.0)
        .initialization_script(NORMALIZE_BLANK_LINKS_SCRIPT)
        .on_new_window(move |url, _features: NewWindowFeatures| {
            // External links (attachments, PDF prints, import review files,
            // help links) open in the OS default browser/viewer instead of
            // trying to pop a second window inside the bare embedded webview.
            if let Err(err) = opener_app.opener().open_url(url.to_string(), None::<&str>) {
                log::error!("Failed to open external link {url}: {err}");
            }
            NewWindowResponse::Deny
        })
        .build()?;

    // Hide instead of destroy on close: the sidecar keeps running as a
    // background service, and the tray/relaunch path re-shows this same
    // window rather than creating a duplicate.
    let window_for_close = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_for_close.hide();
        }
    });

    Ok(())
}

/// Single entry point for "bring Akaun's UI to the front" — used by the
/// tray's "Open Akaun" item, a second app launch (single-instance callback),
/// and the first-ready readiness poll.
fn show_or_create_window(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    if !state.ready.load(Ordering::SeqCst) {
        log::info!("Akaun not ready yet; window will appear automatically once the sidecar is up");
        return;
    }
    let port = state.port;
    let main_thread_app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        match main_thread_app.get_webview_window(MAIN_WINDOW_LABEL) {
            Some(w) => {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            None => {
                if let Err(err) = build_main_window(&main_thread_app, port) {
                    log::error!("Failed to create main window: {err}");
                }
            }
        }
    });
}

/// Asks the sidecar to shut down over its local HTTP endpoint (portable,
/// unlike OS signals) and waits briefly for it to exit; falls back to a hard
/// kill so Quit never hangs regardless of sidecar state.
fn shutdown_sidecar_blocking(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    if state.exited.load(Ordering::SeqCst) {
        return;
    }

    let url = format!("http://127.0.0.1:{}/__akaun/shutdown", state.port);
    let result = ureq::post(&url)
        .set("x-shutdown-token", &state.shutdown_token)
        .timeout(Duration::from_secs(3))
        .call();
    if let Err(err) = result {
        log::warn!("Shutdown request failed: {err}");
    }

    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if state.exited.load(Ordering::SeqCst) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    let taken = state.child.lock().unwrap().take();
    if let Some(child) = taken {
        log::warn!("Sidecar did not exit gracefully in time, killing it");
        let _ = child.kill();
    }
}

fn quit_app(app: &AppHandle) {
    shutdown_sidecar_blocking(app);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch just means "bring the running instance's UI
            // back" — show/focus the existing window rather than starting a
            // second sidecar.
            show_or_create_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Registered unconditionally (not just debug builds): a packaged
            // release app has no terminal, so this is the only way to see
            // sidecar stdout/stderr or our own log lines when something goes
            // wrong. Writes to both stdout (useful under `tauri dev`) and a
            // rotating file under the app's log directory.
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                            file_name: None,
                        }),
                    ])
                    .build(),
            )?;

            // A real window now exists, so behave like a normal Mac app:
            // Dock icon + Cmd+Tab entry, alongside the tray/menu-bar icon.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let database_path = app_data_dir.join("akaun.db");
            let storage_path = app_data_dir.join("storage");

            let port = pick_port();
            let shutdown_token = random_token();

            let sidecar_dir = app.path().resource_dir()?.join("resources").join("sidecar");

            let (mut rx, child) = app
                .shell()
                .sidecar("bun")?
                .args(["server.js"])
                .current_dir(sidecar_dir)
                .env("HOST", "127.0.0.1")
                .env("PORT", port.to_string())
                .env("DATABASE_PATH", database_path.to_string_lossy().to_string())
                .env("STORAGE_PATH", storage_path.to_string_lossy().to_string())
                .env("SHUTDOWN_TOKEN", shutdown_token.clone())
                .env("LOG_LEVEL", "info")
                // Deliberately no NODE_ENV=production: keeps the login route's
                // `secure: process.env.NODE_ENV === 'production'` cookie flag
                // false, which is required for the session cookie to be sent
                // back over plain http://127.0.0.1.
                .spawn()?;

            let exited = Arc::new(AtomicBool::new(false));
            {
                let exited = exited.clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => {
                                log::info!("[sidecar] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Stderr(line) => {
                                log::warn!("[sidecar] {}", String::from_utf8_lossy(&line));
                            }
                            CommandEvent::Terminated(_) => {
                                exited.store(true, Ordering::SeqCst);
                                break;
                            }
                            _ => {}
                        }
                    }
                });
            }

            let ready = Arc::new(AtomicBool::new(false));

            app.manage(SidecarState {
                child: Mutex::new(Some(child)),
                exited,
                port,
                shutdown_token,
                ready: ready.clone(),
            });

            let open_item = MenuItem::with_id(app, "open", "Open Akaun", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            // macOS gets the dedicated monochrome, alpha-only mark (auto-tinted
            // for light/dark menu bars via `icon_as_template`); other
            // platforms get the real, full-color app icon.
            let tray_icon = tauri::image::Image::from_bytes(TRAY_ICON_BYTES)?;
            #[allow(unused_mut)]
            let mut tray_builder = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_or_create_window(app),
                    "quit" => quit_app(app),
                    _ => {}
                });
            #[cfg(target_os = "macos")]
            {
                tray_builder = tray_builder.icon_as_template(true);
            }
            tray_builder.build(app)?;

            // First-launch UX: wait until the sidecar's port accepts
            // connections (DB migrations/seeding run synchronously before
            // server.listen() in server.js, so a bare TCP connect is a
            // sufficient readiness signal), then show the embedded window.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(20);
                while Instant::now() < deadline {
                    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
                        ready.store(true, Ordering::SeqCst);
                        show_or_create_window(&app_handle);
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                log::error!("Akaun server did not become ready within 20s");
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                shutdown_sidecar_blocking(app_handle);
            }
        });
}
