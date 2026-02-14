use crate::errors::Result;
use crate::models::{Game, LibraryEntry};
use crate::services::ApiClient;

#[derive(Clone)]
pub struct LibraryService {
    api: ApiClient,
}

impl LibraryService {
    pub fn new(api: ApiClient) -> Self {
        Self { api }
    }

    pub async fn get_library(&self) -> Result<Vec<LibraryEntry>> {
        self.api.get("library", true).await
    }

    pub async fn get_games(&self) -> Result<Vec<Game>> {
        self.api.get("games", false).await
    }

    pub async fn get_game_details(&self, slug: &str) -> Result<Game> {
        self.api.get(&format!("games/{}", slug), false).await
    }
}
