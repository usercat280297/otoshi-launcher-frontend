use std::sync::Arc;

use tauri::State;

use crate::utils::paths::resolve_games_dir;
use crate::AppState;

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
