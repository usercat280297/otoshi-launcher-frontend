use std::path::{Path, PathBuf};

use tauri::Manager;

fn ensure_dir(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() {
        return None;
    }
    if std::fs::create_dir_all(path).is_ok() {
        return Some(path.to_path_buf());
    }
    None
}

fn is_portable_root(path: &Path) -> bool {
    path.join("portable.config.json").exists()
}

pub fn resolve_root_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(value) = std::env::var("OTOSHI_ROOT_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if let Some(dir) = ensure_dir(&path) {
                return dir;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if is_portable_root(dir) {
                return dir.to_path_buf();
            }
        }
    }

    if let Ok(app_data) = app.path().app_data_dir() {
        if let Some(found) = ensure_dir(&app_data) {
            return found;
        }
    }

    if let Ok(app_local) = app.path().app_local_data_dir() {
        if let Some(found) = ensure_dir(&app_local) {
            return found;
        }
    }

    PathBuf::from(".")
}

pub fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
    let root = resolve_root_dir(app);
    let config = root.join("config");
    if let Some(dir) = ensure_dir(&config) {
        return dir;
    }
    root
}

pub fn resolve_cache_dir(app: &tauri::AppHandle) -> PathBuf {
    let root = resolve_root_dir(app);
    if is_portable_root(&root) {
        let candidates = [
            root.join("otoshi").join("cached"),
            root.join("cached"),
            root.join("appcache"),
            root.join("cache"),
        ];
        for candidate in candidates {
            if let Some(dir) = ensure_dir(&candidate) {
                return dir;
            }
        }
    }

    if let Ok(app_data) = app.path().app_data_dir() {
        let fallback = app_data.join("cache");
        if let Some(dir) = ensure_dir(&fallback) {
            return dir;
        }
    }
    PathBuf::from("cache")
}

pub fn resolve_games_dir(app: &tauri::AppHandle) -> PathBuf {
    let root = resolve_root_dir(app);
    if is_portable_root(&root) {
        let candidates = [
            root.join("otoshiapps").join("common"),
            root.join("otoshi").join("games"),
            root.join("games"),
        ];
        for candidate in candidates {
            if let Some(dir) = ensure_dir(&candidate) {
                return dir;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("otoshiapps").join("common");
            if let Some(found) = ensure_dir(&candidate) {
                return found;
            }
        }
    }

    let fallback = root.join("games");
    ensure_dir(&fallback).unwrap_or(fallback)
}

pub fn resolve_log_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(value) = std::env::var("OTOSHI_LOG_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if let Some(dir) = ensure_dir(&path) {
                return dir;
            }
        }
    }

    let root = resolve_root_dir(app);
    let root_logs = root.join("logs");
    if let Some(found) = ensure_dir(&root_logs) {
        return found;
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("logs");
            if let Some(found) = ensure_dir(&candidate) {
                return found;
            }
        }
    }

    if let Ok(app_data) = app.path().app_data_dir() {
        let candidate = app_data.join("logs");
        if let Some(found) = ensure_dir(&candidate) {
            return found;
        }
    }

    if let Ok(app_local) = app.path().app_local_data_dir() {
        let candidate = app_local.join("logs");
        if let Some(found) = ensure_dir(&candidate) {
            return found;
        }
    }

    PathBuf::from("logs")
}
