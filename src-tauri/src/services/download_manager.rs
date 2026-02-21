use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{self, Read};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sysinfo::Disks;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::{mpsc, watch, OwnedSemaphorePermit, Semaphore};
use tokio::time::sleep;
use zip::ZipArchive;

use crate::db::queries::{DownloadQueries, DownloadStateQueries};
use crate::db::Database;
use crate::errors::{LauncherError, Result};
use crate::models::{DownloadChunk, DownloadState, LocalDownload};
use crate::services::download_service::DownloadProgressUpdate;
use crate::services::{
    build_chunk_peer_urls, peer_url_fingerprint, ApiClient, DownloadService, PeerCacheServer,
    PeerCandidate, PeerCoordinator,
};
use crate::utils::file::FileManager;

const DEFAULT_CHUNK_SIZE: u64 = 1024 * 1024;
const MANIFEST_FILE: &str = "manifest.json";
const DEFAULT_MAX_CONCURRENT_CHUNKS: usize = 24;
const MAX_CONCURRENT_CHUNKS: usize = 64;
const STORAGE_SAFETY_MARGIN_BYTES: u64 = 256 * 1024 * 1024;
const MAX_STORAGE_SAFETY_MARGIN_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const DEPOTCACHE_PREFIX_LEN: usize = 2;
const DEFAULT_DEPOTCACHE_MAX_BYTES: u64 = 64 * 1024 * 1024 * 1024;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[inline]
fn hide_console_window(command: &mut std::process::Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[derive(Clone)]
pub struct DownloadManager {
    app_handle: AppHandle,
    client: reqwest::Client,
    db: Database,
    api: ApiClient,
    downloads_api: DownloadService,
    file_manager: FileManager,
    registry: Arc<Mutex<HashMap<String, DownloadHandle>>>,
    throttle: BandwidthThrottler,
    max_concurrent_chunks: usize,
    depot_cache: DepotCache,
    peer_server: Option<PeerCacheServer>,
    peer_coordinator: Option<PeerCoordinator>,
}

#[derive(Clone)]
pub struct BandwidthThrottler {
    max_bytes_per_second: Arc<tokio::sync::Mutex<u64>>,
    current_window_bytes: Arc<tokio::sync::Mutex<u64>>,
    reset_started: Arc<AtomicBool>,
}

#[derive(Clone)]
struct DownloadHandle {
    control: watch::Sender<DownloadControl>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DownloadControl {
    Running,
    Paused,
    Cancelled,
}

#[derive(Clone, Deserialize, Serialize)]
struct Manifest {
    game_id: String,
    slug: String,
    version: String,
    build_id: String,
    chunk_size: u64,
    total_size: u64,
    compressed_size: u64,
    files: Vec<ManifestFile>,
    #[serde(default)]
    install_mode: Option<String>,
    #[serde(default)]
    archive_dir: Option<String>,
    #[serde(default)]
    archive_cleanup: bool,
    #[serde(default)]
    archive_files: Vec<String>,
    #[serde(default)]
    total_original_size: Option<u64>,
}

#[derive(Clone, Deserialize, Serialize)]
struct ManifestFile {
    path: String,
    size: u64,
    hash: String,
    file_id: String,
    chunks: Vec<ManifestChunk>,
}

#[derive(Clone, Deserialize, Serialize)]
struct ManifestChunk {
    index: u64,
    hash: String,
    size: u64,
    url: String,
    #[serde(default)]
    fallback_urls: Vec<String>,
    #[serde(default = "default_compression")]
    compression: String,
}

fn default_compression() -> String {
    "none".to_string()
}

fn is_archive_mode(manifest: &Manifest) -> bool {
    matches!(manifest.install_mode.as_deref(), Some("archive_chunks"))
}

fn archive_dir_name(manifest: &Manifest) -> String {
    manifest
        .archive_dir
        .clone()
        .unwrap_or_else(|| ".chunks".to_string())
}

fn is_safe_relative_path(path: &Path) -> bool {
    use std::path::Component;
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => return false,
            _ => {}
        }
    }
    true
}

#[derive(Clone)]
struct ChunkJob {
    file_id: String,
    temp_path: PathBuf,
    index: u64,
    offset: u64,
    size: u64,
    hash: String,
    url: String,
    fallback_urls: Vec<String>,
    compression: String,
}

struct DownloadPlan {
    chunks: Vec<ChunkJob>,
    total_bytes: u64,
    preexisting_bytes: u64,
    files_to_finalize: Vec<FilePlan>,
    delete_files: Vec<PathBuf>,
    precompleted_chunks: Vec<DownloadChunk>,
}

