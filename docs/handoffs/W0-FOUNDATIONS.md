# W0 — Foundations: tools.ts, CRLF-safe reads, .gitattributes

**Task:** W0 · **Track:** all (serial; lands before Wave 1 branches) · **Size:** S · **Branch:** `w0/foundations`
**Read first:** `AGENTS.md`, `docs/plan/ROADMAP.md`.

## Goal

Wave 1 runs three agents in parallel, one of them porting to Windows. Two things have to exist before that, so they don't each invent their own:

1. **One module that finds external programs.** Today `server/print.ts` has a macOS-only `chromeBinary()`, and `qpdf`, `pdftotext`, `pdfinfo`, `pdffonts`, and `git` are called by bare name in four files. On Windows, Chrome is in Program Files, Edge is always present, and poppler/qpdf live wherever winget put them.
2. **Library text that parses with CRLF line endings.** `splitFrontmatter()` (`src/schema/markdown.ts`) matches `^---\n`, and `parseBody()` splits on `\n`. A Windows checkout with `core.autocrlf=true` (Git for Windows' default) breaks every leaf.

This is a **move + one normalizer**. Behavior on macOS and Linux must not change.

## Done when

- [ ] `server/tools.ts` exists with `toolPath()`, `doctor()`, `readLibraryText()` (spec below).
- [ ] Every external program call in `server/` goes through `toolPath()`. Check with `grep -rnE "(execFile|execFileSync|spawnSync|execFileAsync)\(\s*'" server cli`, which should return nothing.
- [ ] Every one of those calls also passes `windowsHide: true`. Without it, each git/qpdf/Chrome call flashes a console window when the desktop app runs on Windows.
- [ ] `chromeBinary()` and `MAC_BROWSERS` are gone from `print.ts`.
- [ ] Library text reads in `server/repo.ts` use `readLibraryText()`. `splitFrontmatter()` and `parseBody()` also normalize at entry (they run in the browser too).
- [ ] `.gitattributes` exists at the repo root. `git add --renormalize . && git status` shows no changes, or the changes are committed with the reason in the PR.
- [ ] Ingest writes a library `.gitattributes`. The git adapter allows that one root file in snapshots.
- [ ] Library clone uses `--config core.autocrlf=false`.
- [ ] New `scripts/tools-check.ts` is wired into `npm run test:md`.
- [ ] `npx tsc -b`, `npm run lint`, `npm run test:md`, `test:slice3`, `test:slice6`, `test:slice7`, `test:slice10` all pass on macOS.

## Files

This task is serial, so it may touch other tracks' files, **only at the lines named here**:

```text
server/tools.ts                 NEW
scripts/tools-check.ts          NEW
.gitattributes                  NEW
server/print.ts                 chromeBinary/MAC_BROWSERS → toolPath('chrome'); 'qpdf'/'pdfinfo'/'pdftotext' → toolPath(…)
server/ingest.ts                pdfToText/pdfFonts/pdfInfo → toolPath(…); ensureLibraryGitConfig() also writes .gitattributes
server/git.ts                   spawnGit: 'git' → toolPath('git'); isAllowedGitPath: allow exactly '.gitattributes'
server/config.ts                ensureClone: toolPath('git'), add '--config', 'core.autocrlf=false' to the clone args
server/repo.ts                  readFileSync(…, 'utf8') on library files → readLibraryText(…)
src/schema/markdown.ts          splitFrontmatter, parseBody, bodyStartLine, blockSourceRanges: normalize \r\n? → \n at entry
package.json                    append tools-check to test:md
```

## Spec: `server/tools.ts`

```ts
export type ToolName = 'chrome' | 'qpdf' | 'pdftotext' | 'pdfinfo' | 'pdffonts' | 'git'

/** Absolute path when found, else the bare command name (so the caller's ENOENT message still fires). */
export function toolPath(name: ToolName): string

export type ToolStatus = { name: ToolName; path: string | null; version: string | null; needed_for: string }
export function doctor(): { ok: boolean; tools: ToolStatus[] }

/** utf8, BOM stripped, CRLF/CR → LF. Use for every Markdown/YAML file under the library. */
export function readLibraryText(file: string): string
```

Resolution order for `toolPath`:

1. **Env override**, if set and non-empty: `chrome` ← `REVDESK_CHROME`; `qpdf` ← `REVDESK_QPDF`; `git` ← `REVDESK_GIT`; `pdftotext`/`pdfinfo`/`pdffonts` ← `path.join(REVDESK_POPPLER_DIR, name + exe)`. Return it without checking that it exists; the operator asked for it.
2. **Known install locations** (first that `existsSync`):
   - `chrome` on macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `/Applications/Chromium.app/Contents/MacOS/Chromium` (the current `MAC_BROWSERS`, same order).
   - `chrome` on Windows: `%ProgramFiles%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe`, `%ProgramFiles%\Microsoft\Edge\Application\msedge.exe`. Read the env vars with `process.env`; skip a candidate when its var is unset.
   - `git` on Windows: `%ProgramFiles%\Git\cmd\git.exe`.
   - Others: none. They come from PATH.
3. **PATH search.** Split `process.env.PATH` on `path.delimiter`. On Windows, try each extension in `PATHEXT` (default `.EXE;.CMD;.BAT`). Names to try for `chrome`: `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`, `msedge`. Every other tool: its own name.
4. **Fallback:** the bare name (`'chromium'` for chrome, matching today's behavior).

`doctor()` runs a version probe with a 5 s timeout and `windowsHide: true`, taking the first non-empty line of stdout, else stderr: `git --version`, `qpdf --version`, `pdftotext -v` (prints to stderr), `pdfinfo -v`, `pdffonts -v`. Chrome on Windows prints no version, so report the path and `version: null`. `ok` is true when every tool has a path. `needed_for`: chrome → "PDF render", qpdf → "PDF watermark and page stamps", poppler tools → "PDF render and ingest", git → "history, launch, and bound library".

`toolPath` does not cache. These calls are rare and the operator may install a tool while the app runs.

## CRLF

- Add a `normalizeNewlines(text)` helper (`text.replace(/\r\n?/g, '\n')`) in `src/schema/markdown.ts`. It must be browser-safe, so no Node imports there. Call it first thing in `splitFrontmatter`, `parseBody`, `bodyStartLine`, and `blockSourceRanges`. Line counts do not change.
- `readLibraryText` in `server/tools.ts` does the same plus a BOM strip. In `server/repo.ts`, switch the library text reads (sections, manual.yaml, theme.yaml, ledger.yaml, findings, change/TR/issue YAML) to it. **Leave alone** anything under `control/instruments/` or `control/correspondence/`, and any read whose bytes get hashed. Those stay exact `readFileSync`.
- Writers already write `\n`. Do not change writers.

## .gitattributes

Repo root:

```gitattributes
* text=auto eol=lf
*.pdf  binary
*.png  binary
*.jpg  binary
*.gif  binary
*.webp binary
*.ico  binary
*.icns binary
*.eml  -text
**/control/instruments/** -text
**/control/correspondence/** -text
```

**Instruments are hashed bytes.** `text=auto` would turn a CRLF letter attached on Windows into LF on commit, and its stored sha256 would stop matching. `-text` means byte-exact both ways. Today every tracked instrument and `.eml` is LF in the index (checked 2026-10-07), so renormalizing should change nothing. **If any instrument's bytes or stored sha256 would change, stop and say so.** Never rewrite an instrument.

Library: `ensureLibraryGitConfig(dataRoot)` in `server/ingest.ts` also writes `<dataRoot>/.gitattributes`, if absent, with the same content minus the `**/` prefixes (`control/instruments/** -text`, `control/correspondence/** -text`). In `server/git.ts` `isAllowedGitPath`, allow `normalized === '.gitattributes'` (exact match; do not add it to `ALLOWED_PREFIXES`).

## Tests: `scripts/tools-check.ts`

Same shape as `scripts/slice7-ingest-check.ts` (`check(label, ok)` and a non-zero exit on failure):

- `readLibraryText` on a temp file with `\r\n` and a BOM returns LF with no BOM.
- `splitFrontmatter` and `parseBody` on a CRLF leaf give the same result as on the LF version (deep-equal JSON).
- `toolPath('chrome')` returns `REVDESK_CHROME` when it is set. Set and restore it inside the test.
- `toolPath('git')` resolves to something that runs `--version` (git is required in CI).
- `doctor().tools` has six entries with the right names.

## Do not

- Change any error message text callers emit (tests grep some of them).
- Add an npm dependency.
- Touch `src-tauri/` (T1.1 does Windows in the shell).
- Bundle or download any tool.
- Change writers, pagination, or the ledger.

## PR

Title `refactor(server): one tool resolver and CRLF-safe library reads`. Body: W0, a link to this file, the Tested checklist, and the renormalize result.
