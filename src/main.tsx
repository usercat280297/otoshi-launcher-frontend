import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { LocaleProvider } from "./context/LocaleContext";
import { ThemeProvider } from "./context/ThemeContext";
import "./index.css";

const CHUNK_ERROR_RELOAD_KEY = "otoshi:chunk-reload-once";
const CHUNK_ERROR_PATTERNS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "ChunkLoadError",
  "Loading chunk",
  "Unable to preload CSS",
] as const;

const hasChunkLikeError = (value: unknown): boolean => {
  const text = String(value || "");
  return CHUNK_ERROR_PATTERNS.some((token) => text.includes(token));
};

const reloadWithCacheBustOnce = (): void => {
  if (typeof window === "undefined") return;
  try {
    const attempted = window.sessionStorage.getItem(CHUNK_ERROR_RELOAD_KEY) === "1";
    if (attempted) return;
    window.sessionStorage.setItem(CHUNK_ERROR_RELOAD_KEY, "1");
  } catch {
    // ignore sessionStorage failures
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__reload", String(Date.now()));
  window.location.replace(nextUrl.toString());
};

if (typeof window !== "undefined") {
  const host = String(window.location.hostname || "").trim().toLowerCase();
  if (host === "www.otoshi-launcher.me") {
    const canonical = new URL(window.location.href);
    canonical.hostname = "otoshi-launcher.me";
    window.location.replace(canonical.toString());
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
    if (wasOffline) {
      wasOffline = false;
      window.location.reload();
    }
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
