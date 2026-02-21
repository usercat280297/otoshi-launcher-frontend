import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Download,
  X,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Info,
  Trash2,
  RefreshCw
} from "lucide-react";
import Modal from "../common/Modal";
import Button from "../common/Button";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../common/Badge";
import { fetchSteamDLC } from "../../services/api";
import type { FixEntry, FixOption } from "../../types";

type CrackDownloadProgress = {
  app_id: string;
  status: "pending" | "downloading" | "extracting" | "backing_up" | "installing" | "completed" | "failed" | "cancelled";
  progress_percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bps: number;
  eta_seconds: number;
  current_file: string | null;
};

type GameInstallInfo = {
  installed: boolean;
  install_path: string | null;
  game_name: string | null;
  store_url: string | null;
};

type CrackInstallResult = {
  success: boolean;
  message: string;
  files_installed: number;
  files_backed_up: number;
};

type CrackUninstallResult = {
  success: boolean;
  message: string;
  files_restored: number;
  files_missing: number;
  verification_passed: boolean;
};

type Props = {
  open: boolean;
  entry: FixEntry | null;
  onClose: () => void;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const formatSpeed = (bps: number): string => {
  if (bps === 0) return "0 B/s";
  return `${formatBytes(bps)}/s`;
};

const formatEta = (seconds: number): string => {
  if (seconds === 0) return "--";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

const PLACEHOLDER_STEAM_APP_PATTERN = /^steam app\s+\d+$/i;

const isPlaceholderTitle = (value?: string | null, appId?: string) => {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (PLACEHOLDER_STEAM_APP_PATTERN.test(text)) return true;
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId) return false;
  const lowered = text.toLowerCase();
  return lowered === normalizedAppId.toLowerCase() || lowered === `steam app ${normalizedAppId}`.toLowerCase();
};

export default function CrackDownloadModal({ open, entry, onClose }: Props) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [selectedOption, setSelectedOption] = useState<FixOption | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [gameInfo, setGameInfo] = useState<GameInstallInfo | null>(null);
  const [progress, setProgress] = useState<CrackDownloadProgress | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);
  const [isCrackInstalled, setIsCrackInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uninstallResult, setUninstallResult] = useState<CrackUninstallResult | null>(null);
  const [dlcTotal, setDlcTotal] = useState<number | null>(null);
  const [dlcLoading, setDlcLoading] = useState(false);
  const [headerLoaded, setHeaderLoaded] = useState(false);
  const [headerError, setHeaderError] = useState(false);

  // Check if game is installed
  useEffect(() => {
    if (!open || !entry) return;

    setSelectedOption(entry.options[0] || null);
    setError(null);
    setProgress(null);
    setUninstallResult(null);

    const checkGame = async () => {
      if (!isTauri()) {
        console.warn("Not running in Tauri environment, skipping game check");
        setGameInfo({ installed: false, install_path: null, game_name: null, store_url: `/steam/${entry.appId}` });
        return;
      }
      try {
        const info = await invoke<GameInstallInfo>("check_game_installed", {
          appId: entry.appId
        });
        setGameInfo(info);

        if (info.installed && info.install_path) {
          const installed = await invoke<boolean>("is_crack_installed", {
            appId: entry.appId,
            gamePath: info.install_path
          });
          setIsCrackInstalled(installed);
        }
      } catch (err) {
        console.error("Failed to check game installation:", err);
        setGameInfo({ installed: false, install_path: null, game_name: null, store_url: `/steam/${entry.appId}` });
      }
    };

    checkGame();
  }, [open, entry]);

  useEffect(() => {
    setHeaderLoaded(false);
    setHeaderError(false);
  }, [entry?.steam?.headerImage, entry?.steam?.artwork?.t3, entry?.steam?.artwork?.t2, entry?.appId]);

  useEffect(() => {
    if (!open || !entry?.appId) return;
    let mounted = true;
    setDlcLoading(true);
    setDlcTotal(null);

    fetchSteamDLC(entry.appId)
      .then((data) => {
        if (!mounted) return;
        const total = typeof data.total === "number" ? data.total : data.items?.length ?? 0;
        setDlcTotal(total);
      })
      .catch(() => {
        if (mounted) {
          setDlcTotal(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setDlcLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [open, entry?.appId]);

  // Poll for progress updates
  useEffect(() => {
    if (!isDownloading || !entry || !isTauri()) return;

    const interval = setInterval(async () => {
      try {
        const prog = await invoke<CrackDownloadProgress | null>("get_crack_progress", {
          appId: entry.appId
        });
        if (prog) {
          setProgress(prog);
          if (prog.status === "completed" || prog.status === "failed" || prog.status === "cancelled") {
            setIsDownloading(false);
            if (prog.status === "completed") {
              setIsCrackInstalled(true);
            }
          }
        }
      } catch (err) {
        console.error("Failed to get progress:", err);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isDownloading, entry]);

  const handleDownload = useCallback(async () => {
    if (!entry || !selectedOption || !gameInfo?.install_path || !isTauri()) return;

    setError(null);
    setShowInstructions(false);
    setIsDownloading(true);

    try {
      await invoke<CrackInstallResult>("download_crack", {
        request: {
          app_id: entry.appId,
          option: {
            link: selectedOption.link,
            name: selectedOption.name || null,
            note: selectedOption.note || null,
            version: selectedOption.version || null,
            size: selectedOption.size || null,
            recommended: selectedOption.recommended || false,
            install_guide: null
          },
          game_path: gameInfo.install_path
        }
      });
    } catch (err) {
      setError(String(err));
      setIsDownloading(false);
    }
  }, [entry, selectedOption, gameInfo]);

  const handleCancel = useCallback(async () => {
    if (!entry || !isTauri()) return;

    try {
      await invoke("cancel_crack_download", { appId: entry.appId });
      setIsDownloading(false);
    } catch (err) {
      console.error("Failed to cancel:", err);
    }
  }, [entry]);

  const handleUninstall = useCallback(async () => {
    if (!entry || !gameInfo?.install_path || !isTauri()) return;

    setError(null);

    try {
      const result = await invoke<CrackUninstallResult>("uninstall_crack", {
        appId: entry.appId,
        gamePath: gameInfo.install_path
      });
      setUninstallResult(result);
      if (result.success) {
        setIsCrackInstalled(false);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [entry, gameInfo]);

  const title = useMemo(() => {
    if (!entry) return "";
    const optionNames = entry.options
      .map((option) => String(option.name || "").trim())
      .filter((value) => value.length > 0);
    const candidates = [entry.name, ...optionNames, entry.steam?.name];
    for (const candidate of candidates) {
      if (!isPlaceholderTitle(candidate, entry.appId)) {
        return String(candidate || "").trim();
      }
    }
    for (const candidate of candidates) {
      const text = String(candidate || "").trim();
      if (text) return text;
    }
    return `Steam App ${entry.appId}`;
  }, [entry]);
  const headerImage =
    entry?.steam?.artwork?.t3 ||
    entry?.steam?.artwork?.t2 ||
    entry?.steam?.headerImage ||
    entry?.steam?.capsuleImage ||
    null;
  const hasMultipleOptions = Boolean(entry && entry.options.length > 1);
  const hasDenuvo = Boolean(entry?.denuvo ?? entry?.steam?.denuvo);
  const statusText = progress?.status
    ? t(`crack.status.${progress.status}`)
    : "";

  if (!entry) return null;

  return (
    <Modal isOpen={open} onClose={onClose} title={t("crack.download_title")} size="lg">
      <div className="space-y-6">
        {/* Game Header */}
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-28 overflow-hidden rounded-lg border border-background-border bg-background-surface">
            <div
              className={`absolute inset-0 bg-gradient-to-br from-background-muted via-background-surface to-background-elevated transition-opacity duration-500 animate-pulse ${
                headerLoaded && !headerError ? "opacity-0" : "opacity-100"
              }`}
              aria-hidden
            />
            {headerImage && (
              <img
                src={headerImage}
                alt={title}
                onLoad={() => setHeaderLoaded(true)}
                onError={() => setHeaderError(true)}
                className={`h-full w-full object-cover transition-opacity duration-500 ${
                  headerLoaded && !headerError ? "opacity-100" : "opacity-0"
                }`}
              />
            )}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
            <p className="text-sm text-text-secondary">{entry.steam?.shortDescription || ""}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {hasDenuvo && <Badge label="Denuvo" tone="danger" />}
              {dlcLoading && (
                <span className="rounded-full border border-background-border bg-background-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-text-muted">
                  {t("common.loading")}
                </span>
              )}
              {dlcTotal != null && (
                <Badge label={`${dlcTotal} ${t("crack.dlc_count")}`} tone="secondary" />
              )}
            </div>
          </div>
        </div>

        {hasDenuvo && (
          <div className="rounded-xl border border-accent-red/30 bg-accent-red/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-accent-red flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-accent-red">
                  {t("crack.denuvo_warning_title")}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  {t("crack.denuvo_warning_body")}
                </p>
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-accent-red/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent-red">
                  {t("crack.denuvo_badge")}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Game Not Installed Warning */}
        {gameInfo && !gameInfo.installed && (
          <div className="rounded-xl border border-accent-amber/30 bg-accent-amber/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-accent-amber flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-accent-amber">{t("crack.game_not_installed")}</p>
                <p className="mt-1 text-sm text-text-secondary">
                  {t("crack.install_game_first")}
                </p>
                <button
                  onClick={() => {
                    const url = gameInfo.store_url || `/steam/${entry.appId}`;
                    navigate(url);
                    onClose();
                  }}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark transition"
                >
                  <ExternalLink size={14} />
                  {t("crack.go_to_store")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Installation Instructions */}
        {gameInfo?.installed && showInstructions && !isDownloading && !progress?.status && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-primary">{t("crack.install_guide_title")}</p>
                <div className="mt-2 text-sm text-text-secondary space-y-2">
                  <p>1. {t("crack.guide_step_1")}</p>
                  <p>2. {t("crack.guide_step_2")}</p>
                  <p>3. {t("crack.guide_step_3")}</p>
                  <p>4. {t("crack.guide_step_4")}</p>
                </div>
                {selectedOption?.note && (
                  <div className="mt-3 rounded-lg bg-background-surface p-3 text-sm text-text-muted">
                    <strong>{t("crack.note")}:</strong> {selectedOption.note}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Option Selector (Dropdown for multiple options) */}
        {gameInfo?.installed && hasMultipleOptions && !isDownloading && (
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-[0.3em] text-text-muted">
              {t("crack.select_version")}
            </label>
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex w-full items-center justify-between rounded-lg border border-background-border bg-background-surface px-4 py-3 text-left transition hover:border-primary"
              >
                <div className="flex items-center gap-3">
                  {selectedOption?.recommended && (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {t("crack.recommended")}
                    </span>
                  )}
                  <span className="font-medium text-text-primary">
                    {selectedOption?.name || t("crack.default_option")}
                  </span>
                  {selectedOption?.version && (
                    <span className="text-xs text-text-muted">{selectedOption.version}</span>
                  )}
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-text-muted transition ${dropdownOpen ? "rotate-180" : ""}`}
                />
              </button>

              {dropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-background-border bg-background-elevated shadow-xl">
                  {entry.options.map((option, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setSelectedOption(option);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-background-surface ${
                        selectedOption === option ? "bg-primary/10" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {option.recommended && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {t("crack.recommended")}
                          </span>
                        )}
                        <span className="font-medium text-text-primary">
                          {option.name || `Option ${index + 1}`}
                        </span>
                        {option.version && (
                          <span className="text-xs text-text-muted">{option.version}</span>
                        )}
                      </div>
                      {option.size && (
                        <span className="text-xs text-text-muted">
                          {formatBytes(option.size)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {(isDownloading || progress) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-secondary">{statusText}</span>
              <span className="font-medium text-text-primary">
                {progress?.progress_percent.toFixed(1) || 0}%
              </span>
            </div>

            {/* Epic Games Style Progress Bar */}
            <div className="relative h-2 overflow-hidden rounded-full bg-background-surface">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-accent-blue transition-all duration-300"
                style={{ width: `${progress?.progress_percent || 0}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/20 animate-pulse"
                style={{ width: `${progress?.progress_percent || 0}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>
                {progress?.downloaded_bytes ? formatBytes(progress.downloaded_bytes) : "0 B"} / {progress?.total_bytes ? formatBytes(progress.total_bytes) : "Unknown"}
              </span>
              <div className="flex items-center gap-4">
                <span>{formatSpeed(progress?.speed_bps || 0)}</span>
                <span>{t("crack.eta")}: {formatEta(progress?.eta_seconds || 0)}</span>
              </div>
            </div>

            {progress?.current_file && (
              <p className="truncate text-xs text-text-muted">
                {progress.current_file}
              </p>
            )}
          </div>
        )}

        {/* Completion Status */}
        {progress?.status === "completed" && (
          <div className="flex items-center gap-3 rounded-xl border border-accent-green/30 bg-accent-green/10 p-4">
            <CheckCircle2 className="h-5 w-5 text-accent-green" />
            <p className="font-medium text-accent-green">{t("crack.install_success")}</p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-accent-red/30 bg-accent-red/10 p-4">
            <AlertCircle className="h-5 w-5 text-accent-red" />
            <p className="text-sm text-accent-red">{error}</p>
          </div>
        )}

        {/* Uninstall Result */}
        {uninstallResult && (
          <div className={`flex items-start gap-3 rounded-xl border p-4 ${
            uninstallResult.success 
              ? "border-accent-green/30 bg-accent-green/10" 
              : "border-accent-amber/30 bg-accent-amber/10"
          }`}>
            {uninstallResult.success ? (
              <CheckCircle2 className="h-5 w-5 text-accent-green flex-shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-accent-amber flex-shrink-0" />
            )}
            <div>
              <p className={`font-medium ${uninstallResult.success ? "text-accent-green" : "text-accent-amber"}`}>
                {uninstallResult.message}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                {t("crack.files_restored")}: {uninstallResult.files_restored}
                {uninstallResult.files_missing > 0 && (
                  <> | {t("crack.files_missing")}: {uninstallResult.files_missing}</>
                )}
              </p>
              {uninstallResult.verification_passed && (
                <p className="mt-1 text-xs text-accent-green flex items-center gap-1">
                  <RefreshCw size={12} /> {t("crack.verification_passed")}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-background-border">
          {/* Left side - Uninstall button if crack is installed */}
          <div>
            {isCrackInstalled && !isDownloading && (
              <Button
                variant="danger"
                size="sm"
                onClick={handleUninstall}
                className="flex items-center gap-2"
              >
                <Trash2 size={14} />
                {t("crack.uninstall")}
              </Button>
            )}
          </div>

          {/* Right side - Main action buttons */}
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>

            {gameInfo?.installed && !isDownloading && progress?.status !== "completed" && (
              <Button
                onClick={handleDownload}
                className="flex items-center gap-2"
              >
                <Download size={16} />
                {t("crack.download_and_install")}
              </Button>
            )}

            {isDownloading && (
              <Button
                variant="danger"
                onClick={handleCancel}
                className="flex items-center gap-2"
              >
                <X size={16} />
                {t("action.cancel")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
