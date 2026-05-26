// MFT-based fast scanner for local NTFS volumes.
//
// Pipeline:
//   1. Open the raw volume (`\\.\C:`) via ntfs-reader. Requires admin.
//   2. Iterate every MFT entry, collecting (path, name, size, is_dir) tuples
//      with the cached path lookup so the parent-chain walk is O(1) amortized.
//      ntfs-reader reports ~4s for a full C: drive with the Vec cache.
//   3. Build a JsonNode tree from the flat list using a parent->children
//      hashmap. Same output format as the FindFirstFile walker so the Node
//      side is oblivious to which scanner produced the tree.
//   4. Apply the same small-files bucket optimization as the walker
//      (under 1 MiB files aggregated per directory) so the JSON output
//      stays manageable.
//
// Anything that fails — non-NTFS volume, non-elevated process, ntfs-reader
// internal error — surfaces as `Err(_)`. The Node dispatcher treats any
// non-zero exit as "fall through to the walker," so users always see a
// successful scan even when MFT is unavailable.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::walker::{emit_progress, get_extension, JsonNode, Progress};

use ntfs_reader::{file_info::FileInfo, mft::Mft, volume::Volume};

const SMALL_FILE_THRESHOLD: u64 = 1024 * 1024; // 1 MiB — matches walker.rs

/// Run an MFT scan on the given drive letter (e.g. "C" or "C:"). Output goes
/// to stdout as the same JSON tree the walker produces.
pub fn mft_scan(volume_letter: &str) -> Result<()> {
    let letter = volume_letter
        .trim()
        .trim_end_matches('\\')
        .trim_end_matches(':')
        .to_string();

    if letter.is_empty() || letter.len() != 1 {
        anyhow::bail!(
            "expected single drive letter (e.g. C), got: {}",
            volume_letter
        );
    }

    let letter_upper = letter.to_uppercase();
    let drive_root = format!("{}:\\", letter_upper);
    let volume_path = format!("\\\\.\\{}:", letter_upper);

    let progress = Arc::new(Progress {
        files: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        current_path: Mutex::new(format!("Reading MFT on {}", drive_root)),
    });
    let done = Arc::new(AtomicBool::new(false));

    let prog_for_reporter = progress.clone();
    let done_for_reporter = done.clone();
    let progress_thread = thread::spawn(move || {
        while !done_for_reporter.load(Ordering::Relaxed) {
            emit_progress(&prog_for_reporter);
            thread::sleep(Duration::from_millis(200));
        }
        emit_progress(&prog_for_reporter);
    });

    let result = scan_inner(&volume_path, &drive_root, &progress);

    done.store(true, Ordering::Relaxed);
    progress_thread.join().ok();

    let tree = result?;
    println!("{}", serde_json::to_string(&tree)?);
    Ok(())
}

/// Flat representation of one MFT entry — we collect these during MFT
/// iteration and then assemble the tree in a second pass.
struct FlatEntry {
    full_path: String,
    name: String,
    parent_path: String,
    size: u64,
    is_dir: bool,
}

fn scan_inner(
    volume_path: &str,
    drive_root: &str,
    progress: &Arc<Progress>,
) -> Result<JsonNode> {
    // Update progress text at each setup stage so the user knows the
    // 30-second MFT load isn't a hang. The progress emitter thread is
    // already running, so any update to current_path lands in the UI
    // within ~200ms.
    if let Ok(mut p) = progress.current_path.try_lock() {
        *p = format!("Opening volume {}", drive_root);
    }
    let volume = Volume::new(volume_path).with_context(|| {
        format!(
            "failed to open volume {} — needs admin and a local NTFS volume",
            volume_path
        )
    })?;

    if let Ok(mut p) = progress.current_path.try_lock() {
        *p = "Reading MFT".to_string();
    }
    let mft = Mft::new(volume).with_context(|| "failed to read MFT from volume")?;

    let entries: Mutex<Vec<FlatEntry>> = Mutex::new(Vec::with_capacity(1024 * 1024));
    let root_clean = drive_root.trim_end_matches('\\').to_string();

    mft.iterate_files(|file| {
        // ntfs-reader's FileInfo bundles name, full reconstructed path, size,
        // and is_directory in one shot. `new` is the cacheless version —
        // the 0.3 API for `with_cache` needs a separate FileInfoCache
        // instance passed as the third argument. The probe confirmed
        // cacheless is fast enough (~2.7µs/entry) and that `path` IS
        // populated, just with the `\\.\C:` device prefix attached.
        let info = FileInfo::new(&mft, file);

        if info.name.is_empty() {
            return;
        }

        // `info.path` comes back as a PathBuf like `\\.\C:\Users\danie\file`.
        // We want a user-facing `C:\Users\danie\file`. Strip the device
        // prefix (which equals our `volume_path` argument) and any
        // remaining leading separator, then prepend the friendly root.
        let path_string: String = info.path.to_string_lossy().into_owned();
        let rel = path_string
            .strip_prefix(volume_path)
            .unwrap_or(&path_string)
            .trim_start_matches('\\')
            .trim_start_matches('/');

        // If `rel` is empty after stripping, this entry IS the volume root
        // itself — skip it; we synthesize the root JsonNode in build_tree.
        if rel.is_empty() {
            return;
        }

        let full_path = format!("{}\\{}", root_clean, rel);

        let parent_path = match full_path.rsplit_once('\\') {
            Some((parent, _)) => parent.to_string(),
            None => String::new(),
        };

        if !info.is_directory {
            progress.bytes.fetch_add(info.size, Ordering::Relaxed);
        }
        let n = progress.files.fetch_add(1, Ordering::Relaxed);

        if n % 10_000 == 0 {
            if let Ok(mut p) = progress.current_path.try_lock() {
                *p = full_path.clone();
            }
        }

        entries.lock().unwrap().push(FlatEntry {
            full_path,
            name: info.name,
            parent_path,
            size: info.size,
            is_dir: info.is_directory,
        });
    });

    let entries = entries.into_inner().unwrap_or_default();

    // Diagnostic: dump the first few entries so we can see what
    // ntfs-reader actually returns for name/path/is_directory. Logged to
    // stderr where the Node side captures it for the dev console; doesn't
    // affect the JSON output stream on stdout.
    eprintln!("MFT-DEBUG: total entries collected = {}", entries.len());
    for (i, e) in entries.iter().take(8).enumerate() {
        eprintln!(
            "MFT-DEBUG: sample[{}] name={:?} full_path={:?} parent={:?} is_dir={} size={}",
            i, e.name, e.full_path, e.parent_path, e.is_dir, e.size
        );
    }

    if let Ok(mut p) = progress.current_path.try_lock() {
        *p = format!("Building tree from {} entries", entries.len());
    }

    let tree = build_tree(entries, &root_clean);

    // Safety check: if the MFT scan completes but the resulting root has
    // no children, something's gone wrong with the path reconstruction —
    // typical cause: ntfs-reader's cacheless FileInfo doesn't populate the
    // path field, so every entry computes the same empty parent and
    // nothing gets indexed under the root. Bail with an error so the Node
    // dispatcher falls through to the walker. The user gets a working
    // scan even when MFT is broken.
    if tree.children.is_empty() {
        anyhow::bail!(
            "MFT scan produced an empty tree (likely cacheless path issue); falling back to walker"
        );
    }

    Ok(tree)
}

