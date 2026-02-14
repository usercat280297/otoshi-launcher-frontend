import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import { DownloadTask } from "../types";
import * as api from "../services/api";
import { rememberDownloadAsset, resolveDownloadAsset } from "../services/asset_resolver";

type LocalDownloadRow = {
  id: string;
  game_id: string;
  status: string;
  progress: number;
  speed_mbps: number;
  eta_minutes: number;
  downloaded_bytes?: number;
  total_bytes?: number;
  network_bps?: number;
  disk_read_bps?: number;
  disk_write_bps?: number;
  read_bytes?: number;
  written_bytes?: number;
  remaining_bytes?: number;
  speed_history?: number[];
  updated_at: number;
};

type DownloadMeta = Pick<DownloadTask, "title" | "gameSlug" | "appId" | "imageUrl" | "iconUrl">;
type DownloadMetaCache = Record<string, DownloadMeta>;

const DOWNLOAD_META_CACHE_KEY = "otoshi.download.meta.v2";
const ACTIVE_STATUSES = new Set<DownloadTask["status"]>(["queued", "downloading", "verifying", "paused"]);
const DOWNLOAD_SNAPSHOT_DEDUPE_MS = 1800;
const RUNTIME_ERROR_GRACE_MS = 10000;

const statusOrder: Record<DownloadTask["status"], number> = {
  downloading: 0,
  verifying: 1,
  queued: 2,
  paused: 3,
  failed: 4,
  completed: 5,
  cancelled: 6,
};

const readMetaCache = (): DownloadMetaCache => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DOWNLOAD_META_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as DownloadMetaCache;
  } catch {
    return {};
  }
};

const writeMetaCache = (cache: DownloadMetaCache) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DOWNLOAD_META_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage write failures.
  }
};

const normalizeSpeed = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 MB/s";
  return `${value.toFixed(2)} MB/s`;
};

const parseAppIdFromSlug = (slug?: string | null): string | undefined => {
  if (!slug) return undefined;
  const matched = /^steam-(\d+)$/i.exec(String(slug).trim());
  return matched?.[1];
};

const looksLikeIdentifier = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (/^\d{3,}$/.test(normalized)) return true;
  if (/^steam-\d+$/.test(normalized)) return true;
  if (/^[0-9a-f-]{24,}$/.test(normalized)) return true;
  return false;
};

const normalizeStatus = (value?: string): DownloadTask["status"] => {
  switch ((value || "").toLowerCase()) {
    case "downloading":
      return "downloading";
    case "paused":
      return "paused";
    case "verifying":
      return "verifying";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "queued";
  }
};

