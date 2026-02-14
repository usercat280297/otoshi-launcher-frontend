use std::sync::Arc;

use tauri::State;

use crate::services::{SelfHealRepairPlanV2, SelfHealReportV2, SelfHealScanRequestV2};
use crate::AppState;

#[tauri::command]
pub async fn run_self_heal_scan_v2(
    payload: SelfHealScanRequestV2,
    state: State<'_, Arc<AppState>>,
) -> Result<SelfHealReportV2, String> {
    state
        .self_heal
        .run_scan(payload)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn apply_self_heal_v2(
    report: SelfHealReportV2,
    state: State<'_, Arc<AppState>>,
) -> Result<SelfHealRepairPlanV2, String> {
    state
        .self_heal
        .build_repair_plan(report)
        .await
        .map_err(|err| err.to_string())
}