struct FilePlan {
    final_path: PathBuf,
    temp_path: PathBuf,
    size: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IntegrityScanMode {
    Preflight,
    PostDownload,
}

#[derive(Default, Clone, Debug)]
struct IntegrityScanSummary {
    total_files: usize,
    verified_files: usize,
    missing_files: usize,
    corrupt_files: usize,
    error_files: usize,
    hashed_files: usize,
    elapsed_ms: u128,
    first_failures: Vec<String>,
}

#[derive(Clone, Debug)]
struct IntegrityFileResult {
    path: String,
    status: IntegrityFileStatus,
    reason: String,
    hashed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IntegrityFileStatus {
    Ok,
    Missing,
    Corrupt,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DownloadEngine {
    Reqwest,
    Aria2c,
}

#[derive(Clone, Debug)]
struct Aria2Config {
    binary: String,
    split: usize,
    max_connections_per_server: usize,
    max_tries: usize,
    retry_wait_seconds: usize,
    timeout_seconds: usize,
    connect_timeout_seconds: usize,
    proxy: Option<String>,
}

struct StorageBudget {
    available_bytes: u64,
    reclaimable_bytes: u64,
    preallocate_bytes: u64,
    extraction_bytes: u64,
    cache_write_bytes: u64,
    safety_bytes: u64,
    required_bytes: u64,
}

#[derive(Clone)]
struct DepotCache {
    root: PathBuf,
    max_bytes: u64,
}

struct ProgressTracker {
    total_bytes: u64,
    downloaded_bytes: Arc<tokio::sync::Mutex<u64>>,
    start_time: Instant,
}

#[derive(Clone)]
struct AdaptiveConcurrencyGovernor {
    enabled: bool,
    mode: String,
    semaphore: Arc<Semaphore>,
    reserved: Arc<tokio::sync::Mutex<Vec<OwnedSemaphorePermit>>>,
    min_permits: usize,
    max_permits: usize,
    last_pressure: Arc<tokio::sync::Mutex<Option<Instant>>>,
    last_relax: Arc<tokio::sync::Mutex<Instant>>,
}

#[derive(Clone, Serialize)]
struct DownloadRuntimeErrorPayload {
    download_id: String,
    game_id: String,
    slug: String,
    message: String,
}

impl ProgressTracker {
    fn new(total_bytes: u64, initial: u64) -> Self {
        Self {
            total_bytes,
            downloaded_bytes: Arc::new(tokio::sync::Mutex::new(initial)),
            start_time: Instant::now(),
        }
    }

    async fn add_bytes(&self, bytes: u64) {
        let mut guard = self.downloaded_bytes.lock().await;
        *guard = guard.saturating_add(bytes);
    }

    async fn snapshot(&self) -> (f64, u64, u64, u64, u64) {
        let downloaded = *self.downloaded_bytes.lock().await;
        let progress = if self.total_bytes == 0 {
            0.0
        } else {
            (downloaded as f64 / self.total_bytes as f64) * 100.0
        };
        let elapsed = self.start_time.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 {
            (downloaded as f64 / elapsed) as u64
        } else {
            0
        };
        let remaining = self.total_bytes.saturating_sub(downloaded);
        let eta = if speed > 0 { remaining / speed } else { 0 };
        (progress, speed, eta, downloaded, self.total_bytes)
    }
}

impl AdaptiveConcurrencyGovernor {
    fn new(method_key: &str, semaphore: Arc<Semaphore>, max_permits: usize) -> Self {
        let normalized = method_key.trim().to_ascii_lowercase();
        let enabled =
            normalized.eq("auto") || normalized.eq("max_speed") || normalized.eq("balance");
        let min_permits = match normalized.as_str() {
            "auto" => (max_permits / 3).clamp(8, 24),
            "max_speed" => (max_permits / 2).clamp(12, 32),
            "balance" => (max_permits / 2).clamp(6, 16),
            _ => max_permits,
        }
        .min(max_permits);

        Self {
            enabled,
            mode: normalized,
            semaphore,
            reserved: Arc::new(tokio::sync::Mutex::new(Vec::new())),
            min_permits,
            max_permits,
            last_pressure: Arc::new(tokio::sync::Mutex::new(None)),
            last_relax: Arc::new(tokio::sync::Mutex::new(Instant::now())),
        }
    }

    async fn current_limit(&self) -> usize {
        let reserved = self.reserved.lock().await;
        self.max_permits.saturating_sub(reserved.len())
    }

    async fn on_network_pressure(&self, source: &str, reason: &str) {
        if !self.enabled {
            return;
        }

        let now = Instant::now();
        {
            let mut last_pressure = self.last_pressure.lock().await;
            *last_pressure = Some(now);
        }

        let current = self.current_limit().await;
        if current <= self.min_permits {
            return;
        }

        if let Ok(permit) = self.semaphore.clone().try_acquire_owned() {
            let mut reserved = self.reserved.lock().await;
            reserved.push(permit);
            let reduced = self.max_permits.saturating_sub(reserved.len());
            tracing::warn!(
                "adaptive download governor reduced concurrency mode={} source={} reason={} limit={}/{}",
                self.mode,
                source,
                reason,
                reduced,
                self.max_permits
            );
        }
    }

    async fn maybe_relax(&self) {
        if !self.enabled {
            return;
        }

        let now = Instant::now();
        let last_pressure = { *self.last_pressure.lock().await };
        let pressure_age = last_pressure
            .map(|value| now.saturating_duration_since(value))
            .unwrap_or(Duration::from_secs(3600));
        if pressure_age < Duration::from_secs(4) {
            return;
        }

        let mut last_relax = self.last_relax.lock().await;
        if now.saturating_duration_since(*last_relax) < Duration::from_secs(2) {
            return;
        }

        let mut reserved = self.reserved.lock().await;
        if reserved.pop().is_some() {
            *last_relax = now;
            let restored = self.max_permits.saturating_sub(reserved.len());
            tracing::info!(
                "adaptive download governor restored concurrency mode={} limit={}/{}",
                self.mode,
                restored,
                self.max_permits
            );
        }
    }
}

impl BandwidthThrottler {
    pub fn new(max_bps: u64) -> Self {
        Self {
            max_bytes_per_second: Arc::new(tokio::sync::Mutex::new(max_bps)),
            current_window_bytes: Arc::new(tokio::sync::Mutex::new(0)),
            reset_started: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn set_limit(&self, max_bps: u64) {
        let mut guard = self.max_bytes_per_second.lock().await;
        *guard = max_bps;
    }

    pub async fn acquire(&self, bytes: u64) {
        loop {
            let max = *self.max_bytes_per_second.lock().await;
            if max == 0 {
                return;
            }
            let mut current = self.current_window_bytes.lock().await;
            if *current + bytes <= max {
                *current += bytes;
                return;
            }
            drop(current);
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub fn start_reset_task(&self) {
        if self.reset_started.swap(true, Ordering::SeqCst) {
            return;
        }
        if tokio::runtime::Handle::try_current().is_err() {
            self.reset_started.store(false, Ordering::SeqCst);
            return;
        }
        let counter = self.current_window_bytes.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                let mut guard = counter.lock().await;
                *guard = 0;
            }
        });
    }
}

fn sanitize_hash(hash: &str) -> Option<String> {
    let normalized = hash.trim().to_ascii_lowercase();
    if normalized.len() < 8 {
        return None;
    }
    if !normalized.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return None;
    }
    Some(normalized)
}

fn compute_sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn compute_sha256_file(path: &Path) -> Result<String> {
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

fn resolve_integrity_scan_workers() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(8);
    usize::min(32, usize::max(8, 2 * cores)).clamp(1, 64)
}

fn resolve_preflight_hash_limit_bytes() -> u64 {
    std::env::var("LAUNCHER_PRE_SCAN_HASH_MAX_BYTES")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|value| value.clamp(0, 1024 * 1024 * 1024))
        .unwrap_or(32 * 1024 * 1024)
}

fn scan_manifest_file(
    install_dir: &Path,
    file: &ManifestFile,
    mode: IntegrityScanMode,
    preflight_hash_limit_bytes: u64,
) -> IntegrityFileResult {
    let relative = file
        .path
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    let target = install_dir.join(&relative);
    let expected_hash = sanitize_hash(&file.hash);

    if !target.exists() || !target.is_file() {
        return IntegrityFileResult {
            path: relative,
            status: IntegrityFileStatus::Missing,
            reason: "missing_file".to_string(),
            hashed: false,
        };
    }

    let metadata = match std::fs::metadata(&target) {
        Ok(value) => value,
        Err(_) => {
            return IntegrityFileResult {
                path: relative,
                status: IntegrityFileStatus::Error,
                reason: "metadata_failed".to_string(),
                hashed: false,
            };
        }
    };

    if file.size > 0 && metadata.len() != file.size {
        return IntegrityFileResult {
            path: relative,
            status: IntegrityFileStatus::Corrupt,
            reason: "size_mismatch".to_string(),
            hashed: false,
        };
    }

    let should_hash = match mode {
        IntegrityScanMode::PostDownload => expected_hash.is_some(),
        IntegrityScanMode::Preflight => {
            expected_hash.is_some()
                && (preflight_hash_limit_bytes == 0 || file.size <= preflight_hash_limit_bytes)
        }
    };
    if !should_hash {
        return IntegrityFileResult {
            path: relative,
            status: IntegrityFileStatus::Ok,
            reason: "size_verified".to_string(),
            hashed: false,
        };
    }

    let actual_hash = match compute_sha256_file(&target) {
        Ok(value) => value,
        Err(_) => {
            return IntegrityFileResult {
                path: relative,
                status: IntegrityFileStatus::Error,
                reason: "hash_read_failed".to_string(),
                hashed: true,
            };
        }
    };

    if let Some(expected) = expected_hash {
        if expected != actual_hash {
            return IntegrityFileResult {
                path: relative,
                status: IntegrityFileStatus::Corrupt,
                reason: "hash_mismatch".to_string(),
                hashed: true,
            };
        }
    }

    IntegrityFileResult {
        path: relative,
        status: IntegrityFileStatus::Ok,
        reason: "hash_verified".to_string(),
        hashed: true,
    }
}

fn scan_manifest_integrity_blocking(
    install_dir: PathBuf,
    files: Vec<ManifestFile>,
    mode: IntegrityScanMode,
) -> Result<IntegrityScanSummary> {
    let started = Instant::now();
    let worker_count = resolve_integrity_scan_workers();
    let preflight_hash_limit_bytes = resolve_preflight_hash_limit_bytes();

    let entries = Arc::new(files);
    let next_index = Arc::new(AtomicUsize::new(0));
    let results = Arc::new(Mutex::new(Vec::<IntegrityFileResult>::new()));

    let mut workers = Vec::new();
    for _ in 0..worker_count {
        let root = install_dir.clone();
        let files_ref = Arc::clone(&entries);
        let index_ref = Arc::clone(&next_index);
        let results_ref = Arc::clone(&results);
        workers.push(thread::spawn(move || loop {
            let index = index_ref.fetch_add(1, Ordering::SeqCst);
            if index >= files_ref.len() {
                break;
            }
            let file = &files_ref[index];
            let scanned = scan_manifest_file(&root, file, mode, preflight_hash_limit_bytes);
            if let Ok(mut guard) = results_ref.lock() {
                guard.push(scanned);
            }
        }));
    }

    for handle in workers {
        let _ = handle.join();
    }

    let scanned = results
        .lock()
        .map_err(|_| LauncherError::Config("integrity scan results lock poisoned".to_string()))?
        .clone();

    let mut summary = IntegrityScanSummary {
        total_files: scanned.len(),
        elapsed_ms: started.elapsed().as_millis(),
        ..IntegrityScanSummary::default()
    };

    for item in scanned {
        if item.hashed {
            summary.hashed_files += 1;
        }
        match item.status {
            IntegrityFileStatus::Ok => summary.verified_files += 1,
            IntegrityFileStatus::Missing => {
                summary.missing_files += 1;
                if summary.first_failures.len() < 5 {
                    summary
                        .first_failures
                        .push(format!("{} ({})", item.path, item.reason));
                }
            }
            IntegrityFileStatus::Corrupt => {
                summary.corrupt_files += 1;
                if summary.first_failures.len() < 5 {
                    summary
                        .first_failures
                        .push(format!("{} ({})", item.path, item.reason));
                }
            }
            IntegrityFileStatus::Error => {
                summary.error_files += 1;
                if summary.first_failures.len() < 5 {
                    summary
                        .first_failures
                        .push(format!("{} ({})", item.path, item.reason));
                }
            }
        }
    }

    Ok(summary)
}

async fn scan_manifest_integrity(
    install_dir: &Path,
    files: &[ManifestFile],
    mode: IntegrityScanMode,
) -> Result<IntegrityScanSummary> {
    let install_dir = install_dir.to_path_buf();
    let files = files.to_vec();
    tokio::task::spawn_blocking(move || scan_manifest_integrity_blocking(install_dir, files, mode))
        .await
        .map_err(|err| LauncherError::Config(format!("integrity scan join error: {err}")))?
}

fn resolve_depot_cache_max_bytes() -> u64 {
    if let Some(value) = std::env::var("LAUNCHER_DEPOTCACHE_MAX_BYTES")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
    {
        return value;
    }

    if let Some(gb) = std::env::var("LAUNCHER_DEPOTCACHE_MAX_GB")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
    {
        return gb.saturating_mul(1024 * 1024 * 1024);
    }

    DEFAULT_DEPOTCACHE_MAX_BYTES
}

fn resolve_depot_cache_root(file_manager: &FileManager) -> PathBuf {
    if let Some(path) = std::env::var("OTOSHI_DEPOTCACHE_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return path;
    }

    let app_data = file_manager.app_data_dir();
    if let Some(root) = app_data.parent() {
        if root.join("portable.config.json").exists() {
            return root.join("depotcache");
        }
    }

    app_data.join("depotcache")
}

impl DepotCache {
    fn new(root: PathBuf) -> Self {
        let max_bytes = resolve_depot_cache_max_bytes();
        if let Err(err) = std::fs::create_dir_all(&root) {
            tracing::warn!(
                "failed to create depotcache root {}: {}",
                root.display(),
                err
            );
        }
        Self { root, max_bytes }
    }

    fn chunk_path(&self, hash: &str) -> Option<PathBuf> {
        let normalized = sanitize_hash(hash)?;
        let prefix_len = DEPOTCACHE_PREFIX_LEN.min(normalized.len());
        let prefix = &normalized[..prefix_len];
        Some(self.root.join(prefix).join(format!("{normalized}.bin")))
    }

    fn has_candidate(&self, hash: &str, size: u64) -> bool {
        let Some(path) = self.chunk_path(hash) else {
            return false;
        };
        std::fs::metadata(path)
            .map(|meta| meta.is_file() && meta.len() == size)
            .unwrap_or(false)
    }

