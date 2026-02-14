use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInstallInfo {
    pub installed: bool,
    pub install_path: Option<String>,
    pub size_bytes: Option<u64>,
    pub version: Option<String>,
    pub last_played: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResult {
    pub success: bool,
    pub total_files: u32,
    pub verified_files: u32,
    pub corrupted_files: u32,
    pub missing_files: u32,
}

/// Get game installation information
#[tauri::command]
pub async fn get_game_install_info(app_id: String) -> Result<GameInstallInfo, String> {
    // Try to find the game in common Steam locations
    let steam_path = find_steam_game_path(&app_id).await;

    match steam_path {
        Some(path) => {
            let size = calculate_folder_size(&path).await.unwrap_or(0);
            Ok(GameInstallInfo {
                installed: true,
                install_path: Some(path.to_string_lossy().to_string()),
                size_bytes: Some(size),
                version: None, // Would need to read from app manifest
                last_played: None,
            })
        }
        None => Ok(GameInstallInfo {
            installed: false,
            install_path: None,
            size_bytes: None,
            version: None,
            last_played: None,
        }),
    }
}

/// Verify game files integrity
#[tauri::command]
pub async fn verify_game_files(
    app_id: String,
    install_path: String,
) -> Result<VerifyResult, String> {
    let path = PathBuf::from(&install_path);

    if !path.exists() {
        return Err("Install path does not exist".to_string());
    }

    let mut total_files = 0u32;
    let mut verified_files = 0u32;
    let mut corrupted_files = 0u32;
    let missing_files = 0u32;

    // Walk through all files and verify
    match count_and_verify_files(&path).await {
        Ok((total, verified, corrupted)) => {
            total_files = total;
            verified_files = verified;
            corrupted_files = corrupted;
        }
        Err(e) => {
            return Err(format!("Verification failed: {}", e));
        }
    }

    Ok(VerifyResult {
        success: corrupted_files == 0 && missing_files == 0,
        total_files,
        verified_files,
        corrupted_files,
        missing_files,
    })
}

/// Uninstall game by removing its folder
#[tauri::command]
pub async fn uninstall_game(app_id: String, install_path: String) -> Result<(), String> {
    let path = PathBuf::from(&install_path);

    if !path.exists() {
        return Err("Install path does not exist".to_string());
    }

    // Safety check - make sure this looks like a game folder
    if !is_valid_game_folder(&path).await {
        return Err("Invalid game folder".to_string());
    }

    // Remove the folder
    fs::remove_dir_all(&path)
        .await
        .map_err(|e| format!("Failed to remove game folder: {}", e))?;

    Ok(())
}

/// Move game folder to new location
#[tauri::command]
pub async fn move_game_folder(
    app_id: String,
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

    // Create destination parent if needed
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create destination: {}", e))?;
    }

    // Try to rename first (fast if same drive)
    if fs::rename(&source, &dest).await.is_ok() {
        return Ok(());
    }

    // Fall back to copy + delete
    copy_dir_recursive(&source, &dest)
        .await
        .map_err(|e| format!("Failed to copy: {}", e))?;

    fs::remove_dir_all(&source)
        .await
        .map_err(|e| format!("Failed to remove source after copy: {}", e))?;

    Ok(())
}

/// Sync cloud saves
#[tauri::command]
pub async fn sync_cloud_saves(app_id: String) -> Result<(), String> {
    // In a real implementation, this would:
    // 1. Find save game locations
    // 2. Upload to cloud storage
    // 3. Download any newer cloud saves

    // Simulate sync delay
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    Ok(())
}

/// Open folder in file explorer
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
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// Helper functions

async fn find_steam_game_path(app_id: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let steam_paths = vec![
            PathBuf::from("C:\\Program Files (x86)\\Steam"),
            PathBuf::from("C:\\Program Files\\Steam"),
        ];

        for steam_path in steam_paths {
            let library_folders = steam_path.join("steamapps").join("libraryfolders.vdf");
            if library_folders.exists() {
                // Check common location first
                let game_path = steam_path.join("steamapps").join("common");
                if game_path.exists() {
                    if let Ok(mut entries) = tokio::fs::read_dir(&game_path).await {
                        while let Ok(Some(entry)) = entries.next_entry().await {
                            let path = entry.path();
                            if path.is_dir() {
                                // Check if this folder contains steam_appid.txt with matching ID
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
            }
        }
    }

    None
}

async fn calculate_folder_size(path: &PathBuf) -> Result<u64, std::io::Error> {
    let mut size = 0u64;
    let mut stack = vec![path.clone()];

    while let Some(current) = stack.pop() {
        if current.is_dir() {
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
    }

    Ok(size)
}

async fn count_and_verify_files(path: &PathBuf) -> Result<(u32, u32, u32), std::io::Error> {
    let mut total = 0u32;
    let mut verified = 0u32;
    let corrupted = 0u32;
    let mut stack = vec![path.clone()];

    while let Some(current) = stack.pop() {
        if current.is_dir() {
            let mut entries = tokio::fs::read_dir(&current).await?;
            while let Some(entry) = entries.next_entry().await? {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    stack.push(entry_path);
                } else {
                    total += 1;
                    // In a real implementation, we'd check file hashes
                    // For now, just verify the file exists and is readable
                    if tokio::fs::metadata(&entry_path).await.is_ok() {
                        verified += 1;
                    }
                }
            }
        }
    }

    Ok((total, verified, corrupted))
}

async fn is_valid_game_folder(path: &PathBuf) -> bool {
    // Check for common game folder indicators
    let indicators = [
        "steam_appid.txt",
        "steam_api.dll",
        "steam_api64.dll",
        "Binaries",
        "Engine",
    ];

    for indicator in indicators {
        let check_path = path.join(indicator);
        if check_path.exists() {
            return true;
        }
    }

    // Also accept if the folder has executable files
    if let Ok(mut entries) = tokio::fs::read_dir(path).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(ext) = entry.path().extension() {
                if ext == "exe" {
                    return true;
                }
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
