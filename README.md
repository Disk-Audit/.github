# Disk Analyzer<img width="1920" height="1040" alt="image" src="image.png" />


A Windows disk space analyzer. Scans a drive or folder and shows what's eating the space as a treemap, with a sortable file list alongside it.

Built with Electron + React + TypeScript for the UI, and a small Rust binary for the actual scanning.

## Install

Grab the latest installer from the [Releases page](https://github.com/Disk-Audit/.github/releases). Run it, done.

The rest of this README is for building from source.

## Requirements

- Windows
- [Node.js 18+](https://nodejs.org/)
- [Rust toolchain](https://rustup.rs/) (optional — without it, the app falls back to a slower Node scanner)

## Running

```powershell
npm install
cd mft_scanner && cargo build --release && cd ..
npm run dev
```

The Rust build is one-time. After that, `npm run dev` is all you need.

## Building an installer

```powershell
npm run package
```

Outputs an NSIS installer in `dist/`. The Rust binary is bundled inside, so end users don't need Rust.

## Usage

1. Pick a drive or folder on the welcome screen
2. Click any rectangle in the treemap to drill into that folder
3. Click any folder in the right-hand list to drill in
4. Right-click a file or folder for "Open in Explorer"
5. Back / Up arrows in the toolbar, or click any breadcrumb segment, to navigate back out

## Project layout

```
src/
├── main/         Electron main process (IPC, scanner orchestration)
├── preload/      Renderer ↔ main bridge
└── renderer/     React UI
mft_scanner/      Rust scanner (FindFirstFileW + rayon)
```

## License

PolyForm Noncommercial 1.0.0 — see `LICENSE`.