    fn load_valid_chunk(&self, hash: &str, size: u64) -> Result<Option<Vec<u8>>> {
        let Some(path) = self.chunk_path(hash) else {
            return Ok(None);
        };

        let metadata = match std::fs::metadata(&path) {
            Ok(meta) => meta,
            Err(_) => return Ok(None),
        };

        if !metadata.is_file() || metadata.len() != size {
            return Ok(None);
        }

        let data = std::fs::read(&path)?;
        if data.len() as u64 != size {
            return Ok(None);
        }

        let digest = compute_sha256_hex(&data);
        if !digest.eq_ignore_ascii_case(hash) {
            let _ = std::fs::remove_file(&path);
            tracing::warn!(
                "depotcache chunk hash mismatch removed: {} expected={} actual={}",
                path.display(),
                hash,
                digest
            );
            return Ok(None);
        }

        Ok(Some(data))
    }

    fn store_chunk(&self, hash: &str, data: &[u8]) -> Result<()> {
        let Some(path) = self.chunk_path(hash) else {
            return Ok(());
        };

        if std::fs::metadata(&path)
            .map(|meta| meta.is_file() && meta.len() == data.len() as u64)
            .unwrap_or(false)
        {
            return Ok(());
        }

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let temp_name = format!(
            "{}.tmp-{}-{}",
            path.file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "chunk.bin".to_string()),
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        );
        let temp_path = path.with_file_name(temp_name);

        std::fs::write(&temp_path, data)?;
        match std::fs::rename(&temp_path, &path) {
            Ok(_) => Ok(()),
            Err(_) => {
                if path.exists() {
                    let _ = std::fs::remove_file(&temp_path);
                    Ok(())
                } else {
                    let _ = std::fs::remove_file(&temp_path);
                    Err(LauncherError::Config(format!(
                        "failed to finalize depotcache chunk {}",
                        path.display()
                    )))
                }
            }
        }
    }

    fn collect_entries(&self) -> Vec<(PathBuf, u64, SystemTime)> {
        fn walk(dir: &Path, out: &mut Vec<(PathBuf, u64, SystemTime)>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(meta) = entry.metadata() else {
                    continue;
                };
                if meta.is_dir() {
                    walk(&path, out);
                    continue;
                }
                if !meta.is_file() {
                    continue;
                }
                let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                out.push((path, meta.len(), modified));
            }
        }

        let mut out = Vec::new();
        walk(&self.root, &mut out);
        out
    }

    fn gc_if_needed(&self) -> Result<()> {
        let mut entries = self.collect_entries();
        let mut total: u64 = entries.iter().map(|(_, size, _)| *size).sum();
        if total <= self.max_bytes {
            return Ok(());
        }

        entries.sort_by_key(|(_, _, modified)| *modified);
        for (path, size, _) in entries {
            if total <= self.max_bytes {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(size);
            }
        }

        Ok(())
    }
}

impl DownloadManager {
    pub fn new(
        app_handle: AppHandle,
        db: Database,
        api: ApiClient,
        downloads_api: DownloadService,
        file_manager: FileManager,
    ) -> Self {
        let max_concurrent_chunks = std::env::var("LAUNCHER_MAX_CONCURRENT_CHUNKS")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .map(|value| value.clamp(1, MAX_CONCURRENT_CHUNKS))
            .unwrap_or(DEFAULT_MAX_CONCURRENT_CHUNKS);
        let request_timeout_seconds = env_usize("LAUNCHER_HTTP_TIMEOUT_SECONDS")
            .unwrap_or(600)
            .clamp(60, 7200) as u64;
        let connect_timeout_seconds = env_usize("LAUNCHER_HTTP_CONNECT_TIMEOUT_SECONDS")
            .unwrap_or(20)
            .clamp(5, 120) as u64;

        let mut client_builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(request_timeout_seconds))
            .connect_timeout(Duration::from_secs(connect_timeout_seconds))
            .pool_max_idle_per_host((max_concurrent_chunks * 2).clamp(8, 128))
            .http2_adaptive_window(true)
            .tcp_nodelay(true);

        if env_truthy("LAUNCHER_DISABLE_SYSTEM_PROXY") {
            client_builder = client_builder.no_proxy();
        }

