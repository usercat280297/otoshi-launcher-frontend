use serde::{Deserialize, Serialize};

use crate::errors::Result;
use crate::models::Game;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct RemoteDownloadService {
    api: ApiClient,
}

impl RemoteDownloadService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn list(&self) -> Result<Vec<RemoteDownload>> {
        self.api.get("/remote-downloads", true).await
    }

    pub async fn queue(&self, game_id: &str, target_device: &str) -> Result<RemoteDownload> {
        let payload = RemoteDownloadRequest {
            game_id: game_id.to_string(),
            target_device: target_device.to_string(),
        };
        self.api
            .post("/remote-downloads/queue", payload, true)
            .await
    }

    pub async fn update_status(&self, download_id: &str, status: &str) -> Result<RemoteDownload> {
        let path = format!("/remote-downloads/{}/status?status={}", download_id, status);
        self.api.post(&path, serde_json::json!({}), true).await
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RemoteDownload {
    pub id: String,
    pub game: Game,
    pub target_device: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RemoteDownloadRequest {
    game_id: String,
    target_device: String,
}