fn build_tree(entries: Vec<FlatEntry>, root_clean: &str) -> JsonNode {
    // Index: parent_path -> indices into entries[]
    let mut children_by_parent: HashMap<String, Vec<usize>> = HashMap::new();

    for (i, e) in entries.iter().enumerate() {
        children_by_parent
            .entry(e.parent_path.clone())
            .or_default()
            .push(i);
    }

    // Root entry — the volume root itself isn't usually in entries[] as a
    // discrete record we can grab, but its name (e.g. ".") may collide with
    // a non-root entry. We synthesize the root node from the children list
    // indexed under the bare drive letter ("C:").
    build_dir_node(
        &format!("{}\\", root_clean),
        &root_clean.to_string(),
        root_clean,
        &entries,
        &children_by_parent,
    )
}

fn build_dir_node(
    full_path: &str,
    name: &str,
    parent_key: &str,
    entries: &[FlatEntry],
    children_by_parent: &HashMap<String, Vec<usize>>,
) -> JsonNode {
    let mut total_size: u64 = 0;
    let mut children: Vec<JsonNode> = Vec::new();
    let mut subdir_nodes: Vec<JsonNode> = Vec::new();
    // Indices into entries[] for small files we may bucket or expand below.
    let mut small_indices: Vec<usize> = Vec::new();

    // Same threshold as walker.rs — only collapse small files when there
    // are enough of them to justify hiding the names.
    const BUCKET_MIN_COUNT: usize = 20;

    if let Some(child_indices) = children_by_parent.get(parent_key) {
        for &i in child_indices {
            let c = &entries[i];
            if c.is_dir {
                let sub = build_dir_node(
                    &c.full_path,
                    &c.name,
                    &c.full_path,
                    entries,
                    children_by_parent,
                );
                total_size += sub.size;
                subdir_nodes.push(sub);
            } else {
                total_size += c.size;
                if c.size < SMALL_FILE_THRESHOLD {
                    small_indices.push(i);
                    continue;
                }
                children.push(JsonNode {
                    name: c.name.clone(),
                    path: c.full_path.clone(),
                    size: c.size,
                    node_type: "file",
                    children: Vec::new(),
                    ext: get_extension(&c.name),
                    error: None,
                });
            }
        }
    }

    if small_indices.len() >= BUCKET_MIN_COUNT {
        // Aggregate into one bucket node.
        let small_count = small_indices.len();
        let small_total: u64 = small_indices.iter().map(|&i| entries[i].size).sum();
        children.push(JsonNode {
            name: format!("({} small files)", small_count),
            path: format!("{}\\__small_files_bucket__", full_path.trim_end_matches('\\')),
            size: small_total,
            node_type: "file",
            children: Vec::new(),
            ext: None,
            error: None,
        });
    } else {
        // Few small files — show each individually.
        for &i in &small_indices {
            let c = &entries[i];
            children.push(JsonNode {
                name: c.name.clone(),
                path: c.full_path.clone(),
                size: c.size,
                node_type: "file",
                children: Vec::new(),
                ext: get_extension(&c.name),
                error: None,
            });
        }
    }

    children.extend(subdir_nodes);

    JsonNode {
        name: name.to_string(),
        path: full_path.to_string(),
        size: total_size,
        node_type: "dir",
        children,
        ext: None,
        error: None,
    }
}
