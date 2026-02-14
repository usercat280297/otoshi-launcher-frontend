use serde::{Deserialize, Serialize};

use crate::errors::Result;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct WorkshopService {
    api: ApiClient,
}

impl WorkshopService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn list_items(
        &self,
        game_id: Option<&str>,
        search: Option<&str>,
    ) -> Result<Vec<WorkshopItem>> {
        let mut path = "/workshop/items".to_string();
        let mut params = Vec::new();
        if let Some(value) = game_id {
            params.push(format!("game_id={}", value));
        }
        if let Some(value) = search {
            params.push(format!("search={}", value));
        }
        if !params.is_empty() {
            path.push('?');
            path.push_str(&params.join("&"));
        }
        self.api.get(&path, true).await
    }

    pub async fn list_versions(&self, item_id: &str) -> Result<Vec<WorkshopVersion>> {
        let path = format!("/workshop/items/{}/versions", item_id);
        self.api.get(&path, true).await
    }

    pub async fn list_subscriptions(&self) -> Result<Vec<WorkshopSubscription>> {
        self.api.get("/workshop/subscriptions", true).await
    }

    pub async fn subscribe(&self, item_id: &str) -> Result<WorkshopSubscription> {
        let path = format!("/workshop/items/{}/subscribe", item_id);
        self.api.post(&path, serde_json::json!({}), true).await
    }

    pub async fn unsubscribe(&self, item_id: &str) -> Result<()> {
        let path = format!("/workshop/items/{}/subscribe", item_id);
        let _: serde_json::Value = self.api.delete(&path, true).await?;
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkshopItem {
    pub id: String,
    pub game_id: String,
    pub creator_id: String,
    pub title: String,
    pub description: Option<String>,
    pub item_type: Option<String>,
    pub visibility: String,
    pub total_downloads: i32,
    pub total_subscriptions: i32,
    pub rating_up: i32,
    pub rating_down: i32,
    pub tags: Vec<String>,
    pub preview_image_url: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkshopVersion {
    pub id: String,
    pub workshop_item_id: String,
    pub version: String,
    pub changelog: Option<String>,
    pub file_size: i64,
    pub download_url: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkshopSubscription {
    pub id: String,
    pub workshop_item_id: String,
    pub subscribed_at: String,
    pub auto_update: bool,
    pub item: Option<WorkshopItem>,
}
