import { useEffect, useMemo, useState } from "react";
import { Bell, Download, ExternalLink, Info, Shield, User } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import Input from "../components/common/Input";
import Button from "../components/common/Button";
import { openExternal } from "../utils/openExternal";
import {
  applyRuntimeTuning,
  deletePrivacyData,
  exportPrivacyData,
  fetchPrivacyConsent,
  probeAsmCpuCapabilities,
  recommendRuntimeTuning,
  rollbackRuntimeTuning,
  setPrivacyConsent,
} from "../services/api";
import type { AsmCpuCapabilities, RuntimeTuningProfile } from "../types";

type SettingsSection = "account" | "downloads" | "notifications" | "privacy" | "performance" | "about";
type AiConsentCategory = "search" | "recommendation" | "support" | "anti_cheat";

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
  performance: {
    autoTuningEnabled: boolean;
    autoTuningProfile: RuntimeTuningProfile;
    autoTuningLastAppliedAt: string | null;
    autoTuningFallbackUsed: boolean;
  };
};

const SETTINGS_KEY = "otoshi.launcher.settings";
const AI_CONSENT_ITEMS: Array<{
  key: AiConsentCategory;
  label: string;
  description: string;
}> = [
  {
    key: "search",
    label: "AI search analytics",
    description: "Allow search interaction signals to improve relevance.",
  },
  {
    key: "recommendation",
    label: "AI recommendations",
    description: "Allow recommendation impressions and feedback tracking.",
  },
  {
    key: "support",
    label: "Support copilot",
    description: "Allow AI support suggestions and support session memory.",
  },
  {
    key: "anti_cheat",
    label: "Anti-cheat risk detection",
    description: "Allow anti-cheat signal processing for fraud detection.",
  },
];

const DEFAULT_AI_CONSENT: Record<AiConsentCategory, boolean> = {
  search: false,
  recommendation: false,
  support: false,
  anti_cheat: false,
};

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
  },
  performance: {
    autoTuningEnabled: false,
    autoTuningProfile: "balanced",
    autoTuningLastAppliedAt: null,
    autoTuningFallbackUsed: false
  }
};

const mergeSettings = (raw: Partial<SettingsState> | null | undefined): SettingsState => ({
  ...defaultSettings,
  ...(raw || {}),
  notifications: {
    ...defaultSettings.notifications,
    ...((raw as any)?.notifications || {}),
  },
  privacy: {
    ...defaultSettings.privacy,
    ...((raw as any)?.privacy || {}),
  },
  performance: {
    ...defaultSettings.performance,
    ...((raw as any)?.performance || {}),
  },
});

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI__" in window;

