#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend_sidecar;
mod commands;
mod db;
mod errors;
mod logging;
mod lua_bundler;
mod models;
mod services;
mod utils;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, UNIX_EPOCH};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

use sha2::{Digest, Sha256};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{Emitter, Manager, WindowEvent};

use crate::db::Database;
use crate::errors::{LauncherError, Result};
use crate::services::{
    AchievementService, ApiClient, ArtworkCacheService, AuthService, CloudSaveService, CrackManager,
    DiscoveryService, DownloadManager, DownloadManagerV2, DownloadService, GameRuntimeService,
    InventoryService, LibraryService, LicenseService, ManifestService, OverlayService,
    RemoteDownloadService, SecurityGuardService, SelfHealService, StreamingService, TelemetryService,
    WorkshopService,
};
use crate::services::steam_prefetch_worker::spawn_locale_prefetch_worker;
use crate::utils::file::FileManager;
use crate::utils::paths::{resolve_cache_dir, resolve_data_dir, resolve_games_dir};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub auth: AuthService,
    pub api: ApiClient,
    pub library: LibraryService,
    pub downloads: DownloadService,
    pub download_manager: DownloadManager,
    pub download_manager_v2: DownloadManagerV2,
    pub game_runtime: GameRuntimeService,
    pub self_heal: SelfHealService,
    pub security_guard_v2: SecurityGuardService,
    pub crack_manager: CrackManager,
    pub telemetry: TelemetryService,
    pub manifests: ManifestService,
    pub license: LicenseService,
    pub achievements: AchievementService,
    pub cloud_saves: CloudSaveService,
    pub workshop: WorkshopService,
    pub discovery: DiscoveryService,
    pub inventory: InventoryService,
    pub remote_downloads: RemoteDownloadService,
    pub streaming: StreamingService,
    pub overlay: OverlayService,
    pub artwork_cache: ArtworkCacheService,
    pub files: FileManager,
}

const WEB_PACK_STAMP_FILE: &str = ".web-pack.stamp";

#[derive(Default)]
struct AppLifecycle {
    quitting: AtomicBool,
}

fn apply_window_icon(window: &tauri::WebviewWindow) {
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
        let _ = window.set_icon(icon);
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(main_window) = app.get_webview_window("main") {
        apply_window_icon(&main_window);
        let _ = main_window.show();
        let _ = main_window.unminimize();
        let _ = main_window.maximize();
        let _ = main_window.set_focus();
    }
}

fn emit_tray_action(app: &tauri::AppHandle, action: &str, locale: Option<&str>) {
    let payload = if let Some(locale_value) = locale {
        serde_json::json!({
            "action": action,
            "locale": locale_value
        })
    } else {
        serde_json::json!({
            "action": action
        })
    };
    let _ = app.emit("tray-action", payload);
}

