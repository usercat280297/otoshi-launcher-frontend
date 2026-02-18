use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::Value;

use crate::AppState;

#[derive(Debug, Clone)]
struct WorkerConfig {
    enabled: bool,
    startup_delay_ms: u64,
    top_appids_limit: usize,
    concurrency: usize,
    health_attempts: usize,
    include_english_fallback: bool,
}

impl WorkerConfig {
    fn from_env() -> Self {
        Self {
            enabled: read_env_bool("OTOSHI_STEAM_LOCALE_PREFETCH_ENABLED", true),
            startup_delay_ms: read_env_u64("OTOSHI_STEAM_LOCALE_PREFETCH_DELAY_MS", 1200),
            top_appids_limit: read_env_usize("OTOSHI_STEAM_LOCALE_PREFETCH_LIMIT", 60, 8, 400),
            concurrency: read_env_usize("OTOSHI_STEAM_LOCALE_PREFETCH_CONCURRENCY", 6, 1, 32),
            health_attempts: read_env_usize("OTOSHI_STEAM_LOCALE_PREFETCH_HEALTH_ATTEMPTS", 14, 2, 60),
            include_english_fallback: read_env_bool(
                "OTOSHI_STEAM_LOCALE_PREFETCH_INCLUDE_EN",
                true,
            ),
        }
    }
}

#[derive(Debug, Deserialize)]
struct LocaleSettingsResponse {
    #[serde(default)]
    locale: Option<String>,
    #[serde(default, alias = "systemLocale")]
    system_locale: Option<String>,
}

fn read_env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(default)
}

fn read_env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn read_env_usize(key: &str, default: usize, min: usize, max: usize) -> usize {
    let parsed = std::env::var(key)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(default);
    parsed.clamp(min, max)
}

fn normalize_locale(value: Option<String>) -> String {
    let raw = value.unwrap_or_else(|| "en".to_string());
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.starts_with("vi") {
        "vi".to_string()
    } else {
        "en".to_string()
    }
}

fn extract_numeric_id(node: &Value) -> Option<String> {
    if let Some(number) = node.as_u64() {
        return Some(number.to_string());
    }
    let value = node.as_str()?.trim();
    if !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()) {
        Some(value.to_string())
    } else {
        None
    }
}

fn extract_app_id(item: &Value) -> Option<String> {
    item.get("app_id")
        .or_else(|| item.get("appId"))
        .or_else(|| item.get("id"))
        .and_then(extract_numeric_id)
}

fn append_app_ids(payload: &Value, output: &mut Vec<String>, seen: &mut HashSet<String>, limit: usize) {
    let Some(items) = payload.get("items").and_then(|value| value.as_array()) else {
        return;
    };
    for item in items {
        if output.len() >= limit {
            break;
        }
        let Some(app_id) = extract_app_id(item) else {
            continue;
        };
        if seen.insert(app_id.clone()) {
            output.push(app_id);
        }
    }
}

async fn wait_for_backend_health(state: &Arc<AppState>, attempts: usize) -> bool {
    let health_url = format!("{}/health", state.api.base_url().trim_end_matches('/'));
    for attempt in 0..attempts {
        let ready = state
            .api
            .client()
            .get(&health_url)
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false);
        if ready {
            return true;
        }
        let delay_ms = 220_u64 + (attempt as u64 * 80);
        tokio::time::sleep(Duration::from_millis(delay_ms.min(1000))).await;
    }
    false
}

async fn resolve_target_locale(state: &Arc<AppState>) -> String {
    let payload = state
        .api
        .get::<LocaleSettingsResponse>("/settings/locale", false)
        .await
        .ok();
    let preferred = payload
        .as_ref()
        .and_then(|settings| settings.locale.clone().or_else(|| settings.system_locale.clone()));
    normalize_locale(preferred)
}

async fn load_top_app_ids(state: &Arc<AppState>, limit: usize) -> Vec<String> {
    let mut app_ids: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let paths = vec![
        format!("/steam/search/popular?limit={limit}&offset=0"),
        format!("/steam/index/catalog?limit={limit}&offset=0&scope=all&sort=priority"),
        format!("/steam/catalog?limit={limit}&offset=0"),
    ];

    for path in paths {
        if app_ids.len() >= limit {
            break;
        }
        match state.api.get::<Value>(&path, false).await {
            Ok(payload) => append_app_ids(&payload, &mut app_ids, &mut seen, limit),
            Err(err) => tracing::debug!("steam locale prefetch: source {} failed: {}", path, err),
        }
    }

    app_ids
}

async fn prefetch_locale_details(
    state: &Arc<AppState>,
    app_ids: &[String],
    locale: &str,
    concurrency: usize,
) -> usize {
    let locale_value = locale.to_string();
    stream::iter(app_ids.iter().cloned())
        .map(|app_id| {
            let api = state.api.clone();
            let locale_copy = locale_value.clone();
            async move {
                let path = format!(
                    "/steam/games/{}?locale={}",
                    app_id,
                    urlencoding::encode(&locale_copy)
                );
                api.get::<Value>(&path, false).await.is_ok()
            }
        })
        .buffer_unordered(concurrency)
        .fold(0_usize, |acc, ok| async move { if ok { acc + 1 } else { acc } })
        .await
}

async fn run_locale_prefetch(state: Arc<AppState>, config: WorkerConfig) {
    if config.startup_delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(config.startup_delay_ms)).await;
    }

    let ready = wait_for_backend_health(&state, config.health_attempts).await;
    if !ready {
        tracing::warn!(
            "steam locale prefetch: backend not ready after {} attempts",
            config.health_attempts
        );
        return;
    }

    let app_ids = load_top_app_ids(&state, config.top_appids_limit).await;
    if app_ids.is_empty() {
        tracing::warn!("steam locale prefetch: no appids available from catalog/popular endpoints");
        return;
    }

    let locale = resolve_target_locale(&state).await;
    let success_count = prefetch_locale_details(&state, &app_ids, &locale, config.concurrency).await;

    if config.include_english_fallback && locale != "en" {
        let _ = prefetch_locale_details(&state, &app_ids, "en", config.concurrency).await;
    }

    tracing::info!(
        "steam locale prefetch warmed {} / {} details for locale={} (concurrency={})",
        success_count,
        app_ids.len(),
        locale,
        config.concurrency
    );
}

pub fn spawn_locale_prefetch_worker(state: Arc<AppState>) {
    let config = WorkerConfig::from_env();
    if !config.enabled {
        tracing::info!("steam locale prefetch worker disabled by OTOSHI_STEAM_LOCALE_PREFETCH_ENABLED");
        return;
    }

    tauri::async_runtime::spawn(async move {
        run_locale_prefetch(state, config).await;
    });
}
