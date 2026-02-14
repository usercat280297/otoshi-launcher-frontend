import { isTauri as isTauriRuntimeFn } from "@tauri-apps/api/core";

const isTauri = isTauriRuntimeFn;

export async function buildOAuthStartUrl(provider: string, next: string = "/"): Promise<{url: string; requestId?: string}> {
  const baseUrl = isTauri()
    ? (import.meta.env.VITE_DESKTOP_API_URL || "http://127.0.0.1:8000")
    : (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000");

  if (isTauri()) {
    const redirect = `otoshi://oauth/callback?next=${encodeURIComponent(next)}`;
    const url = `${baseUrl}/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(redirect)}`;
    return { url };
  }

  const redirect = `${window.location.origin}/oauth/callback?next=${encodeURIComponent(next)}`;
  const url = `${baseUrl}/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(redirect)}`;
  return { url };
}

export async function pollOAuthStatus(requestId: string): Promise<{ code: string } | null> {
  const baseUrl = isTauri()
    ? (import.meta.env.VITE_DESKTOP_API_URL || "http://127.0.0.1:8000")
    : (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000");
  try {
    const resp = await fetch(`${baseUrl}/auth/oauth/poll/${requestId}`);
    if (resp.ok) {
        return await resp.json();
    }
  } catch (e) {
      // ignore
  }
  return null;
}
