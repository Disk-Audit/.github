# Disk Analyzer

A Windows desktop app that scans a folder or drive and shows what's eating your space. Drive picker on the welcome screen, then a custom-chrome app window with a drill-down treemap on the left and a sortable file list on the right.

Built with **Electron + React + TypeScript + Vite + D3** for the UI and a small **Rust** binary for fast scanning + drive info.

---

## What's new in 0.3

- New "classic split" layout matching the design preview: custom title bar with min/max/close, toolbar with back/up/refresh + breadcrumb, treemap + list body, status bar.
- The treemap now shows the **immediate children** of the current folder, not all leaves. Click a folder rectangle to drill in; the layout re-squarifies for that level.
- Top-by-size children get the info/warning/success/danger palette tiers so the biggest items pop visually; the rest fall back to neutral.
- Light + dark mode auto via `prefers-color-scheme`.
- Window controls (minimize, maximize, close) are wired up via new IPC handlers since the window is now frameless.

---

## What you need installed first

- **Node.js 18 or later** — [download here](https://nodejs.org/). The "LTS" version is fine.
- **Rust toolchain** — [rustup.rs](https://rustup.rs/). Needed to build the fast scanner. If you skip this, the app still works, just slower (Node fallback).
- **Windows.** The path code and most APIs are Windows-first.

---

## Running it

Open a terminal in the project folder, then:

```powershell
npm install

cd mft_scanner
cargo build --release
cd ..

npm run dev
```

The Rust build only needs to happen once (or after edits to `mft_scanner/`). The Electron window opens automatically once `npm run dev` is ready.

**Hot reload works**: edit any file in `src/renderer/` and the UI updates instantly. Edit `src/main/` or `src/preload/` and the app restarts.

### Try it out

1. Pick a drive from the cards on the welcome screen — or click **"Or scan a specific folder…"** to pick a folder
2. **Click a rectangle** in the treemap or a row in the list to drill into that folder. The treemap re-lays for the new level.
3. Walk back up via the **breadcrumb** segments, the **back arrow** (history-aware), or the **up arrow** (parent folder).
4. **Right-click any item** in the list for "Open in Explorer".

---

## Building a real `.exe` to keep

```powershell
npm run package
```

This produces an NSIS installer in `dist/`. The Rust binary is bundled inside automatically via `extraResources`, so end users don't need Rust installed.

Before `npm run package`, make sure `mft_scanner/target/release/mft_scanner.exe` exists (i.e. you've run `cargo build --release` at least once).

---

## How the code is organized

```
disk-analyzer/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── mft_scanner/               # Rust scanner binary
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs            #   --list-drives / --walk subcommands
│       ├── drives.rs          #   GetLogicalDriveStrings + SSD/HDD detection
│       └── walker.rs          #   parallel FindFirstFileW walker
└── src/
    ├── main/                  # Node.js side (full filesystem access)
    │   ├── index.ts           #   Electron entry, IPC handlers
    │   ├── scanner.ts         #   Pure-Node fallback walker
    │   ├── drives.ts          #   Calls Rust binary, falls back to PowerShell
    │   └── rustWalker.ts      #   Calls Rust walker, falls back to Node
    ├── preload/
    │   └── index.ts           # Safe bridge exposing window.api
    └── renderer/
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx        # Welcome screen + scan result view
            ├── types.ts
            ├── window.d.ts
            ├── index.css
            └── components/
                ├── Treemap.tsx      # Drill-down squarified treemap
                ├── FileList.tsx     # Sortable list, right-click menu
                ├── Breadcrumbs.tsx
                └── ScanProgress.tsx
```

---

## How scanning works

When you start a scan, the app tries these in order, falling through on failure:

1. **Rust walker** (`mft_scanner.exe --walk <path>`) — uses `FindFirstFileW` directly, parallelized via rayon. No admin needed. Fast: ~5-10 seconds for 2M files on an SSD.
2. **Node walker** (`src/main/scanner.ts`) — pure Node.js using `fs.readdir` + `fs.stat`. Slower but works without any external binary.

The Node walker is preserved as a fallback in case the Rust binary is missing (e.g. someone ran the dev server without building Rust first).

---

## Where to look first when you want to change something

| You want to… | Look at |
|---|---|
| Change the treemap color tiers | `src/renderer/src/components/Treemap.tsx` → `PALETTE` |
| Add a column to the file list | `src/renderer/src/components/FileList.tsx` |
| Change the design tokens / theme | `src/renderer/src/index.css` → CSS vars at the top (light + dark) |
| Add a new right-click menu item | `FileList.tsx` → `.context-menu`, plus a new IPC handler in `src/main/index.ts` and preload |
| Change the window size or title | `src/main/index.ts` → `BrowserWindow({...})` |
| Tweak the title bar buttons | `src/renderer/src/App.tsx` → `TitleBar` component |

---

## Troubleshooting

**`cargo build` fails with "linker not found"** — you need the C++ Build Tools that ship with Visual Studio (the "Desktop development with C++" workload). Install from [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/).

**Scan is slow** — DevTools console (Ctrl+Shift+I) will show `[scan] Rust walker succeeded` or `[scan] falling back to Node scanner`. If it's falling back, the Rust binary isn't being found — check `mft_scanner/target/release/mft_scanner.exe` exists.

**Drive picker shows nothing** — check the DevTools console. If the Rust binary is missing it falls back to PowerShell, which is slower but should still work.

**Permission denied on system folders** — expected. Right-click the installed app and "Run as administrator" if you need access to protected directories.

---

## License

PolyForm Noncommercial License 1.0.0 — see `LICENSE`.
