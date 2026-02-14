import {
  Settings,
  Trash2,
  FolderOpen,
  Cloud,
  FolderInput,
  Shield,
  Loader2,
  AlertCircle,
  CheckCircle2
} from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLocale } from "../../context/LocaleContext";

type PropertiesSectionProps = {
  appId: string;
  gameName: string;
  installPath?: string | null;
  isInstalled?: boolean;
};

type GameInstallInfo = {
  installed: boolean;
  installPath: string | null;
  sizeBytes: number | null;
  version: string | null;
  lastPlayed: string | null;
};

type VerifyResult = {
  success: boolean;
  totalFiles: number;
  verifiedFiles: number;
  corruptedFiles: number;
  missingFiles: number;
};

export default function PropertiesSection({
  appId,
  gameName,
  installPath: initialPath,
  isInstalled: initialInstalled
}: PropertiesSectionProps) {
  const { t } = useLocale();
  const [installInfo, setInstallInfo] = useState<GameInstallInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState(0);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [uninstalling, setUninstalling] = useState(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [newInstallPath, setNewInstallPath] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveProgress, setMoveProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Fetch install info on mount
  useEffect(() => {
    const fetchInstallInfo = async () => {
      setLoading(true);
      try {
        const info = await invoke<GameInstallInfo>("get_game_install_info", { appId });
        setInstallInfo(info);
      } catch (err) {
        console.warn("Failed to get install info:", err);
        setInstallInfo({
          installed: initialInstalled ?? false,
          installPath: initialPath ?? null,
          sizeBytes: null,
          version: null,
          lastPlayed: null,
        });
      } finally {
        setLoading(false);
      }
    };
    fetchInstallInfo();
  }, [appId, initialPath, initialInstalled]);

  // Verify game files
  const handleVerify = async () => {
    if (!installInfo?.installPath) return;

    setVerifying(true);
    setVerifyProgress(0);
    setVerifyResult(null);
    setError(null);

    try {
      const result = await invoke<VerifyResult>("verify_game_files", {
        appId,
        installPath: installInfo.installPath
      });
      setVerifyResult(result);
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setVerifying(false);
      setVerifyProgress(100);
    }
  };

  // Uninstall game
  const handleUninstall = async () => {
    if (!installInfo?.installPath) return;

    setUninstalling(true);
    setError(null);

    try {
      await invoke("uninstall_game", {
        appId,
        installPath: installInfo.installPath
      });
      setInstallInfo(prev => prev ? { ...prev, installed: false, installPath: null } : null);
      setShowUninstallConfirm(false);
    } catch (err: any) {
      setError(err.message || "Uninstall failed");
    } finally {
      setUninstalling(false);
    }
  };

  // Move game folder
  const handleMove = async () => {
    if (!installInfo?.installPath || !newInstallPath) return;

    setMoving(true);
    setMoveProgress(0);
    setError(null);

    try {
      await invoke("move_game_folder", {
        appId,
        sourcePath: installInfo.installPath,
        destPath: newInstallPath
      });
      setInstallInfo(prev => prev ? { ...prev, installPath: newInstallPath } : null);
      setShowMoveDialog(false);
      setNewInstallPath("");
    } catch (err: any) {
      setError(err.message || "Move failed");
    } finally {
      setMoving(false);
    }
  };

  // Browse for folder
  const handleBrowse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select new location for game"
      });
      if (selected && typeof selected === "string") {
        setNewInstallPath(selected);
      }
    } catch (err) {
      console.warn("Browse dialog failed:", err);
    }
  };

  // Sync cloud saves
  const handleCloudSync = async () => {
    setSyncing(true);
    setSyncStatus("syncing");
    setError(null);

    try {
      await invoke("sync_cloud_saves", { appId });
      setSyncStatus("success");
      setTimeout(() => setSyncStatus("idle"), 3000);
    } catch (err: any) {
      setSyncStatus("error");
      setError(err.message || "Cloud sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Open install folder
  const handleOpenFolder = async () => {
    if (!installInfo?.installPath) return;
    try {
      await invoke("open_folder", { path: installInfo.installPath });
    } catch (err) {
      console.warn("Failed to open folder:", err);
    }
  };

  const formatSize = (bytes: number | null): string => {
    if (!bytes) return "Unknown";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-text-muted">Loading properties...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Settings size={16} className="text-text-muted" />
        <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
          Properties
        </p>
      </div>

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-accent-red/30 bg-accent-red/10 px-4 py-3 text-sm text-accent-red">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Install Info */}
      <div className="rounded-lg border border-background-border bg-background-surface p-4">
        <h3 className="mb-4 text-sm font-medium text-text-primary">Installation</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Status</span>
            <span className={`font-medium ${installInfo?.installed ? "text-accent-green" : "text-text-muted"}`}>
              {installInfo?.installed ? "Installed" : "Not Installed"}
            </span>
          </div>
          {installInfo?.installPath && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-text-muted">Location</span>
              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-1 truncate text-right text-primary transition hover:underline"
                title={installInfo.installPath}
              >
                <FolderOpen size={12} />
                <span className="max-w-[200px] truncate">{installInfo.installPath}</span>
              </button>
            </div>
          )}
          {installInfo?.sizeBytes && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Size</span>
              <span className="text-text-primary">{formatSize(installInfo.sizeBytes)}</span>
            </div>
          )}
          {installInfo?.version && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Version</span>
              <span className="text-text-primary">{installInfo.version}</span>
            </div>
          )}
          {installInfo?.lastPlayed && (
            <div className="flex items-center justify-between">
              <span className="text-text-muted">Last Played</span>
              <span className="text-text-primary">{installInfo.lastPlayed}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {installInfo?.installed && (
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Verify Game Files */}
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-3 rounded-lg border border-background-border bg-background-surface p-4 transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-blue/10">
              {verifying ? (
                <Loader2 size={20} className="animate-spin text-accent-blue" />
              ) : (
                <Shield size={20} className="text-accent-blue" />
              )}
            </div>
            <div className="text-left">
              <p className="font-medium text-text-primary">Verify Integrity</p>
              <p className="text-xs text-text-muted">
                {verifying ? `Verifying... ${verifyProgress}%` : "Check game files"}
              </p>
            </div>
          </button>

          {/* Move Game */}
          <button
            onClick={() => setShowMoveDialog(true)}
            disabled={moving}
            className="flex items-center gap-3 rounded-lg border border-background-border bg-background-surface p-4 transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-amber/10">
              {moving ? (
                <Loader2 size={20} className="animate-spin text-accent-amber" />
              ) : (
                <FolderInput size={20} className="text-accent-amber" />
              )}
            </div>
            <div className="text-left">
              <p className="font-medium text-text-primary">Move Install</p>
              <p className="text-xs text-text-muted">
                {moving ? `Moving... ${moveProgress}%` : "Change location"}
              </p>
            </div>
          </button>

          {/* Cloud Sync */}
          <button
            onClick={handleCloudSync}
            disabled={syncing}
            className="flex items-center gap-3 rounded-lg border border-background-border bg-background-surface p-4 transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-green/10">
              {syncing ? (
                <Loader2 size={20} className="animate-spin text-accent-green" />
              ) : syncStatus === "success" ? (
                <CheckCircle2 size={20} className="text-accent-green" />
              ) : (
                <Cloud size={20} className="text-accent-green" />
              )}
            </div>
            <div className="text-left">
              <p className="font-medium text-text-primary">Cloud Sync</p>
              <p className="text-xs text-text-muted">
                {syncing ? "Syncing..." : syncStatus === "success" ? "Synced!" : "Sync save data"}
              </p>
            </div>
          </button>

          {/* Uninstall */}
          <button
            onClick={() => setShowUninstallConfirm(true)}
            disabled={uninstalling}
            className="flex items-center gap-3 rounded-lg border border-background-border bg-background-surface p-4 transition hover:border-accent-red hover:bg-accent-red/5 disabled:opacity-50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-red/10">
              {uninstalling ? (
                <Loader2 size={20} className="animate-spin text-accent-red" />
              ) : (
                <Trash2 size={20} className="text-accent-red" />
              )}
            </div>
            <div className="text-left">
              <p className="font-medium text-text-primary">Uninstall</p>
              <p className="text-xs text-text-muted">
                {uninstalling ? "Uninstalling..." : "Remove game files"}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Verify Result */}
      {verifyResult && (
        <div className={`rounded-lg border p-4 ${
          verifyResult.corruptedFiles > 0 || verifyResult.missingFiles > 0
            ? "border-accent-red/30 bg-accent-red/10"
            : "border-accent-green/30 bg-accent-green/10"
        }`}>
          <div className="flex items-center gap-2">
            {verifyResult.corruptedFiles > 0 || verifyResult.missingFiles > 0 ? (
              <AlertCircle size={16} className="text-accent-red" />
            ) : (
              <CheckCircle2 size={16} className="text-accent-green" />
            )}
            <p className="font-medium text-text-primary">
              {verifyResult.corruptedFiles > 0 || verifyResult.missingFiles > 0
                ? "Issues Found"
                : "All Files Verified"}
            </p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-muted">
            <span>Total Files: {verifyResult.totalFiles}</span>
            <span>Verified: {verifyResult.verifiedFiles}</span>
            {verifyResult.corruptedFiles > 0 && (
              <span className="text-accent-red">Corrupted: {verifyResult.corruptedFiles}</span>
            )}
            {verifyResult.missingFiles > 0 && (
              <span className="text-accent-red">Missing: {verifyResult.missingFiles}</span>
            )}
          </div>
        </div>
      )}

      {/* Uninstall Confirm Dialog */}
      {showUninstallConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-background-border bg-background-elevated p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary">Uninstall {gameName}?</h3>
            <p className="mt-2 text-sm text-text-secondary">
              This will remove all game files from your computer. Save data stored in the cloud will not be affected.
            </p>
            {installInfo?.installPath && (
              <p className="mt-2 text-xs text-text-muted">
                Location: {installInfo.installPath}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowUninstallConfirm(false)}
                className="rounded-lg border border-background-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-background-muted"
              >
                Cancel
              </button>
              <button
                onClick={handleUninstall}
                disabled={uninstalling}
                className="rounded-lg bg-accent-red px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-red/80 disabled:opacity-50"
              >
                {uninstalling ? "Uninstalling..." : "Uninstall"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Dialog */}
      {showMoveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-background-border bg-background-elevated p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-text-primary">Move {gameName}</h3>
            <p className="mt-2 text-sm text-text-secondary">
              Select a new location for the game files. The game will be moved to the selected folder.
            </p>

            <div className="mt-4">
              <label className="text-xs text-text-muted">{t("properties.current_location")}</label>
              <p className="mt-1 truncate rounded-lg border border-background-border bg-background-muted px-3 py-2 text-sm text-text-secondary">
                {installInfo?.installPath}
              </p>
            </div>

            <div className="mt-4">
              <label className="text-xs text-text-muted">{t("properties.new_location")}</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={newInstallPath}
                  onChange={(e) => setNewInstallPath(e.target.value)}
                  placeholder={t("properties.select_destination")}
                  className="flex-1 rounded-lg border border-background-border bg-background-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
                />
                <button
                  onClick={handleBrowse}
                  className="rounded-lg border border-background-border px-3 py-2 text-sm text-text-secondary transition hover:bg-background-muted"
                >
                  {t("common.browse")}
                </button>
              </div>
            </div>

            {moving && (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-background-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${moveProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-center text-xs text-text-muted">Moving... {moveProgress}%</p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowMoveDialog(false);
                  setNewInstallPath("");
                }}
                disabled={moving}
                className="rounded-lg border border-background-border px-4 py-2 text-sm font-medium text-text-secondary transition hover:bg-background-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleMove}
                disabled={moving || !newInstallPath}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black transition hover:bg-primary/80 disabled:opacity-50"
              >
                {moving ? "Moving..." : "Move"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
