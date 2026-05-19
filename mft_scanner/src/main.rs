// Disk Analyzer — fast NTFS scanner via MFT
//
// Algorithm:
//   1. Open the raw NTFS volume (e.g. \\.\C:) — requires admin
//   2. Parse the NTFS boot sector to locate the Master File Table
//   3. Iterate every MFT record (each is ~1 KB)
//        - skip records that don't have a usable filename
//        - extract: filename, parent reference, data size, is_directory
//   4. Build a parent → children map in memory
//   5. Recursively walk from root (record 5) and emit JSON to stdout
//
// Progress is written to stderr as `PROGRESS:done:total` lines, which the
// Node side polls from a temp file.

use anyhow::{anyhow, Context, Result};
use ntfs::structured_values::{NtfsFileName, NtfsFileNamespace};
use ntfs::{Ntfs, NtfsAttributeType};
use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::fs::OpenOptions;
use std::io::{BufReader, Write};
use std::os::windows::fs::OpenOptionsExt;
use std::process::ExitCode;
use std::time::Instant;

const FILE_SHARE_READ: u32 = 1;
const FILE_SHARE_WRITE: u32 = 2;
const ROOT_DIRECTORY_RECORD: u64 = 5;

struct Entry {
    name: String,
    parent: u64,
    size: u64,
    is_dir: bool,
}

#[derive(Serialize)]
struct JsonNode {
    name: String,
    path: String,
    size: u64,
    #[serde(rename = "type")]
    node_type: &'static str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    children: Vec<JsonNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ext: Option<String>,
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: mft_scanner <drive_letter>");
        eprintln!("  e.g. mft_scanner C");
        return ExitCode::from(1);
    }

    // Accept "C", "C:", "C:\\", etc.
    let drive = args[1]
        .trim_end_matches('\\')
        .trim_end_matches(':')
        .to_uppercase();

    if drive.len() != 1 {
        eprintln!("ERROR: drive argument must be a single letter, got '{}'", drive);
        return ExitCode::from(1);
    }

    match run(&drive) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("ERROR: {:#}", e);
            ExitCode::from(2)
        }
    }
}

