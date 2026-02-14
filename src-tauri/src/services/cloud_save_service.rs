use serde::{Deserialize, Serialize};

use crate::errors::Result;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct CloudSaveService {
    api: ApiClient,
}

impl CloudSaveService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn upload_save(
        &self,
        game_id: &str,
        payload: serde_json::Value,
    ) -> Result<CloudSave> {
        let request = CloudSaveRequest {
            game_id: game_id.to_string(),
            payload,
            version: None,
        };
        self.api.post("/cloud-saves", request, true).await
    }

    pub async fn fetch_save(&self, game_id: &str) -> Result<CloudSave> {
        self.api.get(&format!("/cloud-saves/{game_id}"), true).await
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct CloudSaveRequest {
    game_id: String,
    payload: serde_json::Value,
    version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudSave {
    pub id: String,
    pub user_id: String,
    pub game_id: String,
    pub payload: serde_json::Value,
    pub version: String,
    pub updated_at: String,
}
