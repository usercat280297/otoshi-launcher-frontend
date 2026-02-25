import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import MainLayout from "./components/layout/MainLayout";
import AuthLayout from "./components/layout/AuthLayout";
import RequireAuth from "./components/common/RequireAuth";
import RequireAdmin from "./components/common/RequireAdmin";
import { initMediaProtection } from "./utils/mediaProtection";
import { useOAuthDeepLink } from "./hooks/useOAuthDeepLink";
import GlobalRipple from "./components/common/GlobalRipple";
import CookieConsentBanner from "./components/common/CookieConsentBanner";
import { syncTelemetryWithConsent } from "./utils/telemetryConsent";
import { useLocale } from "./context/LocaleContext";
import { openExternal } from "./utils/openExternal";
import Modal from "./components/common/Modal";
import Button from "./components/common/Button";
import OverlayNotifications from "./components/common/OverlayNotifications";
import { emitOverlayNotification } from "./utils/notify";

type TrayActionPayload = {
  action?: string;
  locale?: string;
};

const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const GameDetailPage = lazy(() => import("./pages/GameDetailPage"));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage"));
const DownloadLauncherPage = lazy(() => import("./pages/DownloadLauncherPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const WorkshopPage = lazy(() => import("./pages/WorkshopPage"));
const CommunityPage = lazy(() => import("./pages/CommunityPage"));
const WishlistPage = lazy(() => import("./pages/WishlistPage"));
const InventoryPage = lazy(() => import("./pages/InventoryPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const DeveloperPage = lazy(() => import("./pages/DeveloperPage"));
const StorePage = lazy(() => import("./pages/StorePage"));
const SteamCatalogPage = lazy(() => import("./pages/SteamCatalogPage"));
const SteamGameDetailPage = lazy(() => import("./pages/SteamGameDetailPage"));
const DiscoverPausedPage = lazy(() => import("./pages/DiscoverPausedPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const BigPicturePage = lazy(() => import("./pages/BigPicturePage"));
const OAuthCallbackPage = lazy(() => import("./pages/OAuthCallbackPage"));
const OnlineFixPage = lazy(() => import("./pages/OnlineFixPage"));
const BypassPage = lazy(() => import("./pages/BypassPage"));
const FixDetailPage = lazy(() => import("./pages/FixDetailPage"));
const OverlayPage = lazy(() => import("./pages/OverlayPage"));
const StoreNewsWindowPage = lazy(() => import("./pages/StoreNewsWindowPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage"));
const IntroPage = lazy(() => import("./pages/IntroPage"));

function AppContent() {
  const navigate = useNavigate();
  const { setLocale, t } = useLocale();
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("scrollRestoration" in window.history)) {
      return;
    }
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Initialize media protection to prevent IDM and download managers
  useEffect(() => {
    initMediaProtection();
  }, []);

  // Listen for OAuth deep-link callbacks (Tauri only)
  useOAuthDeepLink();

  // Sync telemetry preference with cookie consent
  useEffect(() => {
    const handleConsent = () => syncTelemetryWithConsent();
    handleConsent();
    window.addEventListener("otoshi:cookie-consent", handleConsent as EventListener);
    return () => {
      window.removeEventListener("otoshi:cookie-consent", handleConsent as EventListener);
    };
  }, []);

  useEffect(() => {
    const allowDevtoolsHotkey =
      import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEVTOOLS_HOTKEY === "1";
    if (!allowDevtoolsHotkey) {
      return;
    }

    const openDevtoolsShortcut = async (event: KeyboardEvent) => {
      const isDevtoolsHotkey =
        event.key === "F12" ||
        ((event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === "i");

      if (!isDevtoolsHotkey || !isTauriRuntime()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("toggle_devtools");
      } catch (err) {
        console.warn("[Debug] Unable to toggle devtools:", err);
      }
    };

    window.addEventListener("keydown", openDevtoolsShortcut, true);
    return () => window.removeEventListener("keydown", openDevtoolsShortcut, true);
  }, []);

  useEffect(() => {
    const onStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string; iconUrl?: string }>).detail;
      const title = detail?.title?.trim() || t("common.game");
      emitOverlayNotification({
        tone: "success",
        title: t("download.toast.started_title"),
        message: title,
        imageUrl: detail?.iconUrl?.trim() || null,
        source: "download",
        durationMs: 3600,
      });
    };

    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; messageKey?: string; iconUrl?: string }>).detail;
      const localizedByKey = detail?.messageKey ? t(detail.messageKey) : null;
      const message = localizedByKey || detail?.message?.trim() || t("download.toast.failed_default");
      emitOverlayNotification({
        tone: "error",
        title: t("download.toast.failed_title"),
        message,
        imageUrl: detail?.iconUrl || null,
        source: "download",
        durationMs: 5200,
      });
    };

    window.addEventListener("otoshi:download-started", onStarted as EventListener);
    window.addEventListener("otoshi:download-error", onError as EventListener);

    return () => {
      window.removeEventListener("otoshi:download-started", onStarted as EventListener);
      window.removeEventListener("otoshi:download-error", onError as EventListener);
    };
  }, [t]);

  useEffect(() => {
    const onLuaMissing = () => {
      emitOverlayNotification({
        tone: "warning",
        title: "Catalog warning",
        message: t("lua.error.body"),
        source: "catalog",
        durationMs: 4800,
      });
    };

    const onLuaLoaded = () => {
      emitOverlayNotification({
        tone: "success",
        title: "Catalog synced",
        message: "Lua catalog is online again.",
        source: "catalog",
      });
    };

    window.addEventListener("otoshi:lua-games-missing", onLuaMissing as EventListener);
    window.addEventListener("otoshi:lua-games-loaded", onLuaLoaded as EventListener);
    return () => {
      window.removeEventListener("otoshi:lua-games-missing", onLuaMissing as EventListener);
      window.removeEventListener("otoshi:lua-games-loaded", onLuaLoaded as EventListener);
    };
  }, [t]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen<{
          download_id?: string;
          game_id?: string;
          slug?: string;
          message?: string;
        }>("download-runtime-error", (event) => {
          const detail = event.payload || {};
          const message =
            detail.message?.trim() ||
            `${t("download.toast.failed_default")}${detail.slug ? ` (${detail.slug})` : ""}`;
          window.dispatchEvent(
            new CustomEvent("otoshi:download-error", {
              detail: {
                message,
                downloadId: detail.download_id,
                gameId: detail.game_id,
                slug: detail.slug,
              },
            })
          );
        });

        if (disposed) {
          off();
          return;
        }
        unlisten = off;
      } catch (err) {
        console.warn("[DownloadRuntime] Unable to subscribe runtime error event:", err);
      }
    };

    setup();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [t]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const handleTrayAction = async (payload: TrayActionPayload) => {
      const action = (payload.action || "").trim();
      switch (action) {
        case "open_official_website":
          emitOverlayNotification({
            tone: "info",
            title: "Tray action",
            message: "Opening official website",
            source: "tray",
          });
          await openExternal("https://otoshi-launcher.me");
          break;
        case "check_updates":
          emitOverlayNotification({
            tone: "info",
            title: "Tray action",
            message: "Opening update center",
            source: "tray",
          });
          navigate("/download-launcher");
          break;
        case "set_language":
          if (payload.locale === "en" || payload.locale === "vi") {
            setLocale(payload.locale);
            emitOverlayNotification({
              tone: "success",
              title: "Language updated",
              message: payload.locale === "vi" ? "Tieng Viet" : "English",
              source: "tray",
            });
          }
          break;
        case "feedback":
          emitOverlayNotification({
            tone: "info",
            title: "Tray action",
            message: "Opening feedback channel",
            source: "tray",
          });
          await openExternal("https://discord.gg/6q7YRdWGZJ");
          break;
        case "about":
          setAboutOpen(true);
          emitOverlayNotification({
            tone: "info",
            title: "Tray action",
            message: "About dialog opened",
            source: "tray",
          });
          break;
        default:
          break;
      }
    };

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const off = await listen<TrayActionPayload>("tray-action", (event) => {
          void handleTrayAction(event.payload || {});
        });
        if (disposed) {
          off();
          return;
        }
        unlisten = off;
      } catch (err) {
        console.warn("[Tray] Unable to subscribe tray-action event:", err);
      }
    };

    setup();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [navigate, setLocale]);

  return (
    <>
      <GlobalRipple />
      <CookieConsentBanner />
      <OverlayNotifications />
      <Modal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} title={t("app.about.title")} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t("app.about.description")}
          </p>
          <div className="rounded-lg border border-background-border bg-background-muted px-3 py-2 text-xs text-text-muted">
            {t("app.about.version_label")}: {import.meta.env.VITE_APP_VERSION || t("app.about.desktop_build")}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setAboutOpen(false)}>
              {t("app.about.close")}
            </Button>
            <Button
              onClick={() => {
                void openExternal("https://otoshi-launcher.me");
              }}
            >
              {t("app.about.open_website")}
            </Button>
          </div>
        </div>
      </Modal>
      <Suspense
        fallback={
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background text-sm text-text-secondary">
            {t("common.loading")}
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<IntroPage />} />
          <Route path="/overlay" element={<OverlayPage />} />
          <Route path="/steam-news" element={<StoreNewsWindowPage />} />
          <Route
            path="/big-picture"
            element={
              <RequireAuth>
                <BigPicturePage />
              </RequireAuth>
            }
          />
          <Route path="/download-launcher" element={<DownloadLauncherPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/terms-of-service" element={<TermsOfServicePage />} />
          <Route element={<MainLayout />}>
            <Route path="/store" element={<Navigate to="/steam" replace />} />
            <Route path="/steam" element={<StorePage />} />
            <Route path="/steam-vault" element={<SteamCatalogPage />} />
            <Route path="/steam/:appId" element={<SteamGameDetailPage />} />
            <Route path="/discover" element={<DiscoverPausedPage />} />
            <Route path="/fixes/online" element={<OnlineFixPage />} />
            <Route path="/fixes/online/:appId" element={<FixDetailPage kind="online-fix" />} />
            <Route path="/fixes/bypass" element={<BypassPage />} />
            <Route path="/fixes/bypass/:appId" element={<FixDetailPage kind="bypass" />} />
            <Route path="/workshop" element={<WorkshopPage />} />
            <Route path="/community" element={<CommunityPage />} />
            <Route path="/games/:slug" element={<GameDetailPage />} />
            <Route
              path="/wishlist"
              element={
                <RequireAuth>
                  <WishlistPage />
                </RequireAuth>
              }
            />
            <Route
              path="/inventory"
              element={
                <RequireAuth>
                  <InventoryPage />
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <ProfilePage />
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <LibraryPage />
                </RequireAuth>
              }
            />
            <Route
              path="/downloads"
              element={
                <RequireAuth>
                  <DownloadsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <SettingsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/developer"
              element={
                <RequireAdmin>
                  <DeveloperPage />
                </RequireAdmin>
              }
            />
          </Route>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  return <AppContent />;
}
