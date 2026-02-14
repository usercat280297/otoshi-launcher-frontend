import { HardDrive, Pause, Play, ShieldCheck, Square } from "lucide-react";
import { useLocale } from "../../context/LocaleContext";
import { DownloadTask } from "../../types";
import { resolveDownloadAsset } from "../../services/asset_resolver";

const statusLabelKeys: Record<DownloadTask["status"], string> = {
  queued: "download.status.queued",
  downloading: "download.status.downloading",
  paused: "download.status.paused",
  verifying: "download.status.verifying",
  completed: "download.status.completed",
  failed: "download.status.failed",
  cancelled: "download.status.cancelled",
};

type DownloadCardProps = {
  task: DownloadTask;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  onCancel?: (id: string) => void;
};

const formatBytes = (value?: number) => {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
};

const formatRate = (value?: number) => {
  if (!value || value <= 0) return "0 B/s";
  return `${formatBytes(value)}/s`;
};

const normalizeSeries = (series: number[], target = 64) => {
  const cleaned = series.filter((value) => Number.isFinite(value) && value >= 0);
  if (!cleaned.length) {
    return new Array(target).fill(0);
  }
  if (cleaned.length >= target) {
    return cleaned.slice(cleaned.length - target);
  }
  const padded = new Array(target - cleaned.length).fill(0);
  return padded.concat(cleaned);
};

