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

Finder-launched apps on macOS get a bare PATH. The shell adds node's own directory, `/opt/homebrew/bin`, and `/usr/local/bin` before starting the server.

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
