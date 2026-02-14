use std::sync::Arc;

use serde::Deserialize;
use tauri::State;

use crate::models::{AuthResponse, UserProfile};
use crate::AppState;

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email_or_username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct TokenSyncRequest {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
}

#[tauri::command]
pub async fn login(
    request: LoginRequest,
    state: State<'_, Arc<AppState>>,
) -> Result<AuthResponse, String> {
    state
        .auth
        .login(&request.email_or_username, &request.password)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn logout(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.auth.logout().await.map_err(|err| err.to_string())
}

#[tauri::command]
pub fn set_auth_tokens(
    request: Option<TokenSyncRequest>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let access = request
        .as_ref()
        .and_then(|item| item.access_token.clone())
        .or(access_token);
    let refresh = request
        .as_ref()
        .and_then(|item| item.refresh_token.clone())
        .or(refresh_token);
    state
        .auth
        .set_tokens_external(access, refresh)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_current_user(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<UserProfile>, String> {
    state
        .auth
        .get_current_user()
        .await
        .map_err(|err| err.to_string())
}
