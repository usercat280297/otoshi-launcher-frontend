use once_cell::sync::Lazy;
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use tauri::{Manager, State};
use chrono::Utc;
use sysinfo::System;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AsmCpuCapabilities {
    arch: String,
    vendor: String,
    logical_cores: usize,
    physical_cores: usize,
    total_memory_mb: u64,
    available_memory_mb: u64,
    has_sse42: bool,
    has_avx2: bool,
    has_avx512: bool,
    has_aes_ni: bool,
    has_bmi2: bool,
    has_fma: bool,
    feature_score: u32,
    asm_probe_ticks: Option<u64>,
    fallback_used: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeTuningRecommendation {
    profile: String,
    decode_concurrency: u8,
    prefetch_window: u16,
    polling_fast_ms: u64,
    polling_idle_ms: u64,
    animation_level: String,
    reason: String,
    auto_apply_allowed: bool,
    fallback_used: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuntimeTuningApplyResult {
    applied: bool,
    profile: String,
    decode_concurrency: u8,
    prefetch_window: u16,
    polling_fast_ms: u64,
    polling_idle_ms: u64,
    animation_level: String,
    fallback_used: bool,
    settings_path: String,
    applied_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct RuntimeTuningStateFile {
    enabled: bool,
    profile: String,
    decode_concurrency: u8,
    prefetch_window: u16,
    polling_fast_ms: u64,
    polling_idle_ms: u64,
    animation_level: String,
    fallback_used: bool,
    applied_at: String,
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

#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
fn detect_cpu_vendor() -> String {
    #[cfg(target_arch = "x86")]
    use core::arch::x86::__cpuid;
    #[cfg(target_arch = "x86_64")]
    use core::arch::x86_64::__cpuid;

    // CPUID is the canonical low-level CPU capability probe on x86/x64.
    let leaf0 = unsafe { __cpuid(0) };
    let mut bytes = [0_u8; 12];
    bytes[0..4].copy_from_slice(&leaf0.ebx.to_le_bytes());
    bytes[4..8].copy_from_slice(&leaf0.edx.to_le_bytes());
    bytes[8..12].copy_from_slice(&leaf0.ecx.to_le_bytes());
    String::from_utf8_lossy(&bytes).trim().to_string()
}

#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
fn detect_cpu_vendor() -> String {
    "unknown".to_string()
}

#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
fn asm_probe_ticks() -> Option<u64> {
    // Tiny inline assembly probe to measure a CPU timestamp delta.
    unsafe fn read_rdtsc() -> u64 {
        let lo: u32;
        let hi: u32;
        core::arch::asm!(
            "rdtsc",
            out("eax") lo,
            out("edx") hi,
            options(nomem, nostack, preserves_flags)
        );
        ((hi as u64) << 32) | lo as u64
    }

    let start = unsafe { read_rdtsc() };
    let end = unsafe { read_rdtsc() };
    Some(end.saturating_sub(start))
}

#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
fn asm_probe_ticks() -> Option<u64> {
    None
}

fn collect_cpu_capabilities() -> AsmCpuCapabilities {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let logical_cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1);
    let physical_cores = sys.physical_core_count().unwrap_or(logical_cores);
    let total_memory_mb = sys.total_memory() / (1024 * 1024);
    let available_memory_mb = sys.available_memory() / (1024 * 1024);

    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    let (has_sse42, has_avx2, has_avx512, has_aes_ni, has_bmi2, has_fma) = (
        std::is_x86_feature_detected!("sse4.2"),
        std::is_x86_feature_detected!("avx2"),
        std::is_x86_feature_detected!("avx512f"),
        std::is_x86_feature_detected!("aes"),
        std::is_x86_feature_detected!("bmi2"),
        std::is_x86_feature_detected!("fma"),
    );
    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
    let (has_sse42, has_avx2, has_avx512, has_aes_ni, has_bmi2, has_fma) =
        (false, false, false, false, false, false);

    let feature_score = (if has_sse42 { 15 } else { 0 })
        + (if has_avx2 { 25 } else { 0 })
        + (if has_avx512 { 20 } else { 0 })
        + (if has_aes_ni { 15 } else { 0 })
        + (if has_bmi2 { 15 } else { 0 })
        + (if has_fma { 10 } else { 0 });

    AsmCpuCapabilities {
        arch: std::env::consts::ARCH.to_string(),
        vendor: detect_cpu_vendor(),
        logical_cores,
        physical_cores,
        total_memory_mb,
        available_memory_mb,
        has_sse42,
        has_avx2,
        has_avx512,
        has_aes_ni,
        has_bmi2,
        has_fma,
        feature_score,
        asm_probe_ticks: asm_probe_ticks(),
        fallback_used: !cfg!(any(target_arch = "x86", target_arch = "x86_64")),
    }
}

fn recommendation_from_capabilities(
    capabilities: &AsmCpuCapabilities,
    consent: bool,
    profile_override: Option<&str>,
) -> RuntimeTuningRecommendation {
    if !consent {
        return RuntimeTuningRecommendation {
            profile: "balanced".to_string(),
            decode_concurrency: 4,
            prefetch_window: 24,
            polling_fast_ms: 1100,
            polling_idle_ms: 9000,
            animation_level: "normal".to_string(),
            reason: "opt_in_required".to_string(),
            auto_apply_allowed: false,
            fallback_used: capabilities.fallback_used,
        };
    }

    let mut profile = if capabilities.logical_cores >= 12
        && capabilities.total_memory_mb >= 16_000
        && capabilities.feature_score >= 55
    {
        "performance"
    } else if capabilities.logical_cores <= 4 || capabilities.total_memory_mb <= 8_000 {
        "power_save"
    } else {
        "balanced"
    };

    if let Some(value) = profile_override {
        let normalized = value.trim().to_ascii_lowercase();
        if matches!(normalized.as_str(), "performance" | "balanced" | "power_save") {
            profile = match normalized.as_str() {
                "performance" => "performance",
                "power_save" => "power_save",
                _ => "balanced",
            };
        }
    }

    match profile {
        "performance" => RuntimeTuningRecommendation {
            profile: "performance".to_string(),
            decode_concurrency: 8,
            prefetch_window: 64,
            polling_fast_ms: 700,
            polling_idle_ms: 5000,
            animation_level: "full".to_string(),
            reason: "high_core_count_and_memory".to_string(),
            auto_apply_allowed: true,
            fallback_used: capabilities.fallback_used,
        },
        "power_save" => RuntimeTuningRecommendation {
            profile: "power_save".to_string(),
            decode_concurrency: 2,
            prefetch_window: 12,
            polling_fast_ms: 1600,
            polling_idle_ms: 12000,
            animation_level: "reduced".to_string(),
            reason: "limited_cpu_or_memory_budget".to_string(),
            auto_apply_allowed: true,
            fallback_used: capabilities.fallback_used,
        },
        _ => RuntimeTuningRecommendation {
            profile: "balanced".to_string(),
            decode_concurrency: 4,
            prefetch_window: 28,
            polling_fast_ms: 1000,
            polling_idle_ms: 8000,
            animation_level: "normal".to_string(),
            reason: "balanced_default".to_string(),
            auto_apply_allowed: true,
            fallback_used: capabilities.fallback_used,
        },
    }
}

fn runtime_tuning_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|err| err.to_string())?;
    Ok(data_dir.join("runtime_tuning.json"))
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

#[tauri::command]
pub async fn asm_probe_cpu_capabilities() -> Result<AsmCpuCapabilities, String> {
    Ok(collect_cpu_capabilities())
}

#[tauri::command]
pub async fn runtime_tuning_recommend(
    consent: bool,
    profile: Option<String>,
) -> Result<RuntimeTuningRecommendation, String> {
    let capabilities = collect_cpu_capabilities();
    Ok(recommendation_from_capabilities(
        &capabilities,
        consent,
        profile.as_deref(),
    ))
}

#[tauri::command]
pub async fn runtime_tuning_apply(
    consent: bool,
    profile: Option<String>,
    app: tauri::AppHandle,
) -> Result<RuntimeTuningApplyResult, String> {
    if !consent {
        return Err("runtime tuning requires explicit opt-in".to_string());
    }

    let capabilities = collect_cpu_capabilities();
    let recommendation = recommendation_from_capabilities(&capabilities, true, profile.as_deref());
    let applied_at = Utc::now().to_rfc3339();
    let file_payload = RuntimeTuningStateFile {
        enabled: true,
        profile: recommendation.profile.clone(),
        decode_concurrency: recommendation.decode_concurrency,
        prefetch_window: recommendation.prefetch_window,
        polling_fast_ms: recommendation.polling_fast_ms,
        polling_idle_ms: recommendation.polling_idle_ms,
        animation_level: recommendation.animation_level.clone(),
        fallback_used: recommendation.fallback_used,
        applied_at: applied_at.clone(),
    };
    let settings_path = runtime_tuning_path(&app)?;
    let serialized = serde_json::to_vec_pretty(&file_payload).map_err(|err| err.to_string())?;
    fs::write(&settings_path, serialized).map_err(|err| err.to_string())?;

    Ok(RuntimeTuningApplyResult {
        applied: true,
        profile: recommendation.profile,
        decode_concurrency: recommendation.decode_concurrency,
        prefetch_window: recommendation.prefetch_window,
        polling_fast_ms: recommendation.polling_fast_ms,
        polling_idle_ms: recommendation.polling_idle_ms,
        animation_level: recommendation.animation_level,
        fallback_used: recommendation.fallback_used,
        settings_path: settings_path.to_string_lossy().to_string(),
        applied_at,
    })
}

#[tauri::command]
pub async fn runtime_tuning_rollback(app: tauri::AppHandle) -> Result<bool, String> {
    let settings_path = runtime_tuning_path(&app)?;
    if settings_path.exists() {
        fs::remove_file(settings_path).map_err(|err| err.to_string())?;
    }
    Ok(true)
}