fn setup_system_tray(app: &tauri::AppHandle) -> Result<()> {
    let version_label = MenuItem::with_id(
        app,
        "tray_version_label",
        format!("Otoshi Launcher {}", env!("CARGO_PKG_VERSION")),
        false,
        None::<&str>,
    )
    .map_err(|e| LauncherError::Config(format!("failed to create tray version label: {e}")))?;
    let open_item = MenuItem::with_id(app, "tray_open", "Open Otoshi", true, None::<&str>)
        .map_err(|e| LauncherError::Config(format!("failed to create tray open item: {e}")))?;
    let website_item = MenuItem::with_id(
        app,
        "tray_open_website",
        "Open Official Website",
        true,
        None::<&str>,
    )
    .map_err(|e| LauncherError::Config(format!("failed to create tray website item: {e}")))?;
    let check_updates_item = MenuItem::with_id(
        app,
        "tray_check_updates",
        "Check for Updates",
        true,
        None::<&str>,
    )
    .map_err(|e| LauncherError::Config(format!("failed to create tray update item: {e}")))?;
    let language_en_item = MenuItem::with_id(
        app,
        "tray_language_en",
        "English (EN)",
        true,
        None::<&str>,
    )
    .map_err(|e| LauncherError::Config(format!("failed to create tray english item: {e}")))?;
    let language_vi_item = MenuItem::with_id(
        app,
        "tray_language_vi",
        "Tieng Viet (VI)",
        true,
        None::<&str>,
    )
    .map_err(|e| LauncherError::Config(format!("failed to create tray vietnamese item: {e}")))?;
    let language_submenu = Submenu::with_items(
        app,
        "Language",
        true,
        &[&language_en_item, &language_vi_item],
    )
    .map_err(|e| LauncherError::Config(format!("failed to create tray language submenu: {e}")))?;
    let hide_window_item = MenuItem::with_id(
        app,
        "tray_hide_window",
        "Hide Floating Window",
        true,
        None::<&str>,
    )
    .map_err(|e| LauncherError::Config(format!("failed to create tray hide item: {e}")))?;
    let feedback_item = MenuItem::with_id(app, "tray_feedback", "Feedback", true, None::<&str>)
        .map_err(|e| LauncherError::Config(format!("failed to create tray feedback item: {e}")))?;
    let about_item = MenuItem::with_id(app, "tray_about", "About", true, None::<&str>)
        .map_err(|e| LauncherError::Config(format!("failed to create tray about item: {e}")))?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "Exit", true, None::<&str>)
        .map_err(|e| LauncherError::Config(format!("failed to create tray quit item: {e}")))?;
    let separator_1 = PredefinedMenuItem::separator(app)
        .map_err(|e| LauncherError::Config(format!("failed to create tray separator 1: {e}")))?;
    let separator_2 = PredefinedMenuItem::separator(app)
        .map_err(|e| LauncherError::Config(format!("failed to create tray separator 2: {e}")))?;

    let menu = Menu::with_items(
        app,
        &[
            &version_label,
            &separator_1,
            &open_item,
            &website_item,
            &check_updates_item,
            &language_submenu,
            &hide_window_item,
            &feedback_item,
            &about_item,
            &separator_2,
            &quit_item,
        ],
    )
        .map_err(|e| LauncherError::Config(format!("failed to create tray menu: {e}")))?;

    let tray_icon = app
        .default_window_icon()
        .cloned()
        .or_else(|| tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).ok())
        .ok_or_else(|| LauncherError::Config("failed to load tray icon".to_string()))?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        .tooltip("Otoshi Launcher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let event_id: &str = event.id().as_ref();
            match event_id {
                "tray_open" => {
                    show_main_window(app);
                }
                "tray_open_website" => {
                    emit_tray_action(app, "open_official_website", None);
                }
                "tray_check_updates" => {
                    show_main_window(app);
                    emit_tray_action(app, "check_updates", None);
                }
                "tray_language_en" => {
                    emit_tray_action(app, "set_language", Some("en"));
                }
                "tray_language_vi" => {
                    emit_tray_action(app, "set_language", Some("vi"));
                }
                "tray_hide_window" => {
                    if let Some(main_window) = app.get_webview_window("main") {
                        let _ = main_window.hide();
                    }
                }
                "tray_feedback" => {
                    emit_tray_action(app, "feedback", None);
                }
                "tray_about" => {
                    show_main_window(app);
                    emit_tray_action(app, "about", None);
                }
                "tray_quit" => {
                    if let Some(lifecycle) = app.try_state::<AppLifecycle>() {
                        lifecycle.quitting.store(true, Ordering::SeqCst);
                    }
                    if let Some(proc) = app.try_state::<backend_sidecar::BackendProcess>() {
                        proc.terminate();
                    }
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .map_err(|e| LauncherError::Config(format!("failed to create tray icon: {e}")))?;

    Ok(())
}

fn build_state(app: &tauri::AppHandle) -> Result<AppState> {
    let app_data = resolve_data_dir(app);
    // logging is initialized in main() setup early

    let db = db::init(app)?;
    let install_dir = resolve_games_dir(app);

    let files = FileManager::new(app_data.clone(), install_dir);

    let api_url =
        std::env::var("LAUNCHER_API_URL").unwrap_or_else(|_| "http://127.0.0.1:8000".to_string());

    let key_path = app_data.join("secret.key");
    let key = utils::crypto::load_or_create_key(&key_path)?;
    let artwork_cache = ArtworkCacheService::new(resolve_cache_dir(app), &key)?;

    let auth = AuthService::new(api_url.clone(), db.clone(), key);
    let api = ApiClient::new(api_url, auth.clone());

    let library = LibraryService::new(api.clone());
    let downloads = DownloadService::new(api.clone());
    let download_manager = DownloadManager::new(
        app.clone(),
        db.clone(),
        api.clone(),
        downloads.clone(),
        files.clone(),
    );
    let download_manager_v2 =
        DownloadManagerV2::new(download_manager.clone(), downloads.clone(), db.clone());
    let game_runtime = GameRuntimeService::new();
    let self_heal = SelfHealService::new(db.clone());
    let security_guard_v2 = SecurityGuardService::new();
    let crack_manager = CrackManager::new(db.clone(), api.clone());
    let telemetry = TelemetryService::new(api.clone());
    let manifests = ManifestService::new();
    let license_pem = std::env::var("LICENSE_PUBLIC_KEY_PEM").ok();
    let license = LicenseService::new(license_pem);
    let achievements = AchievementService::new(api.clone());
    let cloud_saves = CloudSaveService::new(api.clone());
    let workshop = WorkshopService::new(api.clone());
    let discovery = DiscoveryService::new(api.clone());
    let inventory = InventoryService::new(api.clone());
    let remote_downloads = RemoteDownloadService::new(api.clone());
    let streaming = StreamingService::new(api.clone());
    let overlay = OverlayService::new();

    Ok(AppState {
        db,
        auth,
        api,
        library,
        downloads,
        download_manager,
        download_manager_v2,
        game_runtime,
        self_heal,
        security_guard_v2,
        crack_manager,
        telemetry,
        manifests,
        license,
        achievements,
        cloud_saves,
        workshop,
        discovery,
        inventory,
        remote_downloads,
        streaming,
        overlay,
        artwork_cache,
        files,
    })
}

fn ensure_web_assets(app: &tauri::AppHandle) -> Result<()> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| LauncherError::Config("resource dir unavailable".to_string()))?;
    let web_dir = resource_dir.join("web");
    let index_path = web_dir.join("index.html");

    let pack_candidates = [
        resource_dir.join("web.pack"),
        resource_dir.join("resources").join("web.pack"),
    ];
    let pack_path = pack_candidates
        .iter()
        .find(|candidate| candidate.exists())
        .cloned();
    let Some(pack_path) = pack_path else {
        if !index_path.exists() {
            tracing::warn!(
                "web assets missing and web.pack not found; checked {:?}",
                pack_candidates
                    .iter()
                    .map(|value| value.display().to_string())
                    .collect::<Vec<_>>()
            );
        }
        return Ok(());
    };

    let pack_stamp = pack_signature(&pack_path)?;
    let current_stamp = read_web_stamp(&web_dir);
    let force_restore = std::env::var("OTOSHI_FORCE_WEB_RESTORE")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        })
        .unwrap_or(!cfg!(debug_assertions));
    let needs_restore = force_restore
        || !index_path.exists()
        || current_stamp.as_deref() != Some(pack_stamp.as_str());
    if !needs_restore {
        return Ok(());
    }

    tracing::info!(
        "Restoring web assets from {:?} (stamp={} previous={:?} force_restore={})",
        pack_path,
        pack_stamp,
        current_stamp,
        force_restore
    );
    if web_dir.exists() {
        if let Err(err) = fs::remove_dir_all(&web_dir) {
            tracing::warn!(
                "failed to clear stale web assets at {}: {}",
                web_dir.display(),
                err
            );
        }
    }
    extract_pack(&pack_path, &web_dir)?;
    write_web_stamp(&web_dir, &pack_stamp)?;

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args([
                "/c",
                "attrib",
                "+h",
                "+s",
                web_dir.to_string_lossy().as_ref(),
            ])
            .status();
        let _ = std::process::Command::new("cmd")
            .args([
                "/c",
                "attrib",
                "+h",
                "+s",
                pack_path.to_string_lossy().as_ref(),
            ])
            .status();
    }

    Ok(())
}

