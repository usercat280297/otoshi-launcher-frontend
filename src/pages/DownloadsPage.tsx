import DownloadCard from "../components/downloads/DownloadCard";
import { useLocale } from "../context/LocaleContext";
import { useDownloads } from "../hooks/useDownloads";

const ACTIVE_STATUSES = new Set(["queued", "downloading", "verifying", "paused"]);

export default function DownloadsPage() {
  const { t } = useLocale();
  const { tasks, loading, error, pause, resume, cancel, activeCount } = useDownloads();

  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const recentTasks = tasks.filter((task) => !ACTIVE_STATUSES.has(task.status));
  const totalSpeedMbps = activeTasks.reduce((sum, task) => {
    const value = Number(task.speedMbps ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-semibold">{t("downloads.title")}</h2>
        <p className="text-text-secondary">
          {t("downloads.subtitle")}
        </p>
      </div>

      {error && (
        <div className="glass-panel p-4 text-sm text-text-secondary">{error}</div>
      )}

      {!loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="glass-panel p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-text-muted">{t("downloads.active_queue")}</p>
            <p className="mt-2 text-2xl font-semibold">{activeCount}</p>
          </div>
          <div className="glass-panel p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-text-muted">{t("downloads.recent_finished")}</p>
            <p className="mt-2 text-2xl font-semibold">
              {recentTasks.filter((task) => task.status === "completed").length}
            </p>
          </div>
          <div className="glass-panel p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-text-muted">{t("downloads.current_throughput")}</p>
            <p className="mt-2 text-2xl font-semibold">{totalSpeedMbps.toFixed(2)} MB/s</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="glass-panel p-6 text-sm text-text-secondary">
          {t("downloads.fetching_queue")}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            {activeTasks.length === 0 ? (
              <div className="glass-panel p-6 text-sm text-text-secondary">
                {t("downloads.empty_queue")}
              </div>
            ) : (
              activeTasks.map((task) => (
                <DownloadCard
                  key={task.id}
                  task={task}
                  onPause={pause}
                  onResume={resume}
                  onCancel={cancel}
                />
              ))
            )}

            {recentTasks.length > 0 ? (
              <div className="space-y-3 pt-2">
                <p className="px-1 text-xs uppercase tracking-[0.3em] text-text-muted">{t("downloads.recent_activity")}</p>
                {recentTasks.slice(0, 6).map((task) => (
                  <DownloadCard
                    key={task.id}
                    task={task}
                    onPause={pause}
                    onResume={resume}
                    onCancel={cancel}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="glass-panel space-y-4 p-6">
            <h3 className="section-title">{t("downloads.network_pulse")}</h3>
            <div className="space-y-3 text-sm text-text-secondary">
              <div className="flex items-center justify-between">
                <span>{t("downloads.active_lanes")}</span>
                <span className="text-text-primary">8</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("downloads.peak_throughput")}</span>
                <span className="text-text-primary">1.4 Gbps</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("downloads.patch_efficiency")}</span>
                <span className="text-text-primary">73%</span>
              </div>
            </div>
            <div className="glass-card p-4 text-sm text-text-secondary">
              {t("downloads.cdn_auto_edge")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
