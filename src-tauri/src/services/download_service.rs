use crate::errors::Result;
use crate::models::{DownloadPreparePayload, DownloadTask};
use crate::services::ApiClient;

#[derive(Clone, Debug, Default)]
pub struct DownloadProgressUpdate {
    pub progress: i32,
    pub downloaded_bytes: Option<i64>,
    pub total_bytes: Option<i64>,
    pub network_bps: Option<i64>,
    pub disk_read_bps: Option<i64>,
    pub disk_write_bps: Option<i64>,
    pub read_bytes: Option<i64>,
    pub written_bytes: Option<i64>,
    pub remaining_bytes: Option<i64>,
    pub speed_mbps: Option<f64>,
    pub eta_minutes: Option<i32>,
}

#[derive(Clone)]
pub struct DownloadService {
    api: ApiClient,
}

impl DownloadService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn list_downloads(&self) -> Result<Vec<DownloadTask>> {
        self.api.get("downloads", true).await
    }

    pub async fn start_download(&self, game_id: &str) -> Result<DownloadTask> {
        self.api
            .post(
                &format!("downloads/start/{}", game_id),
                serde_json::json!({}),
                true,
            )
            .await
    }

    pub async fn start_steam_download(
        &self,
        app_id: &str,
        payload: &DownloadPreparePayload,
    ) -> Result<DownloadTask> {
        self.api
            .post(&format!("downloads/steam/{}/start", app_id), payload, true)
            .await
    }

    pub async fn pause_download(&self, download_id: &str) -> Result<DownloadTask> {
        self.api
            .post(
                &format!("downloads/{}/pause", download_id),
                serde_json::json!({}),
                true,
            )
            .await
    }

    pub async fn resume_download(&self, download_id: &str) -> Result<DownloadTask> {
        self.api
            .post(
                &format!("downloads/{}/resume", download_id),
                serde_json::json!({}),
                true,
            )
            .await
    }

    pub async fn cancel_download(&self, download_id: &str) -> Result<DownloadTask> {
        self.api
            .post(
                &format!("downloads/{}/cancel", download_id),
                serde_json::json!({}),
                true,
            )
            .await
    }

    pub async fn update_progress(
        &self,
        download_id: &str,
        payload: &DownloadProgressUpdate,
    ) -> Result<DownloadTask> {
        let mut query = vec![format!("progress={}", payload.progress)];

        if let Some(value) = payload.downloaded_bytes {
            query.push(format!("downloaded_bytes={value}"));
        }
        if let Some(value) = payload.total_bytes {
            query.push(format!("total_bytes={value}"));
        }
        if let Some(value) = payload.network_bps {
            query.push(format!("network_bps={value}"));
        }
        if let Some(value) = payload.disk_read_bps {
            query.push(format!("disk_read_bps={value}"));
        }
        if let Some(value) = payload.disk_write_bps {
            query.push(format!("disk_write_bps={value}"));
        }
        if let Some(value) = payload.read_bytes {
            query.push(format!("read_bytes={value}"));
        }
        if let Some(value) = payload.written_bytes {
            query.push(format!("written_bytes={value}"));
        }
        if let Some(value) = payload.remaining_bytes {
            query.push(format!("remaining_bytes={value}"));
        }
        if let Some(value) = payload.speed_mbps {
            query.push(format!("speed_mbps={value}"));
        }
        if let Some(value) = payload.eta_minutes {
            query.push(format!("eta_minutes={value}"));
        }

        self.api
            .post(
                &format!("downloads/{}/progress?{}", download_id, query.join("&")),
                serde_json::json!({}),
                true,
            )
            .await
    }

    pub async fn update_status(&self, download_id: &str, status: &str) -> Result<DownloadTask> {
        self.api
            .post(
                &format!("downloads/{}/status?status={}", download_id, status),
                serde_json::json!({}),
                true,
            )
            .await
    }
}