const toPolyline = (series: number[], width: number, height: number, maxValue: number) =>
  series
    .map((value, index) => {
      const x = (index / (series.length - 1 || 1)) * width;
      const y = height - (value / maxValue) * (height - 3);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

const Sparkline = ({
  points = [],
  networkBps = 0,
  readBps = 0,
  writeBps = 0,
}: {
  points?: number[];
  networkBps?: number;
  readBps?: number;
  writeBps?: number;
}) => {
  const networkSeries = normalizeSeries(points);
  const readRatio = networkBps > 0 ? Math.min(1.6, Math.max(0.12, readBps / networkBps)) : 0.18;
  const writeRatio = networkBps > 0 ? Math.min(1.6, Math.max(0.08, writeBps / networkBps)) : 0.14;
  const readSeries = networkSeries.map((value) => value * readRatio);
  const writeSeries = networkSeries.map((value) => value * writeRatio);

  const combined = [...networkSeries, ...readSeries, ...writeSeries];
  const max = Math.max(...combined, 1);
  const width = 320;
  const height = 46;

  const baseline = Array.from({ length: 12 }, (_, index) => (index / 11) * width);
  const networkPath = toPolyline(networkSeries, width, height, max);
  const readPath = toPolyline(readSeries, width, height, max);
  const writePath = toPolyline(writeSeries, width, height, max);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-11 w-full">
      {baseline.map((x, index) => (
        <line
          key={`grid-${index}`}
          x1={x}
          y1={height}
          x2={x}
          y2={height - 9}
          stroke="currentColor"
          strokeOpacity="0.16"
          strokeWidth="1"
          className="text-primary"
        />
      ))}
      <polyline
        fill="none"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={writePath}
        className="text-violet-300/70"
      />
      <polyline
        fill="none"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={readPath}
        className="text-emerald-300/75"
      />
      <polyline
        fill="none"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={networkPath}
        className="text-primary/90"
      />
    </svg>
  );
};

export default function DownloadCard({ task, onPause, onResume, onCancel }: DownloadCardProps) {
  const { t } = useLocale();
  const resolvedAsset = resolveDownloadAsset({
    gameId: task.gameId,
    gameSlug: task.gameSlug,
    appId: task.appId,
    title: task.title,
    imageUrl: task.imageUrl,
    iconUrl: task.iconUrl,
  });
  const backgroundImage = resolvedAsset.imageUrl || resolvedAsset.iconUrl;
  const cardImage = resolvedAsset.iconUrl || resolvedAsset.imageUrl;

  const isActive = task.status === "downloading" || task.status === "verifying";
  const canToggle = task.status === "downloading" || task.status === "paused";
  const canCancel =
    task.status === "queued" ||
    task.status === "downloading" ||
    task.status === "paused" ||
    task.status === "verifying";
  const progress = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
  const downloaded = task.downloadedBytes ?? 0;
  const total = task.totalBytes ?? 0;

  const handleToggle = () => {
    if (!canToggle) return;
    if (task.status === "paused") {
      onResume?.(task.id);
    } else {
      onPause?.(task.id);
    }
  };

  return (
    <div className="glass-panel relative space-y-4 overflow-hidden p-5">
      {isActive && backgroundImage ? (
        <div className="pointer-events-none absolute inset-0">
          <img
            src={backgroundImage}
            alt=""
            aria-hidden="true"
            className="h-full w-full scale-110 object-cover opacity-[0.22] blur-2xl"
            loading="lazy"
            onError={(event) => {
              const target = event.currentTarget;
              if (target.dataset.fallbackApplied === "1") {
                target.style.display = "none";
                return;
              }
              target.dataset.fallbackApplied = "1";
              target.src = "/icons/epic-games-shield.svg";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-background/75 via-background/88 to-background/94" />
        </div>
      ) : null}
      <div className="relative z-10 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {cardImage ? (
            <img
              src={cardImage}
              alt={resolvedAsset.title}
              className="h-14 w-14 flex-none rounded-lg border border-background-border object-cover"
              loading="lazy"
              onError={(event) => {
                const target = event.currentTarget;
                if (target.dataset.fallbackApplied === "1") {
                  target.style.display = "none";
                  return;
                }
                target.dataset.fallbackApplied = "1";
                target.src = "/icons/epic-games-shield.svg";
              }}
            />
          ) : (
            <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg border border-background-border bg-background-muted text-text-muted">
              <HardDrive size={16} />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
              {t(statusLabelKeys[task.status])}
            </p>
            <h3 className="truncate text-base font-semibold">{resolvedAsset.title}</h3>
            {task.appId ? (
              <p className="mt-0.5 text-xs text-text-muted">{t("downloads.appid")} {task.appId}</p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleToggle}
            className={`rounded-md border bg-background-muted p-2 text-text-secondary transition ${
              canToggle ? "border-background-border hover:border-primary" : "border-background-border opacity-40"
            }`}
            disabled={!canToggle}
            title={task.status === "paused" ? t("action.resume") : t("action.pause")}
          >
            {task.status === "paused" ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            onClick={() => onCancel?.(task.id)}
            className={`rounded-md border bg-background-muted p-2 text-text-secondary transition ${
              canCancel ? "border-background-border hover:border-accent-red hover:text-accent-red" : "border-background-border opacity-40"
            }`}
            disabled={!canCancel}
            title={t("downloads.stop")}
          >
            <Square size={14} />
          </button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>{progress}%</span>
          <span>{task.speed}</span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-background-muted">
          <div
            className={`h-2 rounded-full ${
              isActive ? "bg-primary" : "bg-success"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="grid gap-2 text-xs text-text-muted sm:grid-cols-2">
        <p>
          {formatBytes(downloaded)} / {formatBytes(total)}
        </p>
        <p className="sm:text-right">{t("downloads.eta")}: {task.eta}</p>
        <p>{t("downloads.network")}: {formatRate(task.networkBps)}</p>
        <p className="sm:text-right">{t("downloads.read")}: {formatRate(task.diskReadBps)}</p>
        <p>{t("downloads.write")}: {formatRate(task.diskWriteBps)}</p>
        <p className="sm:text-right">{task.remainingBytes ? `${formatBytes(task.remainingBytes)} ${t("downloads.remaining")}` : " "}</p>
      </div>

      <div className="rounded-lg border border-background-border bg-background-muted/40 px-3 py-2">
        <Sparkline
          points={task.speedHistory}
          networkBps={task.networkBps}
          readBps={task.diskReadBps}
          writeBps={task.diskWriteBps}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span className="flex items-center gap-1">
          <ShieldCheck size={12} /> {t("downloads.secure_cdn")}
        </span>
        <span>{t("downloads.realtime_telemetry")}</span>
      </div>
      </div>
    </div>
  );
}
