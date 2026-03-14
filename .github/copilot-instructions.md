# Spicetify CLI – Copilot Instructions

## Architecture Overview

This is a **Go CLI tool** that customizes the Spotify desktop client by patching its bundled JavaScript/CSS files. It also ships first-party **JavaScript extensions** and **custom apps** that get injected into the patched client.

### Two distinct layers
1. **Go backend** (`src/`, `spicetify.go`) – The CLI engine: parses config, locates Spotify's install, backs up app files, preprocesses and patches JS bundles, injects extensions/themes, and manages Spotify restart.
2. **JavaScript layer** (`Extensions/`, `CustomApps/`, `jsHelper/`) – Extensions and apps that run _inside_ Spotify's Electron renderer. These consume the `Spicetify` global namespace exposed by `jsHelper/spicetifyWrapper.js`.

### Core command pipeline
The essential workflow is always **backup → apply**:
- `backup`: Extracts Spotify's `.spa` zip packages from `spotifyPath/Apps/` into a state folder (`Backup/`, `Extracted/`). Runs `preprocess` (disables Sentry, exposes APIs, removes RTL rules, translates obfuscated CSS classes via `css-map.json`).
- `apply`: Copies preprocessed assets to Spotify's live `Apps/` directory, injects theme CSS/JS, extensions, and custom apps via `src/apply/apply.go`.
- Other commands (`watch`, `restore`, `update`, `config`, `color`) wrap these two primitives.

### Key path relationships
- Spicetify config lives in `~/.config/spicetify/config-xpui.ini` (Linux/macOS) or `%APPDATA%\spicetify\config-xpui.ini` (Windows). Run `spicetify -c` to print the path.
- `src/cmd/cmd.go` holds all shared command-level state (config sections, resolved paths, feature flags) as package-level vars initialized by `InitConfig()` and `InitPaths()`.
- `src/utils/config.go` defines the canonical `configLayout` map – the source of truth for all config keys and defaults.

## Developer Workflows

**Build:**
```sh
# Windows
go build -o spicetify.exe
# Linux/macOS
go build -o spicetify
```
Version is injected at release via `-ldflags "-X main.version=TAG"`. During development `version` defaults to `"Dev"`.

**Format & lint:**
```sh
gofmt -s -w .                        # Go source
biome check --write .                # JS/TS/JSON (tabs, lineWidth 150)
```
CI enforces both: `gofmt` (build.yml) and `biome ci` (linter.yml).

**Do NOT run spicetify as administrator/root** – the tool explicitly checks and exits if elevated privileges are detected (see `src/utils/isAdmin/`).

## Project-Specific Conventions

### Go side
- All user-facing output goes through `utils.Print*` helpers (`PrintInfo`, `PrintError`, `PrintSuccess`, `PrintWarning`) or `utils.Spinner` – never `fmt.Print` directly.
- Long-running steps use the spinner pattern: `spinner, _ := utils.Spinner.Start("…"); … ; spinner.Success("…")` or `spinner.Fail("…")`.
- Fatal errors use `utils.Fatal(err)` (not `log.Fatal`).
- File patching uses regex-based `utils.Replace` / `utils.ReplaceOnce` helpers (`src/utils/utils.go`).
- Config is an INI file parsed with `go-ini/ini`; sections are `Setting`, `Preprocesses`, `AdditionalOptions`, `Patch`.
- Platform branches use `runtime.GOOS` checks (`"windows"`, `"darwin"`, `"linux"`).

### JavaScript side
- All extensions **must** be wrapped in a named IIFE and poll until `Spicetify` APIs are available:
  ```js
  /// <reference path="../globals.d.ts" />
  (function MyExtension() {
    const { CosmosAsync, Player } = Spicetify;
    if (!CosmosAsync) { setTimeout(MyExtension, 300); return; }
    // …
  })();
  ```
- `globals.d.ts` provides full TypeScript types for the `Spicetify` namespace – reference it in any JS file that uses Spicetify APIs.
- `jsHelper/spicetifyWrapper.js` is the runtime shim injected into Spotify when `expose_apis = 1`; it defines `window.Spicetify`.
- Custom apps require a `manifest.json` with localized `name` entries and an `index.js` entry point.
- Extensions are registered in the root `manifest.json`; custom apps have their own per-folder `manifest.json`.
- `css-map.json` maps Spotify's obfuscated CSS class names to stable identifiers used in themes and extensions.

### Biome formatter settings (JS/TS/JSON)
- Indent: **tabs**, width 2
- Line width: **150**
- Trailing commas: `es5`
- `noExplicitAny`: off (Spicetify APIs use `any` extensively)

## Commit Convention
Angular-style: `<type>(<scope>): <subject>` (imperative, lowercase, no trailing dot).
Types: `feat | fix | docs | chore | revert`

## Key Files to Know
| File/Dir | Purpose |
|---|---|
| `spicetify.go` | Entry point; flag/command parsing, init, main dispatch |
| `src/cmd/cmd.go` | Shared state and `InitConfig` / `InitPaths` |
| `src/preprocess/preprocess.go` | JS patching via regex; CSS class translation |
| `src/apply/apply.go` | Injects extensions, custom apps, theme JS into xpui bundles |
| `src/utils/config.go` | Config schema (`configLayout`) and `ParseConfig` |
| `jsHelper/spicetifyWrapper.js` | Runtime `window.Spicetify` shim injected into Spotify |
| `globals.d.ts` | TypeScript declarations for `Spicetify.*` APIs |
| `css-map.json` | Obfuscated → stable CSS class name mapping |
| `Themes/SpicetifyDefault/` | Reference theme structure (`color.ini` + `user.css`) |
