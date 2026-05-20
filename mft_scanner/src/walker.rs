// Fast directory walker using FindFirstFileW / FindNextFileW.
//
// Why this instead of MFT reading:
//   - No admin required (these are regular Win32 APIs)
//   - Works on FAT32, exFAT, ReFS, network drives — not just NTFS
//   - File size comes back in the directory enumeration itself (no per-file
//     stat call needed), which is the main reason it's 5-10x faster than a
//     Node walker for huge trees
//
// Parallelism comes from rayon: each directory's subdirectories are walked
// concurrently via `par_iter`. Rayon's work-stealing thread pool naturally
// balances load when one subtree (e.g. Windows\WinSxS) is much bigger than
// its siblings.
//
// Progress format on stderr: `PROGRESS:<files>:<bytes>:<currentPath>` once
// every ~200ms. The Node side parses this and pushes it to the renderer.

use anyhow::Result;
use rayon::prelude::*;
use serde::Serialize;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Serialize)]
pub struct JsonNode {
    pub name: String,
    pub path: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub node_type: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<JsonNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// --- Win32 bindings ---

#[repr(C)]
struct Filetime {
    _low: u32,
    _high: u32,
}

#[repr(C)]
struct Win32FindDataW {
    file_attributes: u32,
    _creation_time: Filetime,
    _last_access_time: Filetime,
    _last_write_time: Filetime,
    file_size_high: u32,
    file_size_low: u32,
    _reserved_0: u32,
    _reserved_1: u32,
    file_name: [u16; 260],
    _alternate_file_name: [u16; 14],
}

const INVALID_HANDLE_VALUE: isize = -1;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const ERROR_NO_MORE_FILES: u32 = 18;
const SEM_FAILCRITICALERRORS: u32 = 0x0001;

#[link(name = "kernel32")]
extern "system" {
    fn FindFirstFileW(file_name: *const u16, find_data: *mut Win32FindDataW) -> isize;
    fn FindNextFileW(find_handle: isize, find_data: *mut Win32FindDataW) -> i32;
    fn FindClose(find_handle: isize) -> i32;
    fn GetLastError() -> u32;
    fn SetErrorMode(mode: u32) -> u32;
}

// --- Shared progress state ---

struct Progress {
    files: AtomicU64,
    bytes: AtomicU64,
    current_path: Mutex<String>,
}

// --- Entry point ---

pub fn walk(root: &str) -> Result<()> {
    unsafe { SetErrorMode(SEM_FAILCRITICALERRORS); }

    let root_normalized = root.trim_end_matches('\\').to_string();

    let progress = Arc::new(Progress {
        files: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        current_path: Mutex::new(String::new()),
    });
    let done = Arc::new(AtomicBool::new(false));

    // Background reporter ticks every 200ms.
    let prog_for_reporter = progress.clone();
    let done_for_reporter = done.clone();
    let progress_thread = thread::spawn(move || {
        while !done_for_reporter.load(Ordering::Relaxed) {
            emit_progress(&prog_for_reporter);
            thread::sleep(Duration::from_millis(200));
        }
        // Final tick so the UI sees the completed count.
        emit_progress(&prog_for_reporter);
    });

    let tree = walk_dir(&root_normalized, &progress);

    done.store(true, Ordering::Relaxed);
    progress_thread.join().ok();

    println!("{}", serde_json::to_string(&tree)?);
    Ok(())
}

fn emit_progress(progress: &Progress) {
    let files = progress.files.load(Ordering::Relaxed);
    let bytes = progress.bytes.load(Ordering::Relaxed);
    // try_lock — if some worker is mid-update, just use the last known
    // (empty on first tick, fine). Never block the reporter on workers.
    let path = match progress.current_path.try_lock() {
        Ok(p) => p.clone(),
        Err(_) => String::new(),
    };
    // PROGRESS:<files>:<bytes>:<path>. Path may contain colons (drive
    // letters) but the Node side greedily captures everything after the
    // 3rd colon to end-of-line.
    eprintln!("PROGRESS:{}:{}:{}", files, bytes, path);
}

// --- Recursive walker ---

struct DirEntry {
    name: String,
    is_dir: bool,
    size: u64,
}

fn walk_dir(dir_path: &str, progress: &Arc<Progress>) -> JsonNode {
    // Update the "current path" as cheaply as possible. try_lock means
    // workers never wait on each other — at worst, the reporter sees a
    // slightly stale value.
    if let Ok(mut p) = progress.current_path.try_lock() {
        *p = dir_path.to_string();
    }

    let name = path_basename(dir_path);

    // Build "\\?\<path>\*" search pattern. The \\?\ prefix lets us go past
    // the 260-char MAX_PATH limit (matters for deep node_modules trees).
    let pattern = if dir_path.len() >= 2 && &dir_path[1..2] == ":" {
        format!(r"\\?\{}\*", dir_path)
    } else {
        format!(r"{}\*", dir_path)
    };
    let pattern_w: Vec<u16> = OsStr::new(&pattern)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut find_data: Win32FindDataW = unsafe { std::mem::zeroed() };
    let handle = unsafe { FindFirstFileW(pattern_w.as_ptr(), &mut find_data) };

    if handle == INVALID_HANDLE_VALUE {
        let err = unsafe { GetLastError() };
        return JsonNode {
            name,
            path: dir_path.to_string(),
            size: 0,
            node_type: "dir",
            children: Vec::new(),
            ext: None,
            error: Some(format!("E{}", err)),
        };
    }

    // Phase 1: collect entries from this directory.
    let mut entries: Vec<DirEntry> = Vec::new();
    loop {
        let entry_name = utf16_to_string(&find_data.file_name);
        if entry_name != "." && entry_name != ".." {
            let attrs = find_data.file_attributes;
            let is_reparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
            if !is_reparse {
                let is_dir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
                let size = if is_dir {
                    0
                } else {
                    ((find_data.file_size_high as u64) << 32) | (find_data.file_size_low as u64)
                };
                entries.push(DirEntry { name: entry_name, is_dir, size });
            }
        }
        let ok = unsafe { FindNextFileW(handle, &mut find_data) };
        if ok == 0 {
            let _err = unsafe { GetLastError() };
            let _ = ERROR_NO_MORE_FILES;
            break;
        }
    }
    unsafe { FindClose(handle); }

    // Phase 2: account for files (atomic increment), then recurse subdirs in parallel.
    let mut file_count_here: u64 = 0;
    let mut byte_count_here: u64 = 0;
    for e in &entries {
        if !e.is_dir {
            file_count_here += 1;
            byte_count_here += e.size;
        }
    }
    progress.files.fetch_add(file_count_here, Ordering::Relaxed);
    progress.bytes.fetch_add(byte_count_here, Ordering::Relaxed);

    let subdir_paths: Vec<(String, String)> = entries
        .iter()
        .filter(|e| e.is_dir)
        .map(|e| (e.name.clone(), format!("{}\\{}", dir_path, e.name)))
        .collect();

    let subdir_nodes: Vec<JsonNode> = subdir_paths
        .par_iter()
        .map(|(_, path)| walk_dir(path, progress))
        .collect();

    // Phase 3: assemble children. Files first (cheap), then subdir nodes.
    //
    // Optimization: aggregate files under 1 MiB into a single synthetic
    // "(N small files)" node per directory. A typical Windows C: drive has
    // 95%+ of its files under that threshold (icons, configs, fonts, build
    // artifacts, WinSxS clutter), so this drops the output JSON from ~750 MB
    // to ~30 MB on a 2M-file scan and lets the Electron side parse it in
    // a couple of seconds instead of minutes.
    //
    // Directory totals are unaffected — every file's size still contributes.
    const SMALL_FILE_THRESHOLD: u64 = 1024 * 1024; // 1 MiB

    let mut children: Vec<JsonNode> = Vec::with_capacity(entries.len());
    let mut total_size: u64 = 0;
    let mut small_count: u64 = 0;
    let mut small_total: u64 = 0;

    for e in entries.into_iter().filter(|e| !e.is_dir) {
        total_size += e.size;
        if e.size < SMALL_FILE_THRESHOLD {
            small_count += 1;
            small_total += e.size;
            continue;
        }
        let ext = get_extension(&e.name);
        let path = format!("{}\\{}", dir_path, e.name);
        children.push(JsonNode {
            name: e.name,
            path,
            size: e.size,
            node_type: "file",
            children: Vec::new(),
            ext,
            error: None,
        });
    }

    if small_count > 0 {
        let bucket_name = if small_count == 1 {
            "(1 small file)".to_string()
        } else {
            format!("({} small files)", small_count)
        };
        // Synthetic path — doesn't correspond to a real filesystem entry.
        // Right-clicking it for "Open in Explorer" will silently no-op,
        // which is the right behavior since it represents many files.
        children.push(JsonNode {
            name: bucket_name,
            path: format!("{}\\__small_files_bucket__", dir_path),
            size: small_total,
            node_type: "file",
            children: Vec::new(),
            ext: None,
            error: None,
        });
    }

    for sub in subdir_nodes {
        total_size += sub.size;
        children.push(sub);
    }

    JsonNode {
        name,
        path: dir_path.to_string(),
        size: total_size,
        node_type: "dir",
        children,
        ext: None,
        error: None,
    }
}

// --- Helpers ---

fn utf16_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn path_basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('\\');
    if let Some(idx) = trimmed.rfind('\\') {
        trimmed[idx + 1..].to_string()
    } else {
        trimmed.to_string()
    }
}

fn get_extension(name: &str) -> Option<String> {
    let dot = name.rfind('.')?;
    if dot == 0 || dot == name.len() - 1 {
        return None;
    }
    Some(name[dot + 1..].to_lowercase())
}
