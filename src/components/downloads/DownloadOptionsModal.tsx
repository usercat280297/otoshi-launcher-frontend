import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  FolderOpen,
  HardDrive,
  Pause,
  Play,
  ShieldCheck,
  ShieldOff,
  Square
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useLocale } from "../../context/LocaleContext";
import Modal from "../common/Modal";
import Button from "../common/Button";
import Badge from "../common/Badge";
import type {
  DownloadMethod,
  DownloadOptions,
  DownloadPreparePayload,
  DownloadTask
} from "../../types";

type DownloadOptionsModalProps = {
  open: boolean;
  options: DownloadOptions | null;
  gameTitle?: string | null;
  gameImage?: string | null;
  gameIcon?: string | null;
  loading: boolean;
  error?: string | null;
  submitting?: boolean;
  submitError?: string | null;
  activeTask?: DownloadTask | null;
  onPauseTask?: (downloadId: string) => void;
  onResumeTask?: (downloadId: string) => void;
  onCancelTask?: (downloadId: string) => void;
  onClose: () => void;
  onSubmit: (payload: DownloadPreparePayload) => void;
};

const formatBytes = (value?: number | null) => {
  if (!value || value <= 0) return "Unknown";
  const gb = value / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = value / 1024 ** 2;
  return `${Math.round(mb)} MB`;
};

const isMethodEnabled = (method: DownloadMethod) => method.enabled !== false;

const getDefaultMethod = (options: DownloadOptions | null) => {
  if (!options) return "";
  const recommended = options.methods.find((method) => isMethodEnabled(method) && method.recommended);
  const first = options.methods.find((method) => isMethodEnabled(method)) || options.methods[0];
  return recommended?.id || first?.id || "";
};

const getDefaultVersion = (options: DownloadOptions | null) => {
  if (!options) return "";
  const latest = options.versions.find((version) => version.isLatest);
  return latest?.id || options.versions[0]?.id || "latest";
};

