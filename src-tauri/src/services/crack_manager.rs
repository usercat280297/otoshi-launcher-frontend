use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::watch;
use zip::ZipArchive;

use crate::db::queries::GameQueries;
use crate::db::Database;
use crate::errors::{LauncherError, Result};
use crate::services::ApiClient;

const BACKUP_DIR_NAME: &str = ".otoshi-backup";
const BACKUP_MANIFEST_FILE: &str = "backup_manifest.json";

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrackDownloadProgress {
    pub app_id: String,
    pub status: CrackDownloadStatus,
    pub progress_percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: u64,
    pub current_file: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CrackDownloadStatus {
    Pending,
    Downloading,
    Extracting,
    BackingUp,
    Installing,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BackupManifest {
    pub app_id: String,
    pub game_path: String,
    pub created_at: i64,
    pub crack_version: Option<String>,
    pub files: Vec<BackupFileEntry>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BackupFileEntry {
    pub relative_path: String,
    pub original_hash: String,
    pub size: u64,
    pub backed_up: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrackInstallResult {
    pub success: bool,
    pub message: String,
    pub files_installed: u32,
    pub files_backed_up: u32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrackUninstallResult {
    pub success: bool,
    pub message: String,
    pub files_restored: u32,
    pub files_missing: u32,
    pub verification_passed: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct GameInstallInfo {
    pub installed: bool,
    pub install_path: Option<String>,
    pub game_name: Option<String>,
    pub store_url: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrackOption {
    pub link: String,
    pub name: Option<String>,
    pub note: Option<String>,
    pub version: Option<String>,
    pub size: Option<u64>,
    pub recommended: bool,
    pub install_guide: Option<String>,
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

#[derive(Clone)]
pub struct CrackManager {
    client: reqwest::Client,
    db: Database,
    api: ApiClient,
    registry: Arc<Mutex<HashMap<String, DownloadHandle>>>,
    progress_cache: Arc<Mutex<HashMap<String, CrackDownloadProgress>>>,
}

impl CrackManager {
    pub fn new(db: Database, api: ApiClient) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(4)
            .build()
            .expect("http client");

        Self {
            client,
            db,
            api,
            registry: Arc::new(Mutex::new(HashMap::new())),
            progress_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Check if a game is installed and get its install path
    pub async fn check_game_installed(&self, app_id: &str) -> Result<GameInstallInfo> {
        // Query database for installed games
        if let Ok(games) = self.db.get_games() {
            for game in games {
                if game.id == app_id || game.slug == app_id {
                    return Ok(GameInstallInfo {
                        installed: game.install_path.is_some(),
                        install_path: game.install_path,
                        game_name: Some(game.title),
                        store_url: Some(format!("/steam/{}", app_id)),
                    });
                }
            }
        }

        // Check Steam installation paths
        if let Some(install_path) = self.find_steam_game_path(app_id).await? {
            return Ok(GameInstallInfo {
                installed: true,
                install_path: Some(install_path),
                game_name: None,
                store_url: Some(format!("/steam/{}", app_id)),
            });
        }

        Ok(GameInstallInfo {
            installed: false,
            install_path: None,
            game_name: None,
            store_url: Some(format!("/steam/{}", app_id)),
        })
    }

    /// Find Steam game installation path
    async fn find_steam_game_path(&self, app_id: &str) -> Result<Option<String>> {
        #[cfg(target_os = "windows")]
        {
            use std::env;
            use std::fs;

            // Common Steam installation paths on Windows
            let steam_paths = vec![
                PathBuf::from("C:\\Program Files (x86)\\Steam"),
                PathBuf::from("C:\\Program Files\\Steam"),
                env::var("ProgramFiles(x86)")
                    .map(|p| PathBuf::from(p).join("Steam"))
                    .unwrap_or_default(),
            ];

            for steam_path in steam_paths {
                let library_folders = steam_path.join("steamapps").join("libraryfolders.vdf");
                if library_folders.exists() {
                    // Parse libraryfolders.vdf to find all library paths
                    let content = fs::read_to_string(&library_folders).unwrap_or_default();
                    let libraries = self.parse_library_folders(&content);

                    for library in libraries {
                        let app_manifest = PathBuf::from(&library)
                            .join("steamapps")
                            .join(format!("appmanifest_{}.acf", app_id));

                        if app_manifest.exists() {
                            // Parse appmanifest to get install directory
                            if let Ok(manifest_content) = fs::read_to_string(&app_manifest) {
                                if let Some(install_dir) = self.parse_install_dir(&manifest_content)
                                {
                                    let game_path = PathBuf::from(&library)
                                        .join("steamapps")
                                        .join("common")
                                        .join(&install_dir);
                                    if game_path.exists() {
                                        return Ok(Some(game_path.to_string_lossy().to_string()));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    fn parse_library_folders(&self, content: &str) -> Vec<String> {
        let mut libraries = Vec::new();
        for line in content.lines() {
            if line.contains("\"path\"") {
                if let Some(path) = line.split('"').nth(3) {
                    libraries.push(path.replace("\\\\", "\\"));
                }
            }
        }
        libraries
    }

    fn parse_install_dir(&self, content: &str) -> Option<String> {
        for line in content.lines() {
            if line.contains("\"installdir\"") {
                return line.split('"').nth(3).map(|s| s.to_string());
            }
        }
        None
    }

    /// Download and install crack files
    pub async fn download_crack(
        &self,
        app_id: &str,
        option: &CrackOption,
        game_path: &str,
    ) -> Result<CrackInstallResult> {
        // Initialize progress
        let progress = CrackDownloadProgress {
            app_id: app_id.to_string(),
            status: CrackDownloadStatus::Pending,
            progress_percent: 0.0,
            downloaded_bytes: 0,
            total_bytes: option.size.unwrap_or(0),
            speed_bps: 0,
            eta_seconds: 0,
            current_file: None,
        };
        self.update_progress(&progress);

        let (tx, rx) = watch::channel(DownloadControl::Running);
        let handle = DownloadHandle { control: tx };
        self.registry
            .lock()
            .map_err(|_| LauncherError::Config("registry locked".to_string()))?
            .insert(app_id.to_string(), handle);

        let result = self.run_crack_download(app_id, option, game_path, rx).await;

        self.registry
            .lock()
            .ok()
            .and_then(|mut map| map.remove(app_id));

        result
    }

    async fn run_crack_download(
        &self,
        app_id: &str,
        option: &CrackOption,
        game_path: &str,
        mut control: watch::Receiver<DownloadControl>,
    ) -> Result<CrackInstallResult> {
        let game_path = PathBuf::from(game_path);
        let temp_dir = std::env::temp_dir().join(format!("otoshi_crack_{}", app_id));
        std::fs::create_dir_all(&temp_dir).map_err(LauncherError::Io)?;

        // Update status to downloading
        self.set_status(app_id, CrackDownloadStatus::Downloading);

        // Download the crack archive
        let temp_archive = temp_dir.join("crack_archive.zip");
        let download_result = self
            .download_file(&option.link, &temp_archive, app_id, &mut control)
            .await;

        if let Err(e) = download_result {
            self.set_status(app_id, CrackDownloadStatus::Failed);
            return Err(e);
        }

        // Check for cancellation
        if *control.borrow() == DownloadControl::Cancelled {
            self.set_status(app_id, CrackDownloadStatus::Cancelled);
            return Ok(CrackInstallResult {
                success: false,
                message: "Download cancelled".to_string(),
                files_installed: 0,
                files_backed_up: 0,
            });
        }

        // Update status to backing up
        self.set_status(app_id, CrackDownloadStatus::BackingUp);

        // Detect archive nesting level so fixes are applied relative to the actual game root.
        let strip_depth = self.determine_archive_root_strip_depth(&temp_archive, &game_path)?;

        // Backup original files before installing crack
        let backup_count = self
            .backup_original_files(app_id, &game_path, &temp_archive, strip_depth)
            .await?;

        // Update status to extracting
        self.set_status(app_id, CrackDownloadStatus::Extracting);

        // Extract crack files to game directory
        let install_count = self
            .extract_to_game_dir(&temp_archive, &game_path, app_id, strip_depth)
            .await?;

        // Cleanup temp files
        let _ = std::fs::remove_dir_all(&temp_dir);

        // Update status to completed
        self.set_status(app_id, CrackDownloadStatus::Completed);

        Ok(CrackInstallResult {
            success: true,
            message: "Crack installed successfully".to_string(),
            files_installed: install_count,
            files_backed_up: backup_count,
        })
    }

    async fn download_file(
        &self,
        url: &str,
        dest: &Path,
        app_id: &str,
        control: &mut watch::Receiver<DownloadControl>,
    ) -> Result<()> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(LauncherError::Network)?;

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;
        let start_time = Instant::now();

        let mut file = std::fs::File::create(dest).map_err(LauncherError::Io)?;

        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        while let Some(chunk_result) = stream.next().await {
            // Check for cancellation
            if control.has_changed().unwrap_or(false) {
                if *control.borrow() == DownloadControl::Cancelled {
                    return Err(LauncherError::Config("Download cancelled".to_string()));
                }
            }

            let chunk = chunk_result.map_err(LauncherError::Network)?;
            file.write_all(&chunk).map_err(LauncherError::Io)?;

            downloaded += chunk.len() as u64;

            // Update progress
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                (downloaded as f64 / elapsed) as u64
            } else {
                0
            };
            let remaining = total_size.saturating_sub(downloaded);
            let eta = if speed > 0 { remaining / speed } else { 0 };

            let progress = CrackDownloadProgress {
                app_id: app_id.to_string(),
                status: CrackDownloadStatus::Downloading,
                progress_percent: if total_size > 0 {
                    (downloaded as f64 / total_size as f64) * 100.0
                } else {
                    0.0
                },
                downloaded_bytes: downloaded,
                total_bytes: total_size,
                speed_bps: speed,
                eta_seconds: eta,
                current_file: Some(url.to_string()),
            };
            self.update_progress(&progress);
        }

        Ok(())
    }

    async fn backup_original_files(
        &self,
        app_id: &str,
        game_path: &Path,
        archive_path: &Path,
        strip_depth: usize,
    ) -> Result<u32> {
        let backup_dir = game_path.join(BACKUP_DIR_NAME);
        std::fs::create_dir_all(&backup_dir).map_err(LauncherError::Io)?;

        // Read archive to get list of files that will be overwritten
        let archive_file = File::open(archive_path).map_err(LauncherError::Io)?;
        let mut archive =
            ZipArchive::new(archive_file).map_err(|e| LauncherError::Config(e.to_string()))?;

        let mut backup_entries: Vec<BackupFileEntry> = Vec::new();
        let mut backup_count = 0u32;

        for i in 0..archive.len() {
            let file = archive
                .by_index(i)
                .map_err(|e| LauncherError::Config(e.to_string()))?;
            if file.is_dir() {
                continue;
            }
            let file_path = file
                .enclosed_name()
                .ok_or_else(|| LauncherError::Config("Invalid file path in archive".to_string()))?;

            let Some(relative_path) = self.map_archive_path(&file_path, strip_depth) else {
                continue;
            };
            let target_path = game_path.join(&relative_path);

            if target_path.exists() && target_path.is_file() {
                // Calculate hash of original file
                let hash = self.calculate_file_hash(&target_path)?;

                // Backup the file
                let backup_path = backup_dir.join(&relative_path);
                if let Some(parent) = backup_path.parent() {
                    std::fs::create_dir_all(parent).map_err(LauncherError::Io)?;
                }
                std::fs::copy(&target_path, &backup_path).map_err(LauncherError::Io)?;

                let size = std::fs::metadata(&target_path)
                    .map(|m| m.len())
                    .unwrap_or(0);

                backup_entries.push(BackupFileEntry {
                    relative_path: relative_path.to_string_lossy().to_string(),
                    original_hash: hash,
                    size,
                    backed_up: true,
                });
                backup_count += 1;
            }
        }

        // Save backup manifest
        let manifest = BackupManifest {
            app_id: app_id.to_string(),
            game_path: game_path.to_string_lossy().to_string(),
            created_at: chrono::Utc::now().timestamp(),
            crack_version: None,
            files: backup_entries,
        };

        let manifest_path = backup_dir.join(BACKUP_MANIFEST_FILE);
        let manifest_json = serde_json::to_string_pretty(&manifest)
            .map_err(|e| LauncherError::Config(e.to_string()))?;
        std::fs::write(&manifest_path, manifest_json).map_err(LauncherError::Io)?;

        Ok(backup_count)
    }

    fn calculate_file_hash(&self, path: &Path) -> Result<String> {
        let mut file = File::open(path).map_err(LauncherError::Io)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];

        loop {
            let bytes_read = file.read(&mut buffer).map_err(LauncherError::Io)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    async fn extract_to_game_dir(
        &self,
        archive_path: &Path,
        game_path: &Path,
        app_id: &str,
        strip_depth: usize,
    ) -> Result<u32> {
        let archive_file = File::open(archive_path).map_err(LauncherError::Io)?;
        let mut archive =
            ZipArchive::new(archive_file).map_err(|e| LauncherError::Config(e.to_string()))?;

        let total_files = archive.len();
        let mut extracted = 0u32;

        for i in 0..total_files {
            let mut file = archive
                .by_index(i)
                .map_err(|e| LauncherError::Config(e.to_string()))?;

            let file_path = file
                .enclosed_name()
                .ok_or_else(|| LauncherError::Config("Invalid file path in archive".to_string()))?;

            let Some(relative_path) = self.map_archive_path(&file_path, strip_depth) else {
                continue;
            };
            let target_path = game_path.join(&relative_path);

            // Update progress
            let progress = CrackDownloadProgress {
                app_id: app_id.to_string(),
                status: CrackDownloadStatus::Extracting,
                progress_percent: ((i + 1) as f64 / total_files as f64) * 100.0,
                downloaded_bytes: 0,
                total_bytes: 0,
                speed_bps: 0,
                eta_seconds: 0,
                current_file: Some(relative_path.to_string_lossy().to_string()),
            };
            self.update_progress(&progress);

            if file.is_dir() {
                std::fs::create_dir_all(&target_path).map_err(LauncherError::Io)?;
            } else {
                if let Some(parent) = target_path.parent() {
                    std::fs::create_dir_all(parent).map_err(LauncherError::Io)?;
                }

                let mut outfile = File::create(&target_path).map_err(LauncherError::Io)?;
                std::io::copy(&mut file, &mut outfile).map_err(LauncherError::Io)?;
                extracted += 1;
            }
        }

        Ok(extracted)
    }

    fn determine_archive_root_strip_depth(
        &self,
        archive_path: &Path,
        game_path: &Path,
    ) -> Result<usize> {
        let archive_file = File::open(archive_path).map_err(LauncherError::Io)?;
        let mut archive =
            ZipArchive::new(archive_file).map_err(|e| LauncherError::Config(e.to_string()))?;

        let mut entries: Vec<PathBuf> = Vec::new();
        let mut max_depth = 0usize;

        for i in 0..archive.len() {
            let file = archive
                .by_index(i)
                .map_err(|e| LauncherError::Config(e.to_string()))?;
            if file.is_dir() {
                continue;
            }
            let Some(path) = file.enclosed_name().map(|p| p.to_path_buf()) else {
                continue;
            };
            if self.is_ignored_archive_path(&path) {
                continue;
            }
            let components = self.normal_components(&path).count();
            if components == 0 {
                continue;
            }
            max_depth = max_depth.max(components.saturating_sub(1));
            entries.push(path);
            if entries.len() >= 1200 {
                break;
            }
        }

        if entries.is_empty() {
            return Ok(0);
        }

        let max_test_depth = max_depth.min(4);
        let mut scores: Vec<(usize, i64)> = Vec::new();
        for depth in 0..=max_test_depth {
            let score = self.score_strip_depth(&entries, game_path, depth);
            scores.push((depth, score));
        }

        let mut best_depth = 0usize;
        let mut best_score = i64::MIN;
        for (depth, score) in &scores {
            if *score > best_score {
                best_score = *score;
                best_depth = *depth;
            }
        }

        // Common package layout: single top-level wrapper folder.
        // If wrapper folder doesn't exist in game root and depth=1 is at least as good,
        // prefer stripping one level.
        if let Some(wrapper) = self.common_top_level_folder(&entries) {
            if !game_path.join(&wrapper).exists() {
                let score0 = scores
                    .iter()
                    .find(|(depth, _)| *depth == 0)
                    .map(|(_, score)| *score)
                    .unwrap_or(i64::MIN);
                let score1 = scores
                    .iter()
                    .find(|(depth, _)| *depth == 1)
                    .map(|(_, score)| *score)
                    .unwrap_or(i64::MIN);
                if score1 >= score0 && best_depth == 0 {
                    best_depth = 1;
                }
            }
        }

        Ok(best_depth)
    }

    fn score_strip_depth(&self, entries: &[PathBuf], game_path: &Path, depth: usize) -> i64 {
        let mut score = 0i64;
        for entry in entries {
            let Some(mapped) = self.strip_components(entry, depth) else {
                continue;
            };
            if self.is_ignored_archive_path(&mapped) {
                continue;
            }

            let target = game_path.join(&mapped);
            if target.exists() {
                score += 12;
                if self.looks_like_game_runtime_file(&mapped) {
                    score += 8;
                }
            } else if let Some(parent) = target.parent() {
                if parent.exists() {
                    score += 4;
                    if self.looks_like_game_runtime_file(&mapped) {
                        score += 2;
                    }
                } else {
                    score -= 1;
                }
            }
        }
        score
    }

    fn map_archive_path(&self, path: &Path, strip_depth: usize) -> Option<PathBuf> {
        let mapped = self.strip_components(path, strip_depth)?;
        if self.is_ignored_archive_path(&mapped) {
            return None;
        }
        Some(mapped)
    }

    fn strip_components(&self, path: &Path, depth: usize) -> Option<PathBuf> {
        let mut out = PathBuf::new();
        let mut skipped = 0usize;
        for component in path.components() {
            let Component::Normal(segment) = component else {
                continue;
            };
            if skipped < depth {
                skipped += 1;
                continue;
            }
            out.push(segment);
        }
        if out.as_os_str().is_empty() {
            None
        } else {
            Some(out)
        }
    }

    fn normal_components<'a>(&self, path: &'a Path) -> impl Iterator<Item = &'a std::ffi::OsStr> {
        path.components().filter_map(|component| match component {
            Component::Normal(seg) => Some(seg),
            _ => None,
        })
    }

    fn common_top_level_folder(&self, entries: &[PathBuf]) -> Option<String> {
        let mut shared: Option<String> = None;
        for entry in entries {
            let first = self
                .normal_components(entry)
                .next()
                .map(|seg| seg.to_string_lossy().to_string())?;
            match &shared {
                None => shared = Some(first),
                Some(current) if current == &first => {}
                Some(_) => return None,
            }
        }
        shared
    }

    fn is_ignored_archive_path(&self, path: &Path) -> bool {
        let first = match self.normal_components(path).next() {
            Some(value) => value.to_string_lossy().to_ascii_lowercase(),
            None => return true,
        };
        if first == "__macosx" {
            return true;
        }
        if let Some(name) = path.file_name() {
            let lower = name.to_string_lossy().to_ascii_lowercase();
            if lower == ".ds_store" || lower == "thumbs.db" {
                return true;
            }
        }
        false
    }

    fn looks_like_game_runtime_file(&self, path: &Path) -> bool {
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());
        matches!(
            ext.as_deref(),
            Some("exe")
                | Some("dll")
                | Some("ini")
                | Some("json")
                | Some("cfg")
                | Some("pak")
                | Some("bin")
                | Some("dat")
        )
    }

    /// Uninstall crack and restore original files
    pub async fn uninstall_crack(
        &self,
        app_id: &str,
        game_path: &str,
    ) -> Result<CrackUninstallResult> {
        let game_path = PathBuf::from(game_path);
        let backup_dir = game_path.join(BACKUP_DIR_NAME);
        let manifest_path = backup_dir.join(BACKUP_MANIFEST_FILE);

        if !manifest_path.exists() {
            return Ok(CrackUninstallResult {
                success: false,
                message: "No backup manifest found. Cannot restore original files.".to_string(),
                files_restored: 0,
                files_missing: 0,
                verification_passed: false,
            });
        }

        // Load backup manifest
        let manifest_content =
            std::fs::read_to_string(&manifest_path).map_err(LauncherError::Io)?;
        let manifest: BackupManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| LauncherError::Config(e.to_string()))?;

        let mut files_restored = 0u32;
        let mut files_missing = 0u32;

        for entry in &manifest.files {
            let backup_path = backup_dir.join(&entry.relative_path);
            let target_path = game_path.join(&entry.relative_path);

            if backup_path.exists() {
                // Verify backup file hash matches original
                let backup_hash = self.calculate_file_hash(&backup_path)?;
                if backup_hash == entry.original_hash {
                    // Restore the file
                    if let Some(parent) = target_path.parent() {
                        std::fs::create_dir_all(parent).map_err(LauncherError::Io)?;
                    }
                    std::fs::copy(&backup_path, &target_path).map_err(LauncherError::Io)?;
                    files_restored += 1;
                } else {
                    files_missing += 1;
                }
            } else {
                files_missing += 1;
            }
        }

        // Verify game integrity after restoration
        let verification_passed = self.verify_game_integrity(app_id, &game_path).await?;

        // Clean up backup directory if all files restored successfully
        if files_missing == 0 && verification_passed {
            let _ = std::fs::remove_dir_all(&backup_dir);
        }

        Ok(CrackUninstallResult {
            success: files_missing == 0,
            message: if files_missing == 0 {
                "Original files restored successfully".to_string()
            } else {
                format!("{} files could not be restored", files_missing)
            },
            files_restored,
            files_missing,
            verification_passed,
        })
    }

    /// Verify game integrity using stored hashes
    pub async fn verify_game_integrity(&self, app_id: &str, game_path: &Path) -> Result<bool> {
        let backup_dir = game_path.join(BACKUP_DIR_NAME);
        let manifest_path = backup_dir.join(BACKUP_MANIFEST_FILE);

        if !manifest_path.exists() {
            return Ok(true); // No manifest means no crack was installed
        }

        let manifest_content =
            std::fs::read_to_string(&manifest_path).map_err(LauncherError::Io)?;
        let manifest: BackupManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| LauncherError::Config(e.to_string()))?;

        for entry in &manifest.files {
            let file_path = game_path.join(&entry.relative_path);
            if file_path.exists() {
                let current_hash = self.calculate_file_hash(&file_path)?;
                // If current hash matches original, the file is intact
                if current_hash != entry.original_hash {
                    // File has been modified (crack is still installed or file corrupted)
                    return Ok(false);
                }
            }
        }

        Ok(true)
    }

    /// Check if crack is installed for a game
    pub async fn is_crack_installed(&self, app_id: &str, game_path: &str) -> Result<bool> {
        let game_path = PathBuf::from(game_path);
        let backup_dir = game_path.join(BACKUP_DIR_NAME);
        let manifest_path = backup_dir.join(BACKUP_MANIFEST_FILE);

        if !manifest_path.exists() {
            return Ok(false);
        }

        // Load manifest and check if any files differ from original
        let manifest_content =
            std::fs::read_to_string(&manifest_path).map_err(LauncherError::Io)?;
        let manifest: BackupManifest = serde_json::from_str(&manifest_content)
            .map_err(|e| LauncherError::Config(e.to_string()))?;

        for entry in &manifest.files {
            let file_path = game_path.join(&entry.relative_path);
            if file_path.exists() {
                let current_hash = self.calculate_file_hash(&file_path)?;
                if current_hash != entry.original_hash {
                    return Ok(true); // Crack is installed
                }
            }
        }

        Ok(false)
    }

    /// Cancel ongoing crack download
    pub fn cancel_crack_download(&self, app_id: &str) -> Result<()> {
        if let Ok(registry) = self.registry.lock() {
            if let Some(handle) = registry.get(app_id) {
                let _ = handle.control.send(DownloadControl::Cancelled);
            }
        }
        self.set_status(app_id, CrackDownloadStatus::Cancelled);
        Ok(())
    }

    /// Get current download progress
    pub fn get_progress(&self, app_id: &str) -> Option<CrackDownloadProgress> {
        self.progress_cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(app_id).cloned())
    }

    fn update_progress(&self, progress: &CrackDownloadProgress) {
        if let Ok(mut cache) = self.progress_cache.lock() {
            cache.insert(progress.app_id.clone(), progress.clone());
        }
    }

    fn set_status(&self, app_id: &str, status: CrackDownloadStatus) {
        if let Ok(mut cache) = self.progress_cache.lock() {
            if let Some(progress) = cache.get_mut(app_id) {
                progress.status = status;
            }
        }
    }
}
