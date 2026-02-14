use serde::{Deserialize, Serialize};

use crate::errors::Result;
use crate::services::ApiClient;

#[derive(Clone)]
pub struct AchievementService {
    api: ApiClient,
}

impl AchievementService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn unlock(&self, game_id: &str, achievement_key: &str) -> Result<UserAchievement> {
        let payload = AchievementUnlockRequest {
            game_id: game_id.to_string(),
            achievement_key: achievement_key.to_string(),
        };
        self.api.post("/achievements/unlock", payload, true).await
    }

    pub async fn list_user(&self) -> Result<Vec<UserAchievement>> {
        self.api.get("/achievements/me", true).await
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AchievementUnlockRequest {
    game_id: String,
    achievement_key: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Achievement {
    pub id: String,
    pub game_id: String,
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub points: i32,
    pub icon_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserAchievement {
    pub id: String,
    pub achievement: Achievement,
    pub unlocked_at: String,
}
