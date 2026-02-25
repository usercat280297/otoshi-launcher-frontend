use std::sync::Arc;

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
};

use crate::AppState;

const OVERLAY_LABEL: &str = "overlay";
const STORE_NEWS_LABEL: &str = "steam-news";
const STORE_NEWS_WIDTH: u32 = 920;
const STORE_NEWS_HEIGHT: u32 = 640;

fn apply_overlay_icon(window: &tauri::WebviewWindow) {
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/icon.png")) {
        let _ = window.set_icon(icon);
    }
}

fn center_window_on_primary_monitor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    width: u32,
    height: u32,
) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let monitor_size = monitor.size();
        let monitor_pos = monitor.position();
        let x = monitor_pos.x + ((monitor_size.width as i32 - width as i32) / 2);
        let y = monitor_pos.y + ((monitor_size.height as i32 - height as i32) / 2);
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn build_store_news_route(payload: Option<&str>) -> String {
    match payload.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => format!("/steam-news?payload={value}"),
        None => "/steam-news".to_string(),
    }
}

fn escape_js_single_quote(input: &str) -> String {
    input.replace('\\', "\\\\").replace('\'', "\\'")
}

fn ensure_overlay_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        apply_overlay_icon(&window);
        return Ok(window);
    }

    let url = WebviewUrl::App("/overlay".into());
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, url)
        .title("Otoshi Overlay")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .build()
        .map_err(|err| format!("Failed to create overlay window: {err}"))?;
    apply_overlay_icon(&window);

    if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let position = monitor.position();
        let _ = window.set_size(PhysicalSize::new(size.width, size.height));
        let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
    }

    #[cfg(target_os = "windows")]
    {
        let _ = window.set_ignore_cursor_events(true);
    }

    Ok(window)
}

pub fn set_overlay_window_visible(app: &AppHandle, visible: bool) -> Result<(), String> {
    if visible {
        let window = ensure_overlay_window(app)?;
        let _ = window.show();
        let _ = window.set_focus();
    } else if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_overlay(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    let next = state.overlay.toggle();
    let _ = set_overlay_window_visible(&app, next);
    Ok(next)
}

#[tauri::command]
pub async fn set_overlay_visible(
    visible: bool,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<bool, String> {
    state.overlay.set_visible(visible);
    let _ = set_overlay_window_visible(&app, visible);
    Ok(state.overlay.is_visible())
}

#[tauri::command]
pub async fn is_overlay_visible(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    Ok(state.overlay.is_visible())
}

#[tauri::command]
pub async fn capture_overlay_screenshot(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    state.overlay.capture_screenshot()
}

#[tauri::command]
pub async fn open_store_news_window(
    app: AppHandle,
    payload: Option<String>,
) -> Result<(), String> {
    let route = build_store_news_route(payload.as_deref());

    if let Some(window) = app.get_webview_window(STORE_NEWS_LABEL) {
        let script_target = escape_js_single_quote(&route);
        let script = format!("window.location.replace('{script_target}');");
        let _ = window.eval(script);
        let _ = window.set_size(PhysicalSize::new(STORE_NEWS_WIDTH, STORE_NEWS_HEIGHT));
        center_window_on_primary_monitor(&app, &window, STORE_NEWS_WIDTH, STORE_NEWS_HEIGHT);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let url = WebviewUrl::App(route.into());
    let window = WebviewWindowBuilder::new(&app, STORE_NEWS_LABEL, url)
        .title("Steam News")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|err| format!("Failed to create store news window: {err}"))?;

    apply_overlay_icon(&window);
    let _ = window.set_size(PhysicalSize::new(STORE_NEWS_WIDTH, STORE_NEWS_HEIGHT));
    center_window_on_primary_monitor(&app, &window, STORE_NEWS_WIDTH, STORE_NEWS_HEIGHT);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}