fn run(drive: &str) -> Result<()> {
    let volume_path = format!(r"\\.\{}:", drive);
    eprintln!("Opening {}...", volume_path);

    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(&volume_path)
        .with_context(|| {
            format!(
                "Failed to open {} (administrator privileges required, and volume must be NTFS)",
                volume_path
            )
        })?;

    // 1 MB buffer cushions the BufReader so sequential MFT record reads
    // mostly hit cache rather than triggering disk seeks.
    let mut fs = BufReader::with_capacity(1024 * 1024, file);

    let ntfs = Ntfs::new(&mut fs).context("Failed to parse NTFS structure")?;
    eprintln!("NTFS volume opened.");

    // Look up $MFT (record 0) so we can determine the total record count
    let mft_file = ntfs.file(&mut fs, 0).context("Failed to read $MFT")?;

    let mut mft_data_value_len: Option<u64> = None;
    {
        let mut mft_attrs = mft_file.attributes();
        while let Some(item) = mft_attrs.next(&mut fs) {
            let item = match item {
                Ok(i) => i,
                Err(_) => continue,
            };
            let attr = match item.to_attribute() {
                Ok(a) => a,
                Err(_) => continue,
            };
            if matches!(attr.ty(), Ok(NtfsAttributeType::Data)) {
                if let Ok(val) = attr.value(&mut fs) {
                    mft_data_value_len = Some(val.len());
                    break;
                }
            }
        }
    }
    let mft_byte_size =
        mft_data_value_len.ok_or_else(|| anyhow!("$MFT missing $DATA attribute"))?;

    let record_size = ntfs.file_record_size() as u64;
    let total_records = mft_byte_size / record_size;
    eprintln!(
        "MFT: {} records ({} MB)",
        total_records,
        mft_byte_size / (1024 * 1024)
    );

    // Walk every MFT record
    let mut entries: HashMap<u64, Entry> = HashMap::with_capacity(total_records as usize);
    let mut last_report = Instant::now();

    for record_num in 0..total_records {
        if last_report.elapsed().as_millis() > 200 {
            eprintln!("PROGRESS:{}:{}", record_num, total_records);
            last_report = Instant::now();
        }

        let file = match ntfs.file(&mut fs, record_num) {
            Ok(f) => f,
            Err(_) => continue,
        };

        let is_dir = file.is_directory();

        let mut best_name: Option<String> = None;
        let mut best_parent: u64 = 0;
        let mut best_priority: u8 = 255;
        let mut data_size: u64 = 0;

        let mut attrs = file.attributes();
        while let Some(item_result) = attrs.next(&mut fs) {
            let item = match item_result {
                Ok(i) => i,
                Err(_) => continue,
            };
            let attr = match item.to_attribute() {
                Ok(a) => a,
                Err(_) => continue,
            };
            let attr_type = match attr.ty() {
                Ok(t) => t,
                Err(_) => continue,
            };

            match attr_type {
                NtfsAttributeType::FileName => {
                    if let Ok(fname) = attr.structured_value::<_, NtfsFileName>(&mut fs) {
                        // Preference order: Win32AndDos > Win32 > POSIX > DOS
                        let priority: u8 = match fname.namespace() {
                            NtfsFileNamespace::Win32AndDos => 0,
                            NtfsFileNamespace::Win32 => 1,
                            NtfsFileNamespace::Posix => 2,
                            NtfsFileNamespace::Dos => 3,
                        };
                        if priority < best_priority {
                            best_name = Some(fname.name().to_string_lossy());
                            best_parent =
                                fname.parent_directory_reference().file_record_number();
                            best_priority = priority;
                        }
                    }
                }
                NtfsAttributeType::Data => {
                    if let Ok(val) = attr.value(&mut fs) {
                        let sz = val.len();
                        if sz > data_size {
                            data_size = sz;
                        }
                    }
                }
                _ => {}
            }
        }

        if let Some(name) = best_name {
            entries.insert(
                record_num,
                Entry {
                    name,
                    parent: best_parent,
                    size: if is_dir { 0 } else { data_size },
                    is_dir,
                },
            );
        }
    }

    eprintln!("PROGRESS:{}:{}", total_records, total_records);
    eprintln!("Collected {} entries. Building tree...", entries.len());

    // Build parent -> children index
    let mut children_index: HashMap<u64, Vec<u64>> = HashMap::new();
    for (&record, entry) in &entries {
        if record == entry.parent {
            continue; // self-reference, skip
        }
        children_index.entry(entry.parent).or_default().push(record);
    }

    // Recursively walk from root (record 5) to build the tree
    let drive_label = format!("{}:", drive);
    let mut visited: HashMap<u64, ()> = HashMap::new();
    let root_node = build_node(
        ROOT_DIRECTORY_RECORD,
        &drive_label,
        &drive_label,
        true,
        0,
        &entries,
        &children_index,
        &mut visited,
    );

    eprintln!("Writing JSON output...");
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    serde_json::to_writer(&mut out, &root_node)?;
    out.write_all(b"\n")?;
    eprintln!("Done. Total tree size: {} bytes", root_node.size);

    Ok(())
}

fn build_node(
    record: u64,
    name: &str,
    path: &str,
    is_dir: bool,
    own_size: u64,
    entries: &HashMap<u64, Entry>,
    children_index: &HashMap<u64, Vec<u64>>,
    visited: &mut HashMap<u64, ()>,
) -> JsonNode {
    if visited.insert(record, ()).is_some() {
        // Cycle protection — if we've already processed this record, return a leaf
        return JsonNode {
            name: name.to_string(),
            path: path.to_string(),
            size: own_size,
            node_type: if is_dir { "dir" } else { "file" },
            children: Vec::new(),
            ext: file_extension(name, is_dir),
        };
    }

    let mut total_size = own_size;
    let mut children: Vec<JsonNode> = Vec::new();

    if is_dir {
        if let Some(child_records) = children_index.get(&record) {
            for &child_rec in child_records {
                if let Some(child_entry) = entries.get(&child_rec) {
                    let child_path = format!("{}\\{}", path, child_entry.name);
                    let child_node = build_node(
                        child_rec,
                        &child_entry.name,
                        &child_path,
                        child_entry.is_dir,
                        child_entry.size,
                        entries,
                        children_index,
                        visited,
                    );
                    total_size += child_node.size;
                    children.push(child_node);
                }
            }
        }
    }

    JsonNode {
        name: name.to_string(),
        path: path.to_string(),
        size: total_size,
        node_type: if is_dir { "dir" } else { "file" },
        children,
        ext: file_extension(name, is_dir),
    }
}

fn file_extension(name: &str, is_dir: bool) -> Option<String> {
    if is_dir {
        return None;
    }
    let dot = name.rfind('.')?;
    if dot == 0 || dot == name.len() - 1 {
        return None;
    }
    Some(name[dot + 1..].to_lowercase())
}
