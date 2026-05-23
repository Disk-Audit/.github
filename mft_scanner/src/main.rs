// Disk Analyzer helper binary.
//
// Two subcommands:
//   `mft_scanner --list-drives`  — enumerate logical drives (no admin)
//   `mft_scanner --walk <path>`  — fast parallel walk of a directory tree

mod drives;
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
        other => {
            eprintln!("unknown subcommand: {}", other);
            ExitCode::from(1)
        }
    }
}