        if let Some(proxy_url) = std::env::var("LAUNCHER_PROXY")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            match reqwest::Proxy::all(&proxy_url) {
                Ok(proxy) => {
                    client_builder = client_builder.proxy(proxy);
                    tracing::info!("using launcher proxy: {}", proxy_url);
                }
                Err(err) => tracing::warn!("invalid LAUNCHER_PROXY '{}': {}", proxy_url, err),
            }
        }

        let client = client_builder.build().expect("http client");

        let max_bps = std::env::var("LAUNCHER_MAX_BPS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);

        let throttle = BandwidthThrottler::new(max_bps);
        throttle.start_reset_task();
        let depot_cache = DepotCache::new(resolve_depot_cache_root(&file_manager));
        let peer_server = PeerCacheServer::start(depot_cache.root.clone());
        let peer_coordinator = peer_server
            .as_ref()
            .and_then(|server| PeerCoordinator::new(api.clone(), server.advertise_info()));
        if let Some(coordination) = peer_coordinator.as_ref() {
            coordination.start();
        }

        Self {
            app_handle,
            client,
            db,
            api,
            downloads_api,
            file_manager,
            registry: Arc::new(Mutex::new(HashMap::new())),
            throttle,
            max_concurrent_chunks,
            depot_cache,
            peer_server,
            peer_coordinator,
        }
    }

    pub async fn start_download(
        &self,
        download_id: &str,
        game_id: &str,
        slug: &str,
        requested_method: Option<&str>,
        install_dir_override: Option<&str>,
    ) -> Result<()> {
        self.throttle.start_reset_task();
        if self
            .registry
            .lock()
            .map_err(|_| LauncherError::Config("download registry locked".to_string()))?
            .contains_key(download_id)
        {
            return Ok(());
        }

        let (tx, rx) = watch::channel(DownloadControl::Running);
        let handle = DownloadHandle { control: tx };
        self.registry
            .lock()
            .map_err(|_| LauncherError::Config("download registry locked".to_string()))?
            .insert(download_id.to_string(), handle);

        let download_id = download_id.to_string();
        let game_id = game_id.to_string();
        let slug = slug.to_string();
        let requested_method = requested_method.map(str::to_string);
        let install_dir_override = install_dir_override.map(str::to_string);
        let manager = self.clone();

        tokio::spawn(async move {
            let result = manager
                .run_download(
                    &download_id,
                    &game_id,
                    &slug,
                    requested_method.as_deref(),
                    install_dir_override.as_deref(),
                    rx,
                )
                .await;
            let _ = manager.depot_cache.gc_if_needed();
            if let Err(err) = result {
                let err_message = err.to_string();
                let cancelled = err_message
                    .to_ascii_lowercase()
                    .contains("download cancelled");
                tracing::error!(
                    "download failed id={} game_id={} slug={} error={}",
                    download_id,
                    game_id,
                    slug,
                    err_message
                );
                let final_status = if cancelled { "cancelled" } else { "failed" };
                let _ = manager
                    .db
                    .update_download_status(&download_id, final_status);
                let _ = manager
                    .downloads_api
                    .update_status(&download_id, final_status)
                    .await;
                let _ = manager.db.upsert_download(&LocalDownload {
                    id: download_id.clone(),
                    game_id: game_id.clone(),
                    status: final_status.to_string(),
                    progress: 0,
                    speed_mbps: 0.0,
                    eta_minutes: 0,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    network_bps: 0,
                    disk_read_bps: 0,
                    disk_write_bps: 0,
                    read_bytes: 0,
                    written_bytes: 0,
                    remaining_bytes: 0,
                    speed_history: Vec::new(),
                    updated_at: chrono::Utc::now().timestamp(),
                });
                if !cancelled {
                    let _ = manager.app_handle.emit(
                        "download-runtime-error",
                        DownloadRuntimeErrorPayload {
                            download_id: download_id.clone(),
                            game_id: game_id.clone(),
                            slug: slug.clone(),
                            message: err_message,
                        },
                    );
                }
            }
            manager
                .registry
                .lock()
                .ok()
                .and_then(|mut map| map.remove(&download_id));
        });

        Ok(())
    }

    pub async fn pause_download(&self, download_id: &str) -> Result<()> {
        self.set_control(download_id, DownloadControl::Paused)?;
        let _ = self.db.update_download_status(download_id, "paused");
        Ok(())
    }

    pub async fn resume_download(&self, download_id: &str) -> Result<()> {
        self.set_control(download_id, DownloadControl::Running)?;
        let _ = self.db.update_download_status(download_id, "downloading");
        Ok(())
    }

    pub async fn cancel_download(&self, download_id: &str) -> Result<()> {
        if let Err(err) = self.set_control(download_id, DownloadControl::Cancelled) {
            tracing::warn!(
                "cancel_download control signal skipped for {}: {}",
                download_id,
                err
            );
        }
        let _ = self.db.update_download_status(download_id, "cancelled");
        Ok(())
    }

    pub async fn set_download_limit(&self, max_mbps: f64) -> Result<()> {
        self.throttle.start_reset_task();
        let max_bps = if max_mbps <= 0.0 {
            0
        } else {
            (max_mbps * 1024.0 * 1024.0) as u64
        };
        self.throttle.set_limit(max_bps).await;
        Ok(())
    }

    fn set_control(&self, download_id: &str, state: DownloadControl) -> Result<()> {
        let guard = self
            .registry
            .lock()
            .map_err(|_| LauncherError::Config("download registry locked".to_string()))?;
        let handle = guard
            .get(download_id)
            .ok_or_else(|| LauncherError::NotFound("download not running".to_string()))?;
        handle
            .control
            .send(state)
            .map_err(|_| LauncherError::Config("download control channel closed".to_string()))?;
        Ok(())
    }

    async fn run_download(
        &self,
        download_id: &str,
        game_id: &str,
        slug: &str,
        requested_method: Option<&str>,
        install_dir_override: Option<&str>,
        control_rx: watch::Receiver<DownloadControl>,
    ) -> Result<()> {
        let manifest: Manifest = self.api.get(&format!("manifests/{}", slug), false).await?;
        let normalized_override = install_dir_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);

        // Explicit path from the current "start download" action should win over
        // any previous persisted state for the same download id.
        let install_dir = if let Some(override_path) = normalized_override.as_ref() {
            override_path.clone()
        } else if let Some(state) = self.db.get_download_state(download_id)? {
            let stored = state.install_dir.trim();
            if !stored.is_empty() {
                PathBuf::from(stored)
            } else {
                self.file_manager.get_game_dir(slug)
            }
        } else {
            self.file_manager.get_game_dir(slug)
        };
        let manifest_json = serde_json::to_string(&manifest)?;

        let state = DownloadState {
            id: download_id.to_string(),
            game_id: game_id.to_string(),
            slug: slug.to_string(),
            status: "downloading".to_string(),
            install_dir: install_dir.to_string_lossy().to_string(),
            manifest_json: manifest_json.clone(),
            updated_at: chrono::Utc::now().timestamp(),
        };
        self.db.save_download_state(&state)?;

        let old_manifest = load_previous_manifest(&install_dir).ok();
        let completed_chunks = self.db.list_completed_chunks(download_id)?;
        let completed_map: HashMap<(String, i32), String> = completed_chunks
            .into_iter()
            .map(|chunk| ((chunk.file_id, chunk.chunk_index), chunk.hash))
            .collect();

        let method_key = requested_method_text(requested_method);
        let mut plan = build_download_plan(
            &manifest,
            &install_dir,
            &completed_map,
            old_manifest.as_ref(),
        )?;
        if method_allows_peer_assist(&method_key) {
            if let Some(coordination) = self.peer_coordinator.as_ref() {
                let peers = coordination.peers_for_game(game_id).await;
                if !peers.is_empty() {
                    apply_peer_sources(&mut plan, &peers);
                    tracing::info!(
                        "p2p peer assist enabled slug={} peers={} chunks={} method={}",
                        slug,
                        peers.len(),
                        plan.chunks.len(),
                        method_key
                    );
                }
            }
        } else {
            tracing::info!(
                "p2p peer assist skipped for slug={} method={}",
                slug,
                method_key
            );
        }

        let preflight_scan =
            scan_manifest_integrity(&install_dir, &manifest.files, IntegrityScanMode::Preflight)
                .await?;
        tracing::info!(
            "preflight scan slug={} total={} ok={} missing={} corrupt={} error={} hashed={} elapsed_ms={}",
            slug,
            preflight_scan.total_files,
            preflight_scan.verified_files,
            preflight_scan.missing_files,
            preflight_scan.corrupt_files,
            preflight_scan.error_files,
            preflight_scan.hashed_files,
            preflight_scan.elapsed_ms
        );

        for chunk in &plan.precompleted_chunks {
            let mut entry = chunk.clone();
            entry.download_id = download_id.to_string();
            self.db.upsert_download_chunk(&entry)?;
        }

        let cache_write_bytes = estimate_cache_write_bytes(&self.depot_cache, &plan.chunks);
        let storage = evaluate_storage_budget(
            &install_dir,
            &manifest,
            &plan,
            old_manifest.as_ref(),
            cache_write_bytes,
        )?;
        let available_after_cleanup = storage
            .available_bytes
            .saturating_add(storage.reclaimable_bytes);
        if available_after_cleanup < storage.required_bytes {
            self.db.update_download_status(download_id, "failed")?;
            return Err(LauncherError::Config(format!(
                "Insufficient disk space at {}. Need at least {} free (pre-allocate {} + extraction {} + depotcache {} + safety {}), available {} ({} free + {} reclaimable).",
                install_dir.display(),
                format_bytes(storage.required_bytes),
                format_bytes(storage.preallocate_bytes),
                format_bytes(storage.extraction_bytes),
                format_bytes(storage.cache_write_bytes),
                format_bytes(storage.safety_bytes),
                format_bytes(available_after_cleanup),
                format_bytes(storage.available_bytes),
                format_bytes(storage.reclaimable_bytes),
            )));
        }

        delete_files(&plan.delete_files).await;
        prepare_files(&plan.files_to_finalize).await?;
        let hydrated_bytes =
            hydrate_from_depot_cache(&mut plan, &self.depot_cache, &self.db, download_id).await?;
        if hydrated_bytes > 0 {
            tracing::info!(
                "reused {} from depotcache for slug={}",
                format_bytes(hydrated_bytes),
                slug
            );
        }

        let tracker = ProgressTracker::new(plan.total_bytes, plan.preexisting_bytes);
        let mut reporter = ProgressReporter::new(plan.preexisting_bytes);
        let requested_method_text = method_key;
        let effective_concurrency =
            resolve_method_concurrency(&requested_method_text, self.max_concurrent_chunks);
        let mut engine = resolve_download_engine(requested_method);
        let mut aria2_config = None;
        if engine == DownloadEngine::Aria2c {
            let config = resolve_aria2_config(effective_concurrency);
            match ensure_aria2_available(&config) {
                Ok(_) => aria2_config = Some(config),
                Err(err) => {
                    if env_truthy("LAUNCHER_ARIA2C_STRICT") {
                        return Err(err);
                    }
                    tracing::warn!("aria2c unavailable, fallback to reqwest: {}", err);
                    engine = DownloadEngine::Reqwest;
                }
            }
        }
        tracing::info!(
            "download engine={} slug={} method={} concurrency={}",
            if engine == DownloadEngine::Aria2c {
                "aria2c"
            } else {
                "reqwest"
            },
            slug,
            requested_method_text,
            effective_concurrency
        );

        let (tx, mut rx) = mpsc::channel::<ChunkResult>(256);
        let semaphore = Arc::new(Semaphore::new(effective_concurrency));
        let governor = AdaptiveConcurrencyGovernor::new(
            &requested_method_text,
            semaphore.clone(),
            effective_concurrency,
        );
        let session_peer_blacklist = Arc::new(Mutex::new(HashSet::<String>::new()));

        for job in plan.chunks {
            let tx = tx.clone();
            let client = self.client.clone();
            let mut control = control_rx.clone();
            let semaphore = semaphore.clone();
            let throttle = self.throttle.clone();
            let aria2_config = aria2_config.clone();
            let depot_cache = self.depot_cache.clone();
            let peer_blacklist = session_peer_blacklist.clone();

            tokio::spawn(async move {
                let _permit = semaphore.acquire().await.ok();
                if let Err(err) = wait_for_running(&mut control).await {
                    let _ = tx.send(ChunkResult::Error { error: err }).await;
                    return;
                }

                match download_chunk(
                    &client,
                    &job,
                    engine,
                    aria2_config.as_ref(),
                    &tx,
                    &mut control,
                    &peer_blacklist,
                )
                .await
                {
                    Ok(payload) => {
                        let data = payload.data;
                        throttle.acquire(data.len() as u64).await;
                        if let Err(err) = write_chunk(&job, &data).await {
                            let _ = tx.send(ChunkResult::Error { error: err }).await;
                            return;
                        }
                        if let Err(err) = depot_cache.store_chunk(&job.hash, &data) {
                            tracing::warn!(
                                "failed to store depotcache chunk {}: {}",
                                job.hash,
                                err
                            );
                        }
                        let _ = tx
                            .send(ChunkResult::Success {
                                file_id: job.file_id.clone(),
                                chunk_index: job.index,
                                size: job.size,
                                hash: job.hash.clone(),
                                accounted_bytes: payload.accounted_bytes,
                            })
                            .await;
                    }
                    Err(err) => {
                        let _ = tx.send(ChunkResult::Error { error: err }).await;
                    }
                }
            });
        }

        drop(tx);

        while let Some(result) = rx.recv().await {
            match result {
                ChunkResult::Progress { bytes } => {
                    if bytes == 0 {
                        continue;
                    }
                    governor.maybe_relax().await;
                    tracker.add_bytes(bytes).await;
                    let (progress, speed, eta, downloaded, total) = tracker.snapshot().await;
                    reporter
                        .maybe_report(
                            &self.db,
                            &self.downloads_api,
                            download_id,
                            game_id,
                            progress,
                            speed,
                            eta,
                            downloaded,
                            total,
                        )
                        .await?;
                }
                ChunkResult::Success {
                    file_id,
                    chunk_index,
                    size,
                    hash,
                    accounted_bytes,
                } => {
                    governor.maybe_relax().await;
                    let remaining = size.saturating_sub(accounted_bytes);
                    if remaining > 0 {
                        tracker.add_bytes(remaining).await;
                    }
                    self.db.upsert_download_chunk(&DownloadChunk {
                        download_id: download_id.to_string(),
                        file_id,
                        chunk_index: chunk_index as i32,
                        hash,
                        size: size as i64,
                        status: "completed".to_string(),
                        updated_at: chrono::Utc::now().timestamp(),
                    })?;

                    let (progress, speed, eta, downloaded, total) = tracker.snapshot().await;
                    reporter
                        .maybe_report(
                            &self.db,
                            &self.downloads_api,
                            download_id,
                            game_id,
                            progress,
                            speed,
                            eta,
                            downloaded,
                            total,
                        )
                        .await?;
                }
                ChunkResult::NetworkPressure { source, reason } => {
                    governor.on_network_pressure(source, reason).await;
                }
                ChunkResult::Error { error } => {
                    self.db.update_download_status(download_id, "failed")?;
                    return Err(error);
                }
            }
        }

        finalize_files(&plan.files_to_finalize).await?;
        self.db.update_download_status(download_id, "verifying")?;
        let _ = self
            .downloads_api
            .update_status(download_id, "verifying")
            .await;
        let post_scan = scan_manifest_integrity(
            &install_dir,
            &manifest.files,
            IntegrityScanMode::PostDownload,
        )
        .await?;
        tracing::info!(
            "post-download scan slug={} total={} ok={} missing={} corrupt={} error={} hashed={} elapsed_ms={}",
            slug,
            post_scan.total_files,
            post_scan.verified_files,
            post_scan.missing_files,
            post_scan.corrupt_files,
            post_scan.error_files,
            post_scan.hashed_files,
            post_scan.elapsed_ms
        );
        if post_scan.missing_files > 0 || post_scan.corrupt_files > 0 || post_scan.error_files > 0 {
            let details = if post_scan.first_failures.is_empty() {
                "no file details".to_string()
            } else {
                post_scan.first_failures.join(", ")
            };
            self.db.update_download_status(download_id, "failed")?;
            return Err(LauncherError::Config(format!(
                "post-download verification failed (missing={}, corrupt={}, error={}): {}",
                post_scan.missing_files, post_scan.corrupt_files, post_scan.error_files, details
            )));
        }
        if is_archive_mode(&manifest) {
            extract_archives(&install_dir, &manifest, old_manifest.as_ref()).await?;
        }
        write_manifest(&install_dir, &manifest_json).await?;
        self.db.update_download_status(download_id, "completed")?;
        self.db.upsert_download(&LocalDownload {
            id: download_id.to_string(),
            game_id: game_id.to_string(),
            status: "completed".to_string(),
            progress: 100,
            speed_mbps: 0.0,
            eta_minutes: 0,
            downloaded_bytes: manifest.total_size as i64,
            total_bytes: manifest.total_size as i64,
            network_bps: 0,
            disk_read_bps: 0,
            disk_write_bps: 0,
            read_bytes: manifest.total_size as i64,
            written_bytes: manifest.total_size as i64,
            remaining_bytes: 0,
            speed_history: Vec::new(),
            updated_at: chrono::Utc::now().timestamp(),
        })?;

        let _ = self
            .downloads_api
            .update_progress(
                download_id,
                &DownloadProgressUpdate {
                    progress: 100,
                    downloaded_bytes: Some(manifest.total_size as i64),
                    total_bytes: Some(manifest.total_size as i64),
                    network_bps: Some(0),
                    disk_read_bps: Some(0),
                    disk_write_bps: Some(0),
                    read_bytes: Some(manifest.total_size as i64),
                    written_bytes: Some(manifest.total_size as i64),
                    remaining_bytes: Some(0),
                    speed_mbps: Some(0.0),
                    eta_minutes: Some(0),
                },
            )
            .await;

        Ok(())
    }
}

