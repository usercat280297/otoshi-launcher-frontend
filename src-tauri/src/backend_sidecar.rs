use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::Manager;

use crate::errors::{LauncherError, Result};
use crate::utils::paths::{
    resolve_cache_dir, resolve_data_dir, resolve_games_dir, resolve_log_dir,
};

/// Windows flag to create process without a visible console window.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Holds the backend child process and guarantees it is terminated when the app exits.
pub struct BackendProcess(std::sync::Mutex<Option<Child>>);

impl BackendProcess {
    pub fn new(child: Child) -> Self {
        Self(std::sync::Mutex::new(Some(child)))
    }

    pub fn terminate(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let pid = child.id();
                // Try to kill the full process tree on Windows (python backend may spawn child processes).
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .status();
                }
                let _ = child.kill();
            }
        }
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        self.terminate();
    }
}

fn is_running(host: &str, port: u16) -> bool {
    let url = format!("http://{host}:{port}/health");
    reqwest::blocking::get(url)
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn can_bind_local_port(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn pick_fallback_port(preferred: u16) -> Option<u16> {
    for candidate in preferred.saturating_add(1)..=preferred.saturating_add(16) {
        if can_bind_local_port(candidate) {
            return Some(candidate);
        }
    }
    None
}

fn parse_u64_value(value: &serde_json::Value) -> Option<u64> {
    if let Some(number) = value.as_u64() {
        return Some(number);
    }
    value.as_str().and_then(|raw| raw.parse::<u64>().ok())
}

fn parse_probe_limit(body: &serde_json::Value) -> Option<u64> {
    body.get("detail")
        .and_then(|value| value.as_array())
        .and_then(|items| {
            items.iter().find_map(|item| {
                let mentions_size = item
                    .get("loc")
                    .and_then(|value| value.as_array())
                    .map(|parts| {
                        parts
                            .iter()
                            .any(|part| part.as_str().map(|v| v == "size").unwrap_or(false))
                    })
                    .unwrap_or(false);
                if !mentions_size {
                    return None;
                }
                item.get("ctx")
                    .and_then(|value| value.get("lt"))
                    .and_then(parse_u64_value)
            })
        })
}

fn backend_supports_large_chunk_requests(host: &str, port: u16) -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(1800))
        .build()
    {
        Ok(value) => value,
        Err(_) => return false,
    };

    let health_url = format!("http://{host}:{port}/health");
    let response = match client.get(health_url).send() {
        Ok(resp) => resp,
        Err(_) => return false,
    };
    if !response.status().is_success() {
        return false;
    }
    let body: serde_json::Value = match response.json() {
        Ok(value) => value,
        Err(_) => return false,
    };
    let mut observed_limit = body
        .get("cdn_chunk_size_limit_bytes")
        .and_then(parse_u64_value);

    // Probe the validator directly with an intentionally too-large size so both
    // old and new backends fail fast with 422, but expose different `lt` limits.
    let probe_url = format!("http://{host}:{port}/cdn/chunks/_probe/_probe/0?size=2147483649");
    if let Ok(resp) = client.get(probe_url).send() {
        if resp.status().as_u16() == 422 {
            if let Ok(payload) = resp.json::<serde_json::Value>() {
                if let Some(limit) = parse_probe_limit(&payload) {
                    observed_limit = Some(limit);
                }
            }
        }
    }

    observed_limit.unwrap_or(0) >= 100 * 1024 * 1024
}

#[cfg(target_os = "windows")]
fn local_address_matches_port(address: &str, port: u16) -> bool {
    address
        .rsplit(':')
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .map(|value| value == port)
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn listener_pids_for_port(port: u16) -> Vec<u32> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    let output = match output {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut pids: Vec<u32> = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with("TCP") {
            continue;
        }
        let columns: Vec<&str> = trimmed.split_whitespace().collect();
        if columns.len() < 5 {
            continue;
        }
        let local_addr = columns[1];
        let state = columns[3];
        let pid = columns[4];
        if !state.eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        if !local_address_matches_port(local_addr, port) {
            continue;
        }
        if let Ok(parsed) = pid.parse::<u32>() {
            if parsed != std::process::id() && !pids.contains(&parsed) {
                pids.push(parsed);
            }
        }
    }
    pids
}

#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(target_os = "windows")]
fn stop_backend_listener_on_port(port: u16) {
    let pids = listener_pids_for_port(port);
    if pids.is_empty() {
        return;
    }
    tracing::warn!(
        "Attempting to stop existing listener(s) on port {}: {:?}",
        port,
        pids
    );
    for pid in pids {
        kill_process_tree(pid);
    }
}

