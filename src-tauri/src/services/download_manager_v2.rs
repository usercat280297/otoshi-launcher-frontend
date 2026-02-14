use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tokio::time::sleep;
use uuid::Uuid;

use crate::db::queries::{DownloadQueries, DownloadStateQueries};
use crate::db::Database;
use crate::errors::{LauncherError, Result};
use crate::models::LocalDownload;
use crate::services::{DownloadManager, DownloadService};

const XDELTA_MIN_BYTES: i64 = 64 * 1024 * 1024;
const PIPELINE_POLL_MS: u64 = 750;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[inline]
fn hide_console_window(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTelemetryV2 {
    pub xdelta_attempted: bool,
    pub xdelta_applied: bool,
    pub xdelta_fallback_reason: Option<String>,
    pub xdelta_patch_count: usize,
    pub xdelta_applied_count: usize,
    pub xdelta_failed_count: usize,
    pub xdelta_duration_ms: u64,
    pub updated_at: i64,
}

impl Default for DownloadTelemetryV2 {
    fn default() -> Self {
        Self {
            xdelta_attempted: false,
            xdelta_applied: false,
            xdelta_fallback_reason: None,
            xdelta_patch_count: 0,
            xdelta_applied_count: 0,
            xdelta_failed_count: 0,
            xdelta_duration_ms: 0,
            updated_at: chrono::Utc::now().timestamp(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSessionV2 {
    pub id: String,
    pub download_id: String,
    pub game_id: String,
    pub slug: String,
    pub channel: String,
    pub method: String,
    pub version: String,
    pub status: String,
    pub stage: String,
    pub install_path: Option<String>,
    pub xdelta_mode: String,
    #[serde(default)]
    pub telemetry: DownloadTelemetryV2,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadV2Request {
    pub game_id: String,
    pub slug: String,
    #[serde(default)]
    pub download_id: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub install_path: Option<String>,
    #[serde(default)]
    pub expected_file_bytes: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct XdeltaPlan {
    #[serde(default)]
    patches: Vec<XdeltaPatchEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct XdeltaPatchEntry {
    #[serde(alias = "source_file", alias = "sourcePath")]
    source: String,
    #[serde(alias = "patch_file", alias = "patchPath")]
    patch: String,
    #[serde(alias = "output_file", alias = "outputPath")]
    output: String,
    #[serde(default, alias = "target_file", alias = "targetPath")]
    target: Option<String>,
    #[serde(default)]
    expected_sha256: Option<String>,
    #[serde(default)]
    expected_size: Option<u64>,
}

#[derive(Clone)]
pub struct DownloadManagerV2 {
    inner: DownloadManager,
    downloads_api: DownloadService,
    db: Database,
    sessions: Arc<Mutex<HashMap<String, DownloadSessionV2>>>,
}

impl DownloadManagerV2 {
    pub fn new(inner: DownloadManager, downloads_api: DownloadService, db: Database) -> Self {
        Self {
            inner,
            downloads_api,
            db,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_download(&self, request: StartDownloadV2Request) -> Result<DownloadSessionV2> {
        let now = chrono::Utc::now().timestamp();
        let mut session = DownloadSessionV2 {
            id: Uuid::new_v4().to_string(),
            download_id: request
                .download_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            game_id: request.game_id.clone(),
            slug: request.slug.clone(),
            channel: request
                .channel
                .as_deref()
                .unwrap_or("stable")
                .trim()
                .to_ascii_lowercase(),
            method: request
                .method
                .as_deref()
                .unwrap_or("chunks")
                .trim()
                .to_ascii_lowercase(),
            version: request
                .version
                .as_deref()
                .unwrap_or("latest")
                .trim()
                .to_string(),
            status: "queued".to_string(),
            stage: "manifest_fetch".to_string(),
            install_path: request.install_path.clone(),
            xdelta_mode: Self::resolve_xdelta_mode(request.expected_file_bytes),
            telemetry: DownloadTelemetryV2::default(),
            created_at: now,
            updated_at: now,
        };

        self.persist_session(&session)?;
        self.cache_session(&session)?;

        self.set_stage_status(&session.id, "plan_build", "queued")?;

        self.inner
            .start_download(
                &session.download_id,
                &session.game_id,
                &session.slug,
                Some(session.method.as_str()),
                session.install_path.as_deref(),
            )
            .await?;

        self.set_stage_status(&session.id, "chunk_transfer", "downloading")?;
        let _ = self
            .downloads_api
            .update_status(&session.download_id, "downloading")
            .await;

        let pipeline_manager = self.clone();
        let pipeline_session_id = session.id.clone();
        tokio::spawn(async move {
            if let Err(err) = pipeline_manager
                .run_session_pipeline(&pipeline_session_id)
                .await
            {
                tracing::warn!(
                    "download v2 pipeline monitor failed session_id={} error={}",
                    pipeline_session_id,
                    err
                );
            }
        });

        session = self
            .get_session(&session.id)?
            .unwrap_or(session);
        Ok(session)
    }

    pub async fn control_download(&self, session_id: &str, action: &str) -> Result<DownloadSessionV2> {
        let mut session = self
            .get_session(session_id)?
            .ok_or_else(|| LauncherError::NotFound("download session v2 not found".to_string()))?;

        let normalized = action.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "pause" => {
                self.inner.pause_download(&session.download_id).await?;
                let _ = self.downloads_api.pause_download(&session.download_id).await;
                session.status = "paused".to_string();
                session.stage = "transfer_paused".to_string();
            }
            "resume" => {
                if self.inner.resume_download(&session.download_id).await.is_err() {
                    self.inner
                        .start_download(
                            &session.download_id,
                            &session.game_id,
                            &session.slug,
                            Some(session.method.as_str()),
                            session.install_path.as_deref(),
                        )
                        .await?;
                    self.inner.resume_download(&session.download_id).await?;
                }
                let _ = self.downloads_api.resume_download(&session.download_id).await;
                session.status = "downloading".to_string();
                session.stage = "chunk_transfer".to_string();
            }
            "cancel" => {
                self.inner.cancel_download(&session.download_id).await?;
                let _ = self.downloads_api.cancel_download(&session.download_id).await;
                session.status = "cancelled".to_string();
                session.stage = "cancelled".to_string();
            }
            _ => {
                return Err(LauncherError::Config(format!(
                    "unsupported control action: {}",
                    action
                )));
            }
        }

        session.updated_at = chrono::Utc::now().timestamp();
        self.persist_session(&session)?;
        self.cache_session(&session)?;
        self.upsert_local_download(&session)?;
        Ok(session)
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<DownloadSessionV2>> {
        if let Some(value) = self
            .sessions
            .lock()
            .map_err(|_| LauncherError::Config("download session lock poisoned".to_string()))?
            .get(session_id)
            .cloned()
        {
            return Ok(Some(value));
        }

        let conn = self.db.connection()?;
        let mut stmt = conn.prepare(
            "SELECT id, download_id, game_id, slug, channel, method, version, status, stage,
                    install_path, meta_json, created_at, updated_at
             FROM download_sessions_v2
             WHERE id = ?1
             LIMIT 1",
        )?;
        let session = stmt
            .query_row(params![session_id], |row| {
                let meta_raw: String = row.get(10)?;
                let meta_value = serde_json::from_str::<serde_json::Value>(&meta_raw)
                    .unwrap_or_else(|_| serde_json::json!({}));
                let xdelta_mode = meta_value
                    .get("xdelta_mode")
                    .and_then(|mode| mode.as_str())
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "chunk_only".to_string());
                let telemetry = meta_value
                    .get("telemetry")
                    .cloned()
                    .and_then(|value| serde_json::from_value::<DownloadTelemetryV2>(value).ok())
                    .unwrap_or_default();
                Ok(DownloadSessionV2 {
                    id: row.get(0)?,
                    download_id: row.get(1)?,
                    game_id: row.get(2)?,
                    slug: row.get(3)?,
                    channel: row.get(4)?,
                    method: row.get(5)?,
                    version: row.get(6)?,
                    status: row.get(7)?,
                    stage: row.get(8)?,
                    install_path: row.get(9)?,
                    xdelta_mode,
                    telemetry,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            })
            .optional()?;

        if let Some(item) = &session {
            self.cache_session(item)?;
        }
        Ok(session)
    }

    async fn run_session_pipeline(&self, session_id: &str) -> Result<()> {
        loop {
            let session = match self.get_session(session_id)? {
                Some(value) => value,
                None => return Ok(()),
            };

            let observed = self.get_local_download(&session.download_id)?;
            let runtime_status = observed
                .as_ref()
                .map(|item| item.status.trim().to_ascii_lowercase())
                .unwrap_or_else(|| session.status.trim().to_ascii_lowercase());

            match runtime_status.as_str() {
                "completed" => {
                    self.set_stage_status(session_id, "verify", "verifying")?;
                    let _ = self
                        .downloads_api
                        .update_status(&session.download_id, "verifying")
                        .await;
                    self.run_xdelta_optional(session_id).await?;
                    self.set_stage_status(session_id, "finalize", "completed")?;
                    if let Some(refreshed) = self.get_session(session_id)? {
                        self.upsert_local_download(&refreshed)?;
                        let _ = self
                            .downloads_api
                            .update_status(&refreshed.download_id, "completed")
                            .await;
                    }
                    return Ok(());
                }
                "paused" => {
                    self.set_stage_status(session_id, "transfer_paused", "paused")?;
                }
                "cancelled" => {
                    self.set_stage_status(session_id, "cancelled", "cancelled")?;
                    return Ok(());
                }
                "failed" => {
                    self.set_stage_status(session_id, "verify", "failed")?;
                    return Ok(());
                }
                "verifying" => {
                    self.set_stage_status(session_id, "verify", "verifying")?;
                }
                _ => {
                    self.set_stage_status(session_id, "chunk_transfer", "downloading")?;
                }
            }

            sleep(Duration::from_millis(PIPELINE_POLL_MS)).await;
        }
    }

    async fn run_xdelta_optional(&self, session_id: &str) -> Result<()> {
        let Some(session) = self.get_session(session_id)? else {
            return Ok(());
        };

        let mut telemetry = session.telemetry.clone();
        telemetry.xdelta_attempted = true;
        telemetry.updated_at = chrono::Utc::now().timestamp();
        self.update_telemetry(session_id, telemetry.clone())?;

        self.set_stage_status(session_id, "xdelta_optional", "verifying")?;

        if session.xdelta_mode != "chunk_plus_xdelta" {
            telemetry.xdelta_fallback_reason = Some("policy_chunk_only".to_string());
            telemetry.updated_at = chrono::Utc::now().timestamp();
            self.update_telemetry(session_id, telemetry)?;
            return Ok(());
        }

        if !Self::has_xdelta3() {
            telemetry.xdelta_fallback_reason = Some("xdelta3_unavailable".to_string());
            telemetry.updated_at = chrono::Utc::now().timestamp();
            self.update_telemetry(session_id, telemetry)?;
            return Ok(());
        }

        let install_root = match self.resolve_install_root(&session)? {
            Some(path) => path,
            None => {
                telemetry.xdelta_fallback_reason = Some("install_path_missing".to_string());
                telemetry.updated_at = chrono::Utc::now().timestamp();
                self.update_telemetry(session_id, telemetry)?;
                return Ok(());
            }
        };

        let plan = match self.resolve_xdelta_plan(&install_root)? {
            Some(plan) => plan,
            None => {
                telemetry.xdelta_fallback_reason = Some("xdelta_plan_missing".to_string());
                telemetry.updated_at = chrono::Utc::now().timestamp();
                self.update_telemetry(session_id, telemetry)?;
                return Ok(());
            }
        };

        if plan.patches.is_empty() {
            telemetry.xdelta_fallback_reason = Some("xdelta_plan_empty".to_string());
            telemetry.updated_at = chrono::Utc::now().timestamp();
            self.update_telemetry(session_id, telemetry)?;
            return Ok(());
        }

        telemetry.xdelta_patch_count = plan.patches.len();
        telemetry.updated_at = chrono::Utc::now().timestamp();
        self.update_telemetry(session_id, telemetry.clone())?;

        let start = std::time::Instant::now();
        match self.apply_xdelta_plan(&install_root, &plan) {
            Ok(applied) => {
                telemetry.xdelta_applied = true;
                telemetry.xdelta_applied_count = applied;
                telemetry.xdelta_failed_count = 0;
                telemetry.xdelta_fallback_reason = None;
            }
            Err(err) => {
                tracing::warn!(
                    "xdelta apply failed for session {} (fallback to chunk result): {}",
                    session_id,
                    err
                );
                telemetry.xdelta_applied = false;
                telemetry.xdelta_applied_count = 0;
                telemetry.xdelta_failed_count = telemetry.xdelta_patch_count;
                telemetry.xdelta_fallback_reason = Some(format!("apply_failed: {}", err));
            }
        }

        telemetry.xdelta_duration_ms = start.elapsed().as_millis() as u64;
        telemetry.updated_at = chrono::Utc::now().timestamp();
        self.update_telemetry(session_id, telemetry)?;
        Ok(())
    }

    fn resolve_install_root(&self, session: &DownloadSessionV2) -> Result<Option<PathBuf>> {
        if let Some(path) = session
            .install_path
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            return Ok(Some(PathBuf::from(path)));
        }

        let saved = self.db.get_download_state(&session.download_id)?;
        Ok(saved.map(|state| PathBuf::from(state.install_dir)))
    }

    fn resolve_xdelta_plan(&self, install_root: &Path) -> Result<Option<XdeltaPlan>> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(path) = std::env::var("OTOSHI_XDELTA_PLAN_FILE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            candidates.push(PathBuf::from(path));
        }
        candidates.push(install_root.join(".otoshi").join("xdelta_plan.json"));
        candidates.push(install_root.join("xdelta_plan.json"));
        candidates.push(install_root.join(".chunks").join("xdelta_plan.json"));

        for path in candidates {
            if !path.exists() || !path.is_file() {
                continue;
            }
            let raw = std::fs::read_to_string(&path).map_err(|err| {
                LauncherError::Config(format!(
                    "unable to read xdelta plan {}: {}",
                    path.display(),
                    err
                ))
            })?;
            let plan: XdeltaPlan = serde_json::from_str(&raw).map_err(|err| {
                LauncherError::Config(format!(
                    "invalid xdelta plan {}: {}",
                    path.display(),
                    err
                ))
            })?;
            return Ok(Some(plan));
        }

        Ok(None)
    }

    fn apply_xdelta_plan(&self, install_root: &Path, plan: &XdeltaPlan) -> Result<usize> {
        let mut applied = 0_usize;
        for patch in &plan.patches {
            let source_path = resolve_plan_path(install_root, &patch.source);
            let patch_path = resolve_plan_path(install_root, &patch.patch);
            let output_path = resolve_plan_path(install_root, &patch.output);
            if !source_path.exists() {
                return Err(LauncherError::Config(format!(
                    "xdelta source missing: {}",
                    source_path.display()
                )));
            }
            if !patch_path.exists() {
                return Err(LauncherError::Config(format!(
                    "xdelta patch missing: {}",
                    patch_path.display()
                )));
            }
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)?;
            }

            let mut command = Command::new("xdelta3");
            hide_console_window(&mut command);
            let status = command
                .args([
                    "-f",
                    "-d",
                    "-s",
                    source_path.to_string_lossy().as_ref(),
                    patch_path.to_string_lossy().as_ref(),
                    output_path.to_string_lossy().as_ref(),
                ])
                .status()
                .map_err(|err| LauncherError::Config(format!("failed to execute xdelta3: {err}")))?;
            if !status.success() {
                return Err(LauncherError::Config(format!(
                    "xdelta3 non-zero exit for output {} (status={})",
                    output_path.display(),
                    status
                )));
            }

            if let Some(expected_size) = patch.expected_size {
                let size = std::fs::metadata(&output_path)?.len();
                if size != expected_size {
                    return Err(LauncherError::Config(format!(
                        "xdelta output size mismatch {} expected={} actual={}",
                        output_path.display(),
                        expected_size,
                        size
                    )));
                }
            }

            if let Some(expected_hash) = patch
                .expected_sha256
                .as_ref()
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
            {
                let actual = hash_sha256_file(&output_path)?;
                if actual != expected_hash {
                    return Err(LauncherError::Config(format!(
                        "xdelta output hash mismatch {} expected={} actual={}",
                        output_path.display(),
                        expected_hash,
                        actual
                    )));
                }
            }

            if let Some(target_raw) = patch
                .target
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                let target_path = resolve_plan_path(install_root, target_raw);
                if let Some(parent) = target_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                if target_path.exists() {
                    let _ = std::fs::remove_file(&target_path);
                }
                std::fs::rename(&output_path, &target_path).map_err(|err| {
                    LauncherError::Config(format!(
                        "xdelta move failed {} -> {}: {}",
                        output_path.display(),
                        target_path.display(),
                        err
                    ))
                })?;
            }

            applied = applied.saturating_add(1);
        }
        Ok(applied)
    }

    fn with_session_mut<F>(&self, session_id: &str, mutator: F) -> Result<Option<DownloadSessionV2>>
    where
        F: FnOnce(&mut DownloadSessionV2) -> bool,
    {
        if self.get_session(session_id)?.is_none() {
            return Ok(None);
        }

        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| LauncherError::Config("download session lock poisoned".to_string()))?;
        let Some(session) = guard.get_mut(session_id) else {
            return Ok(None);
        };

        let changed = mutator(session);
        if !changed {
            return Ok(Some(session.clone()));
        }

        session.updated_at = chrono::Utc::now().timestamp();
        let updated = session.clone();
        drop(guard);
        self.persist_session(&updated)?;
        self.upsert_local_download(&updated)?;
        Ok(Some(updated))
    }

    fn set_stage_status(&self, session_id: &str, stage: &str, status: &str) -> Result<()> {
        let _ = self.with_session_mut(session_id, |session| {
            if session.stage == stage && session.status == status {
                return false;
            }
            session.stage = stage.to_string();
            session.status = status.to_string();
            true
        })?;
        Ok(())
    }

    fn update_telemetry(&self, session_id: &str, telemetry: DownloadTelemetryV2) -> Result<()> {
        let _ = self.with_session_mut(session_id, |session| {
            session.telemetry = telemetry;
            true
        })?;
        Ok(())
    }

    fn get_local_download(&self, download_id: &str) -> Result<Option<LocalDownload>> {
        let downloads = self.db.get_downloads()?;
        Ok(downloads.into_iter().find(|item| item.id == download_id))
    }

    fn cache_session(&self, session: &DownloadSessionV2) -> Result<()> {
        self.sessions
            .lock()
            .map_err(|_| LauncherError::Config("download session lock poisoned".to_string()))?
            .insert(session.id.clone(), session.clone());
        Ok(())
    }

    fn persist_session(&self, session: &DownloadSessionV2) -> Result<()> {
        let conn = self.db.connection()?;
        let meta_json = serde_json::json!({
            "xdelta_mode": session.xdelta_mode,
            "telemetry": session.telemetry,
            "pipeline": [
                "manifest_fetch",
                "plan_build",
                "chunk_transfer",
                "verify",
                "xdelta_optional",
                "finalize"
            ]
        })
        .to_string();
        conn.execute(
            "INSERT OR REPLACE INTO download_sessions_v2
                (id, download_id, game_id, slug, channel, method, version, status, stage,
                 install_path, meta_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                session.id,
                session.download_id,
                session.game_id,
                session.slug,
                session.channel,
                session.method,
                session.version,
                session.status,
                session.stage,
                session.install_path,
                meta_json,
                session.created_at,
                session.updated_at,
            ],
        )?;
        Ok(())
    }

    fn upsert_local_download(&self, session: &DownloadSessionV2) -> Result<()> {
        let existing = self
            .get_local_download(&session.download_id)?
            .unwrap_or(LocalDownload {
                id: session.download_id.clone(),
                game_id: session.game_id.clone(),
                status: "queued".to_string(),
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
                updated_at: session.updated_at,
            });

        let mut local = existing;
        local.game_id = session.game_id.clone();
        local.status = session.status.clone();
        if session.status == "completed" {
            local.progress = 100;
            local.speed_mbps = 0.0;
            local.network_bps = 0;
        } else if session.status == "paused" {
            local.speed_mbps = 0.0;
            local.network_bps = 0;
        } else if session.status == "cancelled" || session.status == "failed" {
            local.speed_mbps = 0.0;
            local.network_bps = 0;
            if local.progress > 0 && local.progress < 100 {
                local.remaining_bytes = local.total_bytes.saturating_sub(local.downloaded_bytes);
            }
        }
        local.updated_at = session.updated_at;

        self.db.upsert_download(&local)?;
        Ok(())
    }

    fn resolve_xdelta_mode(expected_file_bytes: Option<i64>) -> String {
        let bytes = expected_file_bytes.unwrap_or(0);
        if bytes < XDELTA_MIN_BYTES {
            return "chunk_only".to_string();
        }
        if !Self::has_xdelta3() {
            return "chunk_only".to_string();
        }
        "chunk_plus_xdelta".to_string()
    }

    fn has_xdelta3() -> bool {
        let mut command = Command::new("xdelta3");
        hide_console_window(&mut command);
        command
            .arg("-V")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
}

fn resolve_plan_path(install_root: &Path, raw: &str) -> PathBuf {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        return path;
    }
    install_root.join(path)
}

fn hash_sha256_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};

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

trait OptionalRowExt<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}

impl<T> OptionalRowExt<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err),
        }
    }
}