struct ProgressReporter {
    last_sent: Instant,
    last_progress: i32,
    last_downloaded: u64,
    speed_history: Vec<f64>,
}

impl ProgressReporter {
    fn new(initial_downloaded: u64) -> Self {
        Self {
            last_sent: Instant::now() - Duration::from_secs(5),
            last_progress: -1,
            last_downloaded: initial_downloaded,
            speed_history: Vec::new(),
        }
    }

    async fn maybe_report(
        &mut self,
        db: &Database,
        downloads_api: &DownloadService,
        download_id: &str,
        game_id: &str,
        progress: f64,
        average_speed_bps: u64,
        eta_seconds: u64,
        downloaded_bytes: u64,
        total_bytes: u64,
    ) -> Result<()> {
        let progress_int = if progress > 0.0 && progress < 1.0 {
            1
        } else {
            progress.round().clamp(0.0, 100.0) as i32
        };
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_sent).as_secs_f64().max(0.001);
        let delta_downloaded = downloaded_bytes.saturating_sub(self.last_downloaded);
        let instant_speed_bps = ((delta_downloaded as f64) / elapsed) as u64;
        let effective_speed_bps = if instant_speed_bps > 0 {
            instant_speed_bps
        } else {
            average_speed_bps
        };

        self.speed_history
            .push((effective_speed_bps as f64) / (1024.0 * 1024.0));
        if self.speed_history.len() > 48 {
            let drop_count = self.speed_history.len().saturating_sub(48);
            self.speed_history.drain(0..drop_count);
        }

        if progress_int != self.last_progress
            || now.duration_since(self.last_sent) > Duration::from_millis(500)
        {
            let remaining_bytes = total_bytes.saturating_sub(downloaded_bytes);
            let entry = LocalDownload {
                id: download_id.to_string(),
                game_id: game_id.to_string(),
                status: if progress_int >= 100 {
                    "completed".to_string()
                } else {
                    "downloading".to_string()
                },
                progress: progress_int,
                speed_mbps: (effective_speed_bps as f64) / (1024.0 * 1024.0),
                eta_minutes: (eta_seconds / 60) as i32,
                downloaded_bytes: downloaded_bytes as i64,
                total_bytes: total_bytes as i64,
                network_bps: effective_speed_bps as i64,
                disk_read_bps: 0,
                disk_write_bps: effective_speed_bps as i64,
                read_bytes: downloaded_bytes as i64,
                written_bytes: downloaded_bytes as i64,
                remaining_bytes: remaining_bytes as i64,
                speed_history: self.speed_history.clone(),
                updated_at: chrono::Utc::now().timestamp(),
            };
            db.upsert_download(&entry)?;
            let _ = downloads_api
                .update_progress(
                    download_id,
                    &DownloadProgressUpdate {
                        progress: progress_int,
                        downloaded_bytes: Some(downloaded_bytes as i64),
                        total_bytes: Some(total_bytes as i64),
                        network_bps: Some(effective_speed_bps as i64),
                        disk_read_bps: Some(0),
                        disk_write_bps: Some(effective_speed_bps as i64),
                        read_bytes: Some(downloaded_bytes as i64),
                        written_bytes: Some(downloaded_bytes as i64),
                        remaining_bytes: Some(remaining_bytes as i64),
                        speed_mbps: Some((effective_speed_bps as f64) / (1024.0 * 1024.0)),
                        eta_minutes: Some((eta_seconds / 60) as i32),
                    },
                )
                .await;
            self.last_progress = progress_int;
            self.last_sent = now;
            self.last_downloaded = downloaded_bytes;
        }

        Ok(())
    }
}

fn env_truthy(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(false)
}

fn env_usize(key: &str) -> Option<usize> {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
}

fn normalize_download_method(requested_method: Option<&str>) -> String {
    let normalized = requested_method
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_string());
    match normalized.as_str() {
        "aria2c" => "max_speed".to_string(),
        "cdn_direct" => "cdn".to_string(),
        "hf_chunks" => "balance".to_string(),
        _ => normalized,
    }
}

fn method_allows_peer_assist(method_key: &str) -> bool {
    !method_key.eq_ignore_ascii_case("cdn")
}

fn resolve_method_concurrency(method_key: &str, max_concurrent_chunks: usize) -> usize {
    let base = max_concurrent_chunks.clamp(1, MAX_CONCURRENT_CHUNKS);
    match method_key.trim().to_ascii_lowercase().as_str() {
        // Auto is recommended and still max-speed by default.
        "auto" => (base.saturating_mul(2)).clamp(16, MAX_CONCURRENT_CHUNKS),
        "max_speed" => (base.saturating_mul(2).saturating_add(8)).clamp(20, MAX_CONCURRENT_CHUNKS),
        "balance" => base.clamp(12, 40),
        "cdn" => (base / 2).clamp(6, 20),
        _ => base,
    }
}

fn resolve_download_engine(requested_method: Option<&str>) -> DownloadEngine {
    let method_key = normalize_download_method(requested_method);
    if method_key.eq_ignore_ascii_case("auto") || method_key.eq_ignore_ascii_case("max_speed") {
        return DownloadEngine::Aria2c;
    }

    let env_engine = std::env::var("LAUNCHER_DOWNLOAD_ENGINE")
        .ok()
        .unwrap_or_else(|| "reqwest".to_string());
    if env_engine.trim().eq_ignore_ascii_case("aria2c") {
        return DownloadEngine::Aria2c;
    }
    DownloadEngine::Reqwest
}

fn requested_method_text(requested_method: Option<&str>) -> String {
    normalize_download_method(requested_method)
}

fn resolve_aria2_config(max_concurrent_chunks: usize) -> Aria2Config {
    let split_default = max_concurrent_chunks.clamp(8, 32);
    let split = env_usize("LAUNCHER_ARIA2C_SPLIT")
        .unwrap_or(split_default)
        .clamp(1, 64);
    let max_connections_per_server = env_usize("LAUNCHER_ARIA2C_MAX_CONN_PER_SERVER")
        .unwrap_or(split)
        .clamp(1, 16);
    let max_tries = env_usize("LAUNCHER_ARIA2C_MAX_TRIES")
        .unwrap_or(5)
        .clamp(1, 30);
    let retry_wait_seconds = env_usize("LAUNCHER_ARIA2C_RETRY_WAIT")
        .unwrap_or(2)
        .clamp(0, 120);
    let timeout_seconds = env_usize("LAUNCHER_ARIA2C_TIMEOUT")
        .unwrap_or(300)
        .clamp(10, 1800);
    let connect_timeout_seconds = env_usize("LAUNCHER_ARIA2C_CONNECT_TIMEOUT")
        .unwrap_or(15)
        .clamp(3, 120);

    let binary = std::env::var("LAUNCHER_ARIA2C_PATH")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "aria2c".to_string());

    let proxy = std::env::var("LAUNCHER_PROXY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    Aria2Config {
        binary,
        split,
        max_connections_per_server,
        max_tries,
        retry_wait_seconds,
        timeout_seconds,
        connect_timeout_seconds,
        proxy,
    }
}

