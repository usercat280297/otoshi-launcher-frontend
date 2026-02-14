use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::services::workshop_service::{WorkshopItem, WorkshopSubscription, WorkshopVersion};
use crate::AppState;

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkshopInstall {
    pub app_id: String,
    pub item_id: String,
    pub path: String,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkshopSyncResult {
    pub app_id: String,
    pub target_dir: String,
    pub items_total: usize,
    pub items_synced: usize,
    pub errors: Vec<String>,
}

#[cfg(target_os = "windows")]
fn default_steam_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("C:\\Program Files (x86)\\Steam"),
        PathBuf::from("C:\\Program Files\\Steam"),
    ];
    if let Ok(p) = env::var("ProgramFiles(x86)") {
        roots.push(PathBuf::from(p).join("Steam"));
    }
    if let Ok(p) = env::var("ProgramFiles") {
        roots.push(PathBuf::from(p).join("Steam"));
    }
    roots
}

fn home_dir_from_env() -> Option<PathBuf> {
    env::var("HOME").ok().map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn default_steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir_from_env() {
        roots.push(
            home.join("Library")
                .join("Application Support")
                .join("Steam"),
        );
    }
    roots
}

#[cfg(target_os = "linux")]
fn default_steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir_from_env() {
        roots.push(home.join(".steam").join("steam"));
        roots.push(home.join(".local").join("share").join("Steam"));
    }
    roots
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn default_steam_roots() -> Vec<PathBuf> {
    Vec::new()
}

fn parse_library_folders(content: &str) -> Vec<PathBuf> {
    let mut libraries = Vec::new();
    for line in content.lines() {
        if line.contains("\"path\"") {
            if let Some(path) = line.split('"').nth(3) {
                let normalized = path.replace("\\\\", "\\");
                libraries.push(PathBuf::from(normalized));
            }
        }
    }
    libraries
}

fn find_steam_libraries() -> Vec<PathBuf> {
    let mut libs = Vec::new();
    let mut seen = HashSet::new();

    for root in default_steam_roots() {
        let root_str = root.to_string_lossy().to_string();
        if seen.insert(root_str.to_lowercase()) {
            libs.push(root.clone());
        }
        let library_file = root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(content) = fs::read_to_string(&library_file) {
            for lib in parse_library_folders(&content) {
                let lib_str = lib.to_string_lossy().to_string();
                if seen.insert(lib_str.to_lowercase()) {
                    libs.push(lib);
                }
            }
        }
    }

    libs
}

fn collect_workshop_installs(app_ids: &[String]) -> Vec<LocalWorkshopInstall> {
    if app_ids.is_empty() {
        return Vec::new();
    }

    let libraries = find_steam_libraries();
    if libraries.is_empty() {
        return Vec::new();
    }

    let mut installs = Vec::new();
    let mut seen = HashSet::new();

    for app_id in app_ids.iter() {
        if app_id.trim().is_empty() {
            continue;
        }
        for lib in libraries.iter() {
            let content_dir = lib
                .join("steamapps")
                .join("workshop")
                .join("content")
                .join(app_id);
            if !content_dir.exists() {
                continue;
            }
            if let Ok(entries) = fs::read_dir(&content_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let item_id = entry.file_name().to_string_lossy().to_string();
                    let key = format!("{}:{}", app_id, item_id);
                    if seen.insert(key) {
                        installs.push(LocalWorkshopInstall {
                            app_id: app_id.clone(),
                            item_id,
                            path: path.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    installs
}

fn find_mod_dir(game_path: &PathBuf) -> PathBuf {
    let candidates: Vec<Vec<&str>> = vec![
        vec!["BepInEx", "plugins"],
        vec!["Mods"],
        vec!["mods"],
        vec!["Addons"],
        vec!["addons"],
    ];

    for parts in candidates {
        let mut candidate = game_path.clone();
        for part in parts {
            candidate = candidate.join(part);
        }
        if candidate.exists() {
            return candidate;
        }
    }

    let fallback = game_path.join("Mods");
    let _ = fs::create_dir_all(&fallback);
    fallback
}

fn copy_dir_recursive(src: &PathBuf, dest: &PathBuf) -> std::io::Result<()> {
    if dest.exists() {
        fs::remove_dir_all(dest)?;
    }
    fs::create_dir_all(dest)?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_workshop_items(
    game_id: Option<String>,
    search: Option<String>,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<WorkshopItem>, String> {
    state
        .workshop
        .list_items(game_id.as_deref(), search.as_deref())
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_workshop_versions(
    item_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<WorkshopVersion>, String> {
    state
        .workshop
        .list_versions(&item_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_workshop_subscriptions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<WorkshopSubscription>, String> {
    state
        .workshop
        .list_subscriptions()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn subscribe_workshop_item(
    item_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<WorkshopSubscription, String> {
    state
        .workshop
        .subscribe(&item_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn unsubscribe_workshop_item(
    item_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    state
        .workshop
        .unsubscribe(&item_id)
        .await
        .map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn list_local_workshop_items(
    app_ids: Vec<String>,
) -> Result<Vec<LocalWorkshopInstall>, String> {
    let app_ids = app_ids
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>();

    let installs = tokio::task::spawn_blocking(move || collect_workshop_installs(&app_ids))
        .await
        .map_err(|err| err.to_string())?;

    Ok(installs)
}

#[tauri::command]
pub async fn sync_workshop_to_game(
    app_id: String,
    item_ids: Option<Vec<String>>,
    state: State<'_, Arc<AppState>>,
) -> Result<WorkshopSyncResult, String> {
    let install_info = state
        .crack_manager
        .check_game_installed(&app_id)
        .await
        .map_err(|err| err.to_string())?;

    let install_path = install_info
        .install_path
        .ok_or_else(|| "Game is not installed on this machine.".to_string())?;

    let game_path = PathBuf::from(&install_path);
    let mod_dir = find_mod_dir(&game_path);

    let app_ids = vec![app_id.clone()];
    let local_items = tokio::task::spawn_blocking(move || collect_workshop_installs(&app_ids))
        .await
        .map_err(|err| err.to_string())?;

    let target_ids = item_ids.unwrap_or_default();
    let filter_set: HashSet<String> = target_ids.into_iter().collect();

    let mut items_total = 0usize;
    let mut items_synced = 0usize;
    let mut errors = Vec::new();

    for item in local_items {
        if item.app_id != app_id {
            continue;
        }
        if !filter_set.is_empty() && !filter_set.contains(&item.item_id) {
            continue;
        }
        items_total += 1;
        let src = PathBuf::from(&item.path);
        let dest = mod_dir.join(&item.item_id);
        match copy_dir_recursive(&src, &dest) {
            Ok(_) => items_synced += 1,
            Err(err) => errors.push(format!("{}: {}", item.item_id, err)),
        }
    }

    Ok(WorkshopSyncResult {
        app_id,
        target_dir: mod_dir.to_string_lossy().to_string(),
        items_total,
        items_synced,
        errors,
    })
}
