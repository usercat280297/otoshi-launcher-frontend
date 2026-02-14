use std::sync::Arc;

use tauri::State;

use crate::models::LicenseInfo;
use crate::AppState;

#[tauri::command]
pub async fn get_hardware_id(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    Ok(state.license.get_hardware_id())
}

#[tauri::command]
pub async fn validate_license(
    license_json: String,
    state: State<'_, Arc<AppState>>,
) -> Result<LicenseInfo, String> {
    state
        .license
        .validate_license(&license_json)
        .map_err(|err| err.to_string())
}
