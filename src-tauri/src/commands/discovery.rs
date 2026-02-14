use std::sync::Arc;

use tauri::State;

use crate::models::Game;
use crate::AppState;

#[tauri::command]
pub async fn get_discovery_queue(state: State<'_, Arc<AppState>>) -> Result<Vec<Game>, String> {
    state.discovery.queue().await.map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn refresh_discovery_queue(state: State<'_, Arc<AppState>>) -> Result<Vec<Game>, String> {
    state
        .discovery
        .refresh_queue()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_similar_games(
    game_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<Game>, String> {
    state
        .discovery
        .similar(&game_id)
        .await
        .map_err(|err| err.to_string())
}
