use reqwest::Method;
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::time::Duration;

use crate::errors::{LauncherError, Result};
use crate::services::AuthService;

#[derive(Clone)]
pub struct ApiClient {
    client: reqwest::Client,
    base_url: String,
    auth: AuthService,
}

impl ApiClient {
    pub fn new(base_url: String, auth: AuthService) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(6))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            base_url,
            auth,
        }
    }

    /// Get the underlying reqwest client for custom requests
    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    /// Get the base URL for the API
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str, auth: bool) -> Result<T> {
        self.request(Method::GET, path, Option::<()>::None, auth)
            .await
    }

    pub async fn post<T: DeserializeOwned, B: Serialize + Clone>(
        &self,
        path: &str,
        body: B,
        auth: bool,
    ) -> Result<T> {
        self.request(Method::POST, path, Some(body), auth).await
    }

    pub async fn delete<T: DeserializeOwned>(&self, path: &str, auth: bool) -> Result<T> {
        self.request(Method::DELETE, path, Option::<()>::None, auth)
            .await
    }

    async fn request<T: DeserializeOwned, B: Serialize + Clone>(
        &self,
        method: Method,
        path: &str,
        body: Option<B>,
        auth_required: bool,
    ) -> Result<T> {
        self.request_with_retry(method, path, body, auth_required, true)
            .await
    }

    async fn request_with_retry<T: DeserializeOwned, B: Serialize + Clone>(
        &self,
        method: Method,
        path: &str,
        body: Option<B>,
        auth_required: bool,
        allow_refresh: bool,
    ) -> Result<T> {
        let url = format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        );
        let mut refreshed = false;

        loop {
            let mut request = self.client.request(method.clone(), &url);

            if auth_required {
                let token = match self.auth.access_token() {
                    Some(token) => token,
                    None if allow_refresh => self.auth.refresh_access_token().await?,
                    None => {
                        return Err(LauncherError::Auth("no access token available".to_string()))
                    }
                };
                request = request.bearer_auth(token);
            }

            if let Some(payload) = body.as_ref() {
                request = request.json(payload);
            }

            let response = request.send().await?;
            if response.status() == StatusCode::UNAUTHORIZED
                && auth_required
                && allow_refresh
                && !refreshed
            {
                self.auth.refresh_access_token().await?;
                refreshed = true;
                continue;
            }

            if !response.status().is_success() {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                return Err(LauncherError::Http(format!(
                    "HTTP {}: {}",
                    status.as_u16(),
                    text
                )));
            }

            let value = response.json::<T>().await?;
            return Ok(value);
        }
    }
}
