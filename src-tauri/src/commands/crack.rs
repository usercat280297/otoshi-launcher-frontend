use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::services::crack_manager::{
    CrackDownloadProgress, CrackInstallResult, CrackOption, CrackUninstallResult, GameInstallInfo,
};
use crate::AppState;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrackDownloadRequest {
    pub app_id: String,
    pub option: CrackOption,
    pub game_path: String,
}

#[tauri::command]
pub async fn check_game_installed(
    app_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<GameInstallInfo, String> {
    state
        .crack_manager
        .check_game_installed(&app_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_crack(
    request: CrackDownloadRequest,
    state: State<'_, Arc<AppState>>,
) -> Result<CrackInstallResult, String> {
    // First verify game is installed
    let game_info = state
        .crack_manager
        .check_game_installed(&request.app_id)
        .await
        .map_err(|e| e.to_string())?;

    if !game_info.installed {
        return Err("Game is not installed. Please install the game first.".to_string());
    }

    let game_path = request.game_path.clone();

    state
        .crack_manager
        .download_crack(&request.app_id, &request.option, &game_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_crack_progress(
    app_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<CrackDownloadProgress>, String> {
    Ok(state.crack_manager.get_progress(&app_id))
}

#[tauri::command]
pub async fn cancel_crack_download(
    app_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .crack_manager
        .cancel_crack_download(&app_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn uninstall_crack(
    app_id: String,
    game_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<CrackUninstallResult, String> {
    state
        .crack_manager
        .uninstall_crack(&app_id, &game_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn is_crack_installed(
    app_id: String,
    game_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    state
        .crack_manager
        .is_crack_installed(&app_id, &game_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn verify_game_integrity_after_uninstall(
    app_id: String,
    game_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let path = std::path::PathBuf::from(&game_path);
    state
        .crack_manager
        .verify_game_integrity(&app_id, &path)
        .await
        .map_err(|e| e.to_string())
}