export default function DownloadOptionsModal({
  open,
  options,
  gameTitle,
  gameImage,
  gameIcon,
  loading,
  error,
  submitting,
  submitError,
  activeTask,
  onPauseTask,
  onResumeTask,
  onCancelTask,
  onClose,
  onSubmit
}: DownloadOptionsModalProps) {
  const { t } = useLocale();
  const [method, setMethod] = useState("");
  const [version, setVersion] = useState("latest");
  const [installPath, setInstallPath] = useState("");
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMethod((current) => current || getDefaultMethod(options));
    setVersion((current) => current || getDefaultVersion(options));
    setInstallPath((current) => current || options?.installRoot || "");
    setCreateSubfolder(true);
    setBrowseError(null);
  }, [open, options]);

  useEffect(() => {
    if (!options) return;
    if (method) return;
    setMethod(getDefaultMethod(options));
  }, [method, options]);

  useEffect(() => {
    if (!options) return;
    if (version) return;
    setVersion(getDefaultVersion(options));
  }, [options, version]);

  const versionSize = options?.versions.find((item) => item.id === version)?.sizeBytes;
  const requiredBytes = versionSize ?? options?.sizeBytes ?? null;
  const sizeLabel = options?.sizeLabel || formatBytes(requiredBytes);
  const freeLabel = formatBytes(options?.freeBytes);
  const totalLabel = formatBytes(options?.totalBytes);
  const hasSpace = requiredBytes && options?.freeBytes ? options.freeBytes >= requiredBytes : true;

  const finalPath = useMemo(() => {
    if (!options) return installPath;
    const basePath = installPath || options.installRoot;
    if (!createSubfolder) return basePath;
    return basePath ? `${basePath}\\${options.name}` : options.name;
  }, [createSubfolder, installPath, options]);

  const canToggleTask = activeTask && (activeTask.status === "downloading" || activeTask.status === "paused");
  const canStopTask =
    activeTask &&
    (activeTask.status === "queued" ||
      activeTask.status === "downloading" ||
      activeTask.status === "paused" ||
      activeTask.status === "verifying");

  const handleBrowse = async () => {
    setBrowseError(null);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false
      });
      if (typeof selected === "string") {
        setInstallPath(selected);
      }
    } catch (browseErr) {
      console.warn("Browse directory failed", browseErr);
      setBrowseError("Folder picker is available in the desktop app.");
    }
  };

  const handleSubmit = () => {
    if (!options) return;
    onSubmit({
      method,
      version,
      installPath: installPath || options.installRoot,
      createSubfolder
    });
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={t("download_options.title")} size="lg">
      {loading && <div className="glass-panel p-6 text-sm text-text-secondary">Loading options...</div>}
      {!loading && error && <div className="glass-panel p-6 text-sm text-accent-red">{error}</div>}
      {!loading && !error && options && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge label="Steam download" tone="secondary" />
            <p className="text-sm text-text-secondary">{options.name}</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Download method</p>
                <div className="space-y-2">
                  {options.methods.map((item) => {
                    const isDisabled = item.enabled === false;
                    return (
                      <label
                        key={item.id}
                        className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 text-sm transition ${
                          item.id === method
                            ? "border-primary bg-background-muted"
                            : "border-background-border bg-background-surface hover:border-primary/50"
                        } ${isDisabled ? "opacity-50" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="download-method"
                            value={item.id}
                            checked={method === item.id}
                            onChange={() => !isDisabled && setMethod(item.id)}
                            disabled={isDisabled}
                          />
                          <div>
                            <p className="text-sm font-semibold">{item.label}</p>
                            {item.description && <p className="text-xs text-text-muted">{item.description}</p>}
                            {isDisabled && item.note && <p className="text-xs text-accent-amber">{item.note}</p>}
                          </div>
                        </div>
                        {item.recommended && (
                          <span className="flex items-center gap-1 text-xs text-primary">
                            <CheckCircle2 size={14} /> Recommended
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Version</p>
                <select
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  className="input-field"
                  aria-label={t("download_options.version")}
                >
                  {options.versions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Install location</p>
                <div className="flex flex-wrap gap-3">
                  <input
                    value={installPath}
                    onChange={(event) => setInstallPath(event.target.value)}
                    placeholder={options.installRoot}
                    className="input-field flex-1"
                  />
                  <Button size="md" variant="secondary" icon={<FolderOpen size={16} />} onClick={handleBrowse}>
                    Browse
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={createSubfolder}
                    onChange={(event) => setCreateSubfolder(event.target.checked)}
                  />
                  Create a game subfolder automatically
                </label>
                <p className="text-xs text-text-muted">Final path: {finalPath}</p>
                {browseError && <p className="text-xs text-text-muted">{browseError}</p>}
              </div>

              {submitError && <p className="text-xs text-accent-red">{submitError}</p>}
            </div>

            <div className="space-y-4 lg:sticky lg:top-2 lg:self-start">
              <div className="glass-panel flex items-center gap-3 p-3">
                {gameIcon || gameImage ? (
                  <img
                    src={gameIcon || gameImage || ""}
                    alt={gameTitle || options.name}
                    className="h-16 w-16 rounded-lg border border-background-border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-lg border border-background-border bg-background-muted" />
                )}
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Preparing install</p>
                  <p className="truncate text-lg font-semibold text-text-primary">{gameTitle || options.name}</p>
                  <p className="truncate text-xs text-text-muted">{sizeLabel}</p>
                </div>
              </div>

              {activeTask && (
                <div className="glass-panel space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Current task</p>
                    <span className="text-xs text-text-secondary">{Math.round(activeTask.progress || 0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-background-muted">
                    <div
                      className="h-1.5 rounded-full bg-primary transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, activeTask.progress || 0))}%` }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={activeTask.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
                      disabled={!canToggleTask}
                      onClick={() => {
                        if (!activeTask) return;
                        if (activeTask.status === "paused") {
                          onResumeTask?.(activeTask.id);
                        } else {
                          onPauseTask?.(activeTask.id);
                        }
                      }}
                    >
                      {activeTask.status === "paused" ? "Resume" : "Pause"}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Square size={14} />}
                      disabled={!canStopTask}
                      onClick={() => activeTask && onCancelTask?.(activeTask.id)}
                    >
                      Stop
                    </Button>
                  </div>
                </div>
              )}

              <div className="glass-panel space-y-3 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-text-muted">
                  <HardDrive size={14} />
                  Storage
                </div>
                <div className="space-y-2 text-sm text-text-secondary">
                  <div className="flex items-center justify-between">
                    <span>Required</span>
                    <span className="text-text-primary">{sizeLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Free space</span>
                    <span className="text-text-primary">{freeLabel}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Total</span>
                    <span className="text-text-primary">{totalLabel}</span>
                  </div>
                </div>
                {!hasSpace && <p className="text-xs text-accent-red">Not enough free space for this download.</p>}
              </div>

              <div className="glass-panel space-y-3 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Fixes</p>
                <div className="space-y-3 text-sm text-text-secondary">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-emerald-400" />
                      <span>Online Fix</span>
                    </div>
                    <span>{options.onlineFix.length > 0 ? "Available" : "Not available"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldOff size={16} className="text-amber-400" />
                      <span>Bypass</span>
                    </div>
                    <span>{options.bypass ? "Available" : "Not available"}</span>
                  </div>
                  <div className="flex gap-3">
                    <Link to="/fixes/online" className="text-xs text-primary hover:underline">
                      Open Online Fix
                    </Link>
                    <Link to="/fixes/bypass" className="text-xs text-primary hover:underline">
                      Open Bypass
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-background-border pt-4">
            <p className="text-xs text-text-muted">
              Download size uses manifests when available, otherwise Steam requirements.
            </p>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!method || submitting || !hasSpace}>
                {submitting ? "Preparing..." : "Download"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
