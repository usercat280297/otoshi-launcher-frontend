use std::sync::Arc;

use tauri::State;

use crate::services::remote_download_service::RemoteDownload;
use crate::AppState;

#[tauri::command]
pub async fn list_remote_downloads(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<RemoteDownload>, String> {
    state
        .remote_downloads
        .list()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn queue_remote_download(
    game_id: String,
    target_device: String,
    state: State<'_, Arc<AppState>>,
) -> Result<RemoteDownload, String> {
    state
        .remote_downloads
        .queue(&game_id, &target_device)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn update_remote_download_status(
    download_id: String,
    status: String,
    state: State<'_, Arc<AppState>>,
) -> Result<RemoteDownload, String> {
    state
        .remote_downloads
        .update_status(&download_id, &status)
        .await
        .map_err(|err| err.to_string())
}
