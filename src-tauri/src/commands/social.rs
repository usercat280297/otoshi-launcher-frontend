use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::services::achievement_service::UserAchievement;
use crate::services::cloud_save_service::CloudSave;
use crate::AppState;

#[tauri::command]
pub async fn unlock_achievement(
    game_id: String,
    achievement_key: String,
    state: State<'_, Arc<AppState>>,
) -> Result<UserAchievement, String> {
    state
        .achievements
        .unlock(&game_id, &achievement_key)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_achievements(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<UserAchievement>, String> {
    state
        .achievements
        .list_user()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn upload_cloud_save(
    game_id: String,
    payload: Value,
    state: State<'_, Arc<AppState>>,
) -> Result<CloudSave, String> {
    state
        .cloud_saves
        .upload_save(&game_id, payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn fetch_cloud_save(
    game_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<CloudSave, String> {
    state
        .cloud_saves
        .fetch_save(&game_id)
        .await
        .map_err(|err| err.to_string())
}
