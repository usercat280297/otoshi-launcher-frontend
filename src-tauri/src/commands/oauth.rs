use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::models::AuthResponse;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthExchangeResult {
    pub success: bool,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub error: Option<String>,
    pub next_path: Option<String>,
}

/// Exchange OAuth code for tokens via backend API
#[tauri::command]
pub async fn exchange_oauth_code(
    code: String,
    state: State<'_, Arc<AppState>>,
) -> Result<OAuthExchangeResult, String> {
    let response = state
        .api
        .client()
        .post(format!("{}/auth/oauth/exchange", state.api.base_url()))
        .json(&serde_json::json!({ "code": code }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Ok(OAuthExchangeResult {
            success: false,
            access_token: None,
            refresh_token: None,
            error: Some(format!("OAuth exchange failed ({}): {}", status, body)),
            next_path: None,
        });
    }

    let auth: AuthResponse = response.json().await.map_err(|e| e.to_string())?;

    // Save tokens to auth service
    if let Err(e) = state
        .auth
        .set_tokens_external(Some(auth.access_token.clone()), auth.refresh_token.clone())
    {
        tracing::warn!("Failed to save OAuth tokens: {}", e);
    }

    Ok(OAuthExchangeResult {
        success: true,
        access_token: Some(auth.access_token),
        refresh_token: auth.refresh_token,
        error: None,
        next_path: None,
    })
}

/// Get the OAuth start URL for a provider
#[tauri::command]
pub async fn get_oauth_start_url(
    provider: String,
    next_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    // For Tauri app, we use the otoshi:// deep-link protocol
    let redirect_uri = format!(
        "otoshi://oauth/callback?next={}",
        urlencoding::encode(&next_path)
    );

    let url = format!(
        "{}/auth/oauth/{}/start?redirect_uri={}",
        state.api.base_url(),
        provider,
        urlencoding::encode(&redirect_uri)
    );

    Ok(url)
}
