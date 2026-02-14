use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest as ShaDigest, Sha256};
use uuid::Uuid;

use crate::db::Database;
use crate::errors::{LauncherError, Result};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfHealScanRequestV2 {
    pub install_path: String,
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub use_usn_delta: Option<bool>,
    #[serde(default)]
    pub max_workers: Option<usize>,
    #[serde(default)]
    pub manifest_json: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfHealFileEntryV2 {
    pub path: String,
    pub expected_size: u64,
    pub actual_size: u64,
    pub expected_sha256: Option<String>,
    pub actual_sha256: Option<String>,
    pub fast_hash_blake3: Option<String>,
    pub status: String,
    pub reason: String,
    pub modified_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfHealSummaryV2 {
    pub total_files: usize,
    pub verified_files: usize,
    pub missing_files: usize,
    pub corrupt_files: usize,
    pub error_files: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfHealReportV2 {
    pub report_id: String,
    pub game_id: String,
    pub slug: Option<String>,
    pub version: String,
    pub install_path: String,
    pub engine: String,
    pub usn_delta_used: bool,
    pub shadow_verification_queued: bool,
    pub worker_count: usize,
    pub summary: SelfHealSummaryV2,
    pub files: Vec<SelfHealFileEntryV2>,
    pub hot_fix_queue: Vec<String>,
    pub scanned_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfHealRepairQueueItemV2 {
    pub path: String,
    pub reason: String,
    pub strategy: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfHealRepairPlanV2 {
    pub repair_id: String,
    pub report_id: String,
    pub queue_count: usize,
    pub queue: Vec<SelfHealRepairQueueItemV2>,
    pub strategy: String,
    pub generated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
struct ManifestV2 {
    #[serde(default)]
    game_id: Option<String>,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    files: Vec<ManifestFileV2>,
}

#[derive(Clone, Debug, Deserialize)]
struct ManifestFileV2 {
    path: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    hash: String,
}

#[derive(Clone, Debug)]
struct FileIndexSnapshot {
    size_bytes: u64,
    modified_at: i64,
    fast_hash: Option<String>,
    canonical_hash: Option<String>,
    status: String,
}

#[derive(Clone)]
pub struct SelfHealService {
    db: Database,
}

impl SelfHealService {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub async fn run_scan(&self, request: SelfHealScanRequestV2) -> Result<SelfHealReportV2> {
        let service = self.clone();
        tokio::task::spawn_blocking(move || service.run_scan_blocking(request))
            .await
            .map_err(|err| LauncherError::Config(format!("self-heal scan join error: {err}")))?
    }

    pub async fn build_repair_plan(&self, report: SelfHealReportV2) -> Result<SelfHealRepairPlanV2> {
        let queue: Vec<SelfHealRepairQueueItemV2> = report
            .files
            .iter()
            .filter(|item| item.status != "ok")
            .map(|item| SelfHealRepairQueueItemV2 {
                path: item.path.clone(),
                reason: item.reason.clone(),
                strategy: "chunk_refetch".to_string(),
            })
            .collect();

        let strategy = if queue.is_empty() {
            "no_op".to_string()
        } else {
            "targeted_hot_fix".to_string()
        };

        let plan = SelfHealRepairPlanV2 {
            repair_id: Uuid::new_v4().to_string(),
            report_id: report.report_id.clone(),
            queue_count: queue.len(),
            queue,
            strategy,
            generated_at: chrono::Utc::now().timestamp(),
        };
        self.persist_integrity_event(&report, plan.queue_count as i64)?;
        Ok(plan)
    }

    fn run_scan_blocking(&self, request: SelfHealScanRequestV2) -> Result<SelfHealReportV2> {
        let install_path = PathBuf::from(request.install_path.trim());
        if !install_path.exists() {
            return Err(LauncherError::NotFound(format!(
                "install path not found: {}",
                install_path.display()
            )));
        }

        let manifest = self.resolve_manifest(&install_path, &request)?;
        let game_id = request
            .game_id
            .clone()
            .or(manifest.game_id.clone())
            .unwrap_or_else(|| "unknown".to_string());
        let version = request
            .version
            .clone()
            .or(manifest.version.clone())
            .unwrap_or_else(|| "latest".to_string());
        let worker_count = Self::resolve_workers(request.max_workers);
        let use_usn = request.use_usn_delta.unwrap_or(true) && cfg!(target_os = "windows");
        let install_path_text = install_path.to_string_lossy().to_string();
        let file_index = self.load_file_index_map(&game_id, &install_path_text)?;

        let mut usn_delta_used = false;
        let mut scanned_files: Vec<SelfHealFileEntryV2> = Vec::new();
        if use_usn {
            match scan_with_usn_delta(
                &self.db,
                &install_path,
                &manifest.files,
                worker_count,
                &file_index,
            ) {
                Ok(Some(items)) => {
                    usn_delta_used = true;
                    scanned_files = items;
                }
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!("USN delta unavailable, fallback to full scan: {}", err);
                }
            }
        }
        if scanned_files.is_empty() {
            scanned_files = scan_entries_parallel(&install_path, manifest.files.clone(), worker_count)?;
        }
        scanned_files.sort_by(|a, b| a.path.cmp(&b.path));

        let summary = SelfHealSummaryV2 {
            total_files: scanned_files.len(),
            verified_files: scanned_files.iter().filter(|item| item.status == "ok").count(),
            missing_files: scanned_files
                .iter()
                .filter(|item| item.status == "missing")
                .count(),
            corrupt_files: scanned_files
                .iter()
                .filter(|item| item.status == "corrupt")
                .count(),
            error_files: scanned_files
                .iter()
                .filter(|item| item.status == "error")
                .count(),
        };
        let hot_fix_queue = scanned_files
            .iter()
            .filter(|item| item.status != "ok")
            .map(|item| item.path.clone())
            .collect::<Vec<_>>();

        let report = SelfHealReportV2 {
            report_id: Uuid::new_v4().to_string(),
            game_id,
            slug: request.slug.clone().or(manifest.slug.clone()),
            version,
            install_path: install_path.to_string_lossy().to_string(),
            engine: if usn_delta_used {
                "usn_delta".to_string()
            } else {
                "full_scan".to_string()
            },
            usn_delta_used,
            shadow_verification_queued: true,
            worker_count,
            summary,
            files: scanned_files,
            hot_fix_queue,
            scanned_at: chrono::Utc::now().timestamp(),
        };
        self.persist_file_index(&report)?;
        self.persist_integrity_event(&report, report.hot_fix_queue.len() as i64)?;
        Ok(report)
    }

    fn resolve_manifest(
        &self,
        install_path: &Path,
        request: &SelfHealScanRequestV2,
    ) -> Result<ManifestV2> {
        if let Some(raw_manifest) = &request.manifest_json {
            return Ok(serde_json::from_str(raw_manifest)?);
        }

        let manifest_path = install_path.join("manifest.json");
        let raw = std::fs::read_to_string(&manifest_path).map_err(|err| {
            LauncherError::Config(format!(
                "manifest not found or unreadable at {}: {}",
                manifest_path.display(),
                err
            ))
        })?;
        Ok(serde_json::from_str(&raw)?)
    }

    fn load_file_index_map(
        &self,
        game_id: &str,
        install_path: &str,
    ) -> Result<HashMap<String, FileIndexSnapshot>> {
        let conn = self.db.connection()?;
        let mut stmt = conn.prepare(
            "SELECT relative_path, size_bytes, modified_at, fast_hash, canonical_hash, status
             FROM file_index_v2
             WHERE game_id = ?1 AND install_path = ?2",
        )?;
        let rows = stmt.query_map(params![game_id, install_path], |row| {
            Ok((
                row.get::<_, String>(0)?,
                FileIndexSnapshot {
                    size_bytes: row.get::<_, i64>(1)?.max(0) as u64,
                    modified_at: row.get(2)?,
                    fast_hash: row.get(3)?,
                    canonical_hash: row.get(4)?,
                    status: row.get(5)?,
                },
            ))
        })?;

        let mut map = HashMap::new();
        for item in rows {
            let (path, snapshot) = item?;
            map.insert(path.replace('\\', "/"), snapshot);
        }
        Ok(map)
    }

    fn persist_file_index(&self, report: &SelfHealReportV2) -> Result<()> {
        let conn = self.db.connection()?;
        for item in &report.files {
            conn.execute(
                "INSERT OR REPLACE INTO file_index_v2
                    (game_id, install_path, relative_path, size_bytes, modified_at, fast_hash, canonical_hash, status, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    report.game_id,
                    report.install_path,
                    item.path,
                    item.actual_size as i64,
                    item.modified_at,
                    item.fast_hash_blake3,
                    item.actual_sha256,
                    item.status,
                    report.scanned_at,
                ],
            )?;
        }
        Ok(())
    }

    fn persist_integrity_event(&self, report: &SelfHealReportV2, queue_count: i64) -> Result<()> {
        let conn = self.db.connection()?;
        let report_json = serde_json::to_string(report)?;
        conn.execute(
            "INSERT INTO integrity_events_v2
                (id, game_id, install_path, scan_engine, total_files, verified_files,
                 missing_files, corrupt_files, repair_queue_count, report_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                Uuid::new_v4().to_string(),
                report.game_id,
                report.install_path,
                report.engine,
                report.summary.total_files as i64,
                report.summary.verified_files as i64,
                report.summary.missing_files as i64,
                report.summary.corrupt_files as i64,
                queue_count,
                report_json,
                chrono::Utc::now().timestamp(),
            ],
        )?;
        Ok(())
    }

    fn resolve_workers(value: Option<usize>) -> usize {
        let cores = std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(8);
        let recommended = usize::min(32, usize::max(8, 2 * cores));
        value.unwrap_or(recommended).clamp(1, 64)
    }
}

fn normalize_relative_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches('/').to_string()
}

fn scan_with_usn_delta(
    db: &Database,
    install_path: &Path,
    manifest_files: &[ManifestFileV2],
    worker_count: usize,
    index_map: &HashMap<String, FileIndexSnapshot>,
) -> Result<Option<Vec<SelfHealFileEntryV2>>> {
    let changed_paths =
        ntfs_usn::collect_changed_paths_since_checkpoint(db, install_path, manifest_files)?;
    let Some(changed_paths) = changed_paths else {
        return Ok(None);
    };

    let mut immediate: Vec<SelfHealFileEntryV2> = Vec::new();
    let mut to_hash: Vec<ManifestFileV2> = Vec::new();

    for entry in manifest_files {
        let relative = normalize_relative_path(&entry.path);
        if relative.is_empty() {
            continue;
        }

        if !changed_paths.contains(&relative) {
            if let Some(snapshot) = index_map.get(&relative) {
                if let Some(cached) = try_reuse_cached_entry(install_path, entry, &relative, snapshot) {
                    immediate.push(cached);
                    continue;
                }
            }
        }

        to_hash.push(entry.clone());
    }

    let mut hashed = scan_entries_parallel(install_path, to_hash, worker_count)?;
    immediate.append(&mut hashed);
    immediate.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Some(immediate))
}

fn try_reuse_cached_entry(
    install_path: &Path,
    entry: &ManifestFileV2,
    relative: &str,
    snapshot: &FileIndexSnapshot,
) -> Option<SelfHealFileEntryV2> {
    let file_path = install_path.join(relative);
    let expected_hash = if entry.hash.trim().is_empty() {
        None
    } else {
        Some(entry.hash.trim().to_ascii_lowercase())
    };

    if !file_path.exists() || !file_path.is_file() {
        return Some(SelfHealFileEntryV2 {
            path: relative.to_string(),
            expected_size: entry.size,
            actual_size: 0,
            expected_sha256: expected_hash,
            actual_sha256: None,
            fast_hash_blake3: None,
            status: "missing".to_string(),
            reason: "missing_file".to_string(),
            modified_at: 0,
        });
    }

    let metadata = match std::fs::metadata(&file_path) {
        Ok(value) => value,
        Err(_) => {
            return Some(SelfHealFileEntryV2 {
                path: relative.to_string(),
                expected_size: entry.size,
                actual_size: 0,
                expected_sha256: expected_hash,
                actual_sha256: None,
                fast_hash_blake3: None,
                status: "error".to_string(),
                reason: "metadata_failed".to_string(),
                modified_at: 0,
            });
        }
    };

    let actual_size = metadata.len();
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0);

    if entry.size > 0 && actual_size != entry.size {
        return Some(SelfHealFileEntryV2 {
            path: relative.to_string(),
            expected_size: entry.size,
            actual_size,
            expected_sha256: expected_hash,
            actual_sha256: None,
            fast_hash_blake3: None,
            status: "corrupt".to_string(),
            reason: "size_mismatch".to_string(),
            modified_at,
        });
    }

    if snapshot.status != "ok" {
        return None;
    }
    if snapshot.modified_at <= 0 || snapshot.modified_at != modified_at {
        return None;
    }
    if snapshot.size_bytes > 0 && snapshot.size_bytes != actual_size {
        return None;
    }

    if let Some(expected) = &expected_hash {
        let cached_sha = snapshot
            .canonical_hash
            .as_ref()
            .map(|value| value.trim().to_ascii_lowercase())?;
        if cached_sha != *expected {
            return None;
        }
    }

    Some(SelfHealFileEntryV2 {
        path: relative.to_string(),
        expected_size: entry.size,
        actual_size,
        expected_sha256: expected_hash,
        actual_sha256: snapshot.canonical_hash.clone(),
        fast_hash_blake3: snapshot.fast_hash.clone(),
        status: "ok".to_string(),
        reason: "usn_delta_cached".to_string(),
        modified_at,
    })
}

fn scan_entries_parallel(
    install_path: &Path,
    entries: Vec<ManifestFileV2>,
    worker_count: usize,
) -> Result<Vec<SelfHealFileEntryV2>> {
    let files = Arc::new(entries);
    let next_index = Arc::new(AtomicUsize::new(0));
    let results = Arc::new(Mutex::new(Vec::<SelfHealFileEntryV2>::new()));

    let mut workers = Vec::new();
    for _ in 0..worker_count {
        let files_ref = Arc::clone(&files);
        let index_ref = Arc::clone(&next_index);
        let results_ref = Arc::clone(&results);
        let root = install_path.to_path_buf();
        workers.push(thread::spawn(move || loop {
            let index = index_ref.fetch_add(1, Ordering::SeqCst);
            if index >= files_ref.len() {
                break;
            }
            let entry = &files_ref[index];
            let scanned = scan_entry(&root, entry);
            if let Ok(mut guard) = results_ref.lock() {
                guard.push(scanned);
            }
        }));
    }

    for handle in workers {
        let _ = handle.join();
    }

    let scanned_files = results
        .lock()
        .map_err(|_| LauncherError::Config("self-heal results lock poisoned".to_string()))?
        .clone();
    Ok(scanned_files)
}

fn scan_entry(install_path: &Path, entry: &ManifestFileV2) -> SelfHealFileEntryV2 {
    let relative = normalize_relative_path(&entry.path);
    let file_path = install_path.join(&relative);
    let expected_hash = if entry.hash.trim().is_empty() {
        None
    } else {
        Some(entry.hash.trim().to_ascii_lowercase())
    };

    if !file_path.exists() || !file_path.is_file() {
        return SelfHealFileEntryV2 {
            path: relative,
            expected_size: entry.size,
            actual_size: 0,
            expected_sha256: expected_hash,
            actual_sha256: None,
            fast_hash_blake3: None,
            status: "missing".to_string(),
            reason: "missing_file".to_string(),
            modified_at: 0,
        };
    }

    let metadata = match std::fs::metadata(&file_path) {
        Ok(meta) => meta,
        Err(_) => {
            return SelfHealFileEntryV2 {
                path: relative,
                expected_size: entry.size,
                actual_size: 0,
                expected_sha256: expected_hash,
                actual_sha256: None,
                fast_hash_blake3: None,
                status: "error".to_string(),
                reason: "metadata_failed".to_string(),
                modified_at: 0,
            };
        }
    };

    let actual_size = metadata.len();
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0);

    if entry.size > 0 && actual_size != entry.size {
        return SelfHealFileEntryV2 {
            path: relative,
            expected_size: entry.size,
            actual_size,
            expected_sha256: expected_hash,
            actual_sha256: None,
            fast_hash_blake3: None,
            status: "corrupt".to_string(),
            reason: "size_mismatch".to_string(),
            modified_at,
        };
    }

    let fast_hash = hash_blake3(&file_path).ok();
    let actual_sha = hash_sha256(&file_path).ok();
    let hash_mismatch = match (&expected_hash, &actual_sha) {
        (Some(expected), Some(actual)) => expected != actual,
        _ => false,
    };
    if hash_mismatch {
        return SelfHealFileEntryV2 {
            path: relative,
            expected_size: entry.size,
            actual_size,
            expected_sha256: expected_hash,
            actual_sha256: actual_sha,
            fast_hash_blake3: fast_hash,
            status: "corrupt".to_string(),
            reason: "hash_mismatch".to_string(),
            modified_at,
        };
    }

    SelfHealFileEntryV2 {
        path: relative,
        expected_size: entry.size,
        actual_size,
        expected_sha256: expected_hash,
        actual_sha256: actual_sha,
        fast_hash_blake3: fast_hash,
        status: "ok".to_string(),
        reason: "verified".to_string(),
        modified_at,
    }
}

fn hash_sha256(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn hash_blake3(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

#[cfg(target_os = "windows")]
mod ntfs_usn {
    use super::{normalize_relative_path, Database, ManifestFileV2};
    use crate::errors::{LauncherError, Result};
    use rusqlite::{params, OptionalExtension};
    use serde::{Deserialize, Serialize};
    use std::collections::HashSet;
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null_mut;

    type Handle = *mut c_void;
    type Dword = u32;
    type Bool = i32;
    type Usn = i64;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const FILE_SHARE_READ: Dword = 0x0000_0001;
    const FILE_SHARE_WRITE: Dword = 0x0000_0002;
    const FILE_SHARE_DELETE: Dword = 0x0000_0004;
    const OPEN_EXISTING: Dword = 3;
    const FILE_READ_ATTRIBUTES: Dword = 0x80;
    const FILE_FLAG_BACKUP_SEMANTICS: Dword = 0x0200_0000;
    const FILE_ID_INFO_CLASS: Dword = 18;

    const FSCTL_QUERY_USN_JOURNAL: Dword = 0x0009_00f4;
    const FSCTL_READ_USN_JOURNAL: Dword = 0x0009_00bb;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct UsnJournalDataV0 {
        usn_journal_id: u64,
        first_usn: i64,
        next_usn: i64,
        lowest_valid_usn: i64,
        max_usn: i64,
        maximum_size: u64,
        allocation_delta: u64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct ReadUsnJournalDataV0 {
        start_usn: i64,
        reason_mask: u32,
        return_only_on_close: u32,
        timeout: u64,
        bytes_to_wait_for: u64,
        usn_journal_id: u64,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct UsnRecordV2 {
        record_length: u32,
        major_version: u16,
        minor_version: u16,
        file_reference_number: u64,
        parent_file_reference_number: u64,
        usn: i64,
        timestamp: i64,
        reason: u32,
        source_info: u32,
        security_id: u32,
        file_attributes: u32,
        file_name_length: u16,
        file_name_offset: u16,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct FileId128 {
        identifier: [u8; 16],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct FileIdInfo {
        volume_serial_number: u64,
        file_id: FileId128,
    }

    #[derive(Clone, Debug, Serialize, Deserialize)]
    struct UsnCheckpoint {
        journal_id: u64,
        next_usn: i64,
        updated_at: i64,
    }

    struct VolumeHandle {
        raw: Handle,
    }

    impl Drop for VolumeHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.raw);
            }
        }
    }

    impl VolumeHandle {
        fn open(device: &str) -> Result<Self> {
            let wide = to_wide(device);
            let handle = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    null_mut(),
                    OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS,
                    null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE || handle.is_null() {
                return Err(LauncherError::Config(format!(
                    "unable to open volume handle: {}",
                    device
                )));
            }
            Ok(Self { raw: handle })
        }
    }

    pub fn collect_changed_paths_since_checkpoint(
        db: &Database,
        install_path: &Path,
        manifest_files: &[ManifestFileV2],
    ) -> Result<Option<HashSet<String>>> {
        let Some((volume_device, volume_key)) = resolve_volume_device(install_path) else {
            return Ok(None);
        };
        let handle = match VolumeHandle::open(&volume_device) {
            Ok(value) => value,
            Err(_) => return Ok(None),
        };

        let journal = match query_usn_journal(handle.raw) {
            Ok(value) => value,
            Err(_) => return Ok(None),
        };

        let checkpoint_key = format!("self_heal.usn.{}", volume_key);
        let checkpoint = read_checkpoint(db, &checkpoint_key)?;
        let Some(previous) = checkpoint else {
            write_checkpoint(db, &checkpoint_key, journal.usn_journal_id, journal.next_usn)?;
            return Ok(None);
        };

        if previous.journal_id != journal.usn_journal_id
            || previous.next_usn < journal.first_usn
            || previous.next_usn > journal.next_usn
        {
            write_checkpoint(db, &checkpoint_key, journal.usn_journal_id, journal.next_usn)?;
            return Ok(None);
        }

        let changed_frns = read_changed_frns(handle.raw, previous.next_usn, journal.usn_journal_id)?;
        write_checkpoint(db, &checkpoint_key, journal.usn_journal_id, journal.next_usn)?;

        let mut changed_paths = HashSet::new();
        for entry in manifest_files {
            let relative = normalize_relative_path(&entry.path);
            if relative.is_empty() {
                continue;
            }

            let full_path = install_path.join(&relative);
            if !full_path.exists() || !full_path.is_file() {
                changed_paths.insert(relative);
                continue;
            }

            match get_file_reference_number(&full_path) {
                Ok(frn) => {
                    if changed_frns.contains(&frn) {
                        changed_paths.insert(relative);
                    }
                }
                Err(_) => {
                    changed_paths.insert(relative);
                }
            }
        }

        Ok(Some(changed_paths))
    }

    fn resolve_volume_device(install_path: &Path) -> Option<(String, String)> {
        let canonical = install_path
            .canonicalize()
            .ok()
            .unwrap_or_else(|| install_path.to_path_buf());
        let value = canonical.to_string_lossy();
        let bytes = value.as_bytes();
        if bytes.len() < 2 || bytes[1] != b':' {
            return None;
        }
        let drive = value[0..2].to_ascii_uppercase();
        Some((format!(r"\\.\{}", drive), drive))
    }

    fn to_wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn query_usn_journal(handle: Handle) -> Result<UsnJournalDataV0> {
        let mut data = UsnJournalDataV0 {
            usn_journal_id: 0,
            first_usn: 0,
            next_usn: 0,
            lowest_valid_usn: 0,
            max_usn: 0,
            maximum_size: 0,
            allocation_delta: 0,
        };
        let mut bytes_returned: Dword = 0;
        let ok = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_QUERY_USN_JOURNAL,
                null_mut(),
                0,
                &mut data as *mut _ as *mut c_void,
                size_of::<UsnJournalDataV0>() as Dword,
                &mut bytes_returned as *mut Dword,
                null_mut(),
            )
        };
        if ok == 0 {
            return Err(LauncherError::Config("FSCTL_QUERY_USN_JOURNAL failed".to_string()));
        }
        Ok(data)
    }

    fn read_changed_frns(handle: Handle, start_usn: i64, journal_id: u64) -> Result<HashSet<u64>> {
        let mut changed: HashSet<u64> = HashSet::new();
        let mut current_usn = start_usn;
        let mut buffer = vec![0_u8; 1024 * 1024];

        for _ in 0..1024 {
            let mut request = ReadUsnJournalDataV0 {
                start_usn: current_usn,
                reason_mask: u32::MAX,
                return_only_on_close: 0,
                timeout: 0,
                bytes_to_wait_for: 0,
                usn_journal_id: journal_id,
            };
            let mut bytes_returned: Dword = 0;
            let ok = unsafe {
                DeviceIoControl(
                    handle,
                    FSCTL_READ_USN_JOURNAL,
                    &mut request as *mut _ as *mut c_void,
                    size_of::<ReadUsnJournalDataV0>() as Dword,
                    buffer.as_mut_ptr() as *mut c_void,
                    buffer.len() as Dword,
                    &mut bytes_returned as *mut Dword,
                    null_mut(),
                )
            };
            if ok == 0 {
                break;
            }
            if (bytes_returned as usize) <= size_of::<Usn>() {
                break;
            }

            let next_usn = i64::from_le_bytes(
                buffer[0..size_of::<Usn>()]
                    .try_into()
                    .map_err(|_| LauncherError::Config("invalid USN buffer header".to_string()))?,
            );

            let mut offset = size_of::<Usn>();
            while offset + size_of::<UsnRecordV2>() <= bytes_returned as usize {
                let record_ptr = unsafe { buffer.as_ptr().add(offset) as *const UsnRecordV2 };
                let record = unsafe { &*record_ptr };
                let record_len = record.record_length as usize;
                if record_len == 0 || offset + record_len > bytes_returned as usize {
                    break;
                }
                if record.major_version == 2 {
                    changed.insert(record.file_reference_number);
                }
                offset += record_len;
            }

            if next_usn <= current_usn {
                break;
            }
            current_usn = next_usn;
        }

        Ok(changed)
    }

    fn get_file_reference_number(path: &Path) -> Result<u64> {
        let wide = to_wide(path.to_string_lossy().as_ref());
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return Err(LauncherError::Config(format!(
                "unable to open file for FRN: {}",
                path.display()
            )));
        }

        let mut info = FileIdInfo {
            volume_serial_number: 0,
            file_id: FileId128 { identifier: [0; 16] },
        };
        let ok = unsafe {
            GetFileInformationByHandleEx(
                handle,
                FILE_ID_INFO_CLASS,
                &mut info as *mut _ as *mut c_void,
                size_of::<FileIdInfo>() as Dword,
            )
        };
        unsafe {
            let _ = CloseHandle(handle);
        }
        if ok == 0 {
            return Err(LauncherError::Config(format!(
                "GetFileInformationByHandleEx failed: {}",
                path.display()
            )));
        }

        let mut raw = [0_u8; 8];
        raw.copy_from_slice(&info.file_id.identifier[0..8]);
        Ok(u64::from_le_bytes(raw))
    }

    fn read_checkpoint(db: &Database, key: &str) -> Result<Option<UsnCheckpoint>> {
        let conn = db.connection()?;
        let raw = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        match raw {
            Some(value) => serde_json::from_str::<UsnCheckpoint>(&value)
                .map(Some)
                .map_err(|err| {
                    LauncherError::Config(format!(
                        "invalid USN checkpoint payload for key {}: {}",
                        key, err
                    ))
                }),
            None => Ok(None),
        }
    }

    fn write_checkpoint(db: &Database, key: &str, journal_id: u64, next_usn: i64) -> Result<()> {
        let payload = UsnCheckpoint {
            journal_id,
            next_usn,
            updated_at: chrono::Utc::now().timestamp(),
        };
        let value = serde_json::to_string(&payload)?;
        let conn = db.connection()?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, chrono::Utc::now().timestamp()],
        )?;
        Ok(())
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(
            lp_file_name: *const u16,
            dw_desired_access: Dword,
            dw_share_mode: Dword,
            lp_security_attributes: *mut c_void,
            dw_creation_disposition: Dword,
            dw_flags_and_attributes: Dword,
            h_template_file: Handle,
        ) -> Handle;

        fn CloseHandle(h_object: Handle) -> Bool;

        fn DeviceIoControl(
            h_device: Handle,
            dw_io_control_code: Dword,
            lp_in_buffer: *mut c_void,
            n_in_buffer_size: Dword,
            lp_out_buffer: *mut c_void,
            n_out_buffer_size: Dword,
            lp_bytes_returned: *mut Dword,
            lp_overlapped: *mut c_void,
        ) -> Bool;

        fn GetFileInformationByHandleEx(
            h_file: Handle,
            file_information_class: Dword,
            lp_file_information: *mut c_void,
            dw_buffer_size: Dword,
        ) -> Bool;
    }
}

#[cfg(not(target_os = "windows"))]
mod ntfs_usn {
    use super::{Database, ManifestFileV2};
    use crate::errors::Result;
    use std::collections::HashSet;
    use std::path::Path;

    pub fn collect_changed_paths_since_checkpoint(
        _db: &Database,
        _install_path: &Path,
        _manifest_files: &[ManifestFileV2],
    ) -> Result<Option<HashSet<String>>> {
        Ok(None)
    }
}

