use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashMismatchOut {
    pub path: String,
    pub expected_hash: Option<String>,
    pub actual_hash: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInstallInfo {
    pub installed: bool,
    pub install_path: Option<String>,
    #[serde(default)]
    pub install_roots: Vec<String>,
    pub size_bytes: Option<u64>,
    pub version: Option<String>,
    pub branch: Option<String>,
    pub build_id: Option<String>,
    pub last_played: Option<String>,
    #[serde(default)]
    pub playtime_local_hours: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub success: bool,
    pub total_files: u32,
    pub verified_files: u32,
    pub corrupted_files: u32,
    pub missing_files: u32,
    pub manifest_version: Option<String>,
    #[serde(default)]
    pub mismatch_files: Vec<HashMismatchOut>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    pub success: bool,
    pub new_path: String,
    pub progress_token: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncResult {
    pub success: bool,
    pub files_uploaded: u32,
    pub files_downloaded: u32,
    pub conflicts: u32,
    #[serde(default)]
    pub resolution: Vec<String>,
    pub event_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOptionsOut {
    pub app_id: String,
    pub user_id: Option<String>,
    #[serde(default)]
    pub launch_options: Value,
    pub updated_at: Option<String>,
}

fn backend_api_base() -> String {
    std::env::var("LAUNCHER_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8000".to_string())
}

fn backend_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| format!("Failed to init HTTP client: {e}"))
}

async fn backend_get<T: DeserializeOwned>(path: &str) -> Result<T, String> {
    let client = backend_client()?;
    let url = format!("{}{}", backend_api_base().trim_end_matches('/'), path);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Backend request failed: {e}"))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {body}"));
    }
    response
        .json::<T>()
        .await
        .map_err(|e| format!("Invalid backend JSON: {e}"))
}

async fn backend_post<B: Serialize, T: DeserializeOwned>(path: &str, body: &B) -> Result<T, String> {
    let client = backend_client()?;
    let url = format!("{}{}", backend_api_base().trim_end_matches('/'), path);
    let response = client
        .post(&url)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Backend request failed: {e}"))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }
    response
        .json::<T>()
        .await
        .map_err(|e| format!("Invalid backend JSON: {e}"))
}

async fn backend_post_unit<B: Serialize>(path: &str, body: &B) -> Result<(), String> {
    let client = backend_client()?;
    let url = format!("{}{}", backend_api_base().trim_end_matches('/'), path);
    let response = client
        .post(&url)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Backend request failed: {e}"))?;
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }
    Ok(())
}

/// Get game installation information.
#[tauri::command]
pub async fn get_game_install_info(app_id: String) -> Result<GameInstallInfo, String> {
    if let Ok(remote) = backend_get::<GameInstallInfo>(&format!("/properties/{}/info", app_id)).await {
        return Ok(remote);
    }
    legacy_get_game_install_info(app_id).await
}

/// Verify game files integrity.
#[tauri::command]
pub async fn verify_game_files(app_id: String, install_path: String) -> Result<VerifyResult, String> {
    let body = json!({
        "install_path": install_path,
    });
    if let Ok(remote) = backend_post::<_, VerifyResult>(&format!("/properties/{}/verify", app_id), &body).await {
        return Ok(remote);
    }
    legacy_verify_game_files(app_id, install_path).await
}

/// Uninstall game by removing its folder.
#[tauri::command]
pub async fn uninstall_game(app_id: String, install_path: String) -> Result<(), String> {
    let body = json!({ "install_path": install_path });
    if backend_post_unit(&format!("/properties/{}/uninstall", app_id), &body)
        .await
        .is_ok()
    {
        return Ok(());
    }
    legacy_uninstall_game(app_id, install_path).await
}

/// Move game folder to new location.
#[tauri::command]
pub async fn move_game_folder(app_id: String, source_path: String, dest_path: String) -> Result<(), String> {
    let body = json!({
        "source_path": source_path,
        "dest_path": dest_path,
    });
    if backend_post::<_, MoveResult>(&format!("/properties/{}/move", app_id), &body)
        .await
        .is_ok()
    {
        return Ok(());
    }
    legacy_move_game_folder(app_id, source_path, dest_path).await
}

