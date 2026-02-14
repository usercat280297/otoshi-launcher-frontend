import { isTauri } from "@tauri-apps/api/core";

/**
 * Opens a URL in the default browser.
 * Uses Tauri shell plugin when running in desktop app,
 * falls back to window.open in browser/dev mode.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (err) {
    console.warn("Failed to open external URL:", err);
    // Fallback to window.open
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
