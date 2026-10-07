# Desktop runbook

Phase 0 of the desktop app. A Tauri 2 shell (`src-tauri/`) owns the window, the menus, and which library is open. The Node server runs beside it as a loopback sidecar and serves both the built desk (`dist/`) and `/api/*`. The window loads that URL. The web desk and the systemd unit are unchanged.

```text
Revdesk.app (Rust, Tauri)
  ├─ window → http://127.0.0.1:<random port>/
  └─ node server.mjs   REVDESK_DATA=<library>   (dist/ + /api/*)
```

## Library

On first launch the app asks for a library folder (one with `manuals/`). It remembers the last one. **Library → Open Library…** (⌘O) switches. `REVDESK_DATA` overrides both, for dev.

The library is the same folder the web desk uses. Git, a bound remote, and tags all behave as they do there.

## Needs on the machine

- **Node 22+** (`brew install node`). Phase 0 does not bundle Node. The app looks at `REVDESK_NODE`, then Homebrew, then `/usr/local/bin`, then your login shell.
- **git**, **qpdf**, and **poppler** (`brew install git qpdf poppler`).
- **Chrome or Chromium** for PDFs. The app tries Google Chrome.app, then Chromium.app, then `chromium` on PATH. `REVDESK_CHROME` overrides.

Chrome has no brew line: download it from google.com/chrome. The Prerequisites screen shows the same lines as this page and installs nothing.

Finder-launched apps on macOS get a bare PATH. The shell adds node's own directory, `/opt/homebrew/bin`, and `/usr/local/bin` before starting the server.

## Windows

CI builds an unsigned per-user installer (NSIS, no admin prompt). Windows 10 and 11 only.

1. Open the `desktop` workflow run on GitHub (Actions → desktop → the run → Summary → Artifacts) and download `revdesk-x86_64-pc-windows-msvc`. Unzip it to get `Revdesk_<version>_x64-setup.exe`.
2. Run it. SmartScreen warns because the installer is unsigned: click **More info**, then **Run anyway**. It installs under `%LOCALAPPDATA%\Revdesk` for the current user.
3. Install the prerequisites once, from a terminal, then **close and reopen Revdesk** (and sign out and in if a tool is still not found). A running app does not see the new PATH.

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install QPDF.QPDF
winget install oschwartz10612.Poppler
```

These IDs exist in winget-pkgs (checked 2026-10-07). Edge ships with Windows and renders the PDFs; Chrome also works.

Where the app looks:

- **Node 22+**: `REVDESK_NODE`, then PATH, then `%ProgramFiles%\nodejs`, `%LOCALAPPDATA%\Programs\nodejs`, and `%NVM_SYMLINK%` (nvm-windows).
- **git**: `REVDESK_GIT`, then `%ProgramFiles%\Git\cmd`, then PATH. The shell also puts that folder on the server's PATH.
- **qpdf**, **poppler** (`pdfinfo`, `pdftotext`, `pdffonts`): PATH. winget links poppler into `%LOCALAPPDATA%\Microsoft\WinGet\Links`, which is on your user PATH. `REVDESK_QPDF` points at `qpdf.exe`; `REVDESK_POPPLER_DIR` points at the folder holding the `pdf*.exe` files (for the zip from oschwartz10612/poppler-windows if winget is not an option).
- **Chrome or Edge**: `REVDESK_CHROME`, then Chrome, then Edge under `Program Files`.

Set an override as a user environment variable (Settings → System → About → Advanced system settings → Environment Variables), then reopen Revdesk.

Per-user data: the desk config is `%APPDATA%\revdesk\config.yaml` and a bound remote is cloned under `%LOCALAPPDATA%\revdesk\libraries\`. `XDG_CONFIG_HOME` and `XDG_DATA_HOME` still win when set. The last-opened library is remembered by the app itself, as on macOS.

Known gaps on Windows:

- Unsigned installer (SmartScreen step above). No auto-update.
- Node, git, qpdf, and poppler are prerequisites, not bundled. The **Prerequisites** screen (mast, next to Config) lists each tool, where it was found, and the install line for this OS. It opens by itself at first run, and a banner shows on every page while a tool is missing. `revdesk doctor` prints the same list (exit `5` when anything is missing).
- The qpdf installer may not add itself to PATH. If PDFs fail with a qpdf error, set `REVDESK_QPDF` (usually `C:\Program Files\qpdf <version>\bin\qpdf.exe`).
- Not yet run on a real Windows machine: follow the [Windows smoke checklist](windows-smoke.md). The `scripts/*.sh` acceptance scripts are bash and do not run there.
- Downloads go to the Downloads folder with no prompt.

## Run from source

```sh
npm install
npm run desktop          # tauri dev: builds dist/, runs server/standalone.ts from the repo
npm run serve            # the sidecar on its own: node server/standalone.ts (needs dist/)
```

`npm run serve` prints `REVDESK_LISTENING <url>`. It binds loopback on a random port (`--port N` to pin one). It never takes :5173.

## Build

```sh
npm run desktop:build    # dist/ + dist-server/server.mjs, then tauri build
```

Windows: `.exe` under `src-tauri/target/<target>/release/bundle/nsis/` (CI builds it; see Windows above).

Linux: `.deb` / AppImage under `src-tauri/target/release/bundle/`.

**Apple Silicon cannot be built from this x86 Linux box.** Tauri links Apple's WebKit and AppKit, and the macOS SDK is only licensed on Apple hardware. Use one of these:

1. **GitHub Actions.** The `desktop` workflow runs on PRs that touch the app and on main (or Actions → desktop → Run workflow once it is on main). The `macos-14` runner is arm64. Download `revdesk-aarch64-apple-darwin` (a `.dmg`).
2. **On the Mac.** Install the Xcode Command Line Tools (`xcode-select --install`; full Xcode is not needed), Rust via rustup (not brew's `rust`), and Node. Then `npm ci && npm run desktop:build`.

The bundle is ad-hoc signed (`signingIdentity: "-"`). A `.dmg` from CI is quarantined on download. Right-click → Open the first time, or run `xattr -dr com.apple.quarantine /Applications/Revdesk.app`. Signing and notarizing for other people's Macs needs an Apple Developer ID. Not done.

## Known gaps (Phase 0)

- Node is a prerequisite, not bundled.
- Linux WebKitGTK has no inline PDF viewer, so the Issued PDF page may download the file instead of showing it. macOS WKWebView shows it inline.
- Downloads go to `~/Downloads` with no prompt.
- One library per app instance.
