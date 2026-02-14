use std::sync::Arc;

use tauri::State;

use crate::services::{DownloadSessionV2, StartDownloadV2Request};
use crate::AppState;

#[tauri::command]
pub async fn start_download_v2(
    payload: StartDownloadV2Request,
    state: State<'_, Arc<AppState>>,
) -> Result<DownloadSessionV2, String> {
    state
        .security_guard_v2
        .enforce("start_download_v2")
        .map_err(|err| err.to_string())?;
    state
        .download_manager_v2
        .start_download(payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn control_download_v2(
    session_id: String,
    action: String,
    state: State<'_, Arc<AppState>>,
) -> Result<DownloadSessionV2, String> {
    state
        .security_guard_v2
        .enforce("control_download_v2")
        .map_err(|err| err.to_string())?;
    state
        .download_manager_v2
        .control_download(&session_id, &action)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_download_state_v2(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<DownloadSessionV2>, String> {
    state
        .download_manager_v2
        .get_session(&session_id)
        .map_err(|err| err.to_string())
}

