use crate::errors::Result;
use crate::models::TelemetryEvent;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct TelemetryService {
    api: ApiClient,
}

impl TelemetryService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn send_event(&self, name: &str, payload: serde_json::Value) -> Result<()> {
        let event = TelemetryEvent {
            name: name.to_string(),
            payload,
        };
        let _: Vec<serde_json::Value> = self
            .api
            .post("telemetry/events", vec![event], false)
            .await?;
        Ok(())
    }
}
