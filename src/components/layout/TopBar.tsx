import { ChevronDown, Globe, Minus, Square, X, Code2, Upload, FileCode, BookOpen, Rocket, Package, CircleHelp, Sun, Moon } from "lucide-react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { openExternal } from "../../utils/openExternal";
import { useTheme } from "../../context/ThemeContext";

export default function TopBar() {
  const { user, token, logout } = useAuth();
  const { locale, setLocale, t, options } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === "admin";
  const [open, setOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [distributeOpen, setDistributeOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const distributeMenuRef = useRef<HTMLDivElement | null>(null);
  const [tauriRuntime, setTauriRuntime] = useState(false);
  const supportLink = "https://discord.gg/6q7YRdWGZJ";
  const closeSupport = () => setSupportOpen(false);
  const openSupport = () => setSupportOpen(true);

  const handleMinimize = async () => {
    if (!tauriRuntime) return;
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      console.warn("minimize failed", err);
    }
  };

  const handleToggleMaximize = async () => {
    if (!tauriRuntime) return;
    try {
      const win = getCurrentWindow();
      const isMax = await win.isMaximized();
      if (isMax) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    } catch (err) {
      console.warn("toggle maximize failed", err);
    }
  };

  const handleClose = async () => {
    if (!tauriRuntime) return;
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.warn("close failed", err);
    }
  };

  const handleStartDragging = async () => {
    if (!tauriRuntime) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.warn("startDragging failed", err);
    }
  };

  const handleTourHelp = () => {
    if (location.pathname !== "/store") {
      navigate("/store");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("otoshi:tour:store"));
      }, 400);
      return;
    }
    window.dispatchEvent(new CustomEvent("otoshi:tour:store"));
  };

  useEffect(() => {
    // Tauri v2 doesn't always inject `window.__TAURI__`.
    // The recommended detection is `isTauri()`.
    try {
      setTauriRuntime(isTauri());
    } catch {
      setTauriRuntime(false);
    }

    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;

      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
      if (distributeMenuRef.current && !distributeMenuRef.current.contains(event.target)) {
        setDistributeOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-background-border bg-background/95 px-6 py-3 backdrop-blur md:px-10">
      <div className="flex items-center gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <img
              src="/OTOSHI_icon.png"
              alt="Otoshi"
              className="h-9 w-9 rounded-md bg-background-elevated p-1 object-contain"
            />
            <NavLink
              to="/store"
              className="text-sm font-semibold uppercase tracking-[0.25em] text-text-primary"
            >
              {t("nav.store")}
            </NavLink>
          </div>
          <nav className="hidden items-center gap-5 text-sm text-text-secondary md:flex">
            <button
              type="button"
              onClick={openSupport}
              className="transition hover:text-text-primary"
            >
              {t("nav.support")}
            </button>
            <div ref={distributeMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setDistributeOpen((v) => !v)}
                aria-haspopup="menu"
                className={`flex items-center gap-1 transition hover:text-text-primary ${
                  distributeOpen ? "text-text-primary" : ""
                }`}
              >
                {t("nav.distribute")}
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-200 ${
                    distributeOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {distributeOpen && (
                <div className="absolute left-0 top-10 w-64 overflow-hidden rounded-xl border border-background-border bg-background-elevated shadow-xl">
                  <div className="border-b border-background-border bg-gradient-to-r from-primary/10 to-transparent px-4 py-3">
                    <p className="text-xs font-semibold text-text-primary">
                      {t("distribute.title")}
                    </p>
                    <p className="text-[10px] text-text-muted">
                      {t("distribute.subtitle")}
                    </p>
                  </div>
                  <div className="p-2">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setDistributeOpen(false);
                          navigate("/developer");
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-background-muted"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Rocket size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {t("distribute.developer_portal")}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            {t("distribute.developer_portal_desc")}
                          </p>
                        </div>
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setDistributeOpen(false);
                          navigate("/developer?tab=submit");
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-background-muted"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-green/10 text-accent-green">
                          <Upload size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">
                            {t("distribute.submit_game")}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            {t("distribute.submit_game_desc")}
                          </p>
                        </div>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDistributeOpen(false);
                        void openExternal("https://github.com/otoshi-launcher/sdk");
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-background-muted"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
                        <Package size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {t("distribute.sdk_tools")}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {t("distribute.sdk_tools_desc")}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDistributeOpen(false);
                        void openExternal("https://docs.otoshi-launcher.me");
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-background-muted"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-orange/10 text-accent-orange">
                        <BookOpen size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {t("distribute.documentation")}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {t("distribute.documentation_desc")}
                        </p>
                      </div>
                    </button>
                  </div>
                  <div className="border-t border-background-border bg-background-muted/50 px-4 py-2">
                    <p className="text-[10px] text-text-muted">
                      {t("distribute.revenue_share")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Dedicated draggable area for frameless window.
            In Tauri v2, window operations are permission-gated via capabilities.
            We also attach an explicit startDragging() handler for reliability.
        */}
        <div
          className="h-8 flex-1"
          data-tauri-drag-region
          onMouseDown={(e) => {
            // only left mouse button
            if (e.button !== 0) return;
            void handleStartDragging();
          }}
        />

        <div className="flex items-center gap-3">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-haspopup="listbox"
              className="flex items-center gap-2 rounded-md border border-background-border bg-background-surface px-3 py-2 text-xs text-text-secondary transition hover:border-primary"
            >
              <Globe size={16} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
                {locale}
              </span>
              <ChevronDown size={12} />
            </button>
            {open && (
              <div className="absolute right-0 top-12 w-44 rounded-xl border border-background-border bg-background-elevated p-2 shadow-soft">
                <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.3em] text-text-muted">
                  {t("action.language")}
                </p>
                <div className="space-y-1">
                  {options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setLocale(option.value);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-xs transition ${
                        option.value === locale
                          ? "bg-background-muted text-text-primary"
                          : "text-text-secondary hover:bg-background-muted hover:text-text-primary"
                      }`}
                    >
                      <span>{option.label}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted">
                        {option.shortLabel}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {token ? (
            <div className="flex items-center gap-3 rounded-md border border-background-border bg-background-surface px-3 py-2 text-xs">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-black">
                {user?.username?.slice(0, 2).toUpperCase() || "OT"}
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold">{user?.displayName || user?.username}</p>
                <button
                  onClick={logout}
                  className="text-[10px] uppercase tracking-[0.2em] text-text-muted hover:text-text-primary"
                >
                  {t("action.sign_out")}
                </button>
              </div>
            </div>
          ) : (
            <Link
              to="/login"
              className="rounded-md border border-background-border bg-background-surface px-4 py-2 text-xs font-semibold text-text-secondary transition hover:text-text-primary"
            >
              {t("action.sign_in")}
            </Link>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-background-border bg-background-surface text-text-secondary transition hover:border-primary hover:text-text-primary"
            aria-label={theme === "dark" ? t("topbar.theme.switch_light") : t("topbar.theme.switch_dark")}
            title={theme === "dark" ? t("topbar.theme.light") : t("topbar.theme.dark")}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={handleTourHelp}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-background-border bg-background-surface text-text-secondary transition hover:border-primary hover:text-text-primary"
            aria-label={t("topbar.guided_tour")}
            title={t("topbar.guided_tour")}
          >
            <CircleHelp size={16} />
          </button>
          {/* Only show Download Launcher button when NOT in Tauri app (i.e., in browser) */}
          {!tauriRuntime && (
            <Link to="/download-launcher" className="epic-button px-4 py-2 text-xs font-semibold">
              {t("action.download_launcher")}
            </Link>
          )}

          {/* Window controls (only relevant when using a frameless window: decorations=false) */}
          {tauriRuntime && (
            <div className="ml-2 flex items-center overflow-hidden rounded-md border border-background-border bg-background-surface">
              <button
                type="button"
                onClick={handleMinimize}
                className="px-3 py-2 text-text-secondary hover:bg-background-muted hover:text-text-primary"
                aria-label={t("topbar.window.minimize")}
                title={t("topbar.window.minimize")}
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                onClick={handleToggleMaximize}
                className="px-3 py-2 text-text-secondary hover:bg-background-muted hover:text-text-primary"
                aria-label={t("topbar.window.maximize")}
                title={t("topbar.window.maximize")}
              >
                <Square size={14} />
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-2 text-text-secondary hover:bg-accent-red/20 hover:text-accent-red"
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {supportOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex h-screen w-screen items-center justify-center bg-black/80 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={closeSupport}
          >
            <div
              className="w-full max-w-md scale-100 transform rounded-2xl border border-background-border bg-background-elevated p-6 shadow-2xl transition-all"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#5865F2]/10 ring-1 ring-[#5865F2]/20">
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 24 24"
                      fill="#5865F2"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1892.3776-.291a.0741.0741 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1258.1018.2517.1966.3776.2909a.0769.0769 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.699.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">{t("support.title")}</h3>
                    <p className="text-sm font-medium text-text-muted">{t("support.subtitle")}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeSupport}
                  className="rounded-lg bg-background-muted p-2 text-text-secondary transition hover:bg-background-surface hover:text-text-primary"
                  aria-label={t("support.close")}
                >
                  <X size={20} />
                </button>
              </div>

              <p className="mb-6 text-sm leading-relaxed text-text-secondary">
                {t("support.description")}
              </p>

              <button
                type="button"
                onClick={() => void openExternal(supportLink)}
                className="group flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#5865F2] py-3.5 text-sm font-bold text-white transition hover:bg-[#4752C4] hover:shadow-lg hover:shadow-[#5865F2]/25"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1892.3776-.291a.0741.0741 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1258.1018.2517.1966.3776.2909a.0769.0769 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.699.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1569 2.419zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.419-2.1568 2.419z"/>
                </svg>
                {t("support.join_discord")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </header>
  );
}
