import { NavLink } from "react-router-dom";
import {
  ArrowUpRight,
  Boxes,
  Code,
  Download,
  Gamepad2,
  Heart,
  Package,
  ShieldCheck,
  ShieldOff,
  Settings,
  Sparkles,
  Store,
  Users,
  Library
} from "lucide-react";
import { useMemo } from "react";
import { useDownloads } from "../../hooks/useDownloads";
import { useLocale } from "../../context/LocaleContext";
import { useAuth } from "../../context/AuthContext";

export default function Sidebar() {
  const { activeTask, activeCount, pause, resume, cancel } = useDownloads();
  const { t } = useLocale();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const playNav = useMemo(
    () => [
      { to: "/library", labelKey: "nav.library", icon: Library },
      { to: "/downloads", labelKey: "nav.downloads", icon: Download },
      { to: "/big-picture", labelKey: "nav.big_picture", icon: Gamepad2 }
    ],
    []
  );

  const discoverNav = useMemo(
    () => [
      { to: "/store", labelKey: "nav.store", icon: Store },
      { to: "/discover", labelKey: "nav.discover", icon: Sparkles },
      { to: "/wishlist", labelKey: "nav.wishlist", icon: Heart },
      { to: "/community", labelKey: "nav.community", icon: Users },
      { to: "/workshop", labelKey: "nav.workshop", icon: Package }
    ],
    []
  );

  const createNav = useMemo(() => {
    const items = [
      { to: "/developer", labelKey: "nav.developer", icon: Code },
      { to: "/inventory", labelKey: "nav.inventory", icon: Boxes },
      { to: "/settings", labelKey: "nav.settings", icon: Settings }
    ];
    return isAdmin ? items : items.filter((item) => item.to !== "/developer");
  }, [isAdmin]);

  const fixesNav = useMemo(
    () => [
      { to: "/fixes/online", labelKey: "nav.online_fix", icon: ShieldCheck },
      { to: "/fixes/bypass", labelKey: "nav.bypass", icon: ShieldOff }
    ],
    []
  );

  const progress = activeTask ? Math.round(activeTask.progress) : 0;
  const activeDownloadText = activeTask
    ? activeTask.status === "paused"
      ? t("sidebar.paused")
      : `${t("sidebar.bandwidth")}: ${activeTask.speed}`
    : t("sidebar.no_downloads");

  return (
    <aside
      data-tour="sidebar"
      className="hidden w-64 border-r border-background-border bg-background px-5 py-6 lg:relative lg:sticky lg:top-0 lg:z-[60] lg:flex lg:h-screen lg:self-start lg:overflow-x-visible lg:overflow-y-visible"
    >
      <div className="flex h-full min-h-0 flex-col gap-6">
        <div className="flex items-center gap-3">
          <img
            src="/OTOSHI_icon.png"
            alt="Otoshi"
            className="h-10 w-10 rounded-md bg-background-elevated p-1 object-contain"
          />
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-text-muted">{t("sidebar.launcher")}</p>
            <h1 className="text-lg font-semibold">Otoshi</h1>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-text-muted">{t("sidebar.play")}</p>
            {playNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-tour={
                    item.to === "/library"
                      ? "sidebar-library"
                      : item.to === "/downloads"
                        ? "sidebar-downloads"
                        : item.to === "/big-picture"
                          ? "sidebar-big-picture"
                          : undefined
                  }
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-background-elevated text-text-primary"
                        : "text-text-secondary hover:bg-background-muted hover:text-text-primary"
                    }`
                  }
                >
                  <Icon size={16} />
                  <span className="flex items-center gap-2">
                    {t(item.labelKey)}
                    {item.to === "/downloads" && activeCount > 0 ? (
                      <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent-red px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                        {activeCount > 99 ? "99+" : activeCount}
                      </span>
                    ) : null}
                  </span>
                </NavLink>
              );
            })}
          </div>

          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-text-muted">{t("sidebar.discover")}</p>
            {discoverNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-tour={
                    item.to === "/store"
                      ? "sidebar-store"
                      : item.to === "/discover"
                        ? "sidebar-discover"
                        : item.to === "/wishlist"
                          ? "sidebar-wishlist"
                          : item.to === "/community"
                            ? "sidebar-community"
                            : item.to === "/workshop"
                              ? "sidebar-workshop"
                              : undefined
                  }
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-background-elevated text-text-primary"
                        : "text-text-secondary hover:bg-background-muted hover:text-text-primary"
                    }`
                  }
                >
                  <Icon size={16} />
                  {t(item.labelKey)}
                </NavLink>
              );
            })}
          </div>

          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-text-muted">{t("sidebar.fixes")}</p>
            {fixesNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-tour={
                    item.to === "/fixes/online"
                      ? "sidebar-online-fix"
                      : item.to === "/fixes/bypass"
                        ? "sidebar-bypass"
                        : undefined
                  }
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-background-elevated text-text-primary"
                        : "text-text-secondary hover:bg-background-muted hover:text-text-primary"
                    }`
                  }
                >
                  <Icon size={16} />
                  {t(item.labelKey)}
                </NavLink>
              );
            })}
          </div>

          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.3em] text-text-muted">{t("sidebar.create")}</p>
            {createNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-tour={
                    item.to === "/developer"
                      ? "sidebar-developer"
                      : item.to === "/inventory"
                        ? "sidebar-inventory"
                        : item.to === "/settings"
                          ? "sidebar-settings"
                          : undefined
                  }
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-background-elevated text-text-primary"
                        : "text-text-secondary hover:bg-background-muted hover:text-text-primary"
                    }`
                  }
                >
                  <Icon size={16} />
                  {t(item.labelKey)}
                </NavLink>
              );
            })}
          </div>
        </nav>

        <div className="mt-auto overflow-visible">
          <div className="group/fab relative overflow-visible">
            <NavLink
              to="/downloads"
              className={({ isActive }) =>
                `relative z-20 inline-flex h-14 w-14 items-center justify-center rounded-full border bg-background-elevated shadow-soft transition-all duration-200 hover:border-primary/70 hover:bg-background-surface focus-visible:border-primary/70 ${
                  isActive ? "border-primary/80" : "border-background-border"
                }`
              }
              aria-label={t("sidebar.download_manager")}
            >
              <Download size={18} />
              {activeCount > 0 ? (
                <span className="absolute right-[6px] top-[6px] inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent-red px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-[0_0_16px_rgba(248,113,113,0.45)]">
                  {activeCount > 99 ? "99+" : activeCount}
                </span>
              ) : null}
            </NavLink>

            <div className="pointer-events-none absolute bottom-0 left-16 z-[90] w-[260px] translate-x-2 scale-[0.98] opacity-0 transition-all duration-200 group-hover/fab:pointer-events-auto group-hover/fab:translate-x-0 group-hover/fab:scale-100 group-hover/fab:opacity-100 group-focus-within/fab:pointer-events-auto group-focus-within/fab:translate-x-0 group-focus-within/fab:scale-100 group-focus-within/fab:opacity-100">
              <div className="rounded-2xl border border-primary/60 bg-background-elevated/95 p-3 shadow-[0_16px_42px_rgba(14,165,233,0.2)] backdrop-blur">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-text-muted">
                  <span>{t("sidebar.active_download")}</span>
                  <ArrowUpRight size={12} />
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-text-primary">
                  {activeTask?.title || "Download Manager"}
                </p>
                <div className="mt-2 h-1.5 rounded-full bg-background-muted">
                  <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-1 truncate text-xs text-text-muted">
                  {activeCount > 0 ? `${progress}% - ${activeDownloadText}` : activeDownloadText}
                </p>
                {activeTask ? (
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-md border border-background-border bg-background-muted px-2 py-1 text-[10px] text-text-secondary transition hover:border-primary hover:text-text-primary"
                      onClick={(event) => {
                        event.preventDefault();
                        if (activeTask.status === "paused") {
                          void resume(activeTask.id);
                        } else if (activeTask.status === "downloading") {
                          void pause(activeTask.id);
                        }
                      }}
                    >
                      {activeTask.status === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-background-border bg-background-muted px-2 py-1 text-[10px] text-text-secondary transition hover:border-accent-red hover:text-accent-red"
                      onClick={(event) => {
                        event.preventDefault();
                        void cancel(activeTask.id);
                      }}
                    >
                      Stop
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
