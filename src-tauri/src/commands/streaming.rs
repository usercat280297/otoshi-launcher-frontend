use std::sync::Arc;

use tauri::State;

use crate::services::streaming_service::StreamingSession;
use crate::AppState;

#[tauri::command]
pub async fn create_streaming_session(
    game_id: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<StreamingSession, String> {
    state
        .streaming
        .create_session(game_id.as_deref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_streaming_session(
    session_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<StreamingSession, String> {
    state
        .streaming
        .get_session(&session_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn set_streaming_offer(
    session_id: String,
    offer: serde_json::Value,
    state: State<'_, Arc<AppState>>,
) -> Result<StreamingSession, String> {
    state
        .streaming
        .set_offer(&session_id, offer)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn set_streaming_answer(
    session_id: String,
    answer: serde_json::Value,
    state: State<'_, Arc<AppState>>,
) -> Result<StreamingSession, String> {
    state
        .streaming
        .set_answer(&session_id, answer)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn add_streaming_ice_candidate(
    session_id: String,
    candidate: serde_json::Value,
    state: State<'_, Arc<AppState>>,
) -> Result<StreamingSession, String> {
    state
        .streaming
        .add_ice_candidate(&session_id, candidate)
        .await
        .map_err(|err| err.to_string())
}
