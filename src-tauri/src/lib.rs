//! Revdesk desktop shell.
//!
//! Phase 0: the Rust side owns the window, menus, and library choice; the
//! existing Node server (`server/standalone.ts`, bundled as `server.mjs` in
//! release) runs as a loopback sidecar and serves both the UI and `/api/*`.
//! The window just loads that URL, so the web build is untouched.

use std::{
    env,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::Duration,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const MAIN: &str = "main";
const MENU_OPEN_LIBRARY: &str = "open-library";
const MENU_REVEAL_LIBRARY: &str = "reveal-library";

struct Sidecar {
    child: Child,
    // Held open so the server lives exactly as long as we do
    // (`REVDESK_EXIT_ON_STDIN_CLOSE`), even if we are killed.
    _stdin: ChildStdin,
}

#[derive(Default)]
struct Desk {
    sidecar: Mutex<Option<Sidecar>>,
    library: Mutex<Option<PathBuf>>,
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Desk::default())
        .menu(build_menu)
        .on_menu_event(|app, event| {
            let app = app.clone();
            match event.id().as_ref() {
                // Dialogs block; never on the main thread.
                MENU_OPEN_LIBRARY => {
                    thread::spawn(move || {
                        if let Some(dir) = pick_library(&app) {
                            open_library(&app, dir);
                        }
                    });
                }
                MENU_REVEAL_LIBRARY => reveal_library(&app),
                _ => {}
            }
        })
        .setup(|app| {
            let app = app.handle().clone();
            thread::spawn(move || match initial_library(&app) {
                Some(dir) => open_library(&app, dir),
                None => app.exit(0),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Revdesk");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            stop_sidecar(app);
        }
    });
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // Start from the platform default so Edit (⌘C/⌘V/⌘Z) keeps working in the editor.
    let menu = Menu::default(app)?;
    let library = Submenu::with_items(
        app,
        "Library",
        true,
        &[
            &MenuItem::with_id(app, MENU_OPEN_LIBRARY, "Open Library…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, MENU_REVEAL_LIBRARY, "Show Library Folder", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    menu.append(&library)?;
    Ok(menu)
}

// ── Library choice ──────────────────────────────────────────────────────────

fn saved_library_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("library.txt"))
}

/// `REVDESK_DATA`, then the last library opened, then ask.
fn initial_library(app: &AppHandle) -> Option<PathBuf> {
    if let Some(dir) = env::var_os("REVDESK_DATA").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    let saved = saved_library_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| p.is_dir());
    saved.or_else(|| pick_library(app))
}

fn pick_library(app: &AppHandle) -> Option<PathBuf> {
    loop {
        let dir = app
            .dialog()
            .file()
            .set_title("Open a Revdesk library")
            .blocking_pick_folder()?
            .into_path()
            .ok()?;
        if dir.join("manuals").is_dir() {
            return Some(dir);
        }
        let use_anyway = app
            .dialog()
            .message(format!(
                "{} has no manuals/ folder, so it does not look like a Revdesk library yet.\n\nUse it anyway?",
                dir.display()
            ))
            .title("Not a Revdesk library")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom("Use It".into(), "Choose Another".into()))
            .blocking_show();
        if use_anyway {
            return Some(dir);
        }
    }
}

/// (Re)start the server on `dir` and point the window at it.
fn open_library(app: &AppHandle, dir: PathBuf) {
    stop_sidecar(app);
    let url = match start_sidecar(app, &dir) {
        Ok(url) => url,
        Err(message) => {
            app.dialog()
                .message(message)
                .title("Revdesk could not start")
                .kind(MessageDialogKind::Error)
                .blocking_show();
            app.exit(1);
            return;
        }
    };
    if let Some(file) = saved_library_file(app) {
        let _ = fs::create_dir_all(file.parent().unwrap());
        let _ = fs::write(&file, dir.to_string_lossy().as_bytes());
    }
    let title = format!("Revdesk — {}", dir.file_name().unwrap_or_default().to_string_lossy());
    *app.state::<Desk>().library.lock().unwrap() = Some(dir);

    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.set_title(&title);
        let _ = window.navigate(url);
        return;
    }
    if let Err(err) = desk_window(app, MAIN, url, &title, (1360.0, 900.0)) {
        eprintln!("revdesk: window failed: {err}");
        app.exit(1);
    }
}

/// A window on the local server. Pop-ups to the same server (the Issued PDF
/// view) become another desk window; anything else goes to the browser.
fn desk_window(
    app: &AppHandle,
    label: &str,
    url: Url,
    title: &str,
    (width, height): (f64, f64),
) -> tauri::Result<()> {
    static POPUPS: AtomicUsize = AtomicUsize::new(0);
    let downloads = app.path().download_dir().ok();
    let popup_app = app.clone();
    let origin = url.origin();
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(640.0, 480.0)
        .on_new_window(move |target, _features| {
            if target.origin() == origin {
                let app = popup_app.clone();
                let label = format!("popup-{}", POPUPS.fetch_add(1, Ordering::Relaxed));
                thread::spawn(move || {
                    let _ = desk_window(&app, &label, target, "Revdesk", (1100.0, 900.0));
                });
            } else {
                open_external(target.as_str());
            }
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| {
            // PDF "Download" and launch-letter exports land in ~/Downloads.
            if let DownloadEvent::Requested { url, destination } = event {
                if let Some(dir) = &downloads {
                    let name = destination
                        .file_name()
                        .map(|n| n.to_owned())
                        .unwrap_or_else(|| OsString::from(download_name(&url)));
                    *destination = dir.join(name);
                }
            }
            true
        })
        .build()
        .map(|_| ())
}

fn download_name(url: &Url) -> String {
    url.path_segments()
        .and_then(|mut s| s.next_back().map(str::to_owned))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "revdesk-download".into())
}