fn ensure_aria2_available(config: &Aria2Config) -> Result<()> {
    let mut command = std::process::Command::new(&config.binary);
    hide_console_window(&mut command);
    let output = command.arg("--version").output();
    match output {
        Ok(result) if result.status.success() => Ok(()),
        Ok(result) => Err(LauncherError::Config(format!(
            "aria2c is not ready (exit {}). Check LAUNCHER_ARIA2C_PATH.",
            result.status
        ))),
        Err(err) => Err(LauncherError::Config(format!(
            "aria2c not found: {} (binary: {})",
            err, config.binary
        ))),
    }
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    const TB: f64 = GB * 1024.0;

    let value = bytes as f64;
    if value >= TB {
        format!("{:.2} TB", value / TB)
    } else if value >= GB {
        format!("{:.2} GB", value / GB)
    } else if value >= MB {
        format!("{:.0} MB", value / MB)
    } else if value >= KB {
        format!("{:.0} KB", value / KB)
    } else {
        format!("{} B", bytes)
    }
}

fn nearest_existing_path(path: &Path) -> PathBuf {
    let mut candidate = path.to_path_buf();
    while !candidate.exists() {
        if !candidate.pop() {
            return PathBuf::from(".");
        }
    }
    candidate
}

fn available_disk_space(path: &Path) -> Option<u64> {
    let target = nearest_existing_path(path);
    let target = std::fs::canonicalize(&target).unwrap_or(target);
    let disks = Disks::new_with_refreshed_list();

    let mut best: Option<(usize, u64)> = None;
    for disk in disks.list() {
        let mount = disk.mount_point();
        if target.starts_with(mount) {
            let score = mount.as_os_str().to_string_lossy().len();
            match best {
                Some((best_score, _)) if best_score >= score => {}
                _ => best = Some((score, disk.available_space())),
            }
        }
    }

    best.map(|(_, available)| available)
        .or_else(|| disks.list().first().map(|disk| disk.available_space()))
}

fn estimate_reclaimable_bytes(paths: &[PathBuf]) -> u64 {
    paths
        .iter()
        .filter_map(|path| std::fs::metadata(path).ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum()
}

fn estimate_preallocate_bytes(plan: &DownloadPlan) -> u64 {
    plan.files_to_finalize
        .iter()
        .map(|file| {
            let existing = std::fs::metadata(&file.temp_path)
                .ok()
                .map(|meta| meta.len())
                .unwrap_or(0);
            file.size.saturating_sub(existing)
        })
        .sum()
}

fn estimate_cache_write_bytes(depot_cache: &DepotCache, jobs: &[ChunkJob]) -> u64 {
    let mut unique_hashes = HashSet::new();
    let mut total = 0u64;
    for job in jobs {
        let Some(normalized) = sanitize_hash(&job.hash) else {
            continue;
        };
        if !unique_hashes.insert(normalized) {
            continue;
        }
        if !depot_cache.has_candidate(&job.hash, job.size) {
            total = total.saturating_add(job.size);
        }
    }
    total
}

fn estimate_extraction_bytes(manifest: &Manifest, old_manifest: Option<&Manifest>) -> u64 {
    if !is_archive_mode(manifest) {
        return 0;
    }

    let archive_dir = archive_dir_name(manifest).replace("\\", "/");
    let mut old_hashes = HashMap::new();
    if let Some(old_manifest) = old_manifest {
        for file in &old_manifest.files {
            old_hashes.insert(file.path.replace("\\", "/"), file.hash.clone());
        }
    }

    let mut total_archive_bytes = 0u64;
    let mut changed_archive_bytes = 0u64;
    for file in &manifest.files {
        let normalized = file.path.replace("\\", "/");
        if !normalized.starts_with(&archive_dir)
            || !normalized.to_ascii_lowercase().ends_with(".zip")
        {
            continue;
        }
        total_archive_bytes = total_archive_bytes.saturating_add(file.size);
        let changed = old_hashes
            .get(&normalized)
            .map(|old_hash| old_hash != &file.hash)
            .unwrap_or(true);
        if changed {
            changed_archive_bytes = changed_archive_bytes.saturating_add(file.size);
        }
    }

    if changed_archive_bytes == 0 {
        return 0;
    }

    let total_extracted_bytes = manifest
        .total_original_size
        .unwrap_or(manifest.total_size)
        .max(changed_archive_bytes);

    if total_archive_bytes == 0 {
        return total_extracted_bytes;
    }

    if total_extracted_bytes <= total_archive_bytes {
        return changed_archive_bytes.max(total_extracted_bytes);
    }

    ((u128::from(total_extracted_bytes) * u128::from(changed_archive_bytes))
        / u128::from(total_archive_bytes)) as u64
}

fn evaluate_storage_budget(
    install_dir: &Path,
    manifest: &Manifest,
    plan: &DownloadPlan,
    old_manifest: Option<&Manifest>,
    cache_write_bytes: u64,
) -> Result<StorageBudget> {
    let available_bytes = available_disk_space(install_dir).ok_or_else(|| {
        LauncherError::Config(format!(
            "Cannot determine free space for {}",
            install_dir.display()
        ))
    })?;
    let reclaimable_bytes = estimate_reclaimable_bytes(&plan.delete_files);
    let preallocate_bytes = estimate_preallocate_bytes(plan);
    let extraction_bytes = estimate_extraction_bytes(manifest, old_manifest);
    let base_required = preallocate_bytes
        .saturating_add(extraction_bytes)
        .saturating_add(cache_write_bytes);
    let safety_bytes = STORAGE_SAFETY_MARGIN_BYTES
        .max(base_required / 20)
        .min(MAX_STORAGE_SAFETY_MARGIN_BYTES);
    let required_bytes = base_required.saturating_add(safety_bytes);

    Ok(StorageBudget {
        available_bytes,
        reclaimable_bytes,
        preallocate_bytes,
        extraction_bytes,
        cache_write_bytes,
        safety_bytes,
        required_bytes,
    })
}

async fn hydrate_from_depot_cache(
    plan: &mut DownloadPlan,
    depot_cache: &DepotCache,
    db: &Database,
    download_id: &str,
) -> Result<u64> {
    let mut pending = Vec::with_capacity(plan.chunks.len());
    let mut restored = 0u64;

    for job in plan.chunks.drain(..) {
        let cached = depot_cache.load_valid_chunk(&job.hash, job.size)?;
        if let Some(data) = cached {
            write_chunk(&job, &data).await?;
            restored = restored.saturating_add(job.size);
            db.upsert_download_chunk(&DownloadChunk {
                download_id: download_id.to_string(),
                file_id: job.file_id.clone(),
                chunk_index: job.index as i32,
                hash: job.hash.clone(),
                size: job.size as i64,
                status: "completed".to_string(),
                updated_at: chrono::Utc::now().timestamp(),
            })?;
        } else {
            pending.push(job);
        }
    }

    plan.chunks = pending;
    plan.preexisting_bytes = plan.preexisting_bytes.saturating_add(restored);
    Ok(restored)
}

enum ChunkResult {
    Progress {
        bytes: u64,
    },
    NetworkPressure {
        source: &'static str,
        reason: &'static str,
    },
    Success {
        file_id: String,
        chunk_index: u64,
        size: u64,
        hash: String,
        accounted_bytes: u64,
    },
    Error {
        error: LauncherError,
    },
}

struct DownloadChunkPayload {
    data: Vec<u8>,
    accounted_bytes: u64,
}

async fn wait_for_running(control: &mut watch::Receiver<DownloadControl>) -> Result<()> {
    loop {
        let state = *control.borrow();
        match state {
            DownloadControl::Running => return Ok(()),
            DownloadControl::Paused => {
                control
                    .changed()
                    .await
                    .map_err(|_| LauncherError::Config("download control closed".to_string()))?;
            }
            DownloadControl::Cancelled => {
                return Err(LauncherError::Config("download cancelled".to_string()))
            }
        }
    }
}

async fn download_chunk(
    client: &reqwest::Client,
    job: &ChunkJob,
    engine: DownloadEngine,
    aria2_config: Option<&Aria2Config>,
    progress_tx: &mpsc::Sender<ChunkResult>,
    control: &mut watch::Receiver<DownloadControl>,
    peer_blacklist: &Arc<Mutex<HashSet<String>>>,
) -> Result<DownloadChunkPayload> {
    wait_for_running(control).await?;
    if engine == DownloadEngine::Aria2c {
        if let Some(config) = aria2_config {
            match download_chunk_with_aria2(job, config).await {
                Ok(mut data) => {
                    decompress_if_needed(job, &mut data)?;
                    if !verify_chunk(&data, &job.hash) {
                        return Err(LauncherError::Config("chunk hash mismatch".to_string()));
                    }
                    return Ok(DownloadChunkPayload {
                        data,
                        accounted_bytes: 0,
                    });
                }
                Err(err) => {
                    if env_truthy("LAUNCHER_ARIA2C_STRICT") {
                        return Err(err);
                    }
                    tracing::warn!(
                        "aria2 chunk failed for file={} chunk={}, fallback to reqwest: {}",
                        job.file_id,
                        job.index,
                        err
                    );
                }
            }
        } else if env_truthy("LAUNCHER_ARIA2C_STRICT") {
            return Err(LauncherError::Config("aria2c config missing".to_string()));
        } else {
            tracing::warn!(
                "aria2 engine selected but config missing for file={} chunk={}, fallback to reqwest",
                job.file_id,
                job.index
            );
        }
    }

    let mut urls = Vec::new();
    urls.push(job.url.clone());
    urls.extend(job.fallback_urls.clone());
    let mut failures: Vec<String> = Vec::new();

    for url in urls {
        let peer_key = peer_url_fingerprint(&url);
        if let Some(key) = peer_key.as_ref() {
            let is_blocked = peer_blacklist
                .lock()
                .map(|locked| locked.contains(key))
                .unwrap_or(false);
            if is_blocked {
                failures.push(format!("{} -> skipped blacklisted peer", url));
                continue;
            }
        }

        let (max_attempts, retry_wait_ms, timeout_ms) =
            resolve_http_retry_policy(peer_key.is_some());
        let mut last_failure: Option<String> = None;
        for attempt in 1..=max_attempts {
            let response = client
                .get(&url)
                .timeout(Duration::from_millis(timeout_ms))
                .send()
                .await;
            match response {
                Ok(resp) => {
                    if resp.status().is_success() {
                        let mut stream = resp.bytes_stream();
                        let mut data = Vec::with_capacity(job.size.min(16 * 1024 * 1024) as usize);
                        let mut accounted = 0u64;

                        loop {
                            tokio::select! {
                                changed = control.changed() => {
                                    changed.map_err(|_| LauncherError::Config("download control closed".to_string()))?;
                                    let control_state = *control.borrow();
                                    match control_state {
                                        DownloadControl::Running => {}
                                        DownloadControl::Paused => {
                                            wait_for_running(control).await?;
                                        }
                                        DownloadControl::Cancelled => {
                                            return Err(LauncherError::Config("download cancelled".to_string()));
                                        }
                                    }
                                }
                                next = stream.next() => {
                                    let Some(next) = next else { break; };
                                    wait_for_running(control).await?;
                                    let bytes = next?;
                                    data.extend_from_slice(&bytes);

                                    let room = job.size.saturating_sub(accounted);
                                    if room == 0 {
                                        continue;
                                    }
                                    let delta = (bytes.len() as u64).min(room);
                                    accounted = accounted.saturating_add(delta);
                                }
                            }
                        }

                        if let Err(err) = decompress_if_needed(job, &mut data) {
                            if let Some(key) = peer_key.as_ref() {
                                if let Ok(mut locked) = peer_blacklist.lock() {
                                    locked.insert(key.clone());
                                }
                            }
                            last_failure = Some(format!("{} -> decompress failed ({})", url, err));
                            break;
                        }

                        if !verify_chunk(&data, &job.hash) {
                            if let Some(key) = peer_key.as_ref() {
                                if let Ok(mut locked) = peer_blacklist.lock() {
                                    locked.insert(key.clone());
                                }
                            }
                            last_failure = Some(format!(
                                "{} -> hash mismatch [attempt {}/{}]",
                                url, attempt, max_attempts
                            ));
                            break;
                        }

                        if accounted > 0 {
                            let _ = progress_tx
                                .send(ChunkResult::Progress { bytes: accounted })
                                .await;
                        }
                        return Ok(DownloadChunkPayload {
                            data,
                            accounted_bytes: accounted,
                        });
                    }
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    let snippet = trim_text_snippet(&body);
                    let failure = if snippet.is_empty() {
                        format!("{} -> HTTP {}", url, status)
                    } else {
                        format!("{} -> HTTP {} ({})", url, status, snippet)
                    };
                    last_failure = Some(format!(
                        "{} [attempt {}/{}]",
                        failure, attempt, max_attempts
                    ));
                    let retryable = status.is_server_error()
                        || status == reqwest::StatusCode::REQUEST_TIMEOUT
                        || status == reqwest::StatusCode::TOO_MANY_REQUESTS;
                    if retryable && attempt < max_attempts {
                        let source = if peer_key.is_some() { "peer" } else { "cdn" };
                        let reason = if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                            "rate_limited"
                        } else if status == reqwest::StatusCode::REQUEST_TIMEOUT {
                            "http_timeout"
                        } else {
                            "http_retryable"
                        };
                        let _ = progress_tx
                            .send(ChunkResult::NetworkPressure { source, reason })
                            .await;
                        sleep(Duration::from_millis(retry_wait_ms * attempt as u64)).await;
                        continue;
                    }
                    break;
                }
                Err(err) => {
                    last_failure = Some(format!(
                        "{} -> {} [attempt {}/{}]",
                        url, err, attempt, max_attempts
                    ));
                    let retryable = err.is_timeout() || err.is_connect();
                    if retryable && attempt < max_attempts {
                        let source = if peer_key.is_some() { "peer" } else { "cdn" };
                        let reason = if err.is_timeout() {
                            "socket_timeout"
                        } else {
                            "socket_connect"
                        };
                        let _ = progress_tx
                            .send(ChunkResult::NetworkPressure { source, reason })
                            .await;
                        sleep(Duration::from_millis(retry_wait_ms * attempt as u64)).await;
                        continue;
                    }
                    break;
                }
            }
        }
        if let Some(failure) = last_failure {
            failures.push(failure);
        }
    }

    if failures.is_empty() {
        return Err(LauncherError::Http("all endpoints failed".to_string()));
    }
    Err(LauncherError::Http(format!(
        "all endpoints failed: {}",
        failures.join(" | ")
    )))
}

