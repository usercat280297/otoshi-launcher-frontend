use crate::errors::Result;
use crate::models::Game;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct DiscoveryService {
    api: ApiClient,
}

impl DiscoveryService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn queue(&self) -> Result<Vec<Game>> {
        self.api.get("/discovery/queue", true).await
    }

    pub async fn refresh_queue(&self) -> Result<Vec<Game>> {
        self.api
            .post("/discovery/queue/refresh", serde_json::json!({}), true)
            .await
    }

    pub async fn similar(&self, game_id: &str) -> Result<Vec<Game>> {
        let path = format!("/discovery/similar/{}", game_id);
        self.api.get(&path, false).await
    }
}
