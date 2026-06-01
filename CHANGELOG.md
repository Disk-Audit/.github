# Changelog

## v1.4.9
**CLI (`ledgeon`)**

- Bundled with the installer — available system-wide from any terminal after install
- `ledgeon` scans the current directory and prints a size-sorted tree
- `ledgeon <path>` scans a specific drive or folder
- `ledgeon list` shows all detected drives with used/total sizes

| Flag | Default | Description |
|------|---------|-------------|
| `--depth N` | 3 | Levels deep to display |
| `--top N` | 10 | Max entries per level, largest first |
| `--min-size N` | — | Hide entries smaller than N (e.g. `50mb`, `1gb`) |
| `--json` | — | Output raw JSON for scripting |

---

## v1.4.8
**Windows developer experience**

- Added `run.bat` — double-click to build and launch the app on Windows with a single step; handles the admin check required for MFT scanning and switches to the correct working directory automatically

---

## v1.4.7
**MFT fast scanner**

- New MFT (Master File Table) scan mode on Windows — reads the NTFS volume journal directly instead of walking the file tree, dramatically faster on large drives
- Requires admin privileges (already requested by the installer); falls back to the standard walker if unavailable or on non-NTFS volumes

---

## v1.4.6
**Network drives & performance**

- Mapped network drives now appear in the drives list
- UNC paths (e.g. `\\server\share`) can be entered manually
- Faster scans: larger I/O buffers, mimalloc allocator, more worker threads in the Rust scanner
- Drive switcher UI improvements
- Various minor UI polish

---

## v1.4.0
**Folder header**

- Added a folder header bar showing the current folder name and size while browsing the treemap

---

## v1.3.3
**Linux Mint / Cinnamon integration**

- "Scan with Disk Analyzer" now appears in the Nemo file manager right-click menu (Linux Mint / Cinnamon)
- Installs and uninstalls cleanly with the `.deb` package

---

## v1.3.2
**Bug fixes**

- Minor fixes to the main process and renderer

---

## v1.3.1
**New icon**

- Refreshed app icon across all sizes and platforms

---

## v1.3.0
**Duplicate file finder**

- New "Find duplicates" tool — scans for byte-identical files using SHA-256 hashing
- Groups results by wasted space, largest first
- Safe deletion to Recycle Bin / Trash
- Cancellable mid-scan

---

## v1.2.2
**Windows right-click menu**

- "Scan with Disk Analyzer" now appears when you right-click a folder, the background of a folder window, or a drive root in Explorer
- Installs and uninstalls cleanly with the NSIS installer

---

## v1.2.1
**Treemap & icon improvements**

- Treemap visual improvements
- Windows `.ico` icon added

---

## v1.0.2
**Linux icon set & duplicate finder polish**

- Full icon set added for Linux (16px – 512px)
- Duplicate finder UI improvements

---

## v1.0.1
**Duplicate finder fixes**

- Cancel button now reliably stops an in-progress duplicate scan
- Additional IPC handlers for scan lifecycle

---

## v1.0.0
**First release**

- Treemap visualization with drill-in navigation
- File list with sortable columns and search
- File type breakdown panel
- Drive switcher
- Right-click "Send to Recycle Bin" / Trash
- Windows and Linux support

---

## v0.9.0
**Major feature update (pre-release)**

- Drive switcher — swap between drives without re-launching
- Duplicate file finder (initial version)
- File type breakdown panel
- File list with sortable columns
- Large CSS and UI overhaul

---

## v0.6.x
**Cross-platform foundation**

- Linux support added
- Treemap color fixes
- AppImage and `.deb` build targets
- Various stability fixes