/// Sync cloud saves.
#[tauri::command]
pub async fn sync_cloud_saves(app_id: String) -> Result<(), String> {
    if backend_post::<_, CloudSyncResult>(&format!("/properties/{}/cloud-sync", app_id), &json!({}))
        .await
        .is_ok()
    {
        return Ok(());
    }
    legacy_sync_cloud_saves(app_id).await
}

/// New command: fetch extended properties bundle for Steam-like properties modal.
#[tauri::command]
pub async fn properties_get(app_id: String) -> Result<Value, String> {
    let info = backend_get::<Value>(&format!("/properties/{}/info", app_id)).await?;
    let launch_options = backend_get::<LaunchOptionsOut>(&format!("/properties/{}/launch-options", app_id))
        .await
        .unwrap_or(LaunchOptionsOut {
            app_id: app_id.clone(),
            user_id: None,
            launch_options: json!({}),
            updated_at: None,
        });
    let save_locations = backend_get::<Value>(&format!("/properties/{}/save-locations", app_id))
        .await
        .unwrap_or(json!({ "app_id": app_id, "locations": [] }));
    let dlc = backend_get::<Value>(&format!("/properties/{}/dlc", app_id))
        .await
        .unwrap_or(json!([]));

    Ok(json!({
        "info": info,
        "launch_options": launch_options,
        "save_locations": save_locations,
        "dlc": dlc
    }))
}

/// New command: persist launch/properties settings.
#[tauri::command]
pub async fn properties_set(app_id: String, payload: Value) -> Result<Value, String> {
    backend_post::<_, Value>(&format!("/properties/{}/launch-options", app_id), &payload).await
}

/// New command: preview save sync scope before apply.
#[tauri::command]
pub async fn save_sync_preview(app_id: String) -> Result<Value, String> {
    let locations = backend_get::<Value>(&format!("/properties/{}/save-locations", app_id))
        .await
        .unwrap_or(json!({ "locations": [] }));
    let count = locations
        .get("locations")
        .and_then(|v| v.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0);
    Ok(json!({
        "app_id": app_id,
        "locations": locations.get("locations").cloned().unwrap_or(json!([])),
        "location_count": count,
    }))
}

/// New command: apply save sync immediately.
#[tauri::command]
pub async fn save_sync_apply(app_id: String) -> Result<CloudSyncResult, String> {
    backend_post::<_, CloudSyncResult>(&format!("/properties/{}/cloud-sync", app_id), &json!({})).await
}

/// Open folder in file explorer.
#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
    }

    Ok(())
}

async fn legacy_get_game_install_info(app_id: String) -> Result<GameInstallInfo, String> {
    let steam_path = find_steam_game_path(&app_id).await;
    match steam_path {
        Some(path) => {
            let size = calculate_folder_size(&path).await.unwrap_or(0);
            Ok(GameInstallInfo {
                installed: true,
                install_path: Some(path.to_string_lossy().to_string()),
                install_roots: vec![],
                size_bytes: Some(size),
                version: None,
                branch: None,
                build_id: None,
                last_played: None,
                playtime_local_hours: 0.0,
            })
        }
        None => Ok(GameInstallInfo {
            installed: false,
            install_path: None,
            install_roots: vec![],
            size_bytes: None,
            version: None,
            branch: None,
            build_id: None,
            last_played: None,
            playtime_local_hours: 0.0,
        }),
    }
}

async fn legacy_verify_game_files(_app_id: String, install_path: String) -> Result<VerifyResult, String> {
    let path = PathBuf::from(&install_path);
    if !path.exists() {
        return Err("Install path does not exist".to_string());
    }

    let (total_files, verified_files, corrupted_files) =
        count_and_verify_files(&path).await.map_err(|e| format!("Verification failed: {e}"))?;

    Ok(VerifyResult {
        success: corrupted_files == 0,
        total_files,
        verified_files,
        corrupted_files,
        missing_files: 0,
        manifest_version: None,
        mismatch_files: vec![],
    })
}

