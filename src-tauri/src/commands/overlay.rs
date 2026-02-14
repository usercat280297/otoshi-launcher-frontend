use std::sync::Arc;

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
};

use crate::AppState;

const OVERLAY_LABEL: &str = "overlay";

fn apply_overlay_icon(window: &tauri::WebviewWindow) {
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../../icons/icon.png")) {
        let _ = window.set_icon(icon);
    }
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
