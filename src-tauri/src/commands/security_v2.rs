use std::sync::Arc;

use tauri::State;

use crate::services::SecurityVerdictV2;
use crate::AppState;

#[tauri::command]
pub async fn inspect_security_v2(
    action: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<SecurityVerdictV2, String> {
    let verdict = state
        .security_guard_v2
        .evaluate(action.as_deref().unwrap_or("inspect_security_v2"));
    Ok(verdict)
}

#[tauri::command]
pub async fn enforce_security_v2(
    action: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<SecurityVerdictV2, String> {
    state
        .security_guard_v2
        .enforce(action.as_deref().unwrap_or("enforce_security_v2"))
        .map_err(|err| err.to_string())
}

