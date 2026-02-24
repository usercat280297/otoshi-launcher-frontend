import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { LocaleProvider } from "./context/LocaleContext";
import { ThemeProvider } from "./context/ThemeContext";
import "./index.css";

const CHUNK_ERROR_RELOAD_KEY = "otoshi:chunk-reload-once";
const CANONICAL_REDIRECT_KEY = "otoshi:canonical-redirected";
const CHUNK_ERROR_RELOAD_RETRY_PARAM = "__chunk_retry";
const CHUNK_ERROR_RELOAD_MAX_RETRIES = 1;
const CHUNK_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "ChunkLoadError",
  "Loading chunk",
  "Unable to preload CSS",
] as const;
let chunkReloadTriggered = false;

const hasChunkLikeError = (value: unknown): boolean => {
  const text = String(value || "");
  return CHUNK_ERROR_PATTERNS.some((token) => text.includes(token));
};

const getChunkRetryCount = (): number => {
  if (typeof window === "undefined") return 0;
  const raw = new URL(window.location.href).searchParams.get(CHUNK_ERROR_RELOAD_RETRY_PARAM);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
};

const cleanupChunkRetryParams = (): void => {
  if (typeof window === "undefined") return;
  const current = new URL(window.location.href);
  const hasReloadParam = current.searchParams.has("__reload");
  const hasRetryParam = current.searchParams.has(CHUNK_ERROR_RELOAD_RETRY_PARAM);
  if (!hasReloadParam && !hasRetryParam) return;

  current.searchParams.delete("__reload");
  current.searchParams.delete(CHUNK_ERROR_RELOAD_RETRY_PARAM);
  window.history.replaceState(null, document.title, current.toString());
};

const reloadWithCacheBustOnce = (): void => {
  if (typeof window === "undefined") return;
  if (chunkReloadTriggered) return;
  if (getChunkRetryCount() >= CHUNK_ERROR_RELOAD_MAX_RETRIES) return;

  try {
    const attempted = window.sessionStorage.getItem(CHUNK_ERROR_RELOAD_KEY) === "1";
    if (attempted) return;
    window.sessionStorage.setItem(CHUNK_ERROR_RELOAD_KEY, "1");
  } catch {
    // ignore sessionStorage failures
  }

  chunkReloadTriggered = true;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__reload", String(Date.now()));
  nextUrl.searchParams.set(
    CHUNK_ERROR_RELOAD_RETRY_PARAM,
    String(getChunkRetryCount() + 1)
  );
  window.location.replace(nextUrl.toString());
};

if (typeof window !== "undefined") {
  const host = String(window.location.hostname || "").trim().toLowerCase();
  cleanupChunkRetryParams();

  if (host === "www.otoshi-launcher.me") {
    let canRedirect = true;
    try {
      canRedirect = window.sessionStorage.getItem(CANONICAL_REDIRECT_KEY) !== "1";
      if (canRedirect) {
        window.sessionStorage.setItem(CANONICAL_REDIRECT_KEY, "1");
      }
    } catch {
      canRedirect = true;
    }
    if (canRedirect) {
      const canonical = new URL(window.location.href);
      canonical.hostname = "otoshi-launcher.me";
      window.location.replace(canonical.toString());
    }
  }

  // Auto-reload on preload/chunk failures (common after a fresh deploy while tab is stale).
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadWithCacheBustOnce();
  });
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target as HTMLScriptElement | null;
      if (target && target.tagName === "SCRIPT") {
        reloadWithCacheBustOnce();
        return;
      }
      if (hasChunkLikeError(event.message)) {
        reloadWithCacheBustOnce();
      }
    },
    true
  );
  window.addEventListener("unhandledrejection", (event) => {
    if (hasChunkLikeError(event.reason)) {
      reloadWithCacheBustOnce();
    }
  });

  let wasOffline = !navigator.onLine;
  window.addEventListener("offline", () => {
    wasOffline = true;
  });
  window.addEventListener("online", () => {
    // Avoid hard reload loops on flaky networks. Let in-app queries recover naturally.
    if (wasOffline) wasOffline = false;
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <ThemeProvider>
        <AuthProvider>
          <LocaleProvider>
            <App />
          </LocaleProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