fn trim_output_snippet(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(300)
        .collect::<String>()
        .trim()
        .to_string()
}

fn trim_text_snippet(value: &str) -> String {
    value
        .chars()
        .take(200)
        .collect::<String>()
        .trim()
        .to_string()
}

fn resolve_http_retry_policy(is_peer: bool) -> (usize, u64, u64) {
    if is_peer {
        let attempts = env_usize("LAUNCHER_P2P_CHUNK_MAX_ATTEMPTS")
            .unwrap_or(2)
            .clamp(1, 4);
        let retry_wait_ms = env_usize("LAUNCHER_P2P_CHUNK_RETRY_WAIT_MS")
            .unwrap_or(250)
            .clamp(0, 3000) as u64;
        let timeout_ms = env_usize("LAUNCHER_P2P_CHUNK_TIMEOUT_MS")
            .unwrap_or(1200)
            .clamp(300, 20000) as u64;
        return (attempts, retry_wait_ms, timeout_ms);
    }

    let attempts = env_usize("LAUNCHER_HTTP_CHUNK_MAX_ATTEMPTS")
        .unwrap_or(6)
        .clamp(1, 8);
    let retry_wait_ms = env_usize("LAUNCHER_HTTP_CHUNK_RETRY_WAIT_MS")
        .unwrap_or(900)
        .clamp(0, 30000) as u64;
    let timeout_ms = env_usize("LAUNCHER_HTTP_CHUNK_TIMEOUT_MS")
        .unwrap_or(60000)
        .clamp(1000, 600000) as u64;
    (attempts, retry_wait_ms, timeout_ms)
}

fn sanitize_filename_token(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect()
}

fn aria2_temp_paths(job: &ChunkJob) -> Result<(PathBuf, String)> {
    let parent = job
        .temp_path
        .parent()
        .ok_or_else(|| LauncherError::Config("invalid chunk temp path".to_string()))?;
    let scratch_dir = parent.join(".aria2");
    std::fs::create_dir_all(&scratch_dir)?;

    let stem = job
        .temp_path
        .file_stem()
        .map(|v| v.to_string_lossy().to_string())
        .unwrap_or_else(|| "chunk".to_string());
    let safe_file_id = sanitize_filename_token(&job.file_id);
    let filename = format!("{}-{}-{}.part", stem, safe_file_id, job.index);
    let path = scratch_dir.join(&filename);
    Ok((path, filename))
}

async fn download_chunk_with_aria2(job: &ChunkJob, config: &Aria2Config) -> Result<Vec<u8>> {
    let (scratch_path, scratch_name) = aria2_temp_paths(job)?;
    let control_path = scratch_path.with_extension("part.aria2");

    let mut urls = Vec::new();
    urls.push(job.url.clone());
    urls.extend(job.fallback_urls.clone());

    let binary = config.binary.clone();
    let split = config.split;
    let max_connections_per_server = config.max_connections_per_server;
    let max_tries = config.max_tries;
    let retry_wait_seconds = config.retry_wait_seconds;
    let timeout_seconds = config.timeout_seconds;
    let connect_timeout_seconds = config.connect_timeout_seconds;
    let proxy = config.proxy.clone();

    let scratch_dir = scratch_path
        .parent()
        .ok_or_else(|| LauncherError::Config("aria2 scratch dir unavailable".to_string()))?
        .to_path_buf();
    let scratch_name_for_cmd = scratch_name.clone();

    let data = tokio::task::spawn_blocking(move || -> Result<Vec<u8>> {
        let mut command = std::process::Command::new(&binary);
        hide_console_window(&mut command);
        command
            .arg("--allow-overwrite=true")
            .arg("--auto-file-renaming=false")
            .arg("--summary-interval=0")
            .arg("--console-log-level=warn")
            .arg("--file-allocation=none")
            .arg("--continue=true")
            .arg("--always-resume=true")
            .arg(format!("--split={split}"))
            .arg(format!(
                "--max-connection-per-server={max_connections_per_server}"
            ))
            .arg(format!("--max-tries={max_tries}"))
            .arg(format!("--retry-wait={retry_wait_seconds}"))
            .arg(format!("--timeout={timeout_seconds}"))
            .arg(format!("--connect-timeout={connect_timeout_seconds}"))
            .arg("--min-split-size=1M")
            .arg("--dir")
            .arg(&scratch_dir)
            .arg("--out")
            .arg(&scratch_name_for_cmd);

        if let Some(proxy) = proxy {
            command.arg(format!("--all-proxy={proxy}"));
        }
        if env_truthy("LAUNCHER_DISABLE_SYSTEM_PROXY") {
            command.arg("--all-proxy=");
        }

        for url in urls {
            command.arg(url);
        }

        let output = command.output()?;
        if !output.status.success() {
            let stderr = trim_output_snippet(&output.stderr);
            let stdout = trim_output_snippet(&output.stdout);
            let details = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "aria2c returned non-zero status".to_string()
            };
            return Err(LauncherError::Http(format!(
                "aria2c failed ({}): {}",
                output.status, details
            )));
        }

        let bytes = std::fs::read(&scratch_path)?;
        let _ = std::fs::remove_file(&scratch_path);
        let _ = std::fs::remove_file(&control_path);
        Ok(bytes)
    })
    .await
    .map_err(|err| LauncherError::Config(format!("aria2c worker failed: {err}")))??;

    Ok(data)
}