fn pack_signature(pack_path: &Path) -> Result<String> {
    let metadata = fs::metadata(pack_path)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    Ok(format!("{}:{}", metadata.len(), modified))
}

fn read_web_stamp(web_dir: &Path) -> Option<String> {
    let stamp_path = web_dir.join(WEB_PACK_STAMP_FILE);
    fs::read_to_string(stamp_path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn write_web_stamp(web_dir: &Path, stamp: &str) -> Result<()> {
    fs::create_dir_all(web_dir)?;
    fs::write(web_dir.join(WEB_PACK_STAMP_FILE), format!("{stamp}\n"))?;
    Ok(())
}

fn extract_pack(pack_path: &Path, dest: &Path) -> Result<()> {
    let file = fs::File::open(pack_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| LauncherError::Config(format!("invalid web.pack: {e}")))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| LauncherError::Config(format!("web.pack entry error: {e}")))?;
        let name = entry.name().replace('\\', "/");
        let Some(out_path) = safe_pack_path(dest, &name) else {
            continue;
        };

        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out_file = fs::File::create(&out_path)?;
            let mut buffer = Vec::new();
            entry.read_to_end(&mut buffer)?;
            std::io::Write::write_all(&mut out_file, &buffer)?;
        }
    }

    Ok(())
}

