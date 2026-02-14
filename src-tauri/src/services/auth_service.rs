use std::sync::{Arc, Mutex};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::db::queries::SettingsQueries;
use crate::db::Database;
use crate::errors::{LauncherError, Result};
use crate::models::{AuthResponse, UserProfile};
use crate::utils::crypto;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenPair {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
}

#[derive(Clone)]
pub struct AuthService {
    inner: Arc<AuthServiceInner>,
}

struct AuthServiceInner {
    client: reqwest::Client,
    base_url: String,
    store: TokenStore,
    tokens: Mutex<TokenPair>,
}

#[derive(Clone)]
struct TokenStore {
    db: Database,
    key: Vec<u8>,
}

impl TokenStore {
    fn new(db: Database, key: Vec<u8>) -> Self {
        Self { db, key }
    }

    fn save_refresh_token(&self, token: &str) -> Result<()> {
        let encrypted = crypto::encrypt_to_base64(&self.key, token.as_bytes())?;
        self.db.set_setting("refresh_token", &encrypted)?;
        Ok(())
    }

    fn load_refresh_token(&self) -> Result<Option<String>> {
        let value = self.db.get_setting("refresh_token")?;
        if let Some(payload) = value {
            let decrypted = crypto::decrypt_from_base64(&self.key, &payload)?;
            let token = String::from_utf8(decrypted)
                .map_err(|_| LauncherError::Crypto("invalid token data".to_string()))?;
            Ok(Some(token))
        } else {
            Ok(None)
        }
    }

    fn clear(&self) -> Result<()> {
        self.db.delete_setting("refresh_token")?;
        Ok(())
    }
}

impl AuthService {
    pub fn new(base_url: String, db: Database, key: Vec<u8>) -> Self {
        let store = TokenStore::new(db, key);
        let refresh_token = store.load_refresh_token().ok().flatten();
        let tokens = TokenPair {
            access_token: None,
            refresh_token,
        };

        Self {
            inner: Arc::new(AuthServiceInner {
                client: reqwest::Client::new(),
                base_url,
                store,
                tokens: Mutex::new(tokens),
            }),
        }
    }

    pub async fn login(&self, email_or_username: &str, password: &str) -> Result<AuthResponse> {
        let response = self
            .inner
            .client
            .post(format!("{}/auth/login", self.inner.base_url))
            .json(&serde_json::json!({
                "email_or_username": email_or_username,
                "password": password
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(LauncherError::Auth(format!(
                "login failed: {}",
                response.status()
            )));
        }

        let auth: AuthResponse = response.json().await?;
        self.set_tokens(Some(auth.access_token.clone()), auth.refresh_token.clone())?;
        Ok(auth)
    }

    pub async fn logout(&self) -> Result<()> {
        self.inner.store.clear()?;
        let mut guard = self
            .inner
            .tokens
            .lock()
            .map_err(|_| LauncherError::Config("auth lock poisoned".to_string()))?;
        guard.access_token = None;
        guard.refresh_token = None;
        Ok(())
    }

    pub async fn get_current_user(&self) -> Result<Option<UserProfile>> {
        for attempt in 0..2 {
            let token = self
                .access_token()
                .ok_or_else(|| LauncherError::Auth("no access token available".to_string()))?;

            let response = self
                .inner
                .client
                .get(format!("{}/auth/me", self.inner.base_url))
                .bearer_auth(token)
                .send()
                .await?;

            if response.status() == StatusCode::UNAUTHORIZED && attempt == 0 {
                self.refresh_access_token().await?;
                continue;
            }

            if !response.status().is_success() {
                return Err(LauncherError::Auth(format!(
                    "auth check failed: {}",
                    response.status()
                )));
            }

            let user: UserProfile = response.json().await?;
            return Ok(Some(user));
        }

        Err(LauncherError::Auth(
            "auth check failed after refresh".to_string(),
        ))
    }

    pub fn access_token(&self) -> Option<String> {
        self.inner
            .tokens
            .lock()
            .ok()
            .and_then(|guard| guard.access_token.clone())
    }

    /// Check if user is currently authenticated with valid token
    pub fn is_authenticated(&self) -> bool {
        self.access_token().is_some()
    }

    /// Ensure we have a valid access token, refreshing if needed.
    pub async fn ensure_access_token(&self) -> Result<String> {
        if let Some(token) = self.access_token() {
            return Ok(token);
        }
        self.refresh_access_token().await
    }

    /// Validate current token and check if it needs refresh
    pub async fn validate_current_token(&self) -> Result<bool> {
        if let Some(token) = self.access_token() {
            // Try a simple API call to validate token
            let response = self
                .inner
                .client
                .get(format!("{}/auth/validate", self.inner.base_url))
                .bearer_auth(token)
                .send()
                .await?;

            Ok(response.status().is_success())
        } else {
            Ok(false)
        }
    }

    pub async fn refresh_access_token(&self) -> Result<String> {
        let refresh_token = self
            .refresh_token()
            .ok_or_else(|| LauncherError::Auth("no refresh token available".to_string()))?;

        let response = self
            .inner
            .client
            .post(format!("{}/auth/refresh", self.inner.base_url))
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(LauncherError::Auth(format!(
                "refresh failed: {}",
                response.status()
            )));
        }

        let payload: AuthResponse = response.json().await?;
        self.set_tokens(
            Some(payload.access_token.clone()),
            payload.refresh_token.clone(),
        )?;
        Ok(payload.access_token)
    }

    fn refresh_token(&self) -> Option<String> {
        self.inner
            .tokens
            .lock()
            .ok()
            .and_then(|guard| guard.refresh_token.clone())
    }

    fn set_tokens(
        &self,
        access_token: Option<String>,
        refresh_token: Option<String>,
    ) -> Result<()> {
        let mut guard = self
            .inner
            .tokens
            .lock()
            .map_err(|_| LauncherError::Config("auth lock poisoned".to_string()))?;
        guard.access_token = access_token;
        if let Some(refresh) = refresh_token {
            self.inner.store.save_refresh_token(&refresh)?;
            guard.refresh_token = Some(refresh);
        }
        Ok(())
    }

    /// Public method to set tokens from OAuth callback
    pub fn set_tokens_external(
        &self,
        access_token: Option<String>,
        refresh_token: Option<String>,
    ) -> Result<()> {
        self.set_tokens(access_token, refresh_token)
    }
}
