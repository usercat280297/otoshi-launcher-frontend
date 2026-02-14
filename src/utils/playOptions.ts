export type RendererOption = "dx12" | "dx11" | "vulkan" | "auto";

export type PlayOptions = {
  renderer: RendererOption;
  overlayEnabled: boolean;
};

type StoredPlayOptions = {
  [gameId: string]: PlayOptions;
};

const STORAGE_KEY = "otoshi.launcher.playOptions";

export function loadPlayOptions(gameId: string): PlayOptions | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const data = JSON.parse(raw) as StoredPlayOptions;
    return data[gameId] ?? null;
  } catch {
    return null;
  }
}

export function savePlayOptions(gameId: string, options: PlayOptions) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as StoredPlayOptions) : {};
    data[gameId] = options;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage failures.
  }
}

export function getDefaultPlayOptions(): PlayOptions {
  return {
    renderer: "dx12",
    overlayEnabled: true
  };
}

export function derivePlayOptions(
  stored: PlayOptions | null,
  config?: { recommendedApi?: string | null; overlayEnabled?: boolean } | null
): PlayOptions {
  if (stored) {
    return stored;
  }
  const defaultOptions = getDefaultPlayOptions();
  const recommended = (config?.recommendedApi || "").toLowerCase();
  const renderer =
    recommended === "dx12" || recommended === "dx11" || recommended === "vulkan"
      ? (recommended as RendererOption)
      : defaultOptions.renderer;
  const overlayEnabled =
    typeof config?.overlayEnabled === "boolean" ? config.overlayEnabled : defaultOptions.overlayEnabled;
  return {
    renderer,
    overlayEnabled
  };
}