fn safe_pack_path(base: &Path, name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    let mut out = PathBuf::from(base);
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(out)
}

fn resolve_integrity_target(base: &Path, relative: &str) -> Option<PathBuf> {
    let mut output = PathBuf::from(base);
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(value) => output.push(value),
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(output)
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let bytes = file.read(&mut buffer)?;
        if bytes == 0 {
            break;
        }
        hasher.update(&buffer[..bytes]);
    }

    Ok(hex::encode(hasher.finalize()))
}

fn verify_runtime_integrity() -> Result<()> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|value| value.parent().map(Path::to_path_buf))
        .ok_or_else(|| LauncherError::Config("unable to resolve executable directory".to_string()))?;

    let checksum_file = exe_dir.join("checksums.sha256");
    if !checksum_file.exists() {
        return Err(LauncherError::Config(format!(
            "integrity manifest missing: {}",
            checksum_file.display()
        )));
    }

    let content = fs::read_to_string(&checksum_file)?;
    for (index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 2 {
            return Err(LauncherError::Config(format!(
                "invalid integrity manifest line {}",
                index + 1
            )));
        }

        let expected_hash = parts[0].trim().to_ascii_lowercase();
        let relative = parts[1..].join(" ");
        let target = resolve_integrity_target(&exe_dir, &relative).ok_or_else(|| {
            LauncherError::Config(format!(
                "invalid integrity target path at line {}: {}",
                index + 1,
                relative
            ))
        })?;

        if !target.exists() {
            return Err(LauncherError::Config(format!(
                "integrity target missing: {}",
                target.display()
            )));
        }

        let actual_hash = sha256_file(&target)?;
        if actual_hash.to_ascii_lowercase() != expected_hash {
            return Err(LauncherError::Config(format!(
                "integrity mismatch: {}",
                relative
            )));
        }
    }

    Ok(())
}