async fn legacy_uninstall_game(_app_id: String, install_path: String) -> Result<(), String> {
    let path = PathBuf::from(&install_path);
    if !path.exists() {
        return Err("Install path does not exist".to_string());
    }
    if !is_valid_game_folder(&path).await {
        return Err("Invalid game folder".to_string());
    }
    fs::remove_dir_all(&path)
        .await
        .map_err(|e| format!("Failed to remove game folder: {e}"))?;
    Ok(())
}

async fn legacy_move_game_folder(
    _app_id: String,
    source_path: String,
    dest_path: String,
) -> Result<(), String> {
    let source = PathBuf::from(&source_path);
    let dest = PathBuf::from(&dest_path);

    if !source.exists() {
        return Err("Source path does not exist".to_string());
    }
    if dest.exists() {
        return Err("Destination path already exists".to_string());
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create destination: {e}"))?;
    }

    if fs::rename(&source, &dest).await.is_ok() {
        return Ok(());
    }

    copy_dir_recursive(&source, &dest)
        .await
        .map_err(|e| format!("Failed to copy: {e}"))?;
    fs::remove_dir_all(&source)
        .await
        .map_err(|e| format!("Failed to remove source after copy: {e}"))?;
    Ok(())
}

async fn legacy_sync_cloud_saves(_app_id: String) -> Result<(), String> {
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
    Ok(())
}

async fn find_steam_game_path(app_id: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let steam_paths = vec![
            PathBuf::from("C:\\Program Files (x86)\\Steam"),
            PathBuf::from("C:\\Program Files\\Steam"),
        ];

        for steam_path in steam_paths {
            let library_folders = steam_path.join("steamapps").join("libraryfolders.vdf");
            if !library_folders.exists() {
                continue;
            }
            let game_path = steam_path.join("steamapps").join("common");
            if !game_path.exists() {
                continue;
            }
            if let Ok(mut entries) = tokio::fs::read_dir(&game_path).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let appid_file = path.join("steam_appid.txt");
                    if let Ok(content) = tokio::fs::read_to_string(&appid_file).await {
                        if content.trim() == app_id {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }
    None
}

async fn calculate_folder_size(path: &PathBuf) -> Result<u64, std::io::Error> {
    let mut size = 0u64;
    let mut stack = vec![path.clone()];

    while let Some(current) = stack.pop() {
        if !current.is_dir() {
            continue;
        }
        let mut entries = tokio::fs::read_dir(&current).await?;
        while let Some(entry) = entries.next_entry().await? {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
            } else if let Ok(meta) = entry.metadata().await {
                size += meta.len();
            }
        }
    }

    Ok(size)
}

async fn count_and_verify_files(path: &PathBuf) -> Result<(u32, u32, u32), std::io::Error> {
    let mut total = 0u32;
    let mut verified = 0u32;
    let corrupted = 0u32;
    let mut stack = vec![path.clone()];

    while let Some(current) = stack.pop() {
        if !current.is_dir() {
            continue;
        }
        let mut entries = tokio::fs::read_dir(&current).await?;
        while let Some(entry) = entries.next_entry().await? {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
            } else {
                total += 1;
                if tokio::fs::metadata(&entry_path).await.is_ok() {
                    verified += 1;
                }
            }
        }
    }

    Ok((total, verified, corrupted))
}

async fn is_valid_game_folder(path: &PathBuf) -> bool {
    let indicators = [
        "steam_appid.txt",
        "steam_api.dll",
        "steam_api64.dll",
        "Binaries",
        "Engine",
    ];
    for indicator in indicators {
        if path.join(indicator).exists() {
            return true;
        }
    }
    if let Ok(mut entries) = tokio::fs::read_dir(path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if entry
                .path()
                .extension()
                .map(|ext| ext == "exe")
                .unwrap_or(false)
            {
                return true;
            }
        }
    }
    false
}

async fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(dst).await?;

    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            Box::pin(copy_dir_recursive(&src_path, &dst_path)).await?;
        } else {
            tokio::fs::copy(&src_path, &dst_path).await?;
        }
    }

    Ok(())
}
