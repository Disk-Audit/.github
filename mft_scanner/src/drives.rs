// Drive enumeration + media-type detection via Win32. No external deps.

use anyhow::{anyhow, Result};
use serde::Serialize;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;

const DRIVE_REMOVABLE: u32 = 2;
const DRIVE_FIXED: u32 = 3;
const SEM_FAILCRITICALERRORS: u32 = 0x0001;

// CreateFile constants
const FILE_SHARE_READ: u32 = 1;
const FILE_SHARE_WRITE: u32 = 2;
const OPEN_EXISTING: u32 = 3;
const INVALID_HANDLE_VALUE: isize = -1;

// IOCTL for storage device properties
const IOCTL_STORAGE_QUERY_PROPERTY: u32 = 0x002D1400;
const STORAGE_DEVICE_SEEK_PENALTY_PROPERTY: u32 = 7;
const PROPERTY_STANDARD_QUERY: u32 = 0;

#[repr(C)]
struct StoragePropertyQuery {
    property_id: u32,
    query_type: u32,
    additional_parameters: [u8; 1],
}

#[repr(C)]
struct DeviceSeekPenaltyDescriptor {
    _version: u32,
    _size: u32,
    incurs_seek_penalty: u8, // 0 = SSD-class, non-zero = HDD-class
}

#[link(name = "kernel32")]
extern "system" {
    fn GetLogicalDriveStringsW(buffer_length: u32, buffer: *mut u16) -> u32;
    fn GetDriveTypeW(root_path: *const u16) -> u32;
    fn GetVolumeInformationW(
        root_path: *const u16,
        volume_name_buffer: *mut u16,
        volume_name_size: u32,
        volume_serial_number: *mut u32,
        max_component_length: *mut u32,
        file_system_flags: *mut u32,
        file_system_name_buffer: *mut u16,
        file_system_name_size: u32,
    ) -> i32;
    fn GetDiskFreeSpaceExW(
        directory_name: *const u16,
        free_bytes_available_to_caller: *mut u64,
        total_number_of_bytes: *mut u64,
        total_number_of_free_bytes: *mut u64,
    ) -> i32;
    fn SetErrorMode(mode: u32) -> u32;

    fn CreateFileW(
        file_name: *const u16,
        desired_access: u32,
        share_mode: u32,
        security_attributes: *mut u8,
        creation_disposition: u32,
        flags_and_attributes: u32,
        template_file: isize,
    ) -> isize;
    fn DeviceIoControl(
        device: isize,
        io_control_code: u32,
        in_buffer: *const u8,
        in_buffer_size: u32,
        out_buffer: *mut u8,
        out_buffer_size: u32,
        bytes_returned: *mut u32,
        overlapped: *mut u8,
    ) -> i32;
    fn CloseHandle(object: isize) -> i32;
}

#[derive(Serialize)]
pub struct DriveInfo {
    pub letter: String,
    pub label: String,
    #[serde(rename = "totalBytes")]
    pub total_bytes: u64,
    #[serde(rename = "freeBytes")]
    pub free_bytes: u64,
    #[serde(rename = "fileSystem")]
    pub file_system: String,
    #[serde(rename = "driveType")]
    pub drive_type: &'static str,
    #[serde(rename = "mediaType")]
    pub media_type: &'static str,
}

pub fn list_drives() -> Result<()> {
    unsafe { SetErrorMode(SEM_FAILCRITICALERRORS); }

    let mut buf = [0u16; 256];
    let len = unsafe { GetLogicalDriveStringsW(buf.len() as u32, buf.as_mut_ptr()) };
    if len == 0 {
        return Err(anyhow!("GetLogicalDriveStringsW failed"));
    }

    let strings = &buf[..len as usize];
    let mut drives: Vec<DriveInfo> = Vec::new();
    let mut start = 0;
    for i in 0..strings.len() {
        if strings[i] == 0 {
            if i > start {
                let root_w: Vec<u16> = strings[start..=i].to_vec();
                if let Some(info) = query_drive(&root_w) {
                    drives.push(info);
                }
            }
            start = i + 1;
        }
    }

    println!("{}", serde_json::to_string(&drives)?);
    Ok(())
}

