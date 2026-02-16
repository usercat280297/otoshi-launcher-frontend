use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningGame {
    pub game_id: String,
    pub title: String,
    pub pid: u32,
    pub started_at: i64,
    pub session_id: String,
    pub launched_as_admin: bool,
    pub overlay_enabled: bool,
}

#[derive(Clone, Default)]
pub struct GameRuntimeService {
    inner: Arc<Mutex<HashMap<String, RunningGame>>>,
}

impl GameRuntimeService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn list(&self) -> Vec<RunningGame> {
        let map = self.lock();
        let mut items: Vec<RunningGame> = map.values().cloned().collect();
        items.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        items
    }

    pub fn get(&self, game_id: &str) -> Option<RunningGame> {
        let map = self.lock();
        map.get(game_id).cloned()
    }

    pub fn register(&self, running: RunningGame) {
        let mut map = self.lock();
        map.insert(running.game_id.clone(), running);
    }

    pub fn take(&self, game_id: &str) -> Option<RunningGame> {
        let mut map = self.lock();
        map.remove(game_id)
    }

    pub fn take_if_pid_matches(&self, game_id: &str, pid: u32) -> Option<RunningGame> {
        let mut map = self.lock();
        match map.get(game_id) {
            Some(running) if running.pid == pid => map.remove(game_id),
            _ => None,
        }
    }

    pub fn is_pid_registered(&self, game_id: &str, pid: u32) -> bool {
        let map = self.lock();
        map.get(game_id).map(|item| item.pid == pid).unwrap_or(false)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, RunningGame>> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

