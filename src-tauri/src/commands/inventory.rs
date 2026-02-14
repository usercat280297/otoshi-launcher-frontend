use std::sync::Arc;

use tauri::State;

use crate::services::inventory_service::{InventoryItem, TradeOffer, TradeOfferRequest};
use crate::AppState;

#[tauri::command]
pub async fn list_inventory(state: State<'_, Arc<AppState>>) -> Result<Vec<InventoryItem>, String> {
    state
        .inventory
        .list_inventory()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn card_drop(
    game_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<InventoryItem, String> {
    state
        .inventory
        .card_drop(&game_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn craft_badge(
    game_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<InventoryItem, String> {
    state
        .inventory
        .craft_badge(&game_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_trades(state: State<'_, Arc<AppState>>) -> Result<Vec<TradeOffer>, String> {
    state
        .inventory
        .list_trades()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn create_trade(
    to_user_id: String,
    offered_item_ids: Vec<String>,
    requested_item_ids: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<TradeOffer, String> {
    let request = TradeOfferRequest {
        to_user_id,
        offered_item_ids,
        requested_item_ids,
    };
    state
        .inventory
        .create_trade(request)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn accept_trade(
    trade_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<TradeOffer, String> {
    state
        .inventory
        .accept_trade(&trade_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn decline_trade(
    trade_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<TradeOffer, String> {
    state
        .inventory
        .decline_trade(&trade_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn cancel_trade(
    trade_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<TradeOffer, String> {
    state
        .inventory
        .cancel_trade(&trade_id)
        .await
        .map_err(|err| err.to_string())
}
