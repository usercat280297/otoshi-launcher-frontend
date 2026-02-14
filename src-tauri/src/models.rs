use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserProfile {
    pub id: String,
    pub username: String,
    pub email: String,
    pub display_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthResponse {
    pub access_token: String,
    pub token_type: String,
    pub user: UserProfile,
    pub refresh_token: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Game {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub tagline: Option<String>,
    pub description: Option<String>,
    pub studio: Option<String>,
    pub release_date: Option<String>,
    pub genres: Vec<String>,
    pub price: f64,
    pub discount_percent: i32,
    pub rating: f64,
    pub header_image: Option<String>,
    pub hero_image: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LibraryEntry {
    pub id: String,
    pub purchased_at: String,
    pub installed_version: Option<String>,
    pub playtime_hours: f64,
    pub game: Game,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadTask {
    pub id: String,
    pub status: String,
    pub progress: i32,
    pub speed_mbps: f64,
    pub eta_minutes: i32,
    #[serde(default)]
    pub downloaded_bytes: i64,
    #[serde(default)]
    pub total_bytes: i64,
    #[serde(default)]
    pub network_bps: i64,
    #[serde(default)]
    pub disk_read_bps: i64,
    #[serde(default)]
    pub disk_write_bps: i64,
    #[serde(default)]
    pub read_bytes: i64,
    #[serde(default)]
    pub written_bytes: i64,
    #[serde(default)]
    pub remaining_bytes: i64,
    pub game: Game,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadPreparePayload {
    pub method: String,
    pub version: String,
    #[serde(alias = "installPath", alias = "install_path", default)]
    pub install_path: String,
    #[serde(
        alias = "createSubfolder",
        alias = "create_subfolder",
        default = "default_true"
    )]
    pub create_subfolder: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TelemetryEvent {
    pub name: String,
    pub payload: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalGame {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub header_image: Option<String>,
    pub install_path: Option<String>,
    pub installed_version: Option<String>,
    pub last_played: Option<i64>,
    pub playtime_seconds: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalDownload {
    pub id: String,
    pub game_id: String,
    pub status: String,
    pub progress: i32,
    pub speed_mbps: f64,
    pub eta_minutes: i32,
    pub downloaded_bytes: i64,
    pub total_bytes: i64,
    pub network_bps: i64,
    pub disk_read_bps: i64,
    pub disk_write_bps: i64,
    pub read_bytes: i64,
    pub written_bytes: i64,
    pub remaining_bytes: i64,
    pub speed_history: Vec<f64>,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GameLaunchPref {
    pub game_id: String,
    pub require_admin: bool,
    pub ask_every_time: bool,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlaySessionLocal {
    pub id: String,
    pub game_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_sec: i64,
    pub exit_code: Option<i32>,
    pub synced: bool,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadState {
    pub id: String,
    pub game_id: String,
    pub slug: String,
    pub status: String,
    pub install_dir: String,
    pub manifest_json: String,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DownloadChunk {
    pub download_id: String,
    pub file_id: String,
    pub chunk_index: i32,
    pub hash: String,
    pub size: i64,
    pub status: String,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LicenseInfo {
    pub license_id: String,
    pub user_id: String,
    pub game_id: String,
    pub issued_at: String,
    pub expires_at: Option<String>,
    pub max_activations: i32,
    pub current_activations: i32,
    pub hardware_id: Option<String>,
    pub signature: String,
}

impl LicenseInfo {
    pub fn signing_payload(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}",
            self.license_id,
            self.user_id,
            self.game_id,
            self.issued_at,
            self.expires_at.clone().unwrap_or_default(),
            self.max_activations,
            self.current_activations,
            self.hardware_id.clone().unwrap_or_default()
        )
    }
}