fn utf16_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(0);
    String::from_utf16_lossy(&buf[..end])
}

fn query_drive(root_w: &[u16]) -> Option<DriveInfo> {
    let drive_type_code = unsafe { GetDriveTypeW(root_w.as_ptr()) };
    let drive_type = match drive_type_code {
        DRIVE_FIXED => "fixed",
        DRIVE_REMOVABLE => "removable",
        _ => return None,
    };

    let root_str = utf16_to_string(root_w);
    let letter = root_str.trim_end_matches('\\').to_string();

    let mut label_buf = [0u16; 128];
    let mut fs_buf = [0u16; 32];
    let info_ok = unsafe {
        GetVolumeInformationW(
            root_w.as_ptr(),
            label_buf.as_mut_ptr(),
            label_buf.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            fs_buf.as_mut_ptr(),
            fs_buf.len() as u32,
        )
    };
    let (label, file_system) = if info_ok != 0 {
        (utf16_to_string(&label_buf), utf16_to_string(&fs_buf))
    } else {
        (String::new(), String::new())
    };

    let mut total_bytes: u64 = 0;
    let mut free_bytes: u64 = 0;
    unsafe {
        GetDiskFreeSpaceExW(
            root_w.as_ptr(),
            std::ptr::null_mut(),
            &mut total_bytes,
            &mut free_bytes,
        );
    }

    // Media type detection only makes sense for fixed drives. USB sticks
    // would technically work but the "SSD vs HDD" distinction isn't useful
    // for removable storage.
    let media_type = if drive_type == "fixed" {
        detect_media_type(&letter)
    } else {
        "unknown"
    };

    Some(DriveInfo {
        letter,
        label,
        total_bytes,
        free_bytes,
        file_system,
        drive_type,
        media_type,
    })
}

/// Returns "ssd", "hdd", or "unknown" for the given drive letter ("C:").
///
/// Uses IOCTL_STORAGE_QUERY_PROPERTY with StorageDeviceSeekPenaltyProperty.
/// A drive with no seek penalty is SSD-class (NVMe, SATA SSD, eMMC). One
/// with a seek penalty is a spinning HDD.
///
/// Opens the volume with 0 access — that's allowed without admin and lets
/// us query metadata without requesting read/write privileges.
fn detect_media_type(letter: &str) -> &'static str {
    // letter is like "C:" — turn it into "\\.\C:"
    let device_path = format!(r"\\.\{}", letter);
    let device_w: Vec<u16> = OsStr::new(&device_path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe {
        CreateFileW(
            device_w.as_ptr(),
            0, // no access — metadata only
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            0,
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return "unknown";
    }

    let query = StoragePropertyQuery {
        property_id: STORAGE_DEVICE_SEEK_PENALTY_PROPERTY,
        query_type: PROPERTY_STANDARD_QUERY,
        additional_parameters: [0],
    };
    let mut descriptor = DeviceSeekPenaltyDescriptor {
        _version: 0,
        _size: 0,
        incurs_seek_penalty: 0,
    };
    let mut bytes_returned: u32 = 0;

    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            &query as *const _ as *const u8,
            std::mem::size_of::<StoragePropertyQuery>() as u32,
            &mut descriptor as *mut _ as *mut u8,
            std::mem::size_of::<DeviceSeekPenaltyDescriptor>() as u32,
            &mut bytes_returned,
            std::ptr::null_mut(),
        )
    };

    let result = if ok != 0 {
        if descriptor.incurs_seek_penalty == 0 {
            "ssd"
        } else {
            "hdd"
        }
    } else {
        "unknown"
    };

    unsafe {
        CloseHandle(handle);
    }
    result
}
