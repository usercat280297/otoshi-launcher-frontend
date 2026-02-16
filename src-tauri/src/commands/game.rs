use std::collections::HashMap;
use std::fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, System};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::commands::overlay::set_overlay_window_visible;
use crate::db::queries::{GameQueries, LaunchPrefQueries, PlaySessionQueries};
use crate::models::{Game, GameLaunchPref, LibraryEntry, LocalGame, PlaySessionLocal};
use crate::services::RunningGame;
use crate::utils::paths::resolve_data_dir;
use crate::AppState;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn get_library(state: State<'_, Arc<AppState>>) -> Result<Vec<LibraryEntry>, String> {
    let entries = state
        .library
        .get_library()
        .await
        .map_err(|err| err.to_string())?;

    for entry in &entries {
        let local = LocalGame {
            id: entry.game.id.clone(),
            slug: entry.game.slug.clone(),
            title: entry.game.title.clone(),
            header_image: entry.game.header_image.clone(),
            install_path: None,
            installed_version: entry.installed_version.clone(),
            last_played: None,
            playtime_seconds: (entry.playtime_hours * 3600.0) as i64,
        };
        let _ = state.db.upsert_game(&local);
    }

    Ok(entries)
}

#[tauri::command]
pub async fn get_game_details(
    slug: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Game, String> {
    state
        .library
        .get_game_details(&slug)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_cached_library(state: State<'_, Arc<AppState>>) -> Result<Vec<LocalGame>, String> {
    state.db.get_games().map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn update_playtime(
    game_id: String,
    seconds: i64,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state
        .db
        .update_playtime(&game_id, seconds)
        .map_err(|err| err.to_string())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub game_id: String,
    pub slug: String,
    pub title: String,
    pub renderer: String,
    pub overlay_enabled: bool,
    pub steam_app_id: Option<String>,
    pub executable: Option<String>,
    pub game_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub exe_path: String,
    pub working_dir: String,
    pub args: Vec<String>,
    pub renderer: String,
    pub overlay_enabled: bool,
    pub launched_as_admin: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPrefPayload {
    pub game_id: String,
    pub require_admin: bool,
    pub ask_every_time: Option<bool>,
}

#[tauri::command]
pub async fn get_game_launch_pref(
    game_id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<GameLaunchPref>, String> {
    state
        .db
        .get_launch_pref(&game_id)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn set_game_launch_pref(
    payload: LaunchPrefPayload,
    state: State<'_, Arc<AppState>>,
) -> Result<GameLaunchPref, String> {
    let pref = GameLaunchPref {
        game_id: payload.game_id,
        require_admin: payload.require_admin,
        ask_every_time: payload.ask_every_time.unwrap_or(false),
        updated_at: Utc::now().timestamp(),
    };
    state
        .db
        .upsert_launch_pref(&pref)
        .map_err(|err| err.to_string())?;
    Ok(pref)
}

#[tauri::command]
pub async fn get_running_games(state: State<'_, Arc<AppState>>) -> Result<Vec<RunningGame>, String> {
    Ok(state.game_runtime.list())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchersConfig {
    defaults: Option<LaunchDefaults>,
    games: Option<HashMap<String, GameLaunchConfig>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchDefaults {
    renderer_priority: Option<Vec<String>>,
    overlay_default: Option<bool>,
    renderer_args: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameLaunchConfig {
    exe: Option<String>,
    working_dir: Option<String>,
    renderer_args: Option<HashMap<String, Vec<String>>>,
    allowed_renderers: Option<Vec<String>>,
    overlay_default: Option<bool>,
}

#[tauri::command]
pub async fn launch_game(
    payload: LaunchRequest,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<LaunchResult, String> {
    let config = load_launchers_config(&app);
    let game_config = config
        .as_ref()
        .and_then(|cfg| cfg.games.as_ref())
        .and_then(|games| {
            games
                .get(&payload.game_id)
                .or_else(|| games.get(&payload.slug))
        });

    let install_dir = resolve_install_dir(&state, &payload, game_config)
        .ok_or_else(|| "Install folder not found.".to_string())?;

    let exe_path = resolve_exe_path(&install_dir, &payload, game_config)?;
    let working_dir = resolve_working_dir(&install_dir, &payload, game_config);
    let args = resolve_renderer_args(&payload.renderer, config.as_ref(), game_config);
    let launch_pref = state
        .db
        .get_launch_pref(&payload.game_id)
        .map_err(|err| err.to_string())?;
    let require_admin = launch_pref.as_ref().map(|pref| pref.require_admin).unwrap_or(false);

    state.overlay.set_visible(payload.overlay_enabled);
    let _ = set_overlay_window_visible(&app, payload.overlay_enabled);

    let session_id = Uuid::new_v4().to_string();
    let session_started_at = Utc::now().timestamp();
    let _ = state.db.upsert_play_session(&PlaySessionLocal {
        id: session_id.clone(),
        game_id: payload.game_id.clone(),
        started_at: session_started_at,
        ended_at: None,
        duration_sec: 0,
        exit_code: None,
        synced: false,
        updated_at: session_started_at,
    });

    if require_admin {
        let pid = launch_with_admin(
            &exe_path,
            &working_dir,
            &args,
            &payload.renderer,
            payload.overlay_enabled,
        )?;

        state.game_runtime.register(RunningGame {
            game_id: payload.game_id.clone(),
            title: payload.title.clone(),
            pid,
            started_at: session_started_at,
            session_id: session_id.clone(),
            launched_as_admin: true,
            overlay_enabled: payload.overlay_enabled,
        });

        let app_handle = app.clone();
        let state_for_thread = state.inner().clone();
        let game_id = payload.game_id.clone();
        let overlay_enabled = payload.overlay_enabled;
        let session_for_thread = session_id.clone();
        std::thread::spawn(move || {
            let pid_sys = Pid::from_u32(pid);
            let mut sys = System::new_all();
            loop {
                if !state_for_thread.game_runtime.is_pid_registered(&game_id, pid) {
                    return;
                }
                sys.refresh_processes();
                if sys.process(pid_sys).is_none() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(750));
            }

            let ended_at = Utc::now().timestamp();
            let duration_sec = (ended_at - session_started_at).max(0);
            if state_for_thread
                .game_runtime
                .take_if_pid_matches(&game_id, pid)
                .is_none()
            {
                return;
            }
            let _ = state_for_thread.db.update_playtime(&game_id, duration_sec);
            let _ = state_for_thread.db.upsert_play_session(&PlaySessionLocal {
                id: session_for_thread.clone(),
                game_id: game_id.clone(),
                started_at: session_started_at,
                ended_at: Some(ended_at),
                duration_sec,
                exit_code: None,
                synced: false,
                updated_at: ended_at,
            });
            if overlay_enabled {
                let _ = set_overlay_window_visible(&app_handle, false);
            }

            let state_for_sync = state_for_thread.clone();
            let game_for_sync = game_id.clone();
            tauri::async_runtime::spawn(async move {
                let _ = sync_play_session_to_backend(
                    state_for_sync,
                    &session_for_thread,
                    &game_for_sync,
                    session_started_at,
                    ended_at,
                    duration_sec,
                    None,
                )
                .await;
            });
        });
        return Ok(LaunchResult {
            exe_path: exe_path.to_string_lossy().to_string(),
            working_dir: working_dir.to_string_lossy().to_string(),
            args,
            renderer: payload.renderer,
            overlay_enabled: payload.overlay_enabled,
            launched_as_admin: true,
        });
    }

    let mut cmd = Command::new(&exe_path);
    cmd.current_dir(&working_dir)
        .env("OTOSHI_RENDERER", &payload.renderer)
        .env(
            "OTOSHI_OVERLAY",
            if payload.overlay_enabled { "1" } else { "0" },
        )
        .args(&args);

    let mut child = cmd
        .spawn()
        .map_err(|err| format!("Failed to launch game: {err}"))?;
    let pid = child.id();

    state.game_runtime.register(RunningGame {
        game_id: payload.game_id.clone(),
        title: payload.title.clone(),
        pid,
        started_at: session_started_at,
        session_id: session_id.clone(),
        launched_as_admin: false,
        overlay_enabled: payload.overlay_enabled,
    });

    let app_handle = app.clone();
    let state_for_thread = state.inner().clone();
    let game_id = payload.game_id.clone();
    let overlay_enabled = payload.overlay_enabled;
    std::thread::spawn(move || {
        let status = child.wait();
        let ended_at = Utc::now().timestamp();
        let duration_sec = (ended_at - session_started_at).max(0);
        let exit_code = status.ok().and_then(|s| s.code());
        if state_for_thread
            .game_runtime
            .take_if_pid_matches(&game_id, pid)
            .is_none()
        {
            if overlay_enabled {
                let _ = set_overlay_window_visible(&app_handle, false);
            }
            return;
        }
        let _ = state_for_thread.db.update_playtime(&game_id, duration_sec);
        let _ = state_for_thread.db.upsert_play_session(&PlaySessionLocal {
            id: session_id.clone(),
            game_id: game_id.clone(),
            started_at: session_started_at,
            ended_at: Some(ended_at),
            duration_sec,
            exit_code,
            synced: false,
            updated_at: ended_at,
        });
        if overlay_enabled {
            let _ = set_overlay_window_visible(&app_handle, false);
        }

        let state_for_sync = state_for_thread.clone();
        let session_for_sync = session_id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = sync_play_session_to_backend(
                state_for_sync,
                &session_for_sync,
                &game_id,
                session_started_at,
                ended_at,
                duration_sec,
                exit_code,
            )
            .await;
        });
    });

    Ok(LaunchResult {
        exe_path: exe_path.to_string_lossy().to_string(),
        working_dir: working_dir.to_string_lossy().to_string(),
        args,
        renderer: payload.renderer,
        overlay_enabled: payload.overlay_enabled,
        launched_as_admin: false,
    })
}

#[cfg(target_os = "windows")]
fn launch_with_admin(
    exe_path: &Path,
    working_dir: &Path,
    args: &[String],
    renderer: &str,
    overlay_enabled: bool,
) -> Result<u32, String> {
    let quote = |value: &str| format!("'{}'", value.replace('\'', "''"));
    let args_literal = if args.is_empty() {
        "@()".to_string()
    } else {
        let rendered = args
            .iter()
            .map(|arg| quote(arg))
            .collect::<Vec<_>>()
            .join(", ");
        format!("@({rendered})")
    };

    let script = format!(
        "$ErrorActionPreference='Stop'; $env:OTOSHI_RENDERER={}; $env:OTOSHI_OVERLAY={}; (Start-Process -FilePath {} -WorkingDirectory {} -ArgumentList {} -Verb RunAs -PassThru).Id",
        quote(renderer),
        quote(if overlay_enabled { "1" } else { "0" }),
        quote(exe_path.to_string_lossy().as_ref()),
        quote(working_dir.to_string_lossy().as_ref()),
        args_literal,
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Failed to request admin launch: {err}"))?;
    if !output.status.success() {
        return Err("Admin launch request was rejected.".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let pid = stdout
        .split(|c: char| !c.is_ascii_digit())
        .filter(|token| !token.is_empty())
        .last()
        .and_then(|token| token.parse::<u32>().ok())
        .ok_or_else(|| format!("Admin launch succeeded but PID was not returned: {stdout}"))?;
    Ok(pid)
}

#[cfg(target_os = "windows")]
fn kill_pid(pid: u32) -> Result<(), String> {
    let pid_arg = pid.to_string();
    let output = Command::new("taskkill")
        .args(["/PID", &pid_arg, "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|err| format!("Failed to run taskkill: {err}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}\n{stderr}").to_ascii_lowercase();
    if combined.contains("not found") || combined.contains("no running instance") {
        return Ok(());
    }

    // If taskkill fails due to elevation (or any other reason), try again with elevation.
    let script = format!(
        "$ErrorActionPreference='Stop'; $p=Start-Process -FilePath 'taskkill' -ArgumentList @('/PID','{pid}','/T','/F') -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode"
    );
    let status = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|err| format!("Failed to request elevation for stop: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "Failed to stop game (taskkill exit={:?}): {}",
            output.status.code(),
            stderr.trim()
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_pid(_pid: u32) -> Result<(), String> {
    Err("Stop is only supported on Windows.".to_string())
}

#[tauri::command]
pub async fn stop_game(
    game_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let running = state
        .game_runtime
        .take(&game_id)
        .ok_or_else(|| "Game is not running.".to_string())?;

    if let Err(err) = kill_pid(running.pid) {
        // Game is likely still running; re-register so user can retry.
        state.game_runtime.register(running);
        return Err(err);
    }

    if running.overlay_enabled {
        let _ = set_overlay_window_visible(&app, false);
    }

    let ended_at = Utc::now().timestamp();
    let duration_sec = (ended_at - running.started_at).max(0);
    state
        .db
        .update_playtime(&game_id, duration_sec)
        .map_err(|err| err.to_string())?;
    state
        .db
        .upsert_play_session(&PlaySessionLocal {
            id: running.session_id.clone(),
            game_id: game_id.clone(),
            started_at: running.started_at,
            ended_at: Some(ended_at),
            duration_sec,
            exit_code: None,
            synced: false,
            updated_at: ended_at,
        })
        .map_err(|err| err.to_string())?;

    let state_for_sync = state.inner().clone();
    let session_for_sync = running.session_id.clone();
    let game_for_sync = game_id.clone();
    tauri::async_runtime::spawn(async move {
        let _ = sync_play_session_to_backend(
            state_for_sync,
            &session_for_sync,
            &game_for_sync,
            running.started_at,
            ended_at,
            duration_sec,
            None,
        )
        .await;
    });

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_with_admin(
    _exe_path: &Path,
    _working_dir: &Path,
    _args: &[String],
    _renderer: &str,
    _overlay_enabled: bool,
) -> Result<u32, String> {
    Err("Admin launch is only supported on Windows.".to_string())
}

async fn sync_play_session_to_backend(
    state: Arc<AppState>,
    session_id: &str,
    game_id: &str,
    started_at: i64,
    ended_at: i64,
    duration_sec: i64,
    exit_code: Option<i32>,
) -> Result<(), String> {
    let library = state
        .library
        .get_library()
        .await
        .map_err(|err| err.to_string())?;
    let Some(entry) = library.into_iter().find(|item| item.game.id == game_id) else {
        return Err("Library entry not found for play session sync".to_string());
    };

    let started_dt = DateTime::<Utc>::from_timestamp(started_at, 0)
        .ok_or_else(|| "Invalid started_at timestamp".to_string())?;
    let ended_dt = DateTime::<Utc>::from_timestamp(ended_at, 0)
        .ok_or_else(|| "Invalid ended_at timestamp".to_string())?;

    let payload = serde_json::json!({
        "started_at": started_dt.to_rfc3339(),
        "ended_at": ended_dt.to_rfc3339(),
        "duration_sec": duration_sec,
        "exit_code": exit_code
    });
    let path = format!("library/{}/session", entry.id);
    let _: serde_json::Value = state
        .api
        .post(&path, payload, true)
        .await
        .map_err(|err| err.to_string())?;
    state
        .db
        .mark_play_session_synced(session_id)
        .map_err(|err| err.to_string())?;
    Ok(())
}

fn load_launchers_config(app: &AppHandle) -> Option<LaunchersConfig> {
    let data_dir = resolve_data_dir(app);
    let resource_dir = app.path().resource_dir().ok();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));
    let mut candidates: Vec<PathBuf> = Vec::new();
    candidates.push(data_dir.join("launchers.json"));
    if let Some(dir) = resource_dir.as_ref() {
        candidates.push(dir.join("backend").join("launchers.json"));
        candidates.push(dir.join("launchers.json"));
        candidates.push(dir.join("config").join("launchers.json"));
        candidates.push(dir.join("resources").join("config").join("launchers.json"));
    }
    if let Some(dir) = exe_dir.as_ref() {
        candidates.push(dir.join("config").join("launchers.json"));
        candidates.push(dir.join("resources").join("config").join("launchers.json"));
    }

    for path in candidates {
        if let Some(config) = read_launch_config(&path) {
            return Some(config);
        }
    }
    None
}

fn read_launch_config(path: &Path) -> Option<LaunchersConfig> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn resolve_install_dir(
    state: &AppState,
    payload: &LaunchRequest,
    _config: Option<&GameLaunchConfig>,
) -> Option<PathBuf> {
    let default_dir = state.files.get_game_dir(&payload.slug);
    if default_dir.exists() {
        return Some(default_dir);
    }

    if let Some(app_id) = payload
        .steam_app_id
        .as_ref()
        .or_else(|| Some(&payload.game_id))
    {
        if let Some(path) = find_steam_game_path(app_id) {
            return Some(path);
        }
    }

    None
}

fn find_steam_game_path(app_id: &str) -> Option<PathBuf> {
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
            let common_dir = steam_path.join("steamapps").join("common");
            if !common_dir.exists() {
                continue;
            }
            if let Ok(entries) = fs::read_dir(&common_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    let appid_file = path.join("steam_appid.txt");
                    if let Ok(content) = fs::read_to_string(&appid_file) {
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

fn resolve_exe_path(
    install_dir: &Path,
    payload: &LaunchRequest,
    config: Option<&GameLaunchConfig>,
) -> Result<PathBuf, String> {
    if let Some(exe) = payload
        .executable
        .as_ref()
        .map(|value| value.trim())
        .filter(|v| !v.is_empty())
    {
        let exe_path = Path::new(exe);
        if exe_path.is_absolute() && exe_path.exists() {
            return Ok(exe_path.to_path_buf());
        }
        if let Some(dir) = payload
            .game_dir
            .as_ref()
            .map(|value| value.trim())
            .filter(|v| !v.is_empty())
        {
            let candidate = to_path(install_dir, dir).join(exe);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
        let candidate = install_dir.join(exe);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Some(cfg) = config {
        if let Some(exe) = cfg.exe.as_ref() {
            let exe_path = to_path(install_dir, exe);
            if exe_path.exists() {
                return Ok(exe_path);
            }
        }
    }

    let candidates = load_manifest_exes(install_dir);
    if candidates.is_empty() {
        return Err("No executable found in manifest.json.".to_string());
    }
    let best = pick_best_exe(&candidates, &payload.slug, &payload.title)
        .unwrap_or_else(|| candidates[0].clone());
    let exe_path = install_dir.join(&best);
    if exe_path.exists() {
        return Ok(exe_path);
    }

    for candidate in candidates {
        let path = install_dir.join(&candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Executable not found on disk.".to_string())
}

fn resolve_working_dir(
    install_dir: &Path,
    payload: &LaunchRequest,
    config: Option<&GameLaunchConfig>,
) -> PathBuf {
    if let Some(dir) = payload
        .game_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|v| !v.is_empty())
    {
        let path = to_path(install_dir, dir);
        if path.exists() {
            return path;
        }
    }
    if let Some(cfg) = config {
        if let Some(dir) = cfg.working_dir.as_ref() {
            return to_path(install_dir, dir);
        }
    }
    install_dir.to_path_buf()
}

fn resolve_renderer_args(
    renderer: &str,
    config: Option<&LaunchersConfig>,
    game_config: Option<&GameLaunchConfig>,
) -> Vec<String> {
    let renderer_key = renderer.to_lowercase();
    if renderer_key == "auto" {
        return Vec::new();
    }

    if let Some(cfg) = game_config.and_then(|c| c.renderer_args.as_ref()) {
        if let Some(args) = cfg.get(&renderer_key) {
            return args.clone();
        }
    }

    if let Some(cfg) = config
        .and_then(|c| c.defaults.as_ref())
        .and_then(|d| d.renderer_args.as_ref())
    {
        if let Some(args) = cfg.get(&renderer_key) {
            return args.clone();
        }
    }

    match renderer_key.as_str() {
        "dx12" => vec!["-dx12".to_string()],
        "dx11" => vec!["-dx11".to_string()],
        "vulkan" => vec!["-vulkan".to_string()],
        _ => Vec::new(),
    }
}

fn load_manifest_exes(install_dir: &Path) -> Vec<String> {
    let manifest_path = install_dir.join("manifest.json");
    let raw = match fs::read_to_string(&manifest_path) {
        Ok(data) => data,
        Err(_) => return Vec::new(),
    };
    let data: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    let files = match data.get("files").and_then(|value| value.as_array()) {
        Some(list) => list,
        None => return Vec::new(),
    };

    let mut candidates = Vec::new();
    for entry in files {
        let Some(path) = entry.get("path").and_then(|value| value.as_str()) else {
            continue;
        };
        if path.to_ascii_lowercase().ends_with(".exe") {
            candidates.push(path.replace('\\', "/"));
        }
    }
    candidates
}

fn pick_best_exe(candidates: &[String], slug: &str, title: &str) -> Option<String> {
    let slug_norm = normalize_name(slug);
    let title_norm = normalize_name(title);
    let mut best: Option<(i32, String)> = None;

    for candidate in candidates {
        let score = score_exe(candidate, &slug_norm, &title_norm);
        if best
            .as_ref()
            .map_or(true, |(best_score, _)| score > *best_score)
        {
            best = Some((score, candidate.clone()));
        }
    }
    best.map(|(_, value)| value)
}

fn score_exe(path: &str, slug_norm: &str, title_norm: &str) -> i32 {
    let mut score = 0;
    let normalized_path = path.replace('\\', "/");
    let file_name = Path::new(&normalized_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| normalized_path.clone());
    let base = file_name.trim_end_matches(".exe");
    let base_norm = normalize_name(base);

    if !slug_norm.is_empty() && base_norm == slug_norm {
        score += 120;
    }
    if !title_norm.is_empty() && base_norm == title_norm {
        score += 100;
    }
    if !slug_norm.is_empty() && base_norm.contains(slug_norm) {
        score += 40;
    }
    if !title_norm.is_empty() && base_norm.contains(title_norm) {
        score += 30;
    }

    let depth = normalized_path.matches('/').count();
    score += match depth {
        0 => 60,
        1 => 40,
        2 => 20,
        _ => 0,
    };

    let lower = base.to_ascii_lowercase();
    let blocklist = [
        "crash",
        "handler",
        "overlay",
        "steam",
        "unins",
        "setup",
        "uninstall",
        "vcredist",
        "dxsetup",
    ];
    for token in blocklist {
        if lower.contains(token) {
            score -= 80;
        }
    }

    score
}

fn normalize_name(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn to_path(base: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        base.join(value)
    }
}