#[cfg(not(target_os = "windows"))]
fn stop_backend_listener_on_port(_port: u16) {}

fn sqlite_database_url(path: &std::path::Path) -> String {
    // For sqlite file URLs on Windows, a path like `C:\...` must be converted to a file URL.
    // `sqlite:///C:/.../otoshi.db` is accepted, while `sqlite:///C:\...` may fail.
    let p = path.to_string_lossy().replace('\\', "/");
    // Ensure we get `C:/...` not `C:...`
    if p.len() >= 2 && p.as_bytes()[1] == b':' {
        // ok
    }
    format!("sqlite:///{}", p)
}

pub fn spawn_backend(app: &tauri::AppHandle) -> Result<Option<Child>> {
    // If user provides a custom URL, we assume they manage the backend themselves.
    if std::env::var("LAUNCHER_API_URL").is_ok() {
        tracing::info!("LAUNCHER_API_URL is set, skipping backend auto-start");
        return Ok(None);
    }

    let base_port: u16 = std::env::var("BACKEND_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8000);
    let mut spawn_port = base_port;

    tracing::info!(
        "Checking if backend is already running on port {}",
        base_port
    );

    if is_running("127.0.0.1", base_port) {
        if backend_supports_large_chunk_requests("127.0.0.1", base_port) {
            tracing::info!(
                "Compatible backend already running on port {}, skipping spawn",
                base_port
            );
            std::env::set_var("LAUNCHER_API_URL", format!("http://127.0.0.1:{base_port}"));
            return Ok(None);
        }

        tracing::warn!(
            "Existing backend on port {} is stale/incompatible (missing large chunk support); attempting restart",
            base_port
        );
        stop_backend_listener_on_port(base_port);

        for _ in 0..20 {
            if !is_running("127.0.0.1", base_port) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        if is_running("127.0.0.1", base_port) {
            if let Some(fallback_port) = pick_fallback_port(base_port) {
                tracing::warn!(
                    "Port {} remains occupied by stale backend; switching launcher sidecar to fallback port {}",
                    base_port,
                    fallback_port
                );
                spawn_port = fallback_port;
            } else {
                tracing::warn!(
                    "Port {} remains occupied and no fallback port is available; reusing currently running backend",
                    base_port
                );
                std::env::set_var("LAUNCHER_API_URL", format!("http://127.0.0.1:{base_port}"));
                return Ok(None);
            }
        }
    } else if !can_bind_local_port(base_port) {
        if let Some(fallback_port) = pick_fallback_port(base_port) {
            tracing::warn!(
                "Port {} is unavailable; switching launcher sidecar to fallback port {}",
                base_port,
                fallback_port
            );
            spawn_port = fallback_port;
        } else {
            tracing::warn!(
                "Port {} is unavailable and no fallback port is free; keeping default API URL",
                base_port
            );
        }
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| LauncherError::Config("resource dir unavailable".to_string()))?;

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    tracing::info!("Resource directory: {:?}", resource_dir);
    if let Some(dir) = &exe_dir {
        tracing::info!("Executable directory: {:?}", dir);
    }

    // Try multiple locations for the backend exe
    let mut exe_candidates = vec![
        // One-file mode locations (legacy)
        resource_dir.join("otoshi-backend.exe"),
        resource_dir.join("resources").join("otoshi-backend.exe"),
        // Bundled folder mode (resources dir)
        resource_dir.join("backend").join("otoshi-backend.exe"),
    ];

    if let Some(dir) = &exe_dir {
        // Installed app layout (NSIS)
        exe_candidates.push(dir.join("backend").join("otoshi-backend.exe"));
        // Some builds place resources under a sibling folder
        exe_candidates.push(
            dir.join("resources")
                .join("backend")
                .join("otoshi-backend.exe"),
        );
        exe_candidates.push(dir.join("resources").join("otoshi-backend.exe"));
    }

    if let Ok(app_local) = app.path().app_local_data_dir() {
        exe_candidates.push(app_local.join("otoshi-backend.exe"));
    }

    // Log each candidate path and whether it exists
    for candidate in &exe_candidates {
        tracing::info!(
            "Checking backend path: {:?} - exists: {}",
            candidate,
            candidate.exists()
        );
    }

    let exe_path = exe_candidates.iter().find(|p| p.exists());

    let exe_path = match exe_path {
        Some(p) => {
            tracing::info!("Found backend executable at: {:?}", p);
            p.clone()
        }
        None => {
            // Don't fail the whole app if the sidecar isn't present.
            // The UI can still run (it will just show API offline).
            tracing::warn!(
                "backend sidecar missing, searched in {:?}, skipping auto-start",
                exe_candidates
                    .iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
            );
            return Ok(None);
        }
    };

    // Optional .env next to executable (app data dir) or shipped .env next to app.
    let data_dir = resolve_data_dir(app);
    let cache_dir = resolve_cache_dir(app);
    let games_dir = resolve_games_dir(app);
    let mut env_candidates = Vec::new();
    env_candidates.push(data_dir.join(".env"));
    if let Ok(resource_dir) = app.path().resource_dir() {
        env_candidates.push(resource_dir.join("backend").join(".env"));
        env_candidates.push(resource_dir.join("config").join(".env"));
        env_candidates.push(resource_dir.join("resources").join("config").join(".env"));
    }
    if let Some(exe_dir) = &exe_dir {
        env_candidates.push(exe_dir.join(".env"));
        env_candidates.push(exe_dir.join("config").join(".env"));
    }
    let env_file = env_candidates.into_iter().find(|p| p.exists());

    // Ensure the backend runs from a writable directory.
    // The backend defaults to sqlite:///./otoshi.db and other relative paths.
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| LauncherError::Config(format!("failed to create data dir: {e}")))?;
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| LauncherError::Config(format!("failed to create cache dir: {e}")))?;
    let sqlite_db_path = cache_dir.join("otoshi.db");
    let storage_dir = cache_dir.join("storage");
    let _ = std::fs::create_dir_all(&storage_dir);
    let settings_path = storage_dir.join("settings.json");

    let log_dir = resolve_log_dir(app);
    let log_path = log_dir.join("backend.log");
    let stdout_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| LauncherError::Config(format!("failed to open backend.log: {e}")))?;
    let stderr_file = stdout_file
        .try_clone()
        .map_err(|e| LauncherError::Config(format!("failed to clone backend.log handle: {e}")))?;

    // Try to find resource directories for backend data
    // NOTE: lua_files and manifests are NOT bundled - they are fetched from backend API
    // This prevents users from seeing/modifying game data

    let backend_data_dir = exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| resource_dir.join("backend"));

    let mut cmd = Command::new(exe_path);
    let launcher_core_path = {
        let mut candidates = vec![
            resource_dir.join("backend").join("launcher_core.dll"),
            resource_dir.join("launcher_core.dll"),
            resource_dir.join("libs").join("launcher_core.dll"),
            resource_dir.join("native").join("launcher_core.dll"),
        ];
        if let Some(parent) = resource_dir.parent() {
            candidates.push(parent.join("libs").join("launcher_core.dll"));
            candidates.push(parent.join("native").join("launcher_core.dll"));
        }
        if let Some(dir) = &exe_dir {
            candidates.push(dir.join("backend").join("launcher_core.dll"));
            candidates.push(dir.join("launcher_core.dll"));
            candidates.push(dir.join("libs").join("launcher_core.dll"));
            candidates.push(dir.join("native").join("launcher_core.dll"));
        }
        candidates
            .into_iter()
            .find(|p| p.exists())
            .unwrap_or_else(|| {
                // fallback to expected location under resources
                resource_dir.join("backend").join("launcher_core.dll")
            })
    };
    let lua_files_dir = {
        let mut candidates = vec![
            resource_dir.join("lua_files"),
            resource_dir.join("backend").join("lua_files"),
        ];
        if let Some(dir) = &exe_dir {
            candidates.push(dir.join("lua_files"));
            candidates.push(dir.join("resources").join("lua_files"));
            candidates.push(dir.join("resources").join("backend").join("lua_files"));
        }
        candidates.into_iter().find(|p| p.exists())
    };
    let manifest_dir = {
        let mut candidates = vec![
            resource_dir.join("auto_chunk_check_update"),
            resource_dir.join("backend").join("auto_chunk_check_update"),
            resource_dir
                .join("backend")
                .join("_internal")
                .join("auto_chunk_check_update"),
        ];
        if let Some(dir) = &exe_dir {
            candidates.push(dir.join("auto_chunk_check_update"));
            candidates.push(dir.join("resources").join("auto_chunk_check_update"));
            candidates.push(
                dir.join("resources")
                    .join("backend")
                    .join("auto_chunk_check_update"),
            );
            candidates.push(
                dir.join("resources")
                    .join("backend")
                    .join("_internal")
                    .join("auto_chunk_check_update"),
            );
        }
        candidates.into_iter().find(|p| p.exists())
    };
    cmd.arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(spawn_port.to_string())
        .current_dir(&cache_dir)
        // Make sure DATABASE_URL points to a writable sqlite file.
        .env("DATABASE_URL", sqlite_database_url(&sqlite_db_path))
        // Writable storage for OAuth states, workshop, screenshots, etc.
        .env(
            "OTOSHI_STORAGE_DIR",
            storage_dir.to_string_lossy().to_string(),
        )
        .env(
            "SETTINGS_STORAGE_PATH",
            settings_path.to_string_lossy().to_string(),
        )
        .env(
            "WORKSHOP_STORAGE_DIR",
            storage_dir.join("workshop").to_string_lossy().to_string(),
        )
        .env(
            "SCREENSHOT_STORAGE_DIR",
            storage_dir
                .join("screenshots")
                .to_string_lossy()
                .to_string(),
        )
        .env(
            "BUILD_STORAGE_DIR",
            storage_dir.join("builds").to_string_lossy().to_string(),
        )
        // Cache for lua sync + local manifests
        .env("OTOSHI_CACHE_DIR", cache_dir.to_string_lossy().to_string())
        .env(
            "DEFAULT_INSTALL_ROOT",
            games_dir.to_string_lossy().to_string(),
        )
        // Ship SteamGridDB key for production users so they don't need a local .env
        .env("STEAMGRIDDB_API_KEY", "6949533daea9444b0e8f2dfe121a0c30")
        // Keep BACKEND_PORT aligned with the actual listening port.
        .env("BACKEND_PORT", spawn_port.to_string())
        // Ensure chunk endpoints generated by backend use the real runtime port.
        .env("LOCAL_API_BASE", format!("http://127.0.0.1:{spawn_port}"))
        .env("CDN_PRIMARY_URLS", format!("http://127.0.0.1:{spawn_port}"))
        .env(
            "CDN_FALLBACK_URLS",
            format!("http://localhost:{spawn_port},http://127.0.0.1:{spawn_port}"),
        )
        // Keep OAuth callback host/port in sync when backend runs on fallback ports.
        .env(
            "OAUTH_CALLBACK_BASE_URL",
            format!("http://127.0.0.1:{spawn_port}"),
        )
        // Allow backend to load launcher_core.dll from bundled resources
        .env(
            "LAUNCHER_CORE_PATH",
            launcher_core_path.to_string_lossy().to_string(),
        )
        // Prefer mutable backend data shipped next to sidecar executable
        // (chunk manifest map, launchers.json, etc.) over frozen _internal data.
        .env(
            "APP_DATA_DIR",
            backend_data_dir.to_string_lossy().to_string(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));

    if let Some(lua_dir) = lua_files_dir {
        cmd.env("LUA_FILES_DIR", lua_dir.to_string_lossy().to_string());
    }
    if let Some(manifest_path) = manifest_dir {
        cmd.env(
            "CHUNK_MANIFEST_DIR",
            manifest_path.to_string_lossy().to_string(),
        );
    }

    // On Windows, hide the console window for the backend process.
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Some(env) = env_file {
        cmd.arg("--env-file").arg(env);
    }

    tracing::info!("Spawning backend process...");
    let child = cmd
        .spawn()
        .map_err(|e| LauncherError::Config(format!("failed to spawn backend: {e}")))?;

    tracing::info!("Backend process spawned with PID: {:?}", child.id());

    // Wait a bit for readiness.
    tracing::info!(
        "Waiting for backend to become ready on port {}...",
        spawn_port
    );
    for i in 0..40 {
        if is_running("127.0.0.1", spawn_port) {
            std::env::set_var("LAUNCHER_API_URL", format!("http://127.0.0.1:{spawn_port}"));
            tracing::info!("backend sidecar is ready on 127.0.0.1:{}", spawn_port);
            return Ok(Some(child));
        }
        if i % 10 == 0 {
            tracing::debug!("Still waiting for backend... attempt {}/40", i + 1);
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    // Try to read the log file for debugging
    if let Ok(log_content) = std::fs::read_to_string(&log_path) {
        let last_lines: String = log_content
            .lines()
            .rev()
            .take(20)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        tracing::error!("Backend log (last 20 lines):\n{}", last_lines);
    }

    // Backend didn't become ready in time; keep app running.
    tracing::warn!(
        "backend sidecar started but did not become ready in time (port {}), keeping launcher running",
        spawn_port
    );
    Ok(Some(child))
}