const fetchLocalDownloadsRaw = async (): Promise<LocalDownloadRow[]> => {
  if (!isTauriRuntime()) {
    return [];
  }
  try {
    const rows = await invoke<LocalDownloadRow[]>("get_cached_downloads");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

type DownloadSnapshot = {
  remote: DownloadTask[];
  local: LocalDownloadRow[];
};

let sharedSnapshotInFlight: Promise<DownloadSnapshot> | null = null;
let sharedSnapshotCache: DownloadSnapshot = { remote: [], local: [] };
let sharedSnapshotAt = 0;
let sharedSnapshotTokenKey = "";

const loadDownloadSnapshot = async (token?: string | null): Promise<DownloadSnapshot> => {
  const now = Date.now();
  const tokenKey = token || "";
  if (
    !sharedSnapshotInFlight &&
    sharedSnapshotTokenKey === tokenKey &&
    now - sharedSnapshotAt < DOWNLOAD_SNAPSHOT_DEDUPE_MS
  ) {
    return sharedSnapshotCache;
  }

  if (sharedSnapshotInFlight) {
    return sharedSnapshotInFlight;
  }

  sharedSnapshotInFlight = Promise.all([
    token ? api.fetchDownloads(token) : Promise.resolve([]),
    fetchLocalDownloadsRaw(),
  ])
    .then(([remote, local]) => {
      const snapshot: DownloadSnapshot = { remote, local };
      sharedSnapshotCache = snapshot;
      sharedSnapshotAt = Date.now();
      sharedSnapshotTokenKey = tokenKey;
      return snapshot;
    })
    .finally(() => {
      sharedSnapshotInFlight = null;
    });

  return sharedSnapshotInFlight;
};

const mergeMetadata = (existing?: DownloadTask, incoming?: Partial<DownloadTask>): DownloadMeta => {
  const titleCandidate = incoming?.title?.trim();
  const existingTitle = existing?.title?.trim();
  const title =
    titleCandidate && !looksLikeIdentifier(titleCandidate)
      ? titleCandidate
      : existingTitle && !looksLikeIdentifier(existingTitle)
        ? existingTitle
        : titleCandidate || existingTitle || "Download";

  return {
    title,
    gameSlug: incoming?.gameSlug || existing?.gameSlug,
    appId: incoming?.appId || existing?.appId || parseAppIdFromSlug(incoming?.gameSlug || existing?.gameSlug),
    imageUrl: incoming?.imageUrl || existing?.imageUrl,
    iconUrl: incoming?.iconUrl || existing?.iconUrl || incoming?.imageUrl || existing?.imageUrl,
  };
};

const mapLocalRow = (
  row: LocalDownloadRow,
  fallback?: Partial<DownloadTask>
): DownloadTask => {
  const metadata = mergeMetadata(undefined, fallback);
  const normalizedStatus = normalizeStatus(row.status);
  const speedMbps = Number(row.speed_mbps ?? 0);
  const networkBps = Number(row.network_bps ?? 0);
  const speedHistory = Array.isArray(row.speed_history)
    ? row.speed_history.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  return {
    id: row.id,
    title: metadata.title || row.game_id || "Download",
    progress: Number.isFinite(row.progress) ? Math.max(0, Math.min(100, row.progress)) : 0,
    speed: normalizeSpeed(speedMbps > 0 ? speedMbps : networkBps / (1024 * 1024)),
    speedMbps: Number.isFinite(speedMbps) ? speedMbps : 0,
    status: normalizedStatus,
    eta:
      row.eta_minutes && row.eta_minutes > 0
        ? `${row.eta_minutes} min`
        : normalizedStatus === "completed"
          ? "Done"
          : "--",
    etaMinutes: Number.isFinite(row.eta_minutes) ? row.eta_minutes : 0,
    gameId: row.game_id,
    gameSlug: metadata.gameSlug,
    appId: metadata.appId,
    imageUrl: metadata.imageUrl,
    iconUrl: metadata.iconUrl,
    downloadedBytes: Number.isFinite(row.downloaded_bytes as number)
      ? Number(row.downloaded_bytes)
      : fallback?.downloadedBytes,
    totalBytes: Number.isFinite(row.total_bytes as number)
      ? Number(row.total_bytes)
      : fallback?.totalBytes,
    networkBps: Number.isFinite(networkBps) ? networkBps : 0,
    diskReadBps: Number.isFinite(row.disk_read_bps as number) ? Number(row.disk_read_bps) : 0,
    diskWriteBps: Number.isFinite(row.disk_write_bps as number) ? Number(row.disk_write_bps) : 0,
    readBytes: Number.isFinite(row.read_bytes as number) ? Number(row.read_bytes) : 0,
    writtenBytes: Number.isFinite(row.written_bytes as number) ? Number(row.written_bytes) : 0,
    remainingBytes: Number.isFinite(row.remaining_bytes as number) ? Number(row.remaining_bytes) : undefined,
    speedHistory,
    updatedAt: Number.isFinite(row.updated_at) ? row.updated_at : undefined,
  };
};

const mergeDownloads = (
  remote: DownloadTask[],
  local: LocalDownloadRow[],
  previous: DownloadTask[],
  metaCache: DownloadMetaCache
): DownloadTask[] => {
  const byId = new Map<string, DownloadTask>();
  const byGameId = new Map<string, DownloadMeta>();
  const byAppId = new Map<string, DownloadMeta>();

  for (const task of previous) {
    const metadata = mergeMetadata(undefined, task);
    byId.set(task.id, task);
    if (task.gameId) byGameId.set(task.gameId, metadata);
    if (metadata.appId) byAppId.set(metadata.appId, metadata);
  }

  for (const task of remote) {
    const existing = byId.get(task.id);
    const metadata = mergeMetadata(existing, task);
    const mergedTask: DownloadTask = {
      ...task,
      ...metadata,
      progress: Number.isFinite(task.progress) ? Math.max(0, Math.min(100, task.progress)) : 0,
      speed: task.speed || existing?.speed || "0 MB/s",
      eta: task.eta || existing?.eta || "--",
      gameId: task.gameId || existing?.gameId || "",
      appId: task.appId || metadata.appId,
    };
    byId.set(task.id, mergedTask);
    if (mergedTask.gameId) byGameId.set(mergedTask.gameId, metadata);
    if (metadata.appId) byAppId.set(metadata.appId, metadata);
  }

  for (const row of local) {
    const existing = byId.get(row.id);
    const cachedByGame = byGameId.get(row.game_id) || metaCache[row.game_id];
    const cachedByApp = byAppId.get(row.game_id);
    const localTask = mapLocalRow(row, {
      ...existing,
      ...(cachedByGame || {}),
      ...(cachedByApp || {}),
      appId: existing?.appId || cachedByApp?.appId || row.game_id,
    });

    if (!existing) {
      byId.set(row.id, localTask);
      continue;
    }

    const metadata = mergeMetadata(existing, localTask);
    byId.set(row.id, {
      ...existing,
      ...metadata,
      status: localTask.status,
      progress:
        localTask.status === "downloading" || localTask.status === "verifying"
          ? Math.max(existing.progress || 0, localTask.progress || 0)
          : localTask.progress || existing.progress,
      speed: localTask.speed || existing.speed,
      speedMbps: localTask.speedMbps ?? existing.speedMbps,
      eta: localTask.eta || existing.eta,
      etaMinutes: localTask.etaMinutes ?? existing.etaMinutes,
      gameId: existing.gameId || localTask.gameId,
      appId: existing.appId || localTask.appId || metadata.appId,
      downloadedBytes: localTask.downloadedBytes ?? existing.downloadedBytes,
      totalBytes: localTask.totalBytes ?? existing.totalBytes,
      networkBps: localTask.networkBps ?? existing.networkBps,
      diskReadBps: localTask.diskReadBps ?? existing.diskReadBps,
      diskWriteBps: localTask.diskWriteBps ?? existing.diskWriteBps,
      readBytes: localTask.readBytes ?? existing.readBytes,
      writtenBytes: localTask.writtenBytes ?? existing.writtenBytes,
      remainingBytes: localTask.remainingBytes ?? existing.remainingBytes,
      speedHistory:
        localTask.speedHistory && localTask.speedHistory.length > 0
          ? localTask.speedHistory
          : existing.speedHistory,
      updatedAt: localTask.updatedAt ?? existing.updatedAt,
    });
  }

  return Array.from(byId.values()).map((task) => {
    const resolved = resolveDownloadAsset({
      gameId: task.gameId,
      gameSlug: task.gameSlug,
      appId: task.appId,
      title: task.title,
      imageUrl: task.imageUrl,
      iconUrl: task.iconUrl,
    });
    const normalizedTask: DownloadTask = {
      ...task,
      title: resolved.title,
      imageUrl: resolved.imageUrl,
      iconUrl: resolved.iconUrl,
    };
    rememberDownloadAsset({
      gameId: normalizedTask.gameId,
      gameSlug: normalizedTask.gameSlug,
      appId: normalizedTask.appId,
      title: normalizedTask.title,
      imageUrl: normalizedTask.imageUrl,
      iconUrl: normalizedTask.iconUrl,
    });
    return normalizedTask;
  }).sort((a, b) => {
    const aOrder = statusOrder[a.status] ?? 99;
    const bOrder = statusOrder[b.status] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (b.progress ?? 0) - (a.progress ?? 0);
  });
};

export function useDownloads() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousStatusesRef = useRef<Map<string, DownloadTask["status"]>>(new Map());
  const runtimeErrorMarksRef = useRef<Map<string, number>>(new Map());
  const tasksRef = useRef<DownloadTask[]>([]);
  const metaCacheRef = useRef<DownloadMetaCache>(readMetaCache());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const updateMetaCache = useCallback((nextTasks: DownloadTask[]) => {
    const next: DownloadMetaCache = { ...metaCacheRef.current };
    for (const task of nextTasks) {
      const metadata: DownloadMeta = {
        title: task.title,
        gameSlug: task.gameSlug,
        appId: task.appId || parseAppIdFromSlug(task.gameSlug),
        imageUrl: task.imageUrl,
        iconUrl: task.iconUrl || task.imageUrl,
      };
      if (task.gameId) {
        next[task.gameId] = metadata;
      }
      if (metadata.appId) {
        next[metadata.appId] = metadata;
      }
      if (task.gameSlug) {
        next[task.gameSlug] = metadata;
      }
    }
    metaCacheRef.current = next;
    writeMetaCache(next);
  }, []);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const { remote, local } = await loadDownloadSnapshot(token);
      const merged = mergeDownloads(
        remote,
        local,
        tasksRef.current,
        metaCacheRef.current
      );
      const nextStatuses = new Map<string, DownloadTask["status"]>();

      for (const task of merged) {
        const previous = previousStatusesRef.current.get(task.id);
        if (previous && previous !== task.status) {
          if (task.status === "failed") {
            const now = Date.now();
            const keys = [task.id, task.gameId, task.gameSlug]
              .map((value) => String(value || "").trim())
              .filter((value) => value.length > 0);
            const hasRecentRuntimeError = keys.some((key) => {
              const markedAt = runtimeErrorMarksRef.current.get(key);
              if (!markedAt) return false;
              const active = now - markedAt <= RUNTIME_ERROR_GRACE_MS;
              if (!active) {
                runtimeErrorMarksRef.current.delete(key);
              }
              return active;
            });
            if (!hasRecentRuntimeError) {
              window.dispatchEvent(
                new CustomEvent("otoshi:download-error", {
                  detail: { message: `${task.title}: download failed.`, iconUrl: task.iconUrl || task.imageUrl },
                })
              );
            }
          } else if (task.status === "completed") {
            window.dispatchEvent(
              new CustomEvent("otoshi:download-started", {
                detail: { title: `${task.title} completed`, iconUrl: task.iconUrl || task.imageUrl },
              })
            );
          }
        }
        nextStatuses.set(task.id, task.status);
      }

      previousStatusesRef.current = nextStatuses;
      setTasks(merged);
      updateMetaCache(merged);
      setError(null);
    } catch (err: any) {
      if (!options?.silent) {
        setError(err.message || "Failed to load downloads");
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [token]);

  const start = useCallback(
    async (gameId: string) => {
      if (!token) {
        throw new Error("Not authenticated");
      }
      const task = await api.startDownload(gameId, token);
      setTasks((prev) => {
        const existing = prev.find((item) => item.id === task.id);
        const mergedTask = existing ? { ...existing, ...task } : task;
        const next = existing
          ? prev.map((item) => (item.id === task.id ? mergedTask : item))
          : [mergedTask, ...prev];
        updateMetaCache(next);
        if (existing) {
          return next;
        }
        return next;
      });
      window.dispatchEvent(
        new CustomEvent("otoshi:download-started", {
          detail: { title: task.title, iconUrl: task.iconUrl || task.imageUrl },
        })
      );
      return task;
    },
    [token, updateMetaCache]
  );

  const pause = useCallback(
    async (downloadId: string) => {
      const current = tasksRef.current.find((task) => task.id === downloadId);
      if (isTauriRuntime() && !current?.sessionId) {
        await invoke("pause_download", { downloadId });
      } else {
        if (!token) throw new Error("Not authenticated");
        await api.pauseDownload(downloadId, token);
      }
      refresh({ silent: true });
    },
    [token, refresh]
  );

  const resume = useCallback(
    async (downloadId: string) => {
      const current = tasksRef.current.find((task) => task.id === downloadId);
      if (isTauriRuntime() && !current?.sessionId) {
        await invoke("resume_download", { downloadId });
      } else {
        if (!token) throw new Error("Not authenticated");
        await api.resumeDownload(downloadId, token);
      }
      refresh({ silent: true });
    },
    [token, refresh]
  );

  const cancel = useCallback(
    async (downloadId: string) => {
      const current = tasksRef.current.find((task) => task.id === downloadId);
      if (isTauriRuntime() && !current?.sessionId) {
        await invoke("cancel_download", { downloadId });
      } else {
        if (!token) throw new Error("Not authenticated");
        await api.cancelDownload(downloadId, token);
      }
      refresh({ silent: true });
    },
    [token, refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      refresh({ silent: true });
    }, 1200);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      void refresh({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    const onDownloadError = (
      event: Event
    ) => {
      const detail = (
        event as CustomEvent<{
          downloadId?: string;
          gameId?: string;
          slug?: string;
        }>
      ).detail;
      const markedAt = Date.now();
      for (const key of [detail?.downloadId, detail?.gameId, detail?.slug]) {
        const normalized = String(key || "").trim();
        if (!normalized) continue;
        runtimeErrorMarksRef.current.set(normalized, markedAt);
      }
    };

    window.addEventListener("otoshi:download-error", onDownloadError as EventListener);
    return () => {
      window.removeEventListener("otoshi:download-error", onDownloadError as EventListener);
    };
  }, []);

  const activeTasks = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
  const activeCount = activeTasks.length;
  const activeTask =
    activeTasks.find((task) => task.status === "downloading" || task.status === "verifying") ||
    activeTasks[0] ||
    null;

  return {
    tasks,
    activeTasks,
    activeCount,
    activeTask,
    loading,
    error,
    refresh,
    start,
    pause,
    resume,
    cancel,
  };
}
