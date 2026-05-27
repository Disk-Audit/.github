// Disk Analyzer helper binary.
//
// Subcommands:
//   `mft_scanner --list-drives`         — enumerate logical drives (no admin)
//   `mft_scanner --walk <path>`         — recursive FindFirstFile walker
//   `mft_scanner --mft-scan <letter>`   — fast MFT-based scan (admin required,
//                                         local NTFS only)

mod drives;
mod mft_scan;
mod walker;

use std::env;
use std::process::ExitCode;

// Replace the system allocator. Directory walking is dominated by short-lived
// String allocations (one per filesystem entry); mimalloc handles this pattern
// substantially better than the default Windows heap.
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: mft_scanner --list-drives");
        eprintln!("       mft_scanner --walk <path>");
        eprintln!("       mft_scanner --mft-scan <letter>");
        return ExitCode::from(1);
    }

    match args[1].as_str() {
        "--list-drives" => match drives::list_drives() {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("ERROR: {:#}", e);
                ExitCode::from(2)
            }
        },
        "--walk" => {
            if args.len() < 3 {
                eprintln!("usage: mft_scanner --walk <path>");
                return ExitCode::from(1);
            }
            match walker::walk(&args[2]) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("ERROR: {:#}", e);
                    ExitCode::from(2)
                }
            }
        }
        "--mft-scan" => {
            if args.len() < 3 {
                eprintln!("usage: mft_scanner --mft-scan <letter>");
                return ExitCode::from(1);
            }
            match mft_scan::mft_scan(&args[2]) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    // Exit code 3 is "MFT scan failed, caller should fall
                    // through to walker." We surface the error on stderr
                    // so it shows up in the dev console for debugging,
                    // but the Node side treats any non-zero exit the same
                    // way and falls through silently.
                    eprintln!("MFT-ERROR: {:#}", e);
                    ExitCode::from(3)
                }
            }
        }
        other => {
            eprintln!("unknown subcommand: {}", other);
            ExitCode::from(1)
        }
    }
}
