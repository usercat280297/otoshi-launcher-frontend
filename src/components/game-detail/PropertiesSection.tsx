import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  FolderInput,
  FolderOpen,
  Loader2,
  RefreshCw,
  Settings,
  Shield,
  ShieldOff,
  Trash2,
  UploadCloud
} from "lucide-react";
import { isTauri as detectTauriRuntime, invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import {
  fetchPropertiesDlcState,
  fetchPropertiesInstallInfo,
  fetchPropertiesLaunchOptions,
  fetchPropertiesSaveLocations,
  movePropertiesInstall,
  runPropertiesCloudSync,
  setPropertiesLaunchOptions,
  uninstallPropertiesInstall,
  verifyPropertiesInstall
} from "../../services/api";
import type {
  PropertiesCloudSyncResult,
  PropertiesDlcState,
  PropertiesInstallInfo,
  PropertiesLaunchOptions,
  PropertiesVerifyResult
} from "../../types";

type PropertiesSectionProps = {
  appId: string;
  gameName: string;
  installPath?: string | null;
  isInstalled?: boolean;
};

type PropertiesTab = "general" | "updates" | "installed_files" | "dlc" | "privacy" | "customization";

type CustomizationState = {
  coverPath: string;
  backgroundPath: string;
  logoPath: string;
};

const TABS: Array<{ id: PropertiesTab; i18nKey: string }> = [
  { id: "general", i18nKey: "properties.tab.general" },
  { id: "updates", i18nKey: "properties.tab.updates" },
  { id: "installed_files", i18nKey: "properties.tab.installed_files" },
  { id: "dlc", i18nKey: "properties.tab.dlc" },
  { id: "privacy", i18nKey: "properties.tab.privacy" },
  { id: "customization", i18nKey: "properties.tab.customization" },
];

const bytesToHuman = (value?: number | null): string => {
  if (!value || value <= 0) return "-";
  const gb = value / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = value / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = value / 1024;
  return `${kb.toFixed(2)} KB`;
};

const parseError = (error: unknown): string => {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
};

const defaultCustomizationState = (): CustomizationState => ({
  coverPath: "",
  backgroundPath: "",
  logoPath: "",
});

export default function PropertiesSection({
  appId,
  gameName,
  installPath: initialPath,
  isInstalled: initialInstalled
}: PropertiesSectionProps) {
  const { t } = useLocale();
  const isTauriRuntime = detectTauriRuntime();

  const [activeTab, setActiveTab] = useState<PropertiesTab>("general");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [installInfo, setInstallInfo] = useState<PropertiesInstallInfo>({
    installed: Boolean(initialInstalled),
    installPath: initialPath ?? null,
    installRoots: [],
    sizeBytes: null,
    version: null,
    branch: null,
    buildId: null,
    lastPlayed: null,
    playtimeLocalHours: 0,
  });
  const [launchOptions, setLaunchOptions] = useState<PropertiesLaunchOptions | null>(null);
  const [saveLocations, setSaveLocations] = useState<string[]>([]);
  const [dlcItems, setDlcItems] = useState<PropertiesDlcState[]>([]);
  const [dlcSearch, setDlcSearch] = useState("");

  const [overlayEnabled, setOverlayEnabled] = useState(true);
  const [language, setLanguage] = useState("system");
  const [launchArgs, setLaunchArgs] = useState("");
  const [privacyHidden, setPrivacyHidden] = useState(false);
  const [markPrivate, setMarkPrivate] = useState(false);
  const [dlcOverrides, setDlcOverrides] = useState<Record<string, boolean>>({});
  const [customization, setCustomization] = useState<CustomizationState>(defaultCustomizationState());

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<PropertiesVerifyResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<PropertiesCloudSyncResult | null>(null);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [savingDlc, setSavingDlc] = useState(false);
  const [savingCustomization, setSavingCustomization] = useState(false);
  const [moving, setMoving] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [newInstallPath, setNewInstallPath] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadBundle = async () => {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);
      try {
        const [info, launch, save, dlc] = await Promise.all([
          fetchPropertiesInstallInfo(appId),
          fetchPropertiesLaunchOptions(appId),
          fetchPropertiesSaveLocations(appId),
          fetchPropertiesDlcState(appId),
        ]);
        if (cancelled) return;

        setInstallInfo(info);
        setLaunchOptions(launch);
        setSaveLocations(save.locations);
        setDlcItems(dlc);

        const options = launch.launchOptions || {};
        setOverlayEnabled(Boolean(options.overlay_enabled ?? options.overlayEnabled ?? true));
        setLanguage(String(options.language || "system"));
        setLaunchArgs(String(options.launch_args ?? options.launchArgs ?? ""));
        setPrivacyHidden(Boolean(options.privacy_hidden ?? options.privacyHidden ?? false));
        setMarkPrivate(Boolean(options.mark_private ?? options.markPrivate ?? false));
        setDlcOverrides(
          options.dlc_overrides && typeof options.dlc_overrides === "object"
            ? options.dlc_overrides
            : {}
        );
        const customizationRaw = options.customization;
        if (customizationRaw && typeof customizationRaw === "object") {
          setCustomization({
            coverPath: String((customizationRaw as Record<string, unknown>).coverPath || ""),
            backgroundPath: String((customizationRaw as Record<string, unknown>).backgroundPath || ""),
            logoPath: String((customizationRaw as Record<string, unknown>).logoPath || ""),
          });
        } else {
          setCustomization(defaultCustomizationState());
        }
      } catch (bundleError) {
        if (cancelled) return;
        setError(parseError(bundleError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadBundle();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  const filteredDlc = useMemo(() => {
    const query = dlcSearch.trim().toLowerCase();
    if (!query) return dlcItems;
    return dlcItems.filter((item) => item.title.toLowerCase().includes(query));
  }, [dlcItems, dlcSearch]);

  const resolvedInstallStatus = installInfo.installed;
  const resolvedInstallPath = installInfo.installPath || initialPath || null;

  const saveLaunchOptionPayload = async (
    payload: Record<string, unknown>,
    onDone?: (result: PropertiesLaunchOptions) => void
  ) => {
    const result = await setPropertiesLaunchOptions(appId, payload);
    setLaunchOptions(result);
    onDone?.(result);
  };

  const handleSaveGeneral = async () => {
    setSavingGeneral(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await saveLaunchOptionPayload({
        overlay_enabled: overlayEnabled,
        language,
        launch_args: launchArgs,
      });
      setSuccessMessage(t("properties.saved_general"));
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleSavePrivacy = async () => {
    setSavingPrivacy(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await saveLaunchOptionPayload({
        privacy_hidden: privacyHidden,
        mark_private: markPrivate,
      });
      setSuccessMessage(t("properties.saved_privacy"));
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleSaveDlc = async () => {
    setSavingDlc(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await saveLaunchOptionPayload({
        dlc_overrides: dlcOverrides,
      });
      setSuccessMessage(t("properties.saved_dlc"));
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSavingDlc(false);
    }
  };

  const handleSaveCustomization = async () => {
    setSavingCustomization(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await saveLaunchOptionPayload({
        customization,
      });
      setSuccessMessage(t("properties.saved_customization"));
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSavingCustomization(false);
    }
  };

  const handleVerify = async () => {
    if (!resolvedInstallPath) return;
    setVerifying(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await verifyPropertiesInstall(appId, {
        installPath: resolvedInstallPath,
      });
      setVerifyResult(result);
      if (result.success) {
        setSuccessMessage(t("properties.verify_success"));
      } else {
        setSuccessMessage(t("properties.verify_issues"));
      }
    } catch (verifyError) {
      setError(parseError(verifyError));
    } finally {
      setVerifying(false);
    }
  };

  const handleSyncCloud = async () => {
    setSyncing(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await runPropertiesCloudSync(appId);
      setSyncResult(result);
      setSuccessMessage(t("properties.sync_done"));
    } catch (syncError) {
      setError(parseError(syncError));
    } finally {
      setSyncing(false);
    }
  };

  const handleMoveInstall = async () => {
    if (!resolvedInstallPath || !newInstallPath) return;
    setMoving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await movePropertiesInstall(appId, {
        sourcePath: resolvedInstallPath,
        destPath: newInstallPath,
      });
      setInstallInfo((previous) => ({
        ...previous,
        installPath: result.newPath,
      }));
      setShowMoveDialog(false);
      setNewInstallPath("");
      setSuccessMessage(t("properties.move_success"));
    } catch (moveError) {
      setError(parseError(moveError));
    } finally {
      setMoving(false);
    }
  };

  const handleUninstall = async () => {
    if (!resolvedInstallPath) return;
    setUninstalling(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await uninstallPropertiesInstall(appId, resolvedInstallPath);
      setInstallInfo((previous) => ({
        ...previous,
        installed: false,
        installPath: null,
        sizeBytes: null,
      }));
      setShowUninstallConfirm(false);
      setSuccessMessage(t("properties.uninstall_success"));
    } catch (uninstallError) {
      setError(parseError(uninstallError));
    } finally {
      setUninstalling(false);
    }
  };

  const handleOpenInstallFolder = async () => {
    if (!resolvedInstallPath || !isTauriRuntime) return;
    try {
      await invoke("open_folder", { path: resolvedInstallPath });
    } catch (invokeError) {
      setError(parseError(invokeError));
    }
  };

  const handleBrowseMoveTarget = async () => {
    if (!isTauriRuntime) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("properties.select_destination"),
      });
      if (typeof selected === "string") {
        setNewInstallPath(selected);
      }
    } catch (dialogError) {
      setError(parseError(dialogError));
    }
  };

  const handleBrowseCustomizationFile = async (target: keyof CustomizationState) => {
    if (!isTauriRuntime) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        title: t("properties.select_image"),
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp", "bmp"],
          },
        ],
      });
      if (typeof selected === "string") {
        setCustomization((previous) => ({ ...previous, [target]: selected }));
      }
    } catch (dialogError) {
      setError(parseError(dialogError));
    }
  };

  const toggleDlcOverride = (dlcAppId: string) => {
    setDlcOverrides((previous) => {
      const current = previous[dlcAppId];
      return {
        ...previous,
        [dlcAppId]: !current,
      };
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-text-muted">{t("properties.loading")}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-background-border bg-background-surface overflow-hidden">
      <div className="border-b border-background-border px-5 py-4">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-text-muted" />
          <p className="text-xs uppercase tracking-[0.32em] text-text-muted">{t("properties.title")}</p>
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-r border-background-border bg-background-muted/20">
          <div className="border-b border-background-border px-4 py-4">
            <p className="text-sm font-semibold text-primary">{gameName}</p>
            <p className="mt-1 text-xs text-text-muted">
              {resolvedInstallStatus ? t("properties.status_installed") : t("properties.status_not_installed")}
            </p>
          </div>
          <nav className="p-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  activeTab === tab.id
                    ? "bg-background-elevated text-text-primary"
                    : "text-text-secondary hover:bg-background-elevated/60 hover:text-text-primary"
                }`}
              >
                {t(tab.i18nKey)}
              </button>
            ))}
          </nav>
        </aside>

        <section className="space-y-4 p-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          {successMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-accent-green/30 bg-accent-green/10 px-4 py-3 text-sm text-accent-green">
              <CheckCircle2 size={16} />
              <span>{successMessage}</span>
            </div>
          )}

          {activeTab === "general" && (
            <div className="space-y-5">
              <h3 className="text-xl font-semibold text-text-primary">{t("properties.tab.general")}</h3>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <p className="text-sm font-medium text-text-primary">{t("properties.overlay_title")}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-text-secondary">{t("properties.overlay_desc")}</span>
                  <button
                    onClick={() => setOverlayEnabled((value) => !value)}
                    className={`relative h-6 w-11 rounded-full transition ${
                      overlayEnabled ? "bg-primary" : "bg-background-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                        overlayEnabled ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <p className="text-sm font-medium text-text-primary">{t("properties.language_title")}</p>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="mt-3 w-full rounded-lg border border-background-border bg-background-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                >
                  <option value="system">{t("properties.language_system")}</option>
                  <option value="en">{t("locale.english")}</option>
                  <option value="vi">{t("locale.vietnamese")}</option>
                </select>
              </div>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <p className="text-sm font-medium text-text-primary">{t("properties.launch_options_title")}</p>
                <p className="mt-1 text-xs text-text-muted">{t("properties.launch_options_desc")}</p>
                <input
                  value={launchArgs}
                  onChange={(event) => setLaunchArgs(event.target.value)}
                  placeholder={t("properties.launch_options_placeholder")}
                  className="mt-3 w-full rounded-lg border border-background-border bg-background-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t("properties.cloud_title")}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {t("properties.cloud_desc")} ({saveLocations.length} {t("properties.save_locations")})
                    </p>
                  </div>
                  <button
                    onClick={handleSyncCloud}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary hover:border-primary disabled:opacity-50"
                  >
                    {syncing ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                    {syncing ? t("properties.syncing") : t("properties.sync_now")}
                  </button>
                </div>
                {syncResult && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-secondary">
                    <span>{t("properties.sync_uploaded")}: {syncResult.filesUploaded}</span>
                    <span>{t("properties.sync_downloaded")}: {syncResult.filesDownloaded}</span>
                    <span>{t("properties.sync_conflicts")}: {syncResult.conflicts}</span>
                    <span>{t("properties.sync_events")}: {syncResult.eventId || "-"}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveGeneral}
                  disabled={savingGeneral}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black transition hover:bg-primary/80 disabled:opacity-50"
                >
                  {savingGeneral ? t("properties.saving") : t("action.save")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "updates" && (
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-text-primary">{t("properties.tab.updates")}</h3>
              <div className="grid gap-3 rounded-lg border border-background-border bg-background-elevated/50 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">{t("properties.current_version")}</span>
                  <span className="text-text-primary">{installInfo.version || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">{t("properties.branch")}</span>
                  <span className="text-text-primary">{installInfo.branch || "stable"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">{t("properties.build_id")}</span>
                  <span className="text-text-primary">{installInfo.buildId || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">{t("properties.last_played")}</span>
                  <span className="text-text-primary">{installInfo.lastPlayed || "-"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">{t("properties.settings_updated")}</span>
                  <span className="text-text-primary">{launchOptions?.updatedAt || "-"}</span>
                </div>
              </div>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <p className="text-sm text-text-secondary">{t("properties.verify_desc")}</p>
                <button
                  onClick={handleVerify}
                  disabled={!resolvedInstallPath || verifying}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary hover:border-primary disabled:opacity-50"
                >
                  {verifying ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  {verifying ? t("properties.verifying") : t("properties.verify_now")}
                </button>
              </div>

              {verifyResult && (
                <div className={`rounded-lg border p-4 text-sm ${
                  verifyResult.success
                    ? "border-accent-green/30 bg-accent-green/10"
                    : "border-accent-red/30 bg-accent-red/10"
                }`}>
                  <p className="font-medium text-text-primary">
                    {verifyResult.success ? t("properties.verify_success") : t("properties.verify_issues")}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-secondary">
                    <span>{t("properties.total_files")}: {verifyResult.totalFiles}</span>
                    <span>{t("properties.verified_files")}: {verifyResult.verifiedFiles}</span>
                    <span>{t("properties.corrupted_files")}: {verifyResult.corruptedFiles}</span>
                    <span>{t("properties.missing_files")}: {verifyResult.missingFiles}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "installed_files" && (
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-text-primary">{t("properties.tab.installed_files")}</h3>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <div className="grid gap-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">{t("properties.install_status")}</span>
                    <span className={resolvedInstallStatus ? "text-accent-green" : "text-text-muted"}>
                      {resolvedInstallStatus ? t("properties.status_installed") : t("properties.status_not_installed")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">{t("properties.size_on_disk")}</span>
                    <span className="text-text-primary">{bytesToHuman(installInfo.sizeBytes)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-text-muted">{t("properties.current_location")}</span>
                    <span className="max-w-[280px] truncate text-right text-text-primary" title={resolvedInstallPath || "-"}>
                      {resolvedInstallPath || "-"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={handleOpenInstallFolder}
                    disabled={!resolvedInstallPath || !isTauriRuntime}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary hover:border-primary disabled:opacity-50"
                  >
                    <FolderOpen size={14} />
                    {t("properties.open_folder")}
                  </button>
                  <button
                    onClick={() => setShowMoveDialog(true)}
                    disabled={!resolvedInstallPath}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary hover:border-primary disabled:opacity-50"
                  >
                    <FolderInput size={14} />
                    {t("properties.move_install")}
                  </button>
                  <button
                    onClick={handleVerify}
                    disabled={!resolvedInstallPath || verifying}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary hover:border-primary disabled:opacity-50"
                  >
                    {verifying ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
                    {t("properties.verify_now")}
                  </button>
                  <button
                    onClick={() => setShowUninstallConfirm(true)}
                    disabled={!resolvedInstallPath || uninstalling}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-accent-red/30 px-3 py-2 text-sm text-accent-red transition hover:bg-accent-red/10 disabled:opacity-50"
                  >
                    {uninstalling ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {t("action.uninstall")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "dlc" && (
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-text-primary">{t("properties.tab.dlc")}</h3>
              <input
                value={dlcSearch}
                onChange={(event) => setDlcSearch(event.target.value)}
                placeholder={t("properties.search_dlc")}
                className="w-full rounded-lg border border-background-border bg-background-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
              />
              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {filteredDlc.length === 0 && (
                  <div className="rounded-lg border border-background-border bg-background-elevated/50 px-4 py-3 text-sm text-text-muted">
                    {t("properties.no_dlc")}
                  </div>
                )}
                {filteredDlc.map((item) => {
                  const override = dlcOverrides[item.appId];
                  const enabled = override ?? item.enabled;
                  return (
                    <label
                      key={item.appId}
                      className="flex items-center justify-between gap-4 rounded-lg border border-background-border bg-background-elevated/50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">{item.title}</p>
                        <p className="text-xs text-text-muted">{bytesToHuman(item.sizeBytes)}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(enabled)}
                        onChange={() => toggleDlcOverride(item.appId)}
                        className="h-4 w-4 rounded border-background-border bg-background-surface text-primary focus:ring-primary"
                      />
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveDlc}
                  disabled={savingDlc}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black transition hover:bg-primary/80 disabled:opacity-50"
                >
                  {savingDlc ? t("properties.saving") : t("action.save")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "privacy" && (
            <div className="space-y-5">
              <h3 className="text-xl font-semibold text-text-primary">{t("properties.tab.privacy")}</h3>
              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t("properties.hide_in_library")}</p>
                    <p className="text-xs text-text-muted">{t("properties.hide_in_library_desc")}</p>
                  </div>
                  <button
                    onClick={() => setPrivacyHidden((value) => !value)}
                    className={`relative h-6 w-11 rounded-full transition ${
                      privacyHidden ? "bg-primary" : "bg-background-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                        privacyHidden ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{t("properties.mark_private")}</p>
                    <p className="text-xs text-text-muted">{t("properties.mark_private_desc")}</p>
                  </div>
                  <button
                    onClick={() => setMarkPrivate((value) => !value)}
                    className={`relative h-6 w-11 rounded-full transition ${
                      markPrivate ? "bg-primary" : "bg-background-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                        markPrivate ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <p className="text-sm font-medium text-text-primary">{t("properties.overlay_data")}</p>
                <p className="mt-1 text-xs text-text-muted">{t("properties.overlay_data_desc")}</p>
                <button
                  onClick={() => {
                    setLaunchArgs("");
                    setSuccessMessage(t("properties.overlay_data_cleared"));
                  }}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary hover:border-primary"
                >
                  <ShieldOff size={14} />
                  {t("properties.clear_overlay_data")}
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={handleSavePrivacy}
                  disabled={savingPrivacy}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black transition hover:bg-primary/80 disabled:opacity-50"
                >
                  {savingPrivacy ? t("properties.saving") : t("action.save")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "customization" && (
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-text-primary">{t("properties.tab.customization")}</h3>
              <div className="space-y-3 rounded-lg border border-background-border bg-background-elevated/50 p-4">
                <p className="text-xs uppercase tracking-[0.26em] text-text-muted">{t("properties.artwork_title")}</p>

                {(["coverPath", "backgroundPath", "logoPath"] as Array<keyof CustomizationState>).map((field) => {
                  const labelKey =
                    field === "coverPath"
                      ? "properties.artwork_cover"
                      : field === "backgroundPath"
                        ? "properties.artwork_background"
                        : "properties.artwork_logo";
                  return (
                    <div key={field} className="rounded-lg border border-background-border bg-background-surface p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-primary">{t(labelKey)}</p>
                          <p className="truncate text-xs text-text-muted" title={customization[field] || "-"}>
                            {customization[field] || t("properties.no_custom_asset")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void handleBrowseCustomizationFile(field)}
                            disabled={!isTauriRuntime}
                            className="inline-flex items-center gap-1 rounded-md border border-background-border px-2.5 py-1.5 text-xs text-text-secondary transition hover:text-text-primary hover:border-primary disabled:opacity-50"
                          >
                            <UploadCloud size={12} />
                            {t("properties.change")}
                          </button>
                          <button
                            onClick={() =>
                              setCustomization((previous) => ({
                                ...previous,
                                [field]: "",
                              }))
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-background-border px-2.5 py-1.5 text-xs text-text-secondary transition hover:text-text-primary hover:border-primary"
                          >
                            {t("properties.reset")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveCustomization}
                  disabled={savingCustomization}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black transition hover:bg-primary/80 disabled:opacity-50"
                >
                  {savingCustomization ? t("properties.saving") : t("action.save")}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {showUninstallConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-background-border bg-background-elevated p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary">{t("properties.uninstall_confirm_title")}</h3>
            <p className="mt-2 text-sm text-text-secondary">{t("properties.uninstall_confirm_desc")}</p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowUninstallConfirm(false)}
                className="rounded-lg border border-background-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-background-muted"
              >
                {t("action.cancel")}
              </button>
              <button
                onClick={() => void handleUninstall()}
                disabled={uninstalling}
                className="rounded-lg bg-accent-red px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-red/80 disabled:opacity-50"
              >
                {uninstalling ? t("properties.uninstalling") : t("action.uninstall")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMoveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-xl border border-background-border bg-background-elevated p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary">{t("properties.move_title")}</h3>
            <p className="mt-2 text-sm text-text-secondary">{t("properties.move_desc")}</p>

            <div className="mt-4">
              <label className="text-xs text-text-muted">{t("properties.current_location")}</label>
              <p className="mt-1 truncate rounded-lg border border-background-border bg-background-muted px-3 py-2 text-sm text-text-secondary">
                {resolvedInstallPath || "-"}
              </p>
            </div>

            <div className="mt-4">
              <label className="text-xs text-text-muted">{t("properties.new_location")}</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={newInstallPath}
                  onChange={(event) => setNewInstallPath(event.target.value)}
                  placeholder={t("properties.select_destination")}
                  className="flex-1 rounded-lg border border-background-border bg-background-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
                />
                <button
                  onClick={() => void handleBrowseMoveTarget()}
                  disabled={!isTauriRuntime}
                  className="rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:bg-background-muted disabled:opacity-50"
                >
                  {t("common.browse")}
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowMoveDialog(false);
                  setNewInstallPath("");
                }}
                className="rounded-lg border border-background-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-background-muted"
              >
                {t("action.cancel")}
              </button>
              <button
                onClick={() => void handleMoveInstall()}
                disabled={moving || !newInstallPath}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black transition hover:bg-primary/80 disabled:opacity-50"
              >
                {moving ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    {t("properties.moving")}
                  </span>
                ) : (
                  t("properties.move_install")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