fn reveal_library(app: &AppHandle) {
    if let Some(dir) = app.state::<Desk>().library.lock().unwrap().clone() {
        open_external(dir);
    }
}

fn open_external(target: impl AsRef<std::ffi::OsStr>) {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    let _ = Command::new(opener).arg(target).spawn();
}

// ── Sidecar ─────────────────────────────────────────────────────────────────

fn start_sidecar(app: &AppHandle, library: &Path) -> Result<Url, String> {
    let node = find_node().ok_or_else(|| {
        let install = if cfg!(target_os = "macos") {
            "`brew install node`"
        } else if cfg!(windows) {
            "`winget install OpenJS.NodeJS.LTS`"
        } else {
            "your package manager"
        };
        format!("Revdesk needs Node.js 22 or newer. Install it (e.g. {install}) and open Revdesk again.")
    })?;

    // Debug: run the TypeScript source from the repo. Release: the bundled
    // `server.mjs` + `dist/` copied into the app's resources.
    let (app_root, args): (PathBuf, Vec<&str>) = if cfg!(debug_assertions) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        (repo, vec!["--experimental-strip-types", "server/standalone.ts"])
    } else {
        let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
        (resources, vec!["server.mjs"])
    };

    let mut cmd = Command::new(&node);
    cmd.args(&args)
        .current_dir(&app_root)
        .env("REVDESK_APP_ROOT", &app_root)
        .env("REVDESK_DATA", library)
        .env("REVDESK_EXIT_ON_STDIN_CLOSE", "1")
        .env("PATH", tool_path(&node))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console behind the app
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not run {}: {e}", node.display()))?;

    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut tx = Some(tx);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            match (line.strip_prefix("REVDESK_LISTENING "), tx.take()) {
                (Some(url), Some(tx)) => {
                    let _ = tx.send(url.trim().to_owned());
                }
                (_, pending) => {
                    tx = pending;
                    println!("[server] {line}");
                }
            }
        }
    });

    let url = match rx.recv_timeout(Duration::from_secs(30)) {
        Ok(url) => url,
        Err(_) => {
            let _ = child.kill();
            return Err("The Revdesk server did not start. Run the app from a terminal to see why.".into());
        }
    };
    *app.state::<Desk>().sidecar.lock().unwrap() = Some(Sidecar { child, _stdin: stdin });
    Url::parse(&url).map_err(|e| e.to_string())
}

fn stop_sidecar(app: &AppHandle) {
    if let Some(mut sidecar) = app.state::<Desk>().sidecar.lock().unwrap().take() {
        let _ = sidecar.child.kill();
        let _ = sidecar.child.wait();
    }
}

/// GUI apps on macOS start with a bare PATH (no Homebrew, no nvm/mise), so
/// look in the usual places and finally ask the user's login shell.
fn find_node() -> Option<PathBuf> {
    if let Some(p) = env::var_os("REVDESK_NODE").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(p));
    }
    let fixed = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
    if cfg!(debug_assertions) || cfg!(target_os = "windows") {
        // Dev runs from a terminal that already has the right node on PATH.
        if let Some(p) = on_path("node") {
            return Some(p);
        }
    }
    if cfg!(windows) {
        return windows_node();
    }
    if let Some(p) = fixed.iter().map(PathBuf::from).find(|p| p.is_file()) {
        return Some(p);
    }
    if cfg!(unix) {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let out = Command::new(shell).args(["-ilc", "command -v node"]).output().ok()?;
        let found = String::from_utf8_lossy(&out.stdout);
        let line = found.lines().map(str::trim).filter(|l| l.starts_with('/')).last()?;
        return Some(PathBuf::from(line));
    }
    on_path("node")
}

/// winget's Node installer, a per-user install, then nvm-windows' symlink.
/// PATH was already tried; a candidate whose env var is unset is skipped.
fn windows_node() -> Option<PathBuf> {
    [
        ("ProgramFiles", "nodejs"),
        ("LOCALAPPDATA", "Programs\\nodejs"),
        ("NVM_SYMLINK", ""),
    ]
    .iter()
    .filter_map(|(var, sub)| {
        let base = PathBuf::from(env::var_os(var).filter(|v| !v.is_empty())?);
        Some(base.join(sub).join("node.exe"))
    })
    .find(|p| p.is_file())
}

fn on_path(bin: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{bin}.exe") } else { bin.to_owned() };
    env::split_paths(&env::var_os("PATH")?).map(|d| d.join(&exe)).find(|p| p.is_file())
}

/// PATH for the server: node's own dir plus Homebrew (Windows: Git's `cmd`
/// dir), so `git`, `qpdf`, `pdfinfo`, and `pdftotext` resolve when launched
/// from Finder or the Start menu.
fn tool_path(node: &Path) -> OsString {
    let mut dirs: Vec<PathBuf> = node.parent().map(Path::to_path_buf).into_iter().collect();
    if cfg!(windows) {
        dirs.extend(env::var_os("ProgramFiles").map(|p| Path::new(&p).join("Git").join("cmd")));
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    if let Some(existing) = env::var_os("PATH") {
        dirs.extend(env::split_paths(&existing));
    }
    env::join_paths(dirs).unwrap_or_default()
}
