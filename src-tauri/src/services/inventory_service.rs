use serde::{Deserialize, Serialize};

use crate::errors::Result;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct InventoryService {
    api: ApiClient,
}

impl InventoryService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn list_inventory(&self) -> Result<Vec<InventoryItem>> {
        self.api.get("/inventory", true).await
    }

    pub async fn card_drop(&self, game_id: &str) -> Result<InventoryItem> {
        let path = format!("/inventory/cards/drop/{}", game_id);
        self.api.post(&path, serde_json::json!({}), true).await
    }

    pub async fn craft_badge(&self, game_id: &str) -> Result<InventoryItem> {
        let path = format!("/inventory/badges/craft/{}", game_id);
        self.api.post(&path, serde_json::json!({}), true).await
    }

    pub async fn list_trades(&self) -> Result<Vec<TradeOffer>> {
        self.api.get("/inventory/trades", true).await
    }

    pub async fn create_trade(&self, request: TradeOfferRequest) -> Result<TradeOffer> {
        self.api.post("/inventory/trades", request, true).await
    }

    pub async fn accept_trade(&self, trade_id: &str) -> Result<TradeOffer> {
        let path = format!("/inventory/trades/{}/accept", trade_id);
        self.api.post(&path, serde_json::json!({}), true).await
    }

    pub async fn decline_trade(&self, trade_id: &str) -> Result<TradeOffer> {
        let path = format!("/inventory/trades/{}/decline", trade_id);
        self.api.post(&path, serde_json::json!({}), true).await
    }

    pub async fn cancel_trade(&self, trade_id: &str) -> Result<TradeOffer> {
        let path = format!("/inventory/trades/{}/cancel", trade_id);
        self.api.post(&path, serde_json::json!({}), true).await
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct InventoryItem {
    pub id: String,
    pub user_id: String,
    pub game_id: Option<String>,
    pub item_type: String,
    pub name: String,
    pub rarity: String,
    pub quantity: i32,
    pub metadata: serde_json::Value,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TradeOffer {
    pub id: String,
    pub from_user_id: String,
    pub to_user_id: String,
    pub offered_item_ids: Vec<String>,
    pub requested_item_ids: Vec<String>,
    pub status: String,
    pub created_at: String,
    pub expires_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TradeOfferRequest {
    pub to_user_id: String,
    pub offered_item_ids: Vec<String>,
    pub requested_item_ids: Vec<String>,
}
