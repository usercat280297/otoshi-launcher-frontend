use crate::utils::paths::{resolve_cache_dir, resolve_data_dir, resolve_log_dir};

#[tauri::command]
pub async fn get_app_logs(app: tauri::AppHandle) -> Result<String, String> {
    let log_dir = resolve_log_dir(&app);
    let backend_log = log_dir.join("backend.log");
    let launcher_log = log_dir.join("launcher.log");

    let mut result = String::new();

    result.push_str("=== BACKEND LOG ===\n\n");
    match std::fs::read_to_string(&backend_log) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().rev().take(100).collect();
            result.push_str(&lines.into_iter().rev().collect::<Vec<_>>().join("\n"));
        }
        Err(e) => {
            result.push_str(&format!("Failed to read backend log: {}\n", e));
        }
    }

    result.push_str("\n\n=== LAUNCHER LOG ===\n\n");
    match std::fs::read_to_string(&launcher_log) {
        Ok(content) => {
            let lines: Vec<&str> = content.lines().rev().take(100).collect();
            result.push_str(&lines.into_iter().rev().collect::<Vec<_>>().join("\n"));
        }
        Err(e) => {
            result.push_str(&format!("Failed to read launcher log: {}\n", e));
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn get_backend_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let data_dir = resolve_data_dir(&app);
    let cache_dir = resolve_cache_dir(&app);
    let db_path = cache_dir.join("otoshi.db");
    let db_exists = db_path.exists();
    let db_size = if db_exists {
        std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let api_base =
        std::env::var("LAUNCHER_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8000".to_string());
    let health_url = format!("{}/health", api_base.trim_end_matches('/'));

    // Check if backend is running
    let backend_running = reqwest::get(health_url)
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let log_dir = resolve_log_dir(&app);
    let backend_log = log_dir.join("backend.log");
    let backend_log_exists = backend_log.exists();
    let backend_log_size = if backend_log_exists {
        std::fs::metadata(&backend_log)
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };

    Ok(serde_json::json!({
        "backend_running": backend_running,
        "database": {
            "exists": db_exists,
            "size": db_size,
            "path": db_path.to_string_lossy().to_string()
        },
        "logs": {
            "backend_log_exists": backend_log_exists,
            "backend_log_size": backend_log_size,
            "backend_log_path": backend_log.to_string_lossy().to_string()
        },
        "api_base": api_base,
        "app_data_dir": data_dir.to_string_lossy().to_string(),
        "cache_dir": cache_dir.to_string_lossy().to_string()
    }))
}

#[tauri::command]
pub async fn open_logs_folder(app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = resolve_log_dir(&app);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open logs folder: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open logs folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_runtime_api_base() -> Result<String, String> {
    Ok(std::env::var("LAUNCHER_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8000".to_string()))
}
