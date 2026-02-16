use once_cell::sync::Lazy;
use serde::Deserialize;
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;

use tauri::State;

use crate::services::{ArtworkPrefetchItem, ArtworkSources};
use crate::utils::paths::resolve_games_dir;
use crate::AppState;

static START_INSTANT: Lazy<Instant> = Lazy::new(Instant::now);

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PerfSnapshot {
    startup_ms: u64,
    interactive_ms: u64,
    long_tasks: u32,
    fps_avg: f32,
    cache_hit_rate: f32,
    decode_ms: u32,
    upload_ms: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct ArtworkSourcesPayload {
    pub t0: Option<String>,
    pub t1: Option<String>,
    pub t2: Option<String>,
    pub t3: Option<String>,
    pub t4: Option<String>,
}

impl From<ArtworkSourcesPayload> for ArtworkSources {
    fn from(value: ArtworkSourcesPayload) -> Self {
        Self {
            t0: value.t0,
            t1: value.t1,
            t2: value.t2,
            t3: value.t3,
            t4: value.t4,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ArtworkPrefetchPayload {
    pub game_id: String,
    #[serde(default)]
    pub sources: ArtworkSourcesPayload,
}

impl From<ArtworkPrefetchPayload> for ArtworkPrefetchItem {
    fn from(value: ArtworkPrefetchPayload) -> Self {
        Self {
            game_id: value.game_id,
            sources: value.sources.into(),
        }
    }
}

#[tauri::command]
pub async fn build_local_manifest(
    source_dir: String,
    output_path: String,
    chunk_size: Option<u32>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let size = chunk_size.unwrap_or(1024 * 1024);
    state
        .manifests
        .build_manifest(&source_dir, &output_path, size)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn set_download_limit(
    max_mbps: f64,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .download_manager
        .set_download_limit(max_mbps)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_default_install_root(app: tauri::AppHandle) -> Result<String, String> {
    Ok(resolve_games_dir(&app).to_string_lossy().to_string())
}

#[tauri::command]
pub async fn artwork_get(
    game_id: String,
    tier: i32,
    dpi: i32,
    sources: Option<ArtworkSourcesPayload>,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    let normalized_sources = sources.map(ArtworkSources::from);
    state
        .artwork_cache
        .get_data_url(&game_id, tier, dpi, normalized_sources.as_ref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn artwork_prefetch(
    game_ids: Option<Vec<String>>,
    items: Option<Vec<ArtworkPrefetchPayload>>,
    tier_hint: i32,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let mut payload: Vec<ArtworkPrefetchItem> = items
        .unwrap_or_default()
        .into_iter()
        .map(ArtworkPrefetchItem::from)
        .filter(|entry| !entry.game_id.trim().is_empty())
        .collect();

    if payload.is_empty() {
        payload = game_ids
            .unwrap_or_default()
            .into_iter()
            .filter(|id| !id.trim().is_empty())
            .map(|game_id| ArtworkPrefetchItem {
                game_id,
                sources: ArtworkSources::default(),
            })
            .collect();
    }

    if payload.is_empty() {
        return Ok(false);
    }

    state
        .artwork_cache
        .prefetch(payload, tier_hint)
        .await
        .map(|warmed| warmed > 0)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn artwork_release(game_id: String, state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    state
        .artwork_cache
        .release(&game_id)
        .map(|_| true)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn perf_snapshot(state: State<'_, Arc<AppState>>) -> Result<PerfSnapshot, String> {
    let elapsed = START_INSTANT.elapsed().as_millis() as u64;
    let metrics = state.artwork_cache.metrics_snapshot();
    let hit_total = metrics.memory_hits.saturating_add(metrics.disk_hits);
    let request_total = hit_total.saturating_add(metrics.misses);
    let cache_hit_rate = if request_total == 0 {
        0.0
    } else {
        ((hit_total as f64 / request_total as f64) * 100.0) as f32
    };

    Ok(PerfSnapshot {
        startup_ms: elapsed,
        interactive_ms: elapsed,
        long_tasks: 0,
        fps_avg: 0.0,
        cache_hit_rate,
        decode_ms: metrics.decode_ms.min(u32::MAX as u64) as u32,
        upload_ms: metrics.upload_ms.min(u32::MAX as u64) as u32,
    })
}
