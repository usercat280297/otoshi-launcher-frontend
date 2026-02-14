use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributeStats {
    pub total_games: u32,
    pub total_downloads: u64,
    pub total_revenue: f64,
    pub pending_payouts: f64,
    pub active_users: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SDKDownload {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub download_url: String,
    pub size_mb: f64,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSubmission {
    pub title: String,
    pub description: String,
    pub genres: Vec<String>,
    pub price: f64,
    pub platforms: Vec<String>,
    pub release_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSubmissionResponse {
    pub id: String,
    pub title: String,
    pub status: String,
    pub submitted_at: String,
    pub message: String,
}

/// Get distribution statistics for the current developer
#[tauri::command]
pub async fn get_distribute_stats() -> Result<DistributeStats, String> {
    Ok(DistributeStats {
        total_games: 0,
        total_downloads: 0,
        total_revenue: 0.0,
        pending_payouts: 0.0,
        active_users: 0,
    })
}

/// Get available SDK downloads
#[tauri::command]
pub async fn get_sdk_downloads() -> Result<Vec<SDKDownload>, String> {
    Ok(vec![
        SDKDownload {
            name: "OTOSHI SDK for Windows".to_string(),
            version: "2.1.0".to_string(),
            platform: "windows".to_string(),
            download_url: "https://sdk.otoshi-launcher.me/releases/otoshi-sdk-2.1.0-win64.zip"
                .to_string(),
            size_mb: 45.2,
            checksum: "sha256:abc123def456...".to_string(),
        },
        SDKDownload {
            name: "OTOSHI SDK for Linux".to_string(),
            version: "2.1.0".to_string(),
            platform: "linux".to_string(),
            download_url: "https://sdk.otoshi-launcher.me/releases/otoshi-sdk-2.1.0-linux.tar.gz"
                .to_string(),
            size_mb: 42.8,
            checksum: "sha256:789xyz012...".to_string(),
        },
        SDKDownload {
            name: "OTOSHI SDK for macOS".to_string(),
            version: "2.1.0".to_string(),
            platform: "macos".to_string(),
            download_url: "https://sdk.otoshi-launcher.me/releases/otoshi-sdk-2.1.0-macos.pkg"
                .to_string(),
            size_mb: 48.1,
            checksum: "sha256:456abc789...".to_string(),
        },
        SDKDownload {
            name: "OTOSHI CLI Tool".to_string(),
            version: "1.5.0".to_string(),
            platform: "cross-platform".to_string(),
            download_url: "https://sdk.otoshi-launcher.me/releases/otoshi-cli-1.5.0.zip"
                .to_string(),
            size_mb: 12.3,
            checksum: "sha256:cli123abc...".to_string(),
        },
    ])
}

/// Submit a new game for review
#[tauri::command]
pub async fn submit_game(submission: GameSubmission) -> Result<GameSubmissionResponse, String> {
    if submission.title.len() < 3 {
        return Err("Game title must be at least 3 characters".to_string());
    }

    if submission.price < 0.0 {
        return Err("Price cannot be negative".to_string());
    }

    let now = chrono::Utc::now();
    let submission_id = format!("sub_{}", now.format("%Y%m%d%H%M%S"));

    Ok(GameSubmissionResponse {
        id: submission_id,
        title: submission.title,
        status: "pending_review".to_string(),
        submitted_at: now.to_rfc3339(),
        message:
            "Your game has been submitted for review. We'll notify you within 2-5 business days."
                .to_string(),
    })
}
