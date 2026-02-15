import { useEffect, useMemo, useState } from "react";
import { Bell, Download, ExternalLink, Info, Shield, User } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import Input from "../components/common/Input";
import Button from "../components/common/Button";
import { openExternal } from "../utils/openExternal";

type SettingsSection = "account" | "downloads" | "notifications" | "privacy" | "about";

type SettingsState = {
  displayName: string;
  email: string;
  downloadLimitMbps: number;
  installPath: string;
  notifications: {
    storeUpdates: boolean;
    friendActivity: boolean;
    maintenance: boolean;
  };
  privacy: {
    shareActivity: boolean;
    telemetry: boolean;
    cloudSync: boolean;
  };
};

const SETTINGS_KEY = "otoshi.launcher.settings";

const defaultSettings: SettingsState = {
  displayName: "",
  email: "",
  downloadLimitMbps: 0,
  installPath: "",
  notifications: {
    storeUpdates: true,
    friendActivity: true,
    maintenance: false
  },
  privacy: {
    shareActivity: true,
    telemetry: false,
    cloudSync: true
  }
};

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI__" in window;

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useLocale();
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");
  const [status, setStatus] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsState>(() => {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored) as SettingsState;
      } catch {
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  useEffect(() => {
    setSettings((prev) => ({
      ...prev,
      displayName: user?.displayName || user?.username || prev.displayName,
      email: user?.email || prev.email
    }));
  }, [user]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const handleTelemetry = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled !== "boolean") return;
      setSettings((prev) => ({
        ...prev,
        privacy: {
          ...prev.privacy,
          telemetry: detail.enabled
        }
      }));
    };

    window.addEventListener("otoshi:telemetry-setting", handleTelemetry as EventListener);
    return () => {
      window.removeEventListener("otoshi:telemetry-setting", handleTelemetry as EventListener);
    };
  }, []);

  useEffect(() => {
    const shouldResolve =
      isTauriRuntime() &&
      (!settings.installPath || settings.installPath === "D:\\Games\\Otoshi");
    if (!shouldResolve) return;

    invoke<string>("get_default_install_root")
      .then((path) => {
        if (!path) return;
        setSettings((prev) => ({ ...prev, installPath: path }));
      })
      .catch(() => {
        // ignore - keep existing path
      });
  }, [settings.installPath]);

  const sections = useMemo(
    () => [
      { id: "account" as const, label: "Account", icon: User },
      { id: "downloads" as const, label: t("settings.downloads"), icon: Download },
      { id: "notifications" as const, label: t("settings.notifications"), icon: Bell },
      { id: "privacy" as const, label: t("settings.privacy"), icon: Shield },
      { id: "about" as const, label: t("settings.about"), icon: Info }
    ],
    [t]
  );

  const applyDownloadLimit = async () => {
    if (!isTauriRuntime()) {
      setStatus("Saved locally. Launch via desktop app to apply limits.");
      return;
    }
    try {
      await invoke("set_download_limit", {
        maxMbps: settings.downloadLimitMbps
      });
      setStatus("Download limits updated.");
    } catch (err) {
      setStatus("Unable to update download limits.");
    }
  };

  const selectInstallDirectory = async () => {
    setStatus("Directory picker is not configured. Enter a path manually.");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-semibold">{t("nav.settings")}</h2>
        <p className="text-text-secondary">
          Manage account, download, privacy, and launcher details.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="glass-panel w-full p-3 lg:w-64 lg:p-4">
          <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex shrink-0 items-center gap-3 rounded-lg px-4 py-3 text-sm transition lg:w-full ${
                    activeSection === section.id
                      ? "bg-primary text-black"
                      : "text-text-secondary hover:bg-background-muted hover:text-text-primary"
                  }`}
                >
                  <Icon size={18} />
                  <span className="whitespace-nowrap">{section.label}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex-1 space-y-6">
          {activeSection === "account" && (
            <div className="glass-panel space-y-6 p-6">
              <div>
                <h3 className="section-title">Account</h3>
                <p className="text-sm text-text-secondary">
                  Profile identity and security controls.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Display name"
                  value={settings.displayName}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, displayName: event.target.value }))
                  }
                />
                <Input
                  label="Email"
                  value={settings.email}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, email: event.target.value }))
                  }
                />
              </div>
              <label className="glass-card flex items-center justify-between p-4 text-sm text-text-secondary">
                Two-factor authentication
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-5 w-5 accent-primary"
                />
              </label>
            </div>
          )}

          {activeSection === "downloads" && (
            <div className="glass-panel space-y-6 p-6">
              <div>
                <h3 className="section-title">Downloads</h3>
                <p className="text-sm text-text-secondary">
                  Control bandwidth, cache, and install locations.
                </p>
              </div>
              <Input
                label="Download speed limit (Mbps)"
                type="number"
                value={settings.downloadLimitMbps}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    downloadLimitMbps: Number(event.target.value)
                  }))
                }
                helper="Set to 0 for unlimited."
              />
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <Input
                  label="Install location"
                  value={settings.installPath}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, installPath: event.target.value }))
                  }
                />
                <Button variant="secondary" onClick={selectInstallDirectory}>
                  Browse
                </Button>
              </div>
              <div className="glass-card p-4 text-sm text-text-secondary">
                Delta patching is enabled to reduce download sizes by up to 75%.
              </div>
              <Button onClick={applyDownloadLimit}>Save changes</Button>
              {status && <p className="text-xs text-text-secondary">{status}</p>}
            </div>
          )}

          {activeSection === "notifications" && (
            <div className="glass-panel space-y-4 p-6">
              <div>
                <h3 className="section-title">Notifications</h3>
                <p className="text-sm text-text-secondary">
                  Choose which alerts show in the launcher.
                </p>
              </div>
              {[
                { key: "storeUpdates", label: "Store updates and launches" },
                { key: "friendActivity", label: "Friend activity" },
                { key: "maintenance", label: "Maintenance windows" }
              ].map((item) => (
                <label
                  key={item.key}
                  className="glass-card flex items-center justify-between p-4 text-sm text-text-secondary"
                >
                  {item.label}
                  <input
                    type="checkbox"
                    checked={settings.notifications[item.key as keyof SettingsState["notifications"]]}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        notifications: {
                          ...prev.notifications,
                          [item.key]: event.target.checked
                        }
                      }))
                    }
                    className="h-5 w-5 accent-primary"
                  />
                </label>
              ))}
            </div>
          )}

          {activeSection === "privacy" && (
            <div className="glass-panel space-y-4 p-6">
              <div>
                <h3 className="section-title">Privacy</h3>
                <p className="text-sm text-text-secondary">
                  Control sharing and telemetry preferences.
                </p>
              </div>
              {[
                { key: "shareActivity", label: "Share game activity" },
                { key: "telemetry", label: "Enable telemetry" },
                { key: "cloudSync", label: "Sync cloud saves" }
              ].map((item) => (
                <label
                  key={item.key}
                  className="glass-card flex items-center justify-between p-4 text-sm text-text-secondary"
                >
                  {item.label}
                  <input
                    type="checkbox"
                    checked={settings.privacy[item.key as keyof SettingsState["privacy"]]}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        privacy: {
                          ...prev.privacy,
                          [item.key]: event.target.checked
                        }
                      }))
                    }
                    className="h-5 w-5 accent-primary"
                  />
                </label>
              ))}
            </div>
          )}

          {activeSection === "about" && (
            <div className="glass-panel space-y-6 p-6">
              <div>
                <h3 className="section-title">{t("settings.about")}</h3>
                <p className="text-sm text-text-secondary">
                  Build information and official resources.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="glass-card p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-text-muted">Version</p>
                  <p className="mt-1 text-base font-semibold text-text-primary">
                    {import.meta.env.VITE_APP_VERSION || "desktop build"}
                  </p>
                </div>
                <div className="glass-card p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-text-muted">Runtime</p>
                  <p className="mt-1 text-base font-semibold text-text-primary">
                    {isTauriRuntime() ? "Desktop (Tauri)" : "Web"}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  icon={<ExternalLink size={16} />}
                  onClick={() => void openExternal("https://www.otoshi-launcher.me")}
                >
                  Official Website
                </Button>
                <Button
                  variant="secondary"
                  icon={<ExternalLink size={16} />}
                  onClick={() => void openExternal("https://www.otoshi-launcher.me/privacy-policy")}
                >
                  Privacy Policy
                </Button>
                <Button
                  variant="secondary"
                  icon={<ExternalLink size={16} />}
                  onClick={() => void openExternal("https://www.otoshi-launcher.me/terms-of-service")}
                >
                  Terms of Service
                </Button>
                <Button
                  variant="secondary"
                  icon={<ExternalLink size={16} />}
                  onClick={() => void openExternal("https://discord.gg/6q7YRdWGZJ")}
                >
                  Discord Support
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
