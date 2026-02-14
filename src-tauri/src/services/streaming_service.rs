use serde::{Deserialize, Serialize};

use crate::errors::Result;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct StreamingService {
    api: ApiClient,
}

impl StreamingService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn create_session(&self, game_id: Option<&str>) -> Result<StreamingSession> {
        let payload = serde_json::json!({ "game_id": game_id });
        self.api.post("/streaming/sessions", payload, true).await
    }

    pub async fn get_session(&self, session_id: &str) -> Result<StreamingSession> {
        let path = format!("/streaming/sessions/{}", session_id);
        self.api.get(&path, true).await
    }

    pub async fn set_offer(
        &self,
        session_id: &str,
        offer: serde_json::Value,
    ) -> Result<StreamingSession> {
        let path = format!("/streaming/sessions/{}/offer", session_id);
        self.api.post(&path, offer, true).await
    }

    pub async fn set_answer(
        &self,
        session_id: &str,
        answer: serde_json::Value,
    ) -> Result<StreamingSession> {
        let path = format!("/streaming/sessions/{}/answer", session_id);
        self.api.post(&path, answer, true).await
    }

    pub async fn add_ice_candidate(
        &self,
        session_id: &str,
        candidate: serde_json::Value,
    ) -> Result<StreamingSession> {
        let path = format!("/streaming/sessions/{}/ice", session_id);
        self.api.post(&path, candidate, true).await
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StreamingSession {
    pub id: String,
    pub user_id: String,
    pub game_id: Option<String>,
    pub status: String,
    pub offer: serde_json::Value,
    pub answer: serde_json::Value,
    pub ice_candidates: Vec<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}
