use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;

use crate::db::queries::{DownloadQueries, DownloadStateQueries};
use crate::models::{DownloadPreparePayload, DownloadTask, Game, LocalDownload};
use crate::AppState;

fn sanitize_folder_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .to_string()
}

fn resolve_install_override(
    payload: &DownloadPreparePayload,
    game_title: &str,
    game_slug: &str,
) -> Option<String> {
    let root = payload.install_path.trim();
    if root.is_empty() {
        return None;
    }

    let mut path = PathBuf::from(root);
    if payload.create_subfolder {
        let mut folder = sanitize_folder_name(game_title);
        if folder.is_empty() {
            folder = sanitize_folder_name(game_slug);
        }
        if folder.is_empty() {
            folder = "Game".to_string();
        }
        path.push(folder);
    }

    Some(path.to_string_lossy().to_string())
}

fn local_download_to_task(local: &LocalDownload, slug: Option<String>) -> DownloadTask {
    DownloadTask {
        id: local.id.clone(),
        status: local.status.clone(),
        progress: local.progress,
        speed_mbps: local.speed_mbps,
        eta_minutes: local.eta_minutes,
        downloaded_bytes: local.downloaded_bytes,
        total_bytes: local.total_bytes,
        network_bps: local.network_bps,
        disk_read_bps: local.disk_read_bps,
        disk_write_bps: local.disk_write_bps,
        read_bytes: local.read_bytes,
        written_bytes: local.written_bytes,
        remaining_bytes: local.remaining_bytes,
        game: Game {
            id: local.game_id.clone(),
            slug: slug.unwrap_or_else(|| local.game_id.clone()),
            title: local.game_id.clone(),
            tagline: None,
            description: None,
            studio: None,
            release_date: None,
            genres: Vec::new(),
            price: 0.0,
            discount_percent: 0,
            rating: 0.0,
            header_image: None,
            hero_image: None,
        },
    }
}