fn configure_native_guard_env(app: &tauri::AppHandle) {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("win_guard.dll"));
            candidates.push(parent.join("libs").join("win_guard.dll"));
            candidates.push(parent.join("win64").join("win_guard.dll"));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("win_guard.dll"));
        candidates.push(resource_dir.join("libs").join("win_guard.dll"));
        if let Some(parent) = resource_dir.parent() {
            candidates.push(parent.join("win_guard.dll"));
            candidates.push(parent.join("libs").join("win_guard.dll"));
        }
    }

    if let Some(found) = candidates.into_iter().find(|value| value.exists()) {
        std::env::set_var("WIN_GUARD_DLL_PATH", found.to_string_lossy().to_string());
        tracing::info!("WIN_GUARD_DLL_PATH set to {}", found.display());
    } else {
        tracing::warn!("win_guard.dll not found; native guard checks will be skipped");
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
            if let Some(silentui) = app.get_webview_window("silentui") {
                let _ = silentui.close();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished && webview.label() == "main" {
                show_main_window(&webview.app_handle());
                if let Some(silentui) = webview.get_webview_window("silentui") {
                    let _ = silentui.close();
                }
            }
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let should_quit = window
                    .app_handle()
                    .try_state::<AppLifecycle>()
                    .map(|lifecycle| lifecycle.quitting.load(Ordering::SeqCst))
                    .unwrap_or(false);
                if should_quit {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let handle = app.handle();
            app.manage(AppLifecycle::default());
            setup_system_tray(&handle)?;
            show_main_window(&handle);
            if let Some(silentui) = app.get_webview_window("silentui") {
                let _ = silentui.close();
            }
            // Optional: use hosted backend in production when explicitly requested.
            if !cfg!(debug_assertions)
                && std::env::var("LAUNCHER_API_URL").is_err()
                && std::env::var("LAUNCHER_USE_HOSTED")
                    .map(|v| v == "1")
                    .unwrap_or(false)
            {
                let hosted = "https://otoshi-launcher-backend.onrender.com";
                let health_url = format!("{}/health", hosted);
                let client = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_millis(1200))
                    .build();
                let ok = client
                    .ok()
                    .and_then(|c| c.get(health_url).send().ok())
                    .map(|r| r.status().is_success())
                    .unwrap_or(false);
                if ok {
                    std::env::set_var("LAUNCHER_API_URL", hosted);
                }
            }
            // Initialize logging as early as possible so setup failures are recorded.
            let log_dir = utils::paths::resolve_log_dir(&handle);
            logging::init(&log_dir)?;
            configure_native_guard_env(&handle);
            verify_runtime_integrity()?;
            ensure_web_assets(&handle)?;

            // Register deep link handler for OAuth callbacks
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle_clone = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    for url in urls {
                        let url_str = url.as_str();
                        tracing::info!("Deep link received: {}", url_str);
                        // Emit event to frontend for OAuth handling
                        if url_str.starts_with("otoshi://oauth")
                            || url_str.starts_with("otoshi://callback")
                        {
                            if let Err(e) = handle_clone.emit("oauth-callback", url_str) {
                                tracing::error!("Failed to emit oauth-callback event: {}", e);
                            }
                        }
                    }
                });
            }

            // DevTools accessible via right-click context menu in production builds
            // In dev mode, use `npm run dev` for auto-open DevTools

            // Start the bundled backend (if present) for the packaged desktop app.
            // If LAUNCHER_API_URL is set, we assume user manages backend themselves.
            let backend_child = backend_sidecar::spawn_backend(&handle)?;

            let state = Arc::new(build_state(&handle)?);
            spawn_locale_prefetch_worker(state.clone());
            app.manage(state);

            // Keep the backend process alive for the lifetime of the app.
            // The BackendProcess guard will kill it when the app exits (Drop).
            if let Some(child) = backend_child {
                app.manage(backend_sidecar::BackendProcess::new(child));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth::login,
            commands::auth::logout,
            commands::auth::set_auth_tokens,
            commands::auth::get_current_user,
            commands::oauth::exchange_oauth_code,
            commands::oauth::get_oauth_start_url,
            commands::game::get_library,
            commands::game::get_game_details,
            commands::game::get_cached_library,
            commands::game::update_playtime,
            commands::game::get_game_launch_pref,
            commands::game::set_game_launch_pref,
            commands::game::launch_game,
            commands::game::get_running_games,
            commands::game::stop_game,
            commands::download::start_download,
            commands::download::start_steam_download,
            commands::download::pause_download,
            commands::download::resume_download,
            commands::download::cancel_download,
            commands::download::get_download_progress,
            commands::download::get_cached_downloads,
            commands::download_v2::start_download_v2,
            commands::download_v2::control_download_v2,
            commands::download_v2::get_download_state_v2,
            commands::crack::check_game_installed,
            commands::crack::download_crack,
            commands::crack::get_crack_progress,
            commands::crack::cancel_crack_download,
            commands::crack::uninstall_crack,
            commands::crack::is_crack_installed,
            commands::crack::verify_game_integrity_after_uninstall,
            commands::system::build_local_manifest,
            commands::system::set_download_limit,
            commands::system::get_default_install_root,
            commands::system::artwork_get,
            commands::system::artwork_prefetch,
            commands::system::artwork_release,
            commands::system::perf_snapshot,
            commands::system::asm_probe_cpu_capabilities,
            commands::system::runtime_tuning_recommend,
            commands::system::runtime_tuning_apply,
            commands::system::runtime_tuning_rollback,
            commands::security::get_hardware_id,
            commands::security::validate_license,
            commands::security_v2::inspect_security_v2,
            commands::security_v2::enforce_security_v2,
            commands::social::unlock_achievement,
            commands::social::list_achievements,
            commands::social::upload_cloud_save,
            commands::social::fetch_cloud_save,
            commands::workshop::list_workshop_items,
            commands::workshop::list_workshop_versions,
            commands::workshop::list_workshop_subscriptions,
            commands::workshop::subscribe_workshop_item,
            commands::workshop::unsubscribe_workshop_item,
            commands::workshop::list_local_workshop_items,
            commands::workshop::sync_workshop_to_game,
            commands::discovery::get_discovery_queue,
            commands::discovery::refresh_discovery_queue,
            commands::discovery::get_similar_games,
            commands::inventory::list_inventory,
            commands::inventory::card_drop,
            commands::inventory::craft_badge,
            commands::inventory::list_trades,
            commands::inventory::create_trade,
            commands::inventory::accept_trade,
            commands::inventory::decline_trade,
            commands::inventory::cancel_trade,
            commands::remote::list_remote_downloads,
            commands::remote::queue_remote_download,
            commands::remote::update_remote_download_status,
            commands::overlay::toggle_overlay,
            commands::overlay::set_overlay_visible,
            commands::overlay::is_overlay_visible,
            commands::overlay::capture_overlay_screenshot,
            commands::streaming::create_streaming_session,
            commands::streaming::get_streaming_session,
            commands::streaming::set_streaming_offer,
            commands::streaming::set_streaming_answer,
            commands::streaming::add_streaming_ice_candidate,
            commands::policy::get_privacy_policy,
            commands::policy::get_terms_of_service,
            commands::distribute::get_distribute_stats,
            commands::distribute::get_sdk_downloads,
            commands::distribute::submit_game,
            commands::steam_extended::fetch_steam_extended,
            commands::properties::get_game_install_info,
            commands::properties::verify_game_files,
            commands::properties::uninstall_game,
            commands::properties::move_game_folder,
            commands::properties::sync_cloud_saves,
            commands::properties::properties_get,
            commands::properties::properties_set,
            commands::properties::save_sync_preview,
            commands::properties::save_sync_apply,
            commands::properties::open_folder,
            commands::self_heal::run_self_heal_scan_v2,
            commands::self_heal::apply_self_heal_v2,
            commands::debug::get_app_logs,
            commands::debug::get_backend_status,
            commands::debug::open_logs_folder,
            commands::debug::toggle_devtools,
            commands::debug::get_runtime_api_base,
            commands::lua::get_lua_files_path,
            commands::lua::verify_lua_files,
            commands::lua::get_lua_files_count,
            commands::lua::check_lua_file_exists,
            commands::lua::read_lua_file,
            commands::lua::list_lua_files,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            tracing::error!("error while running tauri application: {error}");
            eprintln!("error while running tauri application: {error}");
        });
}