export default function SettingsPage() {
  const { user, token } = useAuth();
  const { t } = useLocale();
  const [activeSection, setActiveSection] = useState<SettingsSection>("account");
  const [status, setStatus] = useState<string | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [aiConsent, setAiConsent] = useState<Record<AiConsentCategory, boolean>>(
    DEFAULT_AI_CONSENT
  );
  const [tuningBusy, setTuningBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<AsmCpuCapabilities | null>(null);
  const [settings, setSettings] = useState<SettingsState>(() => {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      try {
        return mergeSettings(JSON.parse(stored) as SettingsState);
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
    let cancelled = false;
    if (!token) {
      setAiConsent({ ...DEFAULT_AI_CONSENT });
      setPrivacyBusy(false);
      return () => {
        cancelled = true;
      };
    }

    setPrivacyBusy(true);
    void fetchPrivacyConsent(token)
      .then((rows) => {
        if (cancelled) return;
        const nextConsent = { ...DEFAULT_AI_CONSENT };
        let telemetryConsent: boolean | null = null;
        for (const row of rows) {
          const category = String(row.category || "").trim().toLowerCase();
          const granted = Boolean(row.granted);
          if (category === "telemetry") {
            telemetryConsent = granted;
            continue;
          }
          if (category in nextConsent) {
            nextConsent[category as AiConsentCategory] = granted;
          }
        }
        setAiConsent(nextConsent);
        if (telemetryConsent !== null) {
          setSettings((prev) => ({
            ...prev,
            privacy: {
              ...prev.privacy,
              telemetry: telemetryConsent,
            },
          }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPrivacyStatus("Unable to load privacy consent.");
      })
      .finally(() => {
        if (cancelled) return;
        setPrivacyBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

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
      { id: "performance" as const, label: "Performance", icon: Shield },
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

  const analyzeRuntimeTuning = async () => {
    if (!isTauriRuntime()) {
      setStatus("Runtime tuning analysis is available in desktop app only.");
      return;
    }
    setTuningBusy(true);
    setStatus(null);
    try {
      const [probe, recommendation] = await Promise.all([
        probeAsmCpuCapabilities(),
        recommendRuntimeTuning({
          consent: settings.performance.autoTuningEnabled,
          profile: settings.performance.autoTuningProfile,
        }),
      ]);
      if (probe) {
        setCapabilities(probe);
      }
      if (recommendation) {
        setSettings((prev) => ({
          ...prev,
          performance: {
            ...prev.performance,
            autoTuningProfile: recommendation.profile,
            autoTuningFallbackUsed: recommendation.fallbackUsed,
          },
        }));
        setStatus(
          recommendation.autoApplyAllowed
            ? `Recommended profile: ${recommendation.profile}`
            : "Auto tuning requires opt-in."
        );
      }
    } catch {
      setStatus("Unable to analyze runtime tuning.");
    } finally {
      setTuningBusy(false);
    }
  };

  const applyRuntimeTuningNow = async () => {
    if (!isTauriRuntime()) {
      setStatus("Runtime tuning apply is available in desktop app only.");
      return;
    }
    setTuningBusy(true);
    setStatus(null);
    try {
      const result = await applyRuntimeTuning({
        consent: settings.performance.autoTuningEnabled,
        profile: settings.performance.autoTuningProfile,
      });
      if (!result?.applied) {
        setStatus("Runtime tuning did not apply.");
        return;
      }
      setSettings((prev) => ({
        ...prev,
        performance: {
          ...prev.performance,
          autoTuningProfile: result.profile,
          autoTuningLastAppliedAt: result.appliedAt,
          autoTuningFallbackUsed: result.fallbackUsed,
        },
      }));
      setStatus(`Runtime tuning applied: ${result.profile}`);
    } catch {
      setStatus("Unable to apply runtime tuning.");
    } finally {
      setTuningBusy(false);
    }
  };

  const rollbackRuntimeTuningNow = async () => {
    if (!isTauriRuntime()) {
      setStatus("Runtime tuning rollback is available in desktop app only.");
      return;
    }
    setTuningBusy(true);
    setStatus(null);
    try {
      await rollbackRuntimeTuning();
      setSettings((prev) => ({
        ...prev,
        performance: {
          ...prev.performance,
          autoTuningLastAppliedAt: null,
          autoTuningFallbackUsed: false,
          autoTuningProfile: "balanced",
        },
      }));
      setStatus("Runtime tuning rolled back to defaults.");
    } catch {
      setStatus("Unable to rollback runtime tuning.");
    } finally {
      setTuningBusy(false);
    }
  };

  const syncTelemetryConsentRemote = async (enabled: boolean) => {
    if (!token) {
      setPrivacyStatus("Sign in to sync telemetry consent.");
      return;
    }
    setPrivacyBusy(true);
    setPrivacyStatus(null);
    try {
      await setPrivacyConsent(
        {
          category: "telemetry",
          granted: Boolean(enabled),
          source: "settings",
          payload: { key: "telemetry" },
        },
        token
      );
      setPrivacyStatus("Telemetry consent synced.");
    } catch {
      setPrivacyStatus("Unable to sync telemetry consent.");
    } finally {
      setPrivacyBusy(false);
    }
  };

  const syncAiConsentRemote = async (
    category: AiConsentCategory,
    granted: boolean,
    previousValue: boolean
  ) => {
    if (!token) {
      setAiConsent((prev) => ({ ...prev, [category]: previousValue }));
      setPrivacyStatus("Sign in to sync AI consent.");
      return;
    }
    setPrivacyBusy(true);
    setPrivacyStatus(null);
    try {
      await setPrivacyConsent(
        {
          category,
          granted: Boolean(granted),
          source: "settings",
          payload: { key: `ai.${category}` },
        },
        token
      );
      setPrivacyStatus("AI consent updated.");
    } catch {
      setAiConsent((prev) => ({ ...prev, [category]: previousValue }));
      setPrivacyStatus("Unable to sync AI consent.");
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleExportPrivacyData = async () => {
    if (!token) {
      setPrivacyStatus("Sign in to export privacy data.");
      return;
    }
    setPrivacyBusy(true);
    setPrivacyStatus(null);
    try {
      const payload = await exportPrivacyData(token);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const fileName = `otoshi-privacy-export-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setPrivacyStatus("Privacy export downloaded.");
    } catch {
      setPrivacyStatus("Unable to export privacy data.");
    } finally {
      setPrivacyBusy(false);
    }
  };

  const handleDeletePrivacyData = async () => {
    if (!token) {
      setPrivacyStatus("Sign in to delete privacy data.");
      return;
    }
    setPrivacyBusy(true);
    setPrivacyStatus(null);
    try {
      const response = await deletePrivacyData(token);
      setPrivacyStatus(
        response.status === "completed"
          ? "Privacy data deleted."
          : "Privacy delete request submitted."
      );
    } catch {
      setPrivacyStatus("Unable to delete privacy data.");
    } finally {
      setPrivacyBusy(false);
    }
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
                    disabled={privacyBusy && item.key === "telemetry"}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSettings((prev) => ({
                        ...prev,
                        privacy: {
                          ...prev.privacy,
                          [item.key]: checked,
                        },
                      }));
                      if (item.key === "telemetry") {
                        void syncTelemetryConsentRemote(checked);
                      }
                    }}
                    className="h-5 w-5 accent-primary"
                  />
                </label>
              ))}
              <div className="glass-card space-y-3 p-4 text-sm text-text-secondary">
                <p className="text-text-primary">AI feature consent</p>
                <div className="space-y-3">
                  {AI_CONSENT_ITEMS.map((item) => (
                    <label
                      key={item.key}
                      className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"
                    >
                      <div>
                        <p className="text-sm text-text-primary">{item.label}</p>
                        <p className="text-xs text-text-muted">{item.description}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={aiConsent[item.key]}
                        disabled={privacyBusy}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          const previousValue = aiConsent[item.key];
                          setAiConsent((prev) => ({ ...prev, [item.key]: checked }));
                          void syncAiConsentRemote(item.key, checked, previousValue);
                        }}
                        className="h-5 w-5 accent-primary"
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="glass-card space-y-3 p-4 text-sm text-text-secondary">
                <p className="text-text-primary">AI data controls</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={privacyBusy}
                    onClick={handleExportPrivacyData}
                  >
                    Export AI data
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={privacyBusy}
                    onClick={handleDeletePrivacyData}
                  >
                    Delete AI data
                  </Button>
                </div>
                {privacyStatus && <p className="text-xs text-text-muted">{privacyStatus}</p>}
              </div>
            </div>
          )}

          {activeSection === "performance" && (
            <div className="glass-panel space-y-4 p-6">
              <div>
                <h3 className="section-title">Performance</h3>
                <p className="text-sm text-text-secondary">
                  Optional auto-tuning for launcher runtime. Opt-in is required before apply.
                </p>
              </div>
              <label className="glass-card flex items-center justify-between p-4 text-sm text-text-secondary">
                Enable automatic runtime tuning
                <input
                  type="checkbox"
                  checked={settings.performance.autoTuningEnabled}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      performance: {
                        ...prev.performance,
                        autoTuningEnabled: event.target.checked,
                      },
                    }))
                  }
                  className="h-5 w-5 accent-primary"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <Button variant="secondary" onClick={analyzeRuntimeTuning} disabled={tuningBusy}>
                  Analyze
                </Button>
                <Button onClick={applyRuntimeTuningNow} disabled={tuningBusy}>
                  Apply
                </Button>
                <Button variant="secondary" onClick={rollbackRuntimeTuningNow} disabled={tuningBusy}>
                  Rollback
                </Button>
              </div>
              <div className="glass-card p-4 text-sm text-text-secondary">
                <p className="font-semibold text-text-primary">
                  Profile: {settings.performance.autoTuningProfile}
                </p>
                <p>
                  Last applied: {settings.performance.autoTuningLastAppliedAt || "not applied"}
                </p>
                <p>
                  Fallback mode: {settings.performance.autoTuningFallbackUsed ? "yes" : "no"}
                </p>
              </div>
              {capabilities && (
                <div className="glass-card p-4 text-sm text-text-secondary">
                  <p>CPU: {capabilities.vendor} ({capabilities.arch})</p>
                  <p>
                    Cores: {capabilities.physicalCores} physical / {capabilities.logicalCores} logical
                  </p>
                  <p>
                    Memory: {capabilities.availableMemoryMb} MB free / {capabilities.totalMemoryMb} MB total
                  </p>
                  <p>Feature score: {capabilities.featureScore}</p>
                </div>
              )}
              {status && <p className="text-xs text-text-secondary">{status}</p>}
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
                  onClick={() => void openExternal("https://otoshi-launcher.me")}
                >
                  Official Website
                </Button>
                <Button
                  variant="secondary"
                  icon={<ExternalLink size={16} />}
                  onClick={() => void openExternal("https://otoshi-launcher.me/privacy-policy")}
                >
                  Privacy Policy
                </Button>
                <Button
                  variant="secondary"
                  icon={<ExternalLink size={16} />}
                  onClick={() => void openExternal("https://otoshi-launcher.me/terms-of-service")}
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