fn fallback_task_with_status(
    state: &Arc<AppState>,
    download_id: &str,
    status: &str,
) -> Result<DownloadTask, String> {
    let mut local = state
        .db
        .get_downloads()
        .map_err(|err| err.to_string())?
        .into_iter()
        .find(|item| item.id == download_id)
        .unwrap_or(LocalDownload {
            id: download_id.to_string(),
            game_id: download_id.to_string(),
            status: status.to_string(),
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

    local.status = status.to_string();
    if status != "downloading" {
        local.speed_mbps = 0.0;
        local.network_bps = 0;
    }
    local.updated_at = chrono::Utc::now().timestamp();

    state
        .db
        .upsert_download(&local)
        .map_err(|err| err.to_string())?;

    let slug = state
        .db
        .get_download_state(download_id)
        .ok()
        .flatten()
        .map(|item| item.slug);

    Ok(local_download_to_task(&local, slug))
}

fn enforce_download_guard(state: &Arc<AppState>, action: &str) -> Result<(), String> {
    state
        .security_guard_v2
        .enforce(action)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn start_download(
    game_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<DownloadTask, String> {
    enforce_download_guard(state.inner(), "start_download")?;

    let task = state
        .downloads
        .start_download(&game_id)
        .await
        .map_err(|err| err.to_string())?;

    state
        .download_manager
        .start_download(&task.id, &task.game.id, &task.game.slug, None, None)
        .await
        .map_err(|err| err.to_string())?;

    let local = LocalDownload {
        id: task.id.clone(),
        game_id: task.game.id.clone(),
        status: task.status.clone(),
        progress: task.progress,
        speed_mbps: task.speed_mbps,
        eta_minutes: task.eta_minutes,
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        network_bps: task.network_bps,
        disk_read_bps: task.disk_read_bps,
        disk_write_bps: task.disk_write_bps,
        read_bytes: task.read_bytes,
        written_bytes: task.written_bytes,
        remaining_bytes: task.remaining_bytes,
        speed_history: Vec::new(),
        updated_at: chrono::Utc::now().timestamp(),
    };
    state
        .db
        .upsert_download(&local)
        .map_err(|err| err.to_string())?;

    Ok(task)
}

#[tauri::command]
pub async fn start_steam_download(
    app_id: String,
    payload: DownloadPreparePayload,
    token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<DownloadTask, String> {
    enforce_download_guard(state.inner(), "start_steam_download")?;

    tracing::info!(
        "start_steam_download requested app_id={} method={} version={}",
        app_id,
        payload.method,
        payload.version
    );

    // Always prioritize the current frontend token when provided.
    if let Some(frontend_token) = token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        state
            .auth
            .set_tokens_external(Some(frontend_token), None)
            .map_err(|err| err.to_string())?;
    }

    if let Err(err) = state.auth.ensure_access_token().await {
        tracing::warn!(
            "start_steam_download auth check failed app_id={} error={}",
            app_id,
            err
        );
        return Err(format!(
            "Authentication required. Please login to download games. ({})",
            err
        ));
    }

    let task = state
        .downloads
        .start_steam_download(&app_id, &payload)
        .await
        .map_err(|err| {
            tracing::error!(
                "start_steam_download remote task creation failed app_id={} error={}",
                app_id,
                err
            );
            if err.to_string().contains("401") || err.to_string().contains("Unauthorized") {
                "Authentication required. Please login to download games.".to_string()
            } else {
                err.to_string()
            }
        })?;

    let install_override = resolve_install_override(&payload, &task.game.title, &task.game.slug);

    state
        .download_manager
        .start_download(
            &task.id,
            &task.game.id,
            &task.game.slug,
            Some(payload.method.as_str()),
            install_override.as_deref(),
        )
        .await
        .map_err(|err| {
            tracing::error!(
                "start_steam_download manager start failed task_id={} app_id={} error={}",
                task.id,
                app_id,
                err
            );
            err.to_string()
        })?;

    let local = LocalDownload {
        id: task.id.clone(),
        game_id: task.game.id.clone(),
        status: task.status.clone(),
        progress: task.progress,
        speed_mbps: task.speed_mbps,
        eta_minutes: task.eta_minutes,
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        network_bps: task.network_bps,
        disk_read_bps: task.disk_read_bps,
        disk_write_bps: task.disk_write_bps,
        read_bytes: task.read_bytes,
        written_bytes: task.written_bytes,
        remaining_bytes: task.remaining_bytes,
        speed_history: Vec::new(),
        updated_at: chrono::Utc::now().timestamp(),
    };
    state
        .db
        .upsert_download(&local)
        .map_err(|err| err.to_string())?;

    Ok(task)
}

#[tauri::command]
pub async fn pause_download(
    download_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<DownloadTask, String> {
    enforce_download_guard(state.inner(), "pause_download")?;

    if let Err(err) = state.download_manager.pause_download(&download_id).await {
        tracing::warn!("pause_download local runtime signal failed {}: {}", download_id, err);
    }

    let task = match state.downloads.pause_download(&download_id).await {
        Ok(task) => task,
        Err(err) => {
            tracing::warn!("pause_download backend sync failed {}: {}", download_id, err);
            return fallback_task_with_status(state.inner(), &download_id, "paused");
        }
    };

    let local = LocalDownload {
        id: task.id.clone(),
        game_id: task.game.id.clone(),
        status: task.status.clone(),
        progress: task.progress,
        speed_mbps: task.speed_mbps,
        eta_minutes: task.eta_minutes,
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        network_bps: task.network_bps,
        disk_read_bps: task.disk_read_bps,
        disk_write_bps: task.disk_write_bps,
        read_bytes: task.read_bytes,
        written_bytes: task.written_bytes,
        remaining_bytes: task.remaining_bytes,
        speed_history: Vec::new(),
        updated_at: chrono::Utc::now().timestamp(),
    };
    state
        .db
        .upsert_download(&local)
        .map_err(|err| err.to_string())?;

    Ok(task)
}

#[tauri::command]
pub async fn resume_download(
    download_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<DownloadTask, String> {
    enforce_download_guard(state.inner(), "resume_download")?;

    let mut runtime_resumed = state.download_manager.resume_download(&download_id).await.is_ok();
    if !runtime_resumed {
        if let Ok(Some(saved_state)) = state.db.get_download_state(&download_id) {
            let _ = state
                .download_manager
                .start_download(
                    &saved_state.id,
                    &saved_state.game_id,
                    &saved_state.slug,
                    None,
                    Some(saved_state.install_dir.as_str()),
                )
                .await;
            runtime_resumed = state.download_manager.resume_download(&download_id).await.is_ok();
        }
    }
    if !runtime_resumed {
        tracing::warn!("resume_download local runtime resume failed {}", download_id);
    }

    let task = match state.downloads.resume_download(&download_id).await {
        Ok(task) => task,
        Err(err) => {
            tracing::warn!("resume_download backend sync failed {}: {}", download_id, err);
            return fallback_task_with_status(state.inner(), &download_id, "downloading");
        }
    };

    let local = LocalDownload {
        id: task.id.clone(),
        game_id: task.game.id.clone(),
        status: task.status.clone(),
        progress: task.progress,
        speed_mbps: task.speed_mbps,
        eta_minutes: task.eta_minutes,
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        network_bps: task.network_bps,
        disk_read_bps: task.disk_read_bps,
        disk_write_bps: task.disk_write_bps,
        read_bytes: task.read_bytes,
        written_bytes: task.written_bytes,
        remaining_bytes: task.remaining_bytes,
        speed_history: Vec::new(),
        updated_at: chrono::Utc::now().timestamp(),
    };
    state
        .db
        .upsert_download(&local)
        .map_err(|err| err.to_string())?;

    Ok(task)
}

#[tauri::command]
pub async fn cancel_download(
    download_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<DownloadTask, String> {
    enforce_download_guard(state.inner(), "cancel_download")?;

    if let Err(err) = state.download_manager.cancel_download(&download_id).await {
        tracing::warn!("cancel_download local runtime signal failed {}: {}", download_id, err);
    }

    let task = match state.downloads.cancel_download(&download_id).await {
        Ok(task) => task,
        Err(err) => {
            tracing::warn!("cancel_download backend sync failed {}: {}", download_id, err);
            return fallback_task_with_status(state.inner(), &download_id, "cancelled");
        }
    };

    let local = LocalDownload {
        id: task.id.clone(),
        game_id: task.game.id.clone(),
        status: task.status.clone(),
        progress: task.progress,
        speed_mbps: task.speed_mbps,
        eta_minutes: task.eta_minutes,
        downloaded_bytes: task.downloaded_bytes,
        total_bytes: task.total_bytes,
        network_bps: task.network_bps,
        disk_read_bps: task.disk_read_bps,
        disk_write_bps: task.disk_write_bps,
        read_bytes: task.read_bytes,
        written_bytes: task.written_bytes,
        remaining_bytes: task.remaining_bytes,
        speed_history: Vec::new(),
        updated_at: chrono::Utc::now().timestamp(),
    };
    state
        .db
        .upsert_download(&local)
        .map_err(|err| err.to_string())?;
    Ok(task)
}

#[tauri::command]
pub async fn get_download_progress(
    download_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<DownloadTask>, String> {
    let tasks = state
        .downloads
        .list_downloads()
        .await
        .map_err(|err| err.to_string())?;
    Ok(tasks.into_iter().find(|task| task.id == download_id))
}

#[tauri::command]
pub async fn get_cached_downloads(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<LocalDownload>, String> {
    state.db.get_downloads().map_err(|err| err.to_string())
}