fn decompress_if_needed(job: &ChunkJob, data: &mut Vec<u8>) -> Result<()> {
    match job.compression.as_str() {
        "none" => Ok(()),
        "zstd" => {
            let decoded = zstd::stream::decode_all(&data[..])
                .map_err(|err| LauncherError::Config(err.to_string()))?;
            *data = decoded;
            Ok(())
        }
        other => Err(LauncherError::Config(format!(
            "unsupported compression: {}",
            other
        ))),
    }
}

fn verify_chunk(data: &[u8], expected_hash: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let hash = hasher.finalize();
    hex::encode(hash) == expected_hash
}

async fn write_chunk(job: &ChunkJob, data: &[u8]) -> Result<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(&job.temp_path)
        .await?;
    file.seek(std::io::SeekFrom::Start(job.offset)).await?;
    file.write_all(data).await?;
    file.flush().await?;
    Ok(())
}

fn chunk_region_exists(path: &Path, offset: u64, size: u64) -> bool {
    match std::fs::metadata(path) {
        Ok(metadata) => metadata.len() >= offset.saturating_add(size),
        Err(_) => false,
    }
}

fn build_download_plan(
    manifest: &Manifest,
    install_dir: &Path,
    completed: &HashMap<(String, i32), String>,
    old_manifest: Option<&Manifest>,
) -> Result<DownloadPlan> {
    let mut chunks = Vec::new();
    let mut total_bytes = 0u64;
    let mut preexisting = 0u64;
    let mut files_to_finalize = Vec::new();
    let mut delete_files = Vec::new();
    let mut precompleted_chunks = Vec::new();

    let chunk_size = if manifest.chunk_size > 0 {
        manifest.chunk_size
    } else {
        DEFAULT_CHUNK_SIZE
    };

    if is_archive_mode(manifest) {
        let archive_dir = archive_dir_name(manifest);
        let mut new_files = HashSet::new();
        for path in &manifest.archive_files {
            new_files.insert(path.replace("\\", "/"));
        }
        if let Some(old_manifest) = old_manifest {
            for old_path in &old_manifest.archive_files {
                let normalized = old_path.replace("\\", "/");
                if new_files.contains(&normalized) {
                    continue;
                }
                if normalized.is_empty() {
                    continue;
                }
                if normalized.starts_with(&archive_dir) {
                    continue;
                }
                if normalized.eq_ignore_ascii_case(MANIFEST_FILE) {
                    continue;
                }
                let candidate = Path::new(&normalized);
                if !is_safe_relative_path(candidate) {
                    continue;
                }
                delete_files.push(install_dir.join(candidate));
            }
        }
    }

    if let Some(old_manifest) = old_manifest {
        for old_file in &old_manifest.files {
            if !manifest.files.iter().any(|file| file.path == old_file.path) {
                delete_files.push(install_dir.join(&old_file.path));
            }
        }
    }

    for file in &manifest.files {
        let final_path = install_dir.join(&file.path);
        let temp_path = final_path.with_extension("part");
        let mut needs_finalize = false;

        for chunk in &file.chunks {
            total_bytes += chunk.size;
            let offset = chunk.index * chunk_size;

            let key = (file.file_id.clone(), chunk.index as i32);
            if let Some(hash) = completed.get(&key) {
                if hash == &chunk.hash && chunk_region_exists(&temp_path, offset, chunk.size) {
                    preexisting += chunk.size;
                    precompleted_chunks.push(DownloadChunk {
                        download_id: String::new(),
                        file_id: file.file_id.clone(),
                        chunk_index: chunk.index as i32,
                        hash: chunk.hash.clone(),
                        size: chunk.size as i64,
                        status: "completed".to_string(),
                        updated_at: chrono::Utc::now().timestamp(),
                    });
                    continue;
                }
            }

            needs_finalize = true;
            chunks.push(ChunkJob {
                file_id: file.file_id.clone(),
                temp_path: temp_path.clone(),
                index: chunk.index,
                offset,
                size: chunk.size,
                hash: chunk.hash.clone(),
                url: chunk.url.clone(),
                fallback_urls: chunk.fallback_urls.clone(),
                compression: chunk.compression.clone(),
            });
        }

        if needs_finalize {
            files_to_finalize.push(FilePlan {
                final_path,
                temp_path,
                size: file.size,
            });
        }
    }

    Ok(DownloadPlan {
        chunks,
        total_bytes,
        preexisting_bytes: preexisting,
        files_to_finalize,
        delete_files,
        precompleted_chunks,
    })
}

fn apply_peer_sources(plan: &mut DownloadPlan, peers: &[PeerCandidate]) {
    let fanout = env_usize("LAUNCHER_P2P_FANOUT").unwrap_or(3).clamp(1, 6);
    for job in &mut plan.chunks {
        let peer_urls = build_chunk_peer_urls(&job.hash, peers, fanout);
        if peer_urls.is_empty() {
            continue;
        }

        let mut merged = Vec::with_capacity(peer_urls.len() + 1 + job.fallback_urls.len());
        merged.extend(peer_urls);
        merged.push(job.url.clone());
        merged.extend(job.fallback_urls.clone());
        let merged = dedupe_url_list(merged);
        if merged.is_empty() {
            continue;
        }
        job.url = merged[0].clone();
        job.fallback_urls = merged.into_iter().skip(1).collect();
    }
}

fn dedupe_url_list(urls: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for raw in urls {
        let value = raw.trim().to_string();
        if value.is_empty() {
            continue;
        }
        let key = value.to_ascii_lowercase();
        if seen.insert(key) {
            out.push(value);
        }
    }
    out
}

async fn prepare_files(files: &[FilePlan]) -> Result<()> {
    for plan in files {
        if let Some(parent) = plan.temp_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(&plan.temp_path)
            .await?;
        let current_len = file.metadata().await.map(|meta| meta.len()).unwrap_or(0);
        if current_len != plan.size {
            file.set_len(plan.size).await?;
        }
    }
    Ok(())
}

async fn finalize_files(files: &[FilePlan]) -> Result<()> {
    for plan in files {
        if plan.temp_path.exists() {
            if plan.final_path.exists() {
                let _ = tokio::fs::remove_file(&plan.final_path).await;
            }
            tokio::fs::rename(&plan.temp_path, &plan.final_path).await?;
        }
    }
    Ok(())
}

async fn extract_archives(
    install_dir: &Path,
    manifest: &Manifest,
    old_manifest: Option<&Manifest>,
) -> Result<()> {
    let install_dir = install_dir.to_path_buf();
    let files = manifest.files.clone();
    let archive_dir = archive_dir_name(manifest);
    let cleanup = manifest.archive_cleanup;
    let mut old_hashes = HashMap::new();
    if let Some(old_manifest) = old_manifest {
        for file in &old_manifest.files {
            old_hashes.insert(file.path.clone(), file.hash.clone());
        }
    }

    tokio::task::spawn_blocking(move || -> Result<()> {
        for file in files {
            if !file.path.starts_with(&archive_dir) {
                continue;
            }
            if !file.path.to_lowercase().ends_with(".zip") {
                continue;
            }
            if let Some(old_hash) = old_hashes.get(&file.path) {
                if old_hash == &file.hash {
                    continue;
                }
            }
            let archive_path = install_dir.join(&file.path);
            if !archive_path.exists() {
                continue;
            }
            extract_zip_archive(&archive_path, &install_dir)?;
            if cleanup {
                let _ = std::fs::remove_file(&archive_path);
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| LauncherError::Config(err.to_string()))?
}

fn extract_zip_archive(archive_path: &Path, install_dir: &Path) -> Result<()> {
    let file = File::open(archive_path)?;
    let mut archive =
        ZipArchive::new(file).map_err(|err| LauncherError::Config(err.to_string()))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| LauncherError::Config(err.to_string()))?;
        let name = entry.name().replace("\\", "/");
        if name.is_empty() {
            continue;
        }
        let entry_path = Path::new(&name);
        if !is_safe_relative_path(entry_path) {
            continue;
        }
        let out_path = install_dir.join(entry_path);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut outfile = File::create(&out_path)?;
        io::copy(&mut entry, &mut outfile)?;
    }
    Ok(())
}

async fn delete_files(files: &[PathBuf]) {
    for path in files {
        let _ = tokio::fs::remove_file(path).await;
    }
}

fn load_previous_manifest(install_dir: &Path) -> Result<Manifest> {
    let manifest_path = install_dir.join(MANIFEST_FILE);
    let data = std::fs::read_to_string(manifest_path)?;
    let manifest = serde_json::from_str(&data)?;
    Ok(manifest)
}

async fn write_manifest(install_dir: &Path, payload: &str) -> Result<()> {
    let path = install_dir.join(MANIFEST_FILE);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let temp_path = path.with_extension("tmp");
    tokio::fs::write(&temp_path, payload).await?;
    tokio::fs::rename(temp_path, path).await?;
    Ok(())
}
