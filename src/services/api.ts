import {
  AnimeDetail,
  AnimeEpisodeSource,
  AnimeHome,
  AnimeItem,
  ActivityEvent,
  AuthUser,
  Bundle,
  CommunityComment,
  DeveloperAnalytics,
  DeveloperBuild,
  DeveloperDepot,
  DlcItem,
  DownloadTask,
  DownloadOptions,
  DownloadPreparePayload,
  FixCatalog,
  FixEntryDetail,
  FixEntry,
  FixOption,
  Game,
  GraphicsConfig,
  InventoryItem,
  LibraryEntry,
  LaunchConfig,
  OAuthProvider,
  Preorder,
  PerformanceSnapshot,
  RemoteDownload,
  Review,
  SearchHistoryItem,
  SignedLicense,
  SteamCatalogItem,
  SteamGameDetail,
  SteamGridDBAsset,
  SteamPrice,
  SystemRequirements,
  ImageQualityMode,
  PropertiesCloudSyncResult,
  PropertiesDlcState,
  PropertiesInstallInfo,
  PropertiesLaunchOptions,
  PropertiesMoveResult,
  PropertiesSaveLocations,
  PropertiesVerifyResult,
  SteamIndexAssetInfo,
  SteamIndexAssetPrefetchResult,
  SteamIndexCoverage,
  SteamIndexCompletionResult,
  SteamIndexIngestRebuildResult,
  SteamIndexIngestStatus,
  RuntimeHealth,
  AsmCpuCapabilities,
  RuntimeTuningApplyResult,
  RuntimeTuningProfile,
  RuntimeTuningRecommendation,
  TradeOffer,
  UserProfile,
  WishlistEntry,
  WorkshopItem,
  LocalWorkshopInstall,
  WorkshopSubscription,
  WorkshopVersion,
  WorkshopSyncResult
} from "../types";

import { isTauri as isTauriRuntimeFn } from "@tauri-apps/api/core";

// Local alias used throughout the file.
// Some tooling expects an `isTauri` identifier, so we expose it here.
const isTauri = isTauriRuntimeFn;

const isDev = Boolean(import.meta.env.DEV);
const isDesktop = isTauri();
const debugLog = (...args: unknown[]) => {
  if (isDev) {
    console.log(...args);
  }
};

const normalizeApiBase = (base: string): string =>
  String(base || "").trim().replace(/\/+$/, "");

const resolveDevWebBase = (): string => {
  const port = String(BACKEND_PORT || "8000");
  if (typeof window !== "undefined") {
    const host = String(window.location.hostname || "").trim().toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") {
      return `http://${host}:${port}`;
    }
  }
  return `http://127.0.0.1:${port}`;
};

// Default backend port is 8000 (primary).
const BACKEND_PORT = import.meta.env.VITE_BACKEND_PORT || import.meta.env.BACKEND_PORT;
const desktopDefaultBase = BACKEND_PORT
  ? `http://127.0.0.1:${BACKEND_PORT}`
  : "http://127.0.0.1:8000";
const desktopApiBase =
  import.meta.env.VITE_DESKTOP_API_URL || desktopDefaultBase;
const webApiBase =
  import.meta.env.VITE_API_URL || (isDev ? resolveDevWebBase() : "");
const API_URL = isDesktop ? desktopApiBase : webApiBase;

const toLocalFallbacks = (base: string): string[] => {
  const trimmed = normalizeApiBase(base);
  if (!trimmed) return [];
  const out = [trimmed];
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    // Desktop can tolerate localhost/127 differences on the same resolved runtime port.
    // Web dev should stay pinned to a single host to avoid noisy CORS/connection churn.
    if (isDesktop && (host === "127.0.0.1" || host === "localhost")) {
      const alternateHost = host === "127.0.0.1" ? "localhost" : "127.0.0.1";
      out.push(`${u.protocol}//${alternateHost}:${port}`);
    }
  } catch {
    // ignore malformed base values
  }
  return Array.from(new Set(out.map(normalizeApiBase).filter(Boolean)));
};

const envFallbackBases = String(import.meta.env.VITE_API_FALLBACKS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const desktopFallbackBases = isDesktop
  ? Array.from(
      new Set([
        ...toLocalFallbacks(desktopApiBase),
        ...envFallbackBases.flatMap(toLocalFallbacks)
      ])
    )
  : [];
const webFallbackBases = Array.from(
  new Set([
    ...toLocalFallbacks(API_URL),
    ...envFallbackBases.flatMap(toLocalFallbacks)
  ])
);
const API_FALLBACKS = isDesktop ? desktopFallbackBases : webFallbackBases;
const API_BASES = Array.from(new Set(API_FALLBACKS.filter(Boolean)));
if (!API_BASES.length && !isDev) {
  console.warn("[API] VITE_API_URL is not set; API calls will fail in production.");
}
// Tauri v2 does not guarantee `window.__TAURI__`.
// Use the official runtime check.

let resolvedApiBase: string | null = null;
let runtimeBaseResolved = false;
const MIN_COMPATIBLE_CDN_CHUNK_LIMIT_BYTES = 100 * 1024 * 1024;
const API_HEALTH_TIMEOUT_MS = 1500;
const API_RUNTIME_READY_CACHE_MS = 15_000;
const API_RUNTIME_READY_ATTEMPTS = 18;
const API_RUNTIME_READY_DELAY_MS = 250;
let runtimeReadyCheckedAt = 0;
let runtimeReadyPromise: Promise<void> | null = null;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function parseNumericLike(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseProbeLimit(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const detail = (payload as { detail?: unknown }).detail;
  if (!Array.isArray(detail)) return null;
  for (const item of detail) {
    if (!item || typeof item !== "object") continue;
    const loc = (item as { loc?: unknown }).loc;
    const mentionsSize = Array.isArray(loc)
      ? loc.some((part) => part === "size")
      : false;
    if (!mentionsSize) continue;
    const ctx = (item as { ctx?: unknown }).ctx;
    if (!ctx || typeof ctx !== "object") continue;
    const lt = (ctx as { lt?: unknown }).lt;
    const parsed = parseNumericLike(lt);
    if (parsed !== null) return parsed;
  }
  return null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_HEALTH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function probeDesktopBaseCompatibility(base: string): Promise<{
  base: string;
  ok: boolean;
  compatible: boolean;
  observedLimit: number | null;
}> {
  const normalized = base.replace(/\/+$/, "");
  try {
    const health = await fetchWithTimeout(`${normalized}/health`);
    if (!health.ok) {
      return { base: normalized, ok: false, compatible: false, observedLimit: null };
    }

    let observedLimit: number | null = null;
    try {
      const healthJson = await health.json();
      if (healthJson && typeof healthJson === "object") {
        observedLimit = parseNumericLike(
          (healthJson as { cdn_chunk_size_limit_bytes?: unknown }).cdn_chunk_size_limit_bytes
        );
      }
    } catch {
      // Ignore JSON decode errors from health endpoint.
    }

    if (observedLimit === null) {
      try {
        const probe = await fetchWithTimeout(
          `${normalized}/cdn/chunks/_probe/_probe/0?size=2147483649`
        );
        if (probe.status === 422) {
          const probeJson = await probe.json().catch(() => null);
          const probeLimit = parseProbeLimit(probeJson);
          if (probeLimit !== null) {
            observedLimit = probeLimit;
          }
        }
      } catch {
        // Probe can fail on some older builds; keep health result.
      }
    }

    const compatible =
      observedLimit === null ||
      observedLimit >= MIN_COMPATIBLE_CDN_CHUNK_LIMIT_BYTES;
    return { base: normalized, ok: true, compatible, observedLimit };
  } catch {
    return { base: normalized, ok: false, compatible: false, observedLimit: null };
  }
}

async function selectBestDesktopApiBase() {
  if (!isDesktop || !API_BASES.length) return;
  const candidates = Array.from(
    new Set(
      (resolvedApiBase ? [resolvedApiBase] : API_BASES).filter(Boolean)
    )
  );
  if (!candidates.length) return;

  const probeResults = await Promise.all(candidates.map((base) => probeDesktopBaseCompatibility(base)));
  const current = resolvedApiBase
    ? probeResults.find((result) => result.base === resolvedApiBase)
    : null;
  const compatible = probeResults.find((result) => result.ok && result.compatible);
  const healthy = probeResults.find((result) => result.ok);

  if (current?.ok && current.compatible) {
    return;
  }
  if (compatible) {
    if (resolvedApiBase !== compatible.base) {
      resolvedApiBase = compatible.base;
      debugLog("[API] Selected compatible desktop backend:", compatible.base, {
        observedLimit: compatible.observedLimit
      });
    }
    return;
  }
  if (!resolvedApiBase && healthy) {
    resolvedApiBase = healthy.base;
    console.warn("[API] No compatibility signal found; using healthy backend:", healthy.base);
  }
}

async function ensureDesktopRuntimeApiBase() {
  if (!isDesktop || runtimeBaseResolved) return;
  runtimeBaseResolved = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const runtimeBase = await invoke<string>("get_runtime_api_base");
    if (runtimeBase && /^https?:\/\//i.test(runtimeBase)) {
      resolvedApiBase = runtimeBase.replace(/\/+$/, "");
      debugLog("[API] Runtime base resolved from Tauri:", resolvedApiBase);
    }
  } catch (error) {
    console.warn("[API] Runtime base discovery failed, using probes/fallbacks.", error);
  } finally {
    await selectBestDesktopApiBase();
  }
}

async function probeRuntimeHealth(base: string): Promise<RuntimeHealth | null> {
  const normalized = base.replace(/\/+$/, "");
  try {
    const response = await fetchWithTimeout(`${normalized}/health/runtime`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || typeof data !== "object") return null;
    return {
      status: String((data as any).status ?? "unknown"),
      sidecarReady: Boolean((data as any).sidecar_ready ?? false),
      runtimeMode: (data as any).runtime_mode ?? null,
      indexMode: (data as any).index_mode ?? null,
      globalIndexV1: Boolean((data as any).global_index_v1 ?? false),
      dbPath: (data as any).db_path ?? null,
      dbExists: Boolean((data as any).db_exists ?? false),
      ingestState: (data as any).ingest_state ?? null,
      lastError: (data as any).last_error ?? null,
    };
  } catch {
    return null;
  }
}

async function ensureDesktopRuntimeReady() {
  if (!isDesktop) return;
  const now = Date.now();
  if (now - runtimeReadyCheckedAt < API_RUNTIME_READY_CACHE_MS) {
    return;
  }
  if (runtimeReadyPromise) {
    return runtimeReadyPromise;
  }

  runtimeReadyPromise = (async () => {
    await ensureDesktopRuntimeApiBase();

    const candidates = Array.from(
      new Set(
        (resolvedApiBase ? [resolvedApiBase] : API_BASES).filter(Boolean)
      )
    );
    if (!candidates.length) {
      runtimeReadyCheckedAt = Date.now();
      return;
    }

    for (let attempt = 0; attempt < API_RUNTIME_READY_ATTEMPTS; attempt += 1) {
      for (const base of candidates) {
        const health = await probeRuntimeHealth(base);
        if (health?.sidecarReady) {
          resolvedApiBase = base.replace(/\/+$/, "");
          runtimeReadyCheckedAt = Date.now();
          return;
        }
      }
      await sleep(API_RUNTIME_READY_DELAY_MS);
    }

    // keep requests moving even if runtime health endpoint is unavailable
    runtimeReadyCheckedAt = Date.now();
  })().finally(() => {
    runtimeReadyPromise = null;
  });

  return runtimeReadyPromise;
}

export const getPreferredApiBase = () =>
  resolvedApiBase || API_BASES[0] || (isDev ? normalizeApiBase(webApiBase || desktopDefaultBase) : "");

export function getApiDebugInfo() {
  return {
    preferredBase: getPreferredApiBase(),
    resolvedBase: resolvedApiBase,
    runtimeReadyCheckedAt,
    bases: API_BASES,
    isDev
  };
}

const RETRY_PATHS = ["/steam", "/steamgriddb"];
const shouldRetry = (path: string, status?: number) => {
  if (!RETRY_PATHS.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  if (typeof status !== "number") {
    return true;
  }
  return status >= 500 || status === 429 || status === 408;
};

class ApiHttpError extends Error {
  status?: number;
  retryable: boolean;
  code?: string;
  constructor(message: string, status?: number, retryable = false, code?: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

type ParsedApiError = {
  message: string;
  code?: string;
};

function parseApiError(rawBody: string): ParsedApiError {
  const fallback: ParsedApiError = {
    message: rawBody || "Request failed",
  };

  if (!rawBody) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object") {
      return fallback;
    }

    const detail = (parsed as { detail?: unknown }).detail;
    if (typeof detail === "string") {
      return { message: detail };
    }
    if (detail && typeof detail === "object") {
      const detailObj = detail as { message?: unknown; code?: unknown };
      return {
        message:
          typeof detailObj.message === "string" && detailObj.message.trim().length > 0
            ? detailObj.message
            : fallback.message,
        code: typeof detailObj.code === "string" ? detailObj.code : undefined,
      };
    }

    const message = (parsed as { message?: unknown }).message;
    if (typeof message === "string") {
      return { message };
    }

    return fallback;
  } catch {
    return fallback;
  }
}

const isNetworkLikeError = (err: unknown) => {
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : String(err || "");
  const lower = message.toLowerCase();
  return (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("connection refused") ||
    lower.includes("load failed") ||
    lower.includes("aborted")
  );
};

const HF_UNAVAILABLE_CODES = new Set(["hf_manifest_missing", "hf_repo_not_configured"]);

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return String(error || "");
};

const extractErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
};

export function resolveDownloadErrorI18nKey(error: unknown): string {
  const code = extractErrorCode(error);
  if (code && HF_UNAVAILABLE_CODES.has(code)) {
    return "download.error.game_not_updated";
  }

  const message = extractErrorMessage(error).toLowerCase();
  if (message.includes("authentication required") || message.includes("please login") || message.includes("401")) {
    return "download.error.auth_required";
  }
  if (message.includes("security policy blocked") || message.includes("debugger") || message.includes("reverse engineering")) {
    return "download.error.security_blocked";
  }
  if (
    message.includes("hf_manifest_missing") ||
    message.includes("hf_repo_not_configured") ||
    message.includes("manifest not available") ||
    message.includes("download method unavailable")
  ) {
    return "download.error.game_not_updated";
  }
  if (message.includes("method unavailable")) {
    return "download.error.method_unavailable";
  }
  return "download.error.start_failed";
}

const spotlightPalette = [
  "from-blue-500/30 to-cyan-300/20",
  "from-orange-500/30 to-amber-300/20",
  "from-emerald-400/30 to-sky-300/20",
  "from-slate-500/30 to-indigo-300/20"
];

const defaultRequirements: SystemRequirements = {
  minimum: {
    os: "Windows 10 64-bit",
    processor: "Intel i5-8400 / Ryzen 5 2600",
    memory: "12 GB RAM",
    graphics: "GTX 1060 / RX 580",
    storage: "80 GB SSD"
  },
  recommended: {
    os: "Windows 11 64-bit",
    processor: "Intel i7-12700K / Ryzen 7 5800X",
    memory: "16 GB RAM",
    graphics: "RTX 3070 / RX 6800",
    storage: "80 GB NVMe SSD"
  }
};

const steamGridCache = new Map<string, SteamGridDBAsset | null>();
const steamGridInFlight = new Map<string, Promise<SteamGridDBAsset | null>>();
const steamGridMissCache = new Map<string, number>();
const STEAMGRID_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const STEAMGRID_NEGATIVE_TTL_MS = 1000 * 20; // retry failed lookups quickly without forcing app reload
const STEAMGRID_STORAGE_PREFIX = 'otoshi.steamgrid.v2:';
const isSteamGridHostedAsset = (url?: string | null) => {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith("steamgriddb.com");
  } catch {
    return String(url).toLowerCase().includes("steamgriddb.com");
  }
};
const hasSteamGridHostedAsset = (data?: SteamGridDBAsset | null) =>
  Boolean(data && [data.grid, data.hero, data.logo, data.icon].some((value) => isSteamGridHostedAsset(value)));
const loadSteamGridFromStorage = (key: string): SteamGridDBAsset | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STEAMGRID_STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: SteamGridDBAsset | null };
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > STEAMGRID_CACHE_TTL_MS) {
      window.localStorage.removeItem(`${STEAMGRID_STORAGE_PREFIX}${key}`);
      return null;
    }
    return parsed.data ?? null;
  } catch {
    return null;
  }
};
const saveSteamGridToStorage = (key: string, data: SteamGridDBAsset | null) => {
  if (typeof window === 'undefined') return;
  try {
    const storageKey = `${STEAMGRID_STORAGE_PREFIX}${key}`;
    if (!data) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    // ignore storage errors
  }
};
const STEAMGRID_CONCURRENCY = 3;
let steamGridActive = 0;
const steamGridQueue: Array<() => void> = [];
const THUMB_PROXY_HOST_SUFFIXES = [
  "steamstatic.com",
  "steamgriddb.com",
  "steamusercontent.com",
  "steampowered.com",
  "akamaihd.net",
  "unsplash.com"
];

function canProxyThumbnail(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return THUMB_PROXY_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

function toBackendThumbnail(
  url?: string | null,
  width = 460,
  mode: ImageQualityMode = "adaptive"
) {
  if (!url) return null;
  const baseUrl = getPreferredApiBase();
  if (!baseUrl || !canProxyThumbnail(url)) return url;
  const quality = mode === "fast" ? 42 : mode === "high" ? 68 : 52;
  return `${baseUrl}/steamgriddb/thumbnail?url=${encodeURIComponent(url)}&w=${width}&q=${quality}&mode=${mode}`;
}

function runSteamGridQueue() {
  while (steamGridActive < STEAMGRID_CONCURRENCY && steamGridQueue.length > 0) {
    const next = steamGridQueue.shift();
    if (!next) break;
    next();
  }
}

function scheduleSteamGrid<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      steamGridActive += 1;
      task()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          steamGridActive -= 1;
          runSteamGridQueue();
        });
    };
    steamGridQueue.push(run);
    runSteamGridQueue();
  });
}

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  await ensureDesktopRuntimeApiBase();
  if (isDesktop && !path.startsWith("/health")) {
    await ensureDesktopRuntimeReady();
  }
  const method = (options.method || "GET").toUpperCase();
  const canFallback = method === "GET" || method === "HEAD";
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const bases =
    resolvedApiBase
      ? (canFallback
          ? [resolvedApiBase, ...(isDesktop ? [] : API_BASES.filter((base) => base !== resolvedApiBase))]
          : [resolvedApiBase])
      : API_BASES;
  let lastError: Error | null = null;

  debugLog(`[API] Requesting: ${path}`, { bases, method: options.method || 'GET' });

  for (const base of bases) {
    try {
      const url = `${base}${path}`;
      debugLog(`[API] Trying base: ${base}`);

      const response = await fetch(url, {
        ...options,
        headers
      });

      debugLog(`[API] Response from ${base}: status=${response.status}`);

      if (!response.ok) {
        const rawMessage = await response.text();
        const parsedError = parseApiError(rawMessage);

        const retryableStatus = canFallback && shouldRetry(path, response.status);
        if (retryableStatus) {
          debugLog(`[API] Retryable HTTP error from ${base}:`, {
            path,
            status: response.status,
            message: parsedError.message
          });
          lastError = new ApiHttpError(
            parsedError.message,
            response.status,
            true,
            parsedError.code
          );
          continue;
        }
        console.error(`[API] Error from ${base}:`, {
          path,
          status: response.status,
          message: parsedError.message
        });
        throw new ApiHttpError(
          parsedError.message,
          response.status,
          false,
          parsedError.code
        );
      }

      const data = await response.json();
      resolvedApiBase = base;
      debugLog(`[API] Success from ${base}`, { path, resolvedApiBase });
      return data;
    } catch (err: any) {
      if (canFallback) {
        const retryable =
          Boolean(err?.retryable) ||
          shouldRetry(path, typeof err?.status === "number" ? err.status : undefined) ||
          isNetworkLikeError(err);
        if (retryable) {
          debugLog(`[API] Retryable exception from ${base}:`, { path, error: err });
          lastError = err instanceof Error ? err : new Error("Request failed");
          continue;
        }
      }
      console.error(`[API] Exception from ${base}:`, { path, error: err });
      throw err;
    }
  }

  if (path.startsWith("/settings/locale") || path.startsWith("/settings/locales/")) {
    console.warn(`[API] All bases failed for ${path}`, lastError);
  } else {
    console.error(`[API] All bases failed for ${path}`, lastError);
  }

  throw lastError || new Error("Request failed");
}

async function requestForm<T>(
  path: string,
  form: FormData,
  token?: string
): Promise<T> {
  await ensureDesktopRuntimeApiBase();
  if (isDesktop && !path.startsWith("/health")) {
    await ensureDesktopRuntimeReady();
  }
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const bases =
    resolvedApiBase && shouldRetry(path)
      ? [resolvedApiBase, ...(isDesktop ? [] : API_BASES.filter((base) => base !== resolvedApiBase))]
      : resolvedApiBase
        ? [resolvedApiBase]
        : API_BASES;
  let lastError: Error | null = null;

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers,
        body: form
      });

      if (!response.ok) {
        const message = await response.text();
        const retryableStatus = shouldRetry(path, response.status);
        if (retryableStatus) {
          lastError = new ApiHttpError(message || "Request failed", response.status, true);
          continue;
        }
        throw new ApiHttpError(message || "Request failed", response.status, false);
      }

      const data = await response.json();
      resolvedApiBase = base;
      return data;
    } catch (err: any) {
      const retryablePath = shouldRetry(path, typeof err?.status === "number" ? err.status : undefined);
      if (retryablePath || (shouldRetry(path) && isNetworkLikeError(err))) {
        lastError = err instanceof Error ? err : new Error("Request failed");
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Request failed");
}



export async function fetchOAuthProviders(): Promise<OAuthProvider[]> {
  return requestJson<OAuthProvider[]>("/auth/oauth/providers");
}

export async function exchangeOAuthCode(code: string) {
  return requestJson<{ access_token: string; refresh_token?: string; user: any }>(
    "/auth/oauth/exchange",
    {
      method: "POST",
      body: JSON.stringify({ code })
    }
  );
}

export async function fetchSteamGridAssets(
  title: string,
  steamAppId?: string
): Promise<SteamGridDBAsset | null> {
  const key = `${title}:${steamAppId || ""}`.toLowerCase();
  if (steamGridCache.has(key)) {
    const cached = steamGridCache.get(key) || null;
    if (cached) {
      return cached;
    }
    steamGridCache.delete(key);
  }
  const lastMiss = steamGridMissCache.get(key);
  if (lastMiss) {
    if (Date.now() - lastMiss < STEAMGRID_NEGATIVE_TTL_MS) {
      return null;
    }
    steamGridMissCache.delete(key);
  }
  const cachedLocal = loadSteamGridFromStorage(key);
  if (cachedLocal) {
    if (!hasSteamGridHostedAsset(cachedLocal)) {
      // Purge legacy fallback entries so we can re-fetch real SteamGridDB art.
      saveSteamGridToStorage(key, null);
    } else {
      steamGridCache.set(key, cachedLocal);
      steamGridMissCache.delete(key);
      return cachedLocal;
    }
  }
  if (steamGridInFlight.has(key)) {
    return steamGridInFlight.get(key) || null;
  }
  const task = scheduleSteamGrid(async () => {
    try {
      const params = new URLSearchParams();
      params.set("title", title);
      if (steamAppId) {
        params.set("steam_app_id", steamAppId);
      }
      const data = await requestJson<SteamGridDBAsset>(
        `/steamgriddb/lookup?${params.toString()}`
      );
      return hasSteamGridHostedAsset(data) ? data : null;
    } catch {
      return null;
    }
  });
  steamGridInFlight.set(key, task);
  try {
    const result = await task;
    if (result) {
      steamGridCache.set(key, result);
      steamGridMissCache.delete(key);
      if (hasSteamGridHostedAsset(result)) {
        saveSteamGridToStorage(key, result);
      } else {
        saveSteamGridToStorage(key, null);
      }
      return result;
    }
    steamGridCache.delete(key);
    steamGridMissCache.set(key, Date.now());
    saveSteamGridToStorage(key, null);
    return result;
  } finally {
    steamGridInFlight.delete(key);
  }
}

export async function fetchSteamGridAssetsBatch(
  requests: Array<{ appId?: string | null; title: string }>
): Promise<Record<string, SteamGridDBAsset | null>> {
  const items = requests
    .map((item) => ({
      app_id: item.appId ? String(item.appId) : null,
      title: String(item.title || "").trim(),
    }))
    .filter((item) => item.app_id || item.title.length > 0);

  if (!items.length) {
    return {};
  }

  const data = await requestJson<any>("/steamgriddb/lookup/batch", {
    method: "POST",
    body: JSON.stringify({ items }),
  });

  const rawItems = data?.items && typeof data.items === "object" ? data.items : {};
  const result: Record<string, SteamGridDBAsset | null> = {};
  for (const [appId, raw] of Object.entries(rawItems)) {
    const parsed = raw ? (raw as SteamGridDBAsset) : null;
    result[String(appId)] = hasSteamGridHostedAsset(parsed) ? parsed : null;
  }
  return result;
}

export async function fetchSteamCatalog(params: {
  limit?: number;
  offset?: number;
  search?: string;
  sort?: string;
  artMode?: "none" | "basic" | "tiered";
  thumbW?: number;
}): Promise<{ total: number; offset: number; limit: number; items: SteamCatalogItem[] }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.search) query.set("search", params.search);
  if (params.sort) query.set("sort", params.sort);
  if (params.artMode) query.set("art_mode", params.artMode);
  if (params.thumbW) query.set("thumb_w", String(params.thumbW));
  const data = await requestJson<any>(`/steam/catalog?${query.toString()}`);
  return {
    total: data.total ?? 0,
    offset: data.offset ?? 0,
    limit: data.limit ?? params.limit ?? 0,
    items: Array.isArray(data.items) ? data.items.map(mapSteamCatalogItem) : []
  };
}

export async function fetchSteamIndexCatalog(params: {
  limit?: number;
  offset?: number;
  sort?: string;
  scope?: "all" | "library" | "owned";
  includeDlc?: boolean;
  mustHaveArtwork?: boolean;
}): Promise<{ total: number; offset: number; limit: number; items: SteamCatalogItem[] }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.sort) query.set("sort", params.sort);
  if (params.scope) query.set("scope", params.scope);
  if (typeof params.includeDlc === "boolean") {
    query.set("include_dlc", params.includeDlc ? "true" : "false");
  }
  if (typeof params.mustHaveArtwork === "boolean") {
    query.set("must_have_artwork", params.mustHaveArtwork ? "true" : "false");
  }
  const data = await requestJson<any>(`/steam/index/catalog?${query.toString()}`);
  return {
    total: data.total ?? 0,
    offset: data.offset ?? 0,
    limit: data.limit ?? params.limit ?? 0,
    items: Array.isArray(data.items) ? data.items.map(mapSteamCatalogItem) : [],
  };
}

export async function searchSteamIndexCatalog(params: {
  q: string;
  limit?: number;
  offset?: number;
  source?: "global";
  includeDlc?: boolean;
  rankingMode?: "relevance" | "recent" | "updated" | "priority" | "hot" | "top";
  mustHaveArtwork?: boolean;
}): Promise<{ total: number; offset: number; limit: number; items: SteamCatalogItem[] }> {
  const query = new URLSearchParams();
  query.set("q", params.q);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.source) query.set("source", params.source);
  if (typeof params.includeDlc === "boolean") {
    query.set("include_dlc", params.includeDlc ? "true" : "false");
  }
  if (params.rankingMode) query.set("ranking_mode", params.rankingMode);
  if (typeof params.mustHaveArtwork === "boolean") {
    query.set("must_have_artwork", params.mustHaveArtwork ? "true" : "false");
  }
  const data = await requestJson<any>(`/steam/index/search?${query.toString()}`);
  return {
    total: data.total ?? 0,
    offset: data.offset ?? 0,
    limit: data.limit ?? params.limit ?? 0,
    items: Array.isArray(data.items) ? data.items.map(mapSteamCatalogItem) : [],
  };
}

export async function fetchSteamIndexGameDetail(appId: string): Promise<SteamGameDetail> {
  const data = await requestJson<any>(`/steam/index/games/${appId}`);
  return mapSteamGameDetail(data);
}

export async function fetchSteamIndexAssets(
  appId: string,
  forceRefresh = false
): Promise<SteamIndexAssetInfo> {
  const query = forceRefresh ? "?force_refresh=true" : "";
  const data = await requestJson<any>(`/steam/index/assets/${appId}${query}`);
  return {
    appId: String(data.app_id ?? appId),
    selectedSource: String(data.selected_source ?? "steam"),
    assets: {
      grid: data.assets?.grid ?? null,
      hero: data.assets?.hero ?? null,
      logo: data.assets?.logo ?? null,
      icon: data.assets?.icon ?? null,
    },
    qualityScore: data.quality_score ?? null,
    version: data.version ?? null,
  };
}

export async function prefetchSteamIndexAssets(payload: {
  appIds: string[];
  forceRefresh?: boolean;
}): Promise<SteamIndexAssetPrefetchResult> {
  const endpoint = payload.forceRefresh
    ? "/steam/index/assets/prefetch-force-visible"
    : "/steam/index/assets/prefetch";
  const data = await requestJson<any>(endpoint, {
    method: "POST",
    body: JSON.stringify({
      app_ids: payload.appIds,
      force_refresh: Boolean(payload.forceRefresh),
    }),
  });
  return {
    total: Number(data.total ?? 0),
    processed: Number(data.processed ?? 0),
    success: Number(data.success ?? 0),
    failed: Number(data.failed ?? 0),
  };
}

export async function fetchSteamIndexAssetsBatch(payload: {
  appIds: string[];
  forceRefresh?: boolean;
}): Promise<Record<string, SteamIndexAssetInfo>> {
  const data = await requestJson<any>("/steam/index/assets/batch", {
    method: "POST",
    body: JSON.stringify({
      app_ids: payload.appIds,
      force_refresh: Boolean(payload.forceRefresh),
    }),
  });

  const rawItems = data?.items && typeof data.items === "object" ? data.items : {};
  const result: Record<string, SteamIndexAssetInfo> = {};
  for (const [appId, raw] of Object.entries(rawItems)) {
    const assets = (raw as any)?.assets && typeof (raw as any).assets === "object" ? (raw as any).assets : {};
    result[String(appId)] = {
      appId: String((raw as any)?.app_id ?? (raw as any)?.appId ?? appId),
      selectedSource: String((raw as any)?.selected_source ?? (raw as any)?.selectedSource ?? "steam"),
      assets: {
        grid: assets.grid ?? null,
        hero: assets.hero ?? null,
        logo: assets.logo ?? null,
        icon: assets.icon ?? null,
      },
      qualityScore: (raw as any)?.quality_score ?? (raw as any)?.qualityScore ?? null,
      version: (raw as any)?.version ?? null,
    };
  }
  return result;
}

export async function fetchSteamIndexIngestStatus(): Promise<SteamIndexIngestStatus> {
  const data = await requestJson<any>("/steam/index/ingest/status");
  return {
    latestJob: {
      id: data.latest_job?.id ?? null,
      status: data.latest_job?.status ?? "idle",
      processedCount: Number(data.latest_job?.processed_count ?? 0),
      successCount: Number(data.latest_job?.success_count ?? 0),
      failureCount: Number(data.latest_job?.failure_count ?? 0),
      startedAt: data.latest_job?.started_at ?? null,
      completedAt: data.latest_job?.completed_at ?? null,
      errorMessage: data.latest_job?.error_message ?? null,
      externalEnrichment: {
        steamdbSuccess: Number(data.latest_job?.external_enrichment?.steamdb_success ?? 0),
        steamdbFailed: Number(data.latest_job?.external_enrichment?.steamdb_failed ?? 0),
        crossStoreSuccess: Number(data.latest_job?.external_enrichment?.cross_store_success ?? 0),
        crossStoreFailed: Number(data.latest_job?.external_enrichment?.cross_store_failed ?? 0),
        completionProcessed: Number(data.latest_job?.external_enrichment?.completion_processed ?? 0),
        completionFailed: Number(data.latest_job?.external_enrichment?.completion_failed ?? 0),
        completionMetadataCreated: Number(
          data.latest_job?.external_enrichment?.completion_metadata_created ?? 0
        ),
        completionAssetsCreated: Number(
          data.latest_job?.external_enrichment?.completion_assets_created ?? 0
        ),
        completionCrossStoreCreated: Number(
          data.latest_job?.external_enrichment?.completion_cross_store_created ?? 0
        ),
      },
    },
    totals: {
      titles: Number(data.totals?.titles ?? 0),
      assets: Number(data.totals?.assets ?? 0),
      steamdbEnrichment: Number(data.totals?.steamdb_enrichment ?? 0),
      crossStoreMappings: Number(data.totals?.cross_store_mappings ?? 0),
    },
  };
}

export async function fetchSteamIndexCoverage(): Promise<SteamIndexCoverage> {
  const data = await requestJson<any>("/steam/index/coverage");
  return {
    titlesTotal: Number(data.titles_total ?? 0),
    metadataComplete: Number(data.metadata_complete ?? 0),
    assetsComplete: Number(data.assets_complete ?? 0),
    crossStoreComplete: Number(data.cross_store_complete ?? 0),
    absoluteComplete: Number(data.absolute_complete ?? 0),
  };
}

export async function fetchRuntimeHealth(): Promise<RuntimeHealth> {
  const data = await requestJson<any>("/health/runtime");
  return {
    status: String(data.status ?? "unknown"),
    sidecarReady: Boolean(data.sidecar_ready ?? false),
    runtimeMode: data.runtime_mode ?? undefined,
    indexMode: data.index_mode ?? undefined,
    globalIndexV1: Boolean(data.global_index_v1 ?? false),
    dbPath: data.db_path ?? null,
    dbExists: Boolean(data.db_exists ?? false),
    ingestState: data.ingest_state ?? undefined,
    lastError: data.last_error ?? null,
  };
}

export async function fetchSteamIndexTopRanking(params?: {
  limit?: number;
  offset?: number;
  includeDlc?: boolean;
}): Promise<{ total: number; offset: number; limit: number; items: SteamCatalogItem[] }> {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset) query.set("offset", String(params.offset));
  if (typeof params?.includeDlc === "boolean") {
    query.set("include_dlc", params.includeDlc ? "true" : "false");
  }
  const suffix = query.toString();
  const data = await requestJson<any>(`/steam/index/ranking/top${suffix ? `?${suffix}` : ""}`);
  return {
    total: Number(data.total ?? 0),
    offset: Number(data.offset ?? 0),
    limit: Number(data.limit ?? params?.limit ?? 0),
    items: Array.isArray(data.items) ? data.items.map(mapSteamCatalogItem) : [],
  };
}

export async function rebuildSteamIndex(params?: {
  maxItems?: number | null;
  enrichDetails?: boolean;
}): Promise<SteamIndexIngestRebuildResult> {
  const data = await requestJson<any>("/steam/index/ingest/rebuild", {
    method: "POST",
    body: JSON.stringify({
      max_items: params?.maxItems ?? null,
      enrich_details: params?.enrichDetails ?? true,
    }),
  });
  return {
    jobId: String(data.job_id ?? ""),
    processed: Number(data.processed ?? 0),
    success: Number(data.success ?? 0),
    failed: Number(data.failed ?? 0),
    steamdbSuccess: Number(data.steamdb_success ?? 0),
    steamdbFailed: Number(data.steamdb_failed ?? 0),
    crossStoreSuccess: Number(data.cross_store_success ?? 0),
    crossStoreFailed: Number(data.cross_store_failed ?? 0),
    completionProcessed: Number(data.completion_processed ?? 0),
    completionFailed: Number(data.completion_failed ?? 0),
    startedAt: String(data.started_at ?? ""),
    completedAt: String(data.completed_at ?? ""),
  };
}

export async function completeSteamIndexCoverage(payload?: {
  appIds?: string[];
  maxItems?: number | null;
}): Promise<SteamIndexCompletionResult> {
  const data = await requestJson<any>("/steam/index/ingest/complete", {
    method: "POST",
    body: JSON.stringify({
      app_ids: payload?.appIds ?? [],
      max_items: payload?.maxItems ?? null,
    }),
  });
  return {
    processed: Number(data.processed ?? 0),
    failed: Number(data.failed ?? 0),
    metadataCreated: Number(data.metadata_created ?? 0),
    metadataUpdated: Number(data.metadata_updated ?? 0),
    assetsCreated: Number(data.assets_created ?? 0),
    assetsUpdated: Number(data.assets_updated ?? 0),
    crossStoreCreated: Number(data.cross_store_created ?? 0),
    crossStoreUpdated: Number(data.cross_store_updated ?? 0),
  };
}

export async function runLauncherFirstRunDiagnostics(payload?: {
  preloadLimit?: number;
  installPath?: string;
  deferred?: boolean;
  requirements?: {
    min_cpu_cores?: number;
    min_ram_gb?: number;
    min_disk_free_gb?: number;
    min_dx_major?: number;
  };
}): Promise<any> {
  const body = {
    preload_limit: payload?.preloadLimit ?? 48,
    install_path: payload?.installPath ?? null,
    deferred: payload?.deferred ?? false,
    requirements: payload?.requirements ?? null
  };
  return requestJson<any>("/launcher-diagnostics/first-run", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export async function fetchPerformanceSnapshot(): Promise<PerformanceSnapshot> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const data = await invoke<any>("perf_snapshot");
    return {
      startupMs: Number(data?.startup_ms ?? data?.startupMs ?? 0),
      interactiveMs: Number(data?.interactive_ms ?? data?.interactiveMs ?? 0),
      longTasks: Number(data?.long_tasks ?? data?.longTasks ?? 0),
      fpsAvg: Number(data?.fps_avg ?? data?.fpsAvg ?? 0),
      cacheHitRate: Number(data?.cache_hit_rate ?? data?.cacheHitRate ?? 0),
      decodeMs: Number(data?.decode_ms ?? data?.decodeMs ?? 0),
      uploadMs: Number(data?.upload_ms ?? data?.uploadMs ?? 0),
    };
  }

  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const startupMs = nav ? Math.max(0, nav.domInteractive - nav.startTime) : 0;
  return {
    startupMs,
    interactiveMs: startupMs,
    longTasks: 0,
    fpsAvg: 0,
    cacheHitRate: 0,
    decodeMs: 0,
    uploadMs: 0,
  };
}

export async function probeAsmCpuCapabilities(): Promise<AsmCpuCapabilities | null> {
  if (!isTauri()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const data = await invoke<any>("asm_probe_cpu_capabilities");
  return {
    arch: String(data?.arch ?? "unknown"),
    vendor: String(data?.vendor ?? "unknown"),
    logicalCores: Number(data?.logical_cores ?? data?.logicalCores ?? 1),
    physicalCores: Number(data?.physical_cores ?? data?.physicalCores ?? 1),
    totalMemoryMb: Number(data?.total_memory_mb ?? data?.totalMemoryMb ?? 0),
    availableMemoryMb: Number(data?.available_memory_mb ?? data?.availableMemoryMb ?? 0),
    hasSse42: Boolean(data?.has_sse42 ?? data?.hasSse42 ?? false),
    hasAvx2: Boolean(data?.has_avx2 ?? data?.hasAvx2 ?? false),
    hasAvx512: Boolean(data?.has_avx512 ?? data?.hasAvx512 ?? false),
    hasAesNi: Boolean(data?.has_aes_ni ?? data?.hasAesNi ?? false),
    hasBmi2: Boolean(data?.has_bmi2 ?? data?.hasBmi2 ?? false),
    hasFma: Boolean(data?.has_fma ?? data?.hasFma ?? false),
    featureScore: Number(data?.feature_score ?? data?.featureScore ?? 0),
    asmProbeTicks: Number(data?.asm_probe_ticks ?? data?.asmProbeTicks ?? 0),
    fallbackUsed: Boolean(data?.fallback_used ?? data?.fallbackUsed ?? false),
  };
}

export async function recommendRuntimeTuning(payload: {
  consent: boolean;
  profile?: RuntimeTuningProfile | null;
}): Promise<RuntimeTuningRecommendation | null> {
  if (!isTauri()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const data = await invoke<any>("runtime_tuning_recommend", {
    consent: payload.consent,
    profile: payload.profile ?? null,
  });
  return {
    profile: (String(data?.profile ?? "balanced").toLowerCase() as RuntimeTuningProfile),
    decodeConcurrency: Number(data?.decode_concurrency ?? data?.decodeConcurrency ?? 4),
    prefetchWindow: Number(data?.prefetch_window ?? data?.prefetchWindow ?? 24),
    pollingFastMs: Number(data?.polling_fast_ms ?? data?.pollingFastMs ?? 1000),
    pollingIdleMs: Number(data?.polling_idle_ms ?? data?.pollingIdleMs ?? 8000),
    animationLevel: String(data?.animation_level ?? data?.animationLevel ?? "normal"),
    reason: String(data?.reason ?? "balanced_default"),
    autoApplyAllowed: Boolean(data?.auto_apply_allowed ?? data?.autoApplyAllowed ?? false),
    fallbackUsed: Boolean(data?.fallback_used ?? data?.fallbackUsed ?? false),
  };
}

export async function applyRuntimeTuning(payload: {
  consent: boolean;
  profile?: RuntimeTuningProfile | null;
}): Promise<RuntimeTuningApplyResult | null> {
  if (!isTauri()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const data = await invoke<any>("runtime_tuning_apply", {
    consent: payload.consent,
    profile: payload.profile ?? null,
  });
  return {
    applied: Boolean(data?.applied ?? false),
    profile: (String(data?.profile ?? "balanced").toLowerCase() as RuntimeTuningProfile),
    decodeConcurrency: Number(data?.decode_concurrency ?? data?.decodeConcurrency ?? 4),
    prefetchWindow: Number(data?.prefetch_window ?? data?.prefetchWindow ?? 24),
    pollingFastMs: Number(data?.polling_fast_ms ?? data?.pollingFastMs ?? 1000),
    pollingIdleMs: Number(data?.polling_idle_ms ?? data?.pollingIdleMs ?? 8000),
    animationLevel: String(data?.animation_level ?? data?.animationLevel ?? "normal"),
    fallbackUsed: Boolean(data?.fallback_used ?? data?.fallbackUsed ?? false),
    settingsPath: String(data?.settings_path ?? data?.settingsPath ?? ""),
    appliedAt: String(data?.applied_at ?? data?.appliedAt ?? ""),
  };
}

export async function rollbackRuntimeTuning(): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<boolean>("runtime_tuning_rollback");
  return Boolean(result);
}

export async function artworkGet(
  gameId: string,
  tier: number,
  dpi = 1,
  sources?: {
    t0?: string | null;
    t1?: string | null;
    t2?: string | null;
    t3?: string | null;
    t4?: string | null;
  }
): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const value = await invoke<string | null>("artwork_get", {
    gameId,
    tier,
    dpi,
    sources: sources ?? null,
  });
  return value || null;
}

export async function artworkPrefetch(
  items: Array<{
    gameId: string;
    sources?: {
      t0?: string | null;
      t1?: string | null;
      t2?: string | null;
      t3?: string | null;
      t4?: string | null;
    } | null;
  }>,
  tierHint = 2
): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }
  const payload = items
    .filter((item) => item && item.gameId)
    .map((item) => ({
      game_id: String(item.gameId),
      sources: {
        t0: item.sources?.t0 ?? null,
        t1: item.sources?.t1 ?? null,
        t2: item.sources?.t2 ?? null,
        t3: item.sources?.t3 ?? null,
        t4: item.sources?.t4 ?? null,
      },
    }));
  if (!payload.length) {
    return false;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return Boolean(
    await invoke<boolean>("artwork_prefetch", {
      items: payload,
      tierHint,
    })
  );
}

export async function artworkRelease(gameId: string): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return Boolean(await invoke<boolean>("artwork_release", { gameId }));
}

export async function fetchSteamSearchHistory(limit = 12): Promise<SearchHistoryItem[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  const data = await requestJson<any>(`/steam/search/history?${params.toString()}`);
  return Array.isArray(data.items)
    ? data.items.map((item: any) => ({
        query: item.query ?? "",
        count: item.count ?? 1,
        lastUsed: item.last_used ?? item.lastUsed ?? null
      }))
    : [];
}

export async function recordSteamSearchHistory(
  query: string,
  limit = 12
): Promise<SearchHistoryItem[]> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  const data = await requestJson<any>(`/steam/search/history?${params.toString()}`, {
    method: "POST",
    body: JSON.stringify({ query })
  });
  return Array.isArray(data.items)
    ? data.items.map((item: any) => ({
        query: item.query ?? "",
        count: item.count ?? 1,
        lastUsed: item.last_used ?? item.lastUsed ?? null
      }))
    : [];
}

export async function clearSteamSearchHistory() {
  return requestJson<void>("/steam/search/history", { method: "DELETE" });
}

export async function fetchSteamPopular(
  limit = 12,
  offset = 0
): Promise<{ total: number; offset: number; limit: number; items: SteamCatalogItem[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const data = await requestJson<any>(`/steam/search/popular?${params.toString()}`);
  return {
    total: data.total ?? 0,
    offset: data.offset ?? offset,
    limit: data.limit ?? limit,
    items: Array.isArray(data.items) ? data.items.map(mapSteamCatalogItem) : []
  };
}

export async function fetchSteamGameDetail(
  appId: string,
  locale?: string | null
): Promise<SteamGameDetail> {
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  const data = await requestJson<any>(`/steam/games/${appId}${query}`);
  return mapSteamGameDetail(data);
}

export async function fetchSteamDLC(appId: string, skipCache = false): Promise<{
  appId: string;
  items: SteamDLC[];
  total: number;
}> {
  // Add cache-busting timestamp if skipCache is true
  const cacheBuster = skipCache ? `&t=${Date.now()}` : '';
  const data = await requestJson<any>(`/steam/games/${appId}/dlc?${skipCache ? `t=${Date.now()}` : ''}`);
  return {
    appId: data.app_id ?? appId,
    items: Array.isArray(data.items) ? data.items.map(mapSteamDLC) : [],
    total: data.total ?? 0,
  };
}

export async function fetchSteamAchievements(appId: string): Promise<{
  appId: string;
  items: SteamAchievement[];
  total: number;
}> {
  const data = await requestJson<any>(`/steam/games/${appId}/achievements`);
  return {
    appId: data.app_id ?? appId,
    items: Array.isArray(data.items) ? data.items.map(mapSteamAchievement) : [],
    total: data.total ?? 0,
  };
}

export async function fetchSteamNews(appId: string, count = 10): Promise<{
  appId: string;
  items: SteamNewsItem[];
  total: number;
}> {
  const data = await requestJson<any>(`/steam/games/${appId}/news?count=${count}`);
  return {
    appId: data.app_id ?? appId,
    items: Array.isArray(data.items) ? data.items.map(mapSteamNewsItem) : [],
    total: data.total ?? 0,
  };
}

export async function fetchSteamPlayerCount(appId: string): Promise<number | null> {
  const data = await requestJson<any>(`/steam/games/${appId}/players`);
  return data.player_count ?? null;
}

export async function fetchSteamReviews(appId: string): Promise<SteamReviewSummary> {
  const data = await requestJson<any>(`/steam/games/${appId}/reviews`);
  return mapSteamReviewSummary(data);
}

export async function fetchSteamExtended(appId: string, skipCache = false): Promise<SteamExtendedData> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const data = await invoke<any>("fetch_steam_extended", { appId });
    return {
      appId: data.app_id ?? data.appId ?? appId,
      dlc: {
        items: Array.isArray(data.dlc?.items) ? data.dlc.items.map(mapSteamDLC) : [],
        total: data.dlc?.total ?? 0,
      },
      achievements: {
        items: Array.isArray(data.achievements?.items) ? data.achievements.items.map(mapSteamAchievement) : [],
        total: data.achievements?.total ?? 0,
      },
      news: {
        items: Array.isArray(data.news?.items) ? data.news.items.map(mapSteamNewsItem) : [],
        total: data.news?.total ?? 0,
      },
      playerCount: data.player_count ?? data.playerCount ?? null,
      reviews: mapSteamReviewSummary(data.reviews),
    };
  }

  // Add cache-busting timestamp if skipCache is true
  const urlWithCache = skipCache 
    ? `/steam/games/${appId}/extended?news_all=true&t=${Date.now()}`
    : `/steam/games/${appId}/extended?news_all=true`;
  const data = await requestJson<any>(urlWithCache);
  return {
    appId: data.app_id ?? appId,
    dlc: {
      items: Array.isArray(data.dlc?.items) ? data.dlc.items.map(mapSteamDLC) : [],
      total: data.dlc?.total ?? 0,
    },
    achievements: {
      items: Array.isArray(data.achievements?.items) ? data.achievements.items.map(mapSteamAchievement) : [],
      total: data.achievements?.total ?? 0,
    },
    news: {
      items: Array.isArray(data.news?.items) ? data.news.items.map(mapSteamNewsItem) : [],
      total: data.news?.total ?? 0,
    },
    playerCount: data.player_count ?? null,
    reviews: mapSteamReviewSummary(data.reviews),
  };
}

export async function fetchPropertiesInstallInfo(appId: string): Promise<PropertiesInstallInfo> {
  const data = await requestJson<any>(`/properties/${appId}/info`);
  return {
    installed: Boolean(data.installed),
    installPath: data.install_path ?? data.installPath ?? null,
    installRoots: Array.isArray(data.install_roots ?? data.installRoots)
      ? (data.install_roots ?? data.installRoots)
      : [],
    sizeBytes: data.size_bytes ?? data.sizeBytes ?? null,
    version: data.version ?? null,
    branch: data.branch ?? null,
    buildId: data.build_id ?? data.buildId ?? null,
    lastPlayed: data.last_played ?? data.lastPlayed ?? null,
    playtimeLocalHours: Number(data.playtime_local_hours ?? data.playtimeLocalHours ?? 0),
  };
}

export async function uninstallPropertiesInstall(
  appId: string,
  installPath: string
): Promise<{ success: boolean; message?: string | null }> {
  const data = await requestJson<any>(`/properties/${appId}/uninstall`, {
    method: "POST",
    body: JSON.stringify({
      install_path: installPath,
    }),
  });
  return {
    success: Boolean(data.success ?? true),
    message: typeof data.message === "string" ? data.message : null,
  };
}

export async function verifyPropertiesInstall(
  appId: string,
  payload: { installPath: string; manifestVersion?: string | null; maxMismatches?: number }
): Promise<PropertiesVerifyResult> {
  const data = await requestJson<any>(`/properties/${appId}/verify`, {
    method: "POST",
    body: JSON.stringify({
      install_path: payload.installPath,
      manifest_version: payload.manifestVersion ?? null,
      max_mismatches: payload.maxMismatches ?? 200,
    }),
  });
  return {
    success: Boolean(data.success),
    totalFiles: Number(data.total_files ?? data.totalFiles ?? 0),
    verifiedFiles: Number(data.verified_files ?? data.verifiedFiles ?? 0),
    corruptedFiles: Number(data.corrupted_files ?? data.corruptedFiles ?? 0),
    missingFiles: Number(data.missing_files ?? data.missingFiles ?? 0),
    manifestVersion: data.manifest_version ?? data.manifestVersion ?? null,
    mismatchFiles: Array.isArray(data.mismatch_files ?? data.mismatchFiles)
      ? (data.mismatch_files ?? data.mismatchFiles).map((item: any) => ({
          path: String(item.path ?? ""),
          expectedHash: item.expected_hash ?? item.expectedHash ?? null,
          actualHash: item.actual_hash ?? item.actualHash ?? null,
          reason: String(item.reason ?? "unknown"),
        }))
      : [],
  };
}

export async function movePropertiesInstall(
  appId: string,
  payload: { sourcePath: string; destPath: string }
): Promise<PropertiesMoveResult> {
  const data = await requestJson<any>(`/properties/${appId}/move`, {
    method: "POST",
    body: JSON.stringify({
      source_path: payload.sourcePath,
      dest_path: payload.destPath,
    }),
  });
  return {
    success: Boolean(data.success),
    newPath: String(data.new_path ?? data.newPath ?? payload.destPath),
    progressToken: String(data.progress_token ?? data.progressToken ?? ""),
    message: String(data.message ?? ""),
  };
}

export async function runPropertiesCloudSync(appId: string): Promise<PropertiesCloudSyncResult> {
  const data = await requestJson<any>(`/properties/${appId}/cloud-sync`, {
    method: "POST",
  });
  return {
    success: Boolean(data.success),
    filesUploaded: Number(data.files_uploaded ?? data.filesUploaded ?? 0),
    filesDownloaded: Number(data.files_downloaded ?? data.filesDownloaded ?? 0),
    conflicts: Number(data.conflicts ?? 0),
    resolution: Array.isArray(data.resolution) ? data.resolution : [],
    eventId: data.event_id ?? data.eventId ?? null,
  };
}

export async function fetchPropertiesSaveLocations(appId: string): Promise<PropertiesSaveLocations> {
  const data = await requestJson<any>(`/properties/${appId}/save-locations`);
  return {
    appId: String(data.app_id ?? data.appId ?? appId),
    locations: Array.isArray(data.locations) ? data.locations : [],
  };
}

export async function fetchPropertiesLaunchOptions(appId: string): Promise<PropertiesLaunchOptions> {
  const data = await requestJson<any>(`/properties/${appId}/launch-options`);
  return {
    appId: String(data.app_id ?? data.appId ?? appId),
    userId: data.user_id ?? data.userId ?? null,
    launchOptions:
      data.launch_options && typeof data.launch_options === "object"
        ? data.launch_options
        : data.launchOptions && typeof data.launchOptions === "object"
          ? data.launchOptions
          : {},
    updatedAt: data.updated_at ?? data.updatedAt ?? null,
  };
}

export async function setPropertiesLaunchOptions(
  appId: string,
  payload: Record<string, any>
): Promise<PropertiesLaunchOptions> {
  const data = await requestJson<any>(`/properties/${appId}/launch-options`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    appId: String(data.app_id ?? data.appId ?? appId),
    userId: data.user_id ?? data.userId ?? null,
    launchOptions:
      data.launch_options && typeof data.launch_options === "object"
        ? data.launch_options
        : data.launchOptions && typeof data.launchOptions === "object"
          ? data.launchOptions
          : {},
    updatedAt: data.updated_at ?? data.updatedAt ?? null,
  };
}

export async function fetchPropertiesDlcState(appId: string): Promise<PropertiesDlcState[]> {
  const data = await requestJson<any>(`/properties/${appId}/dlc`);
  const items = Array.isArray(data) ? data : [];
  return items.map((item: any) => ({
    appId: String(item.app_id ?? item.appId ?? ""),
    title: String(item.title ?? "Unknown DLC"),
    installed: Boolean(item.installed),
    enabled: Boolean(item.enabled ?? true),
    sizeBytes: item.size_bytes ?? item.sizeBytes ?? null,
    headerImage: item.header_image ?? item.headerImage ?? null,
  }));
}

function mapSteamDLC(item: any): SteamDLC {
  return {
    appId: String(item.app_id ?? item.appId ?? ""),
    name: item.name ?? "",
    headerImage: item.header_image ?? item.headerImage ?? null,
    description: item.description ?? item.short_description ?? item.shortDescription ?? null,
    releaseDate: item.release_date ?? item.releaseDate ?? null,
    price: item.price ? {
      initial: item.price.initial,
      final: item.price.final,
      discountPercent: item.price.discount_percent ?? item.price.discountPercent ?? 0,
      currency: item.price.currency,
      formatted: item.price.formatted ?? item.price.initial_formatted ?? null,
      finalFormatted: item.price.final_formatted ?? item.price.finalFormatted ?? null,
    } : null,
  };
}

function mapSteamAchievement(item: any): SteamAchievement {
  const globalPercent = item.global_percent ?? item.globalPercent;
  return {
    name: item.name ?? "",
    displayName: item.display_name ?? item.displayName ?? item.name ?? "",
    description: item.description ?? null,
    icon: item.icon ?? null,
    iconGray: item.icon_gray ?? item.iconGray ?? null,
    hidden: Boolean(item.hidden),
    globalPercent: globalPercent != null ? Number(globalPercent) : null,
  };
}

function mapSteamNewsItem(item: any): SteamNewsItem {
  return {
    gid: String(item.gid ?? ""),
    title: item.title ?? "",
    url: item.url ?? "",
    author: item.author ?? null,
    contents: item.contents ?? null,
    image: item.image ?? null,
    images: Array.isArray(item.images) ? item.images : [],
    feedLabel: item.feed_label ?? item.feedLabel ?? null,
    date: item.date ?? 0,
    feedName: item.feed_name ?? item.feedName ?? null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    patch_notes: Array.isArray(item.patch_notes) ? item.patch_notes : null,
    structured_content: item.structured_content ?? null,
  };
}

function mapSteamReviewSummary(data: any): SteamReviewSummary {
  return {
    totalPositive: data?.total_positive ?? data?.totalPositive ?? 0,
    totalNegative: data?.total_negative ?? data?.totalNegative ?? 0,
    totalReviews: data?.total_reviews ?? data?.totalReviews ?? 0,
    reviewScore: data?.review_score ?? data?.reviewScore ?? 0,
    reviewScoreDesc: data?.review_score_desc ?? data?.reviewScoreDesc ?? "No reviews",
  };
}

import type { SteamDLC, SteamAchievement, SteamNewsItem, SteamReviewSummary, SteamExtendedData } from "../types";

export async function fetchSteamDownloadOptions(appId: string): Promise<DownloadOptions> {
  const data = await requestJson<any>(`/downloads/steam/${appId}/options`);
  return mapDownloadOptions(data);
}

export async function fetchGraphicsConfig(gameId: string): Promise<GraphicsConfig> {
  const data = await requestJson<any>(`/games/${gameId}/graphics-config`);
  return mapGraphicsConfig(data);
}

export async function fetchLaunchConfig(gameId: string): Promise<LaunchConfig> {
  const data = await requestJson<any>(`/games/${gameId}/launch-config`);
  return mapLaunchConfig(data);
}

export async function prepareSteamDownload(
  appId: string,
  payload: DownloadPreparePayload
): Promise<DownloadOptions> {
  const data = await requestJson<any>(`/downloads/steam/${appId}/prepare`, {
    method: "POST",
    body: JSON.stringify({
      method: payload.method,
      version: payload.version,
      install_path: payload.installPath,
      create_subfolder: payload.createSubfolder
    })
  });
  return mapDownloadOptions(data);
}

export async function verifyAgeGate(payload: {
  year: number;
  month: number;
  day: number;
  requiredAge: number;
}): Promise<{ allowed: boolean; age: number; requiredAge: number }> {
  const data = await requestJson<any>("/age-gate/verify", {
    method: "POST",
    body: JSON.stringify({
      year: payload.year,
      month: payload.month,
      day: payload.day,
      required_age: payload.requiredAge
    })
  });
  return {
    allowed: Boolean(data.allowed),
    age: Number(data.age ?? 0),
    requiredAge: Number(data.required_age ?? payload.requiredAge ?? 0)
  };
}

export async function fetchLocaleSettings(): Promise<{
  locale: string;
  source: string;
  systemLocale: string;
  supported: string[];
}> {
  try {
    const data = await requestJson<any>("/settings/locale");
    return {
      locale: data.locale ?? "en",
      source: data.source ?? "default",
      systemLocale: data.system_locale ?? data.systemLocale ?? "en",
      supported: Array.isArray(data.supported) ? data.supported : ["en", "vi"]
    };
  } catch {
    const browserLocale =
      typeof navigator !== "undefined" && typeof navigator.language === "string"
        ? navigator.language.toLowerCase()
        : "en";
    const resolved = browserLocale.startsWith("vi") ? "vi" : "en";
    return {
      locale: resolved,
      source: "runtime_fallback",
      systemLocale: resolved,
      supported: ["en", "vi"]
    };
  }
}

export async function fetchLocaleBundle(locale: string): Promise<Record<string, string>> {
  const normalizeMessages = (messages: unknown): Record<string, string> => {
    if (!messages || typeof messages !== "object") {
      return {};
    }
    const normalized: Record<string, string> = {};
    Object.entries(messages as Record<string, unknown>).forEach(([key, value]) => {
      if (typeof value === "string") {
        normalized[key] = value;
      }
    });
    return normalized;
  };

  try {
    const data = await requestJson<any>(`/settings/locales/${encodeURIComponent(locale)}`);
    return normalizeMessages(data?.messages);
  } catch {
    try {
      const response = await fetch(`/locales/${encodeURIComponent(locale)}.json`);
      if (!response.ok) {
        return {};
      }
      const payload = await response.json();
      return normalizeMessages(payload);
    } catch {
      return {};
    }
  }
}

export async function updateLocaleSettings(locale: string): Promise<{
  locale: string;
  source: string;
  systemLocale: string;
  supported: string[];
}> {
  const data = await requestJson<any>("/settings/locale", {
    method: "POST",
    body: JSON.stringify({ locale })
  });
  return {
    locale: data.locale ?? "en",
    source: data.source ?? "user",
    systemLocale: data.system_locale ?? data.systemLocale ?? "en",
    supported: Array.isArray(data.supported) ? data.supported : ["en", "vi"]
  };
}

export async function fetchFixCatalog(
  kind: "online-fix" | "bypass",
  params: { limit?: number; offset?: number } = {}
): Promise<FixCatalog> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString();
  const data = await requestJson<any>(`/fixes/${kind}${suffix ? `?${suffix}` : ""}`);
  return {
    total: data.total ?? 0,
    offset: data.offset ?? 0,
    limit: data.limit ?? params.limit ?? 0,
    items: Array.isArray(data.items) ? data.items.map(mapFixEntry) : []
  };
}

// Bypass category types
export interface BypassCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  total: number;
  games: FixEntry[];
}

export interface BypassCategoryResult {
  total: number;
  offset: number;
  limit: number;
  items: FixEntry[];
  category: {
    id: string;
    name: string;
    description: string;
    icon: string;
  } | null;
}

export async function fetchBypassCategories(): Promise<BypassCategory[]> {
  const data = await requestJson<any[]>("/fixes/bypass/categories");
  return Array.isArray(data)
    ? data.map((cat) => ({
        id: cat.id ?? "",
        name: cat.name ?? "",
        description: cat.description ?? "",
        icon: cat.icon ?? "",
        total: cat.total ?? 0,
        games: Array.isArray(cat.games)
          ? cat.games.map((raw: any) => {
              const entry = mapFixEntry(raw);
              // Some legacy rows omit the explicit denuvo flag, but the category already implies it.
              if (String(cat.id).toLowerCase() === "denuvo") {
                entry.denuvo = true;
              }
              return entry;
            })
          : []
      }))
    : [];
}

export async function fetchBypassByCategory(
  categoryId: string,
  params: { limit?: number; offset?: number } = {}
): Promise<BypassCategoryResult> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString();
  const data = await requestJson<any>(
    `/fixes/bypass/category/${categoryId}${suffix ? `?${suffix}` : ""}`
  );
  return {
    total: data.total ?? 0,
    offset: data.offset ?? 0,
    limit: data.limit ?? params.limit ?? 0,
    items: Array.isArray(data.items) ? data.items.map(mapFixEntry) : [],
    category: data.category ?? null
  };
}

export async function fetchFixEntryDetail(
  kind: "online-fix" | "bypass",
  appId: string
): Promise<FixEntryDetail> {
  const data = await requestJson<any>(`/fixes/detail/${kind}/${appId}`);
  return mapFixEntryDetail(data, kind);
}

function mapGame(game: any, index = 0): Game {
  const toThumb = (url?: string | null, width = 360) => toBackendThumbnail(url, width) ?? "";

  const fallbackScreenshots = [
    game.hero_image,
    game.header_image,
    game.background_image
  ]
    .filter(Boolean)
    .slice(0, 3);
  const screenshots = Array.isArray(game.screenshots) && game.screenshots.length > 0
    ? game.screenshots
    : fallbackScreenshots;

  return {
    id: game.id,
    slug: game.slug,
    steamAppId: game.steam_app_id || game.steamAppId,
    title: game.title,
    tagline: game.tagline || "",
    shortDescription: game.short_description || game.tagline || "",
    description: game.description || "",
    studio: game.studio || "",
    releaseDate: game.release_date || "",
    genres: game.genres || [],
    price: game.price || 0,
    discountPercent: game.discount_percent || 0,
    rating: game.rating || 0,
    requiredAge: game.required_age ?? game.requiredAge ?? 18,
    denuvo: Boolean(
      game.denuvo ??
        game.has_denuvo ??
        game.hasDenuvo ??
        game.uses_denuvo ??
        game.usesDenuvo
    ),
    headerImage: toThumb(game.header_image || "", 460),
    heroImage: game.hero_image || game.header_image || "",
    backgroundImage: game.background_image || game.hero_image || game.header_image || "",
    logoImage: game.logo_image || game.logoImage || undefined,
    iconImage: toThumb(game.icon_image || game.iconImage || "", 128) || undefined,
    screenshots,
    videos: Array.isArray(game.videos) ? game.videos : [],
    systemRequirements: game.system_requirements || defaultRequirements,
    spotlightColor: spotlightPalette[index % spotlightPalette.length],
    installed: false,
    playtimeHours: 0
  };
}

function mapSteamPrice(raw?: any): SteamPrice | null {
  if (!raw) return null;
  return {
    initial: raw.initial ?? undefined,
    final: raw.final ?? undefined,
    discountPercent: raw.discount_percent ?? raw.discountPercent ?? undefined,
    currency: raw.currency ?? undefined,
    formatted: raw.formatted ?? raw.initial_formatted ?? null,
    finalFormatted: raw.final_formatted ?? raw.finalFormatted ?? null
  };
}

function inferSteamAppId(raw: any): string {
  const direct = raw?.app_id ?? raw?.appId ?? raw?.id;
  if (direct !== undefined && direct !== null) {
    const normalized = String(direct).trim();
    if (
      normalized &&
      normalized.toLowerCase() !== "null" &&
      normalized.toLowerCase() !== "none"
    ) {
      return normalized;
    }
  }

  const candidates = [
    raw?.name,
    raw?.header_image,
    raw?.headerImage,
    raw?.capsule_image,
    raw?.capsuleImage,
    raw?.background,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const fromName = candidate.match(/^steam app\s+(\d+)$/i);
    if (fromName?.[1]) {
      return fromName[1];
    }
    const fromUrl = candidate.match(/\/steam\/apps\/(\d+)\//i);
    if (fromUrl?.[1]) {
      return fromUrl[1];
    }
  }
  return "";
}

const STEAM_PLACEHOLDER_NAME_PATTERN = /^steam app\s+\d+$/i;

function isPlaceholderSteamName(name?: string | null, appId?: string | null): boolean {
  const text = String(name || "").trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (STEAM_PLACEHOLDER_NAME_PATTERN.test(text)) return true;
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId) return false;
  const lowered = text.toLowerCase();
  return lowered === normalizedAppId.toLowerCase() || lowered === `steam app ${normalizedAppId}`.toLowerCase();
}

function resolveSteamCatalogName(raw: any, appId: string): string {
  const candidates = [
    raw?.name,
    raw?.title,
    raw?.display_name,
    raw?.displayName,
    raw?.game_name,
    raw?.gameName,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  for (const candidate of candidates) {
    if (!isPlaceholderSteamName(candidate, appId)) {
      return candidate;
    }
  }

  if (candidates.length) {
    return candidates[0];
  }
  return appId ? `Steam App ${appId}` : "";
}

function mapSteamCatalogItem(raw: any): SteamCatalogItem {
  const toThumb = (
    url?: string | null,
    width = 460,
    mode: ImageQualityMode = "adaptive"
  ) => toBackendThumbnail(url, width, mode);
  const rawArtwork = raw?.artwork && typeof raw.artwork === "object" ? raw.artwork : {};
  const appId = inferSteamAppId(raw);
  const steamStaticBase =
    appId && /^\d+$/.test(appId)
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`
      : null;
  const steamHeaderFallback = steamStaticBase ? `${steamStaticBase}/header.jpg` : null;
  const steamCapsuleFallback = steamStaticBase ? `${steamStaticBase}/capsule_616x353.jpg` : null;
  const steamHeroFallback = steamStaticBase ? `${steamStaticBase}/library_hero.jpg` : null;
  const cardImageSource =
    rawArtwork.t3 ??
    raw.capsule_image ??
    raw.capsuleImage ??
    raw.header_image ??
    raw.headerImage ??
    raw.background ??
    raw.background_raw ??
    steamCapsuleFallback ??
    steamHeaderFallback ??
    null;
  const heroImageSource =
    rawArtwork.t4 ??
    raw.background ??
    raw.background_image ??
    raw.hero_image ??
    raw.header_image ??
    raw.headerImage ??
    steamHeroFallback ??
    steamHeaderFallback ??
    cardImageSource;
  const backgroundSource =
    raw.background ??
    raw.background_image ??
    raw.hero_image ??
    steamHeroFallback ??
    steamHeaderFallback ??
    heroImageSource ??
    null;
  const resolvedName = resolveSteamCatalogName(raw, appId);
  const artwork = {
    t0: toThumb(rawArtwork.t0 ?? steamCapsuleFallback ?? steamHeaderFallback ?? null, 120),
    t1: toThumb(rawArtwork.t1 ?? steamCapsuleFallback ?? steamHeaderFallback ?? null, 220),
    t2: toThumb(rawArtwork.t2 ?? steamCapsuleFallback ?? steamHeaderFallback ?? null, 360),
    t3: toThumb(cardImageSource, 560, "adaptive"),
    t4: toThumb(heroImageSource, 1600, "high"),
    version: Number.isFinite(Number(rawArtwork.version)) ? Number(rawArtwork.version) : 1,
  };
  const dlcCountRaw =
    raw.dlc_count ??
    raw.dlcCount ??
    (Array.isArray(raw.dlc) ? raw.dlc.length : null);
  const dlcCount = Number.isFinite(Number(dlcCountRaw)) ? Number(dlcCountRaw) : 0;
  const itemTypeRaw = raw.item_type ?? raw.itemType ?? raw.type;
  const itemType =
    typeof itemTypeRaw === "string" && itemTypeRaw.trim()
      ? itemTypeRaw.trim().toLowerCase()
      : null;
  const isDlc = Boolean(raw.is_dlc ?? raw.isDlc ?? itemType === "dlc");
  const isBaseGame = Boolean(raw.is_base_game ?? raw.isBaseGame ?? !isDlc);
  const classificationRaw = Number(raw.classification_confidence ?? raw.classificationConfidence);
  const classificationConfidence = Number.isFinite(classificationRaw)
    ? classificationRaw
    : undefined;
  const artworkCoverageRaw = raw.artwork_coverage ?? raw.artworkCoverage ?? null;
  const artworkCoverage =
    artworkCoverageRaw === "sgdb" ||
    artworkCoverageRaw === "epic" ||
    artworkCoverageRaw === "steam" ||
    artworkCoverageRaw === "mixed"
      ? artworkCoverageRaw
      : undefined;
  return {
    appId,
    name: resolvedName,
    shortDescription: raw.short_description ?? raw.shortDescription ?? null,
    headerImage: toThumb(
      raw.header_image ??
        raw.headerImage ??
        raw.tiny_image ??
        cardImageSource ??
        steamHeaderFallback ??
        null,
      560
    ),
    capsuleImage: toThumb(
      raw.capsule_image ??
        raw.capsuleImage ??
        raw.header_image ??
        raw.headerImage ??
        steamCapsuleFallback ??
        steamHeaderFallback ??
        null,
      420
    ),
    background: backgroundSource,
    artwork,
    requiredAge: raw.required_age ?? raw.requiredAge ?? null,
    denuvo: Boolean(raw.denuvo ?? raw.has_denuvo ?? raw.hasDenuvo ?? false),
    price: mapSteamPrice(raw.price ?? raw.price_overview),
    genres: raw.genres ?? [],
    releaseDate: raw.release_date ?? raw.releaseDate ?? null,
    platforms: raw.platforms ?? [],
    itemType,
    isDlc,
    isBaseGame,
    classificationConfidence,
    artworkCoverage,
    dlcCount
  };
}

function mapSteamGameDetail(raw: any): SteamGameDetail {
  const base = mapSteamCatalogItem(raw);
  return {
    ...base,
    // Keep full-resolution hero/header assets on detail page.
    headerImage: raw.header_image ?? raw.headerImage ?? raw.tiny_image ?? base.headerImage,
    capsuleImage: raw.capsule_image ?? raw.capsuleImage ?? base.capsuleImage,
    aboutTheGame: raw.about_the_game ?? raw.aboutTheGame ?? null,
    aboutTheGameHtml: raw.about_the_game_html ?? raw.aboutTheGameHtml ?? null,
    detailedDescription: raw.detailed_description ?? raw.detailedDescription ?? null,
    detailedDescriptionHtml:
      raw.detailed_description_html ?? raw.detailedDescriptionHtml ?? null,
    developers: raw.developers ?? [],
    publishers: raw.publishers ?? [],
    categories: raw.categories ?? [],
    screenshots: raw.screenshots ?? [],
    movies: Array.isArray(raw.movies)
      ? raw.movies.map((movie: any) => ({
          url: movie.url ?? "",
          thumbnail: movie.thumbnail ?? null,
          hls: movie.hls ?? null,
          dash: movie.dash ?? null
        }))
      : [],
    pcRequirements: raw.pc_requirements ?? raw.pcRequirements ?? null,
    metacritic: raw.metacritic ?? null,
    recommendations: raw.recommendations ?? null,
    website: raw.website ?? null,
    supportInfo: raw.support_info ?? raw.supportInfo ?? null,
    contentLocale: raw.content_locale ?? raw.contentLocale ?? null
  };
}

function mapAnimeItem(raw: any): AnimeItem {
  return {
    id: String(raw.id ?? ""),
    title: raw.title ?? "",
    detailUrl: raw.detail_url ?? raw.detailUrl ?? "",
    posterImage: raw.poster_image ?? raw.posterImage ?? null,
    backgroundImage: raw.background_image ?? raw.backgroundImage ?? null,
    episodeLabel: raw.episode_label ?? raw.episodeLabel ?? null,
    ratingLabel: raw.rating_label ?? raw.ratingLabel ?? null,
    sectionTitle: raw.section_title ?? raw.sectionTitle ?? null
  };
}

function mapAnimeTagLink(raw: any) {
  return {
    id: String(raw.id ?? ""),
    label: raw.label ?? "",
    href: raw.href ?? ""
  };
}

function mapAnimeHome(raw: any): AnimeHome {
  return {
    source: raw.source ?? "",
    updatedAt: raw.updated_at ?? raw.updatedAt ?? null,
    menuTags: Array.isArray(raw.menu_tags ?? raw.menuTags)
      ? (raw.menu_tags ?? raw.menuTags).map((group: any) => ({
          id: String(group.id ?? ""),
          title: group.title ?? "",
          href: group.href ?? null,
          items: Array.isArray(group.items) ? group.items.map(mapAnimeTagLink) : []
        }))
      : [],
    carousel: Array.isArray(raw.carousel) ? raw.carousel.map(mapAnimeItem) : [],
    sections: Array.isArray(raw.sections)
      ? raw.sections.map((section: any) => ({
          id: String(section.id ?? ""),
          title: section.title ?? "",
          items: Array.isArray(section.items) ? section.items.map(mapAnimeItem) : []
        }))
      : []
  };
}

function mapAnimeDetail(raw: any): AnimeDetail {
  return {
    url: raw.url ?? "",
    title: raw.title ?? "",
    description: raw.description ?? null,
    coverImage: raw.cover_image ?? raw.coverImage ?? null,
    bannerImage: raw.banner_image ?? raw.bannerImage ?? null,
    qualityLabel: raw.quality_label ?? raw.qualityLabel ?? null,
    metadata: Array.isArray(raw.metadata)
      ? raw.metadata.map((entry: any) => ({
          key: entry.key ?? "",
          value: entry.value ?? ""
        }))
      : [],
    breadcrumbs: Array.isArray(raw.breadcrumbs)
      ? raw.breadcrumbs.map(mapAnimeTagLink)
      : [],
    episodes: Array.isArray(raw.episodes)
      ? raw.episodes.map((episode: any) => ({
          label: episode.label ?? "Watch",
          url: episode.url ?? ""
        }))
      : []
  };
}

function mapAnimeEpisodeSource(raw: any): AnimeEpisodeSource {
  return {
    url: raw.url ?? "",
    title: raw.title ?? "",
    qualityLabel: raw.quality_label ?? raw.qualityLabel ?? null,
    serverGroups: Array.isArray(raw.server_groups ?? raw.serverGroups)
      ? (raw.server_groups ?? raw.serverGroups).map((group: any) => ({
          name: group.name ?? "Server",
          episodes: Array.isArray(group.episodes)
            ? group.episodes.map((episode: any) => ({
                label: episode.label ?? "Episode",
                url: episode.url ?? "",
                sourceKey: episode.source_key ?? episode.sourceKey ?? null,
                playMode: episode.play_mode ?? episode.playMode ?? null,
                episodeId: episode.episode_id ?? episode.episodeId ?? null,
                episodeHash: episode.episode_hash ?? episode.episodeHash ?? null
              }))
            : []
        }))
      : [],
    mediaUrls: Array.isArray(raw.media_urls) ? raw.media_urls : [],
    playerScripts: Array.isArray(raw.player_scripts) ? raw.player_scripts : [],
    playerHints:
      raw.player_hints && typeof raw.player_hints === "object" ? raw.player_hints : {}
  };
}

function mapFixOption(raw: any): FixOption {
  return {
    link: raw.link ?? "",
    name: raw.name ?? null,
    note: raw.note ?? null,
    version: raw.version ?? null,
    size: raw.size ?? null,
    recommended: Boolean(raw.recommended)
  };
}

function mapFixGuide(raw: any, kind: "online-fix" | "bypass", fallbackName: string) {
  const defaultSteps =
    kind === "bypass"
      ? [
          { title: "Step 1", description: "Close the game and launcher before applying files." },
          { title: "Step 2", description: "Extract selected package to a temporary folder." },
          { title: "Step 3", description: "Copy files to game directory and replace existing files." },
          { title: "Step 4", description: "Launch game using required executable if provided." }
        ]
      : [
          { title: "Step 1", description: "Close the game before applying online-fix files." },
          { title: "Step 2", description: "Extract selected package to a temporary folder." },
          { title: "Step 3", description: "Copy all files to game directory and replace existing files." },
          { title: "Step 4", description: "Start the game and verify online/co-op features." }
        ];

  const stepSource = Array.isArray(raw?.steps) ? raw.steps : [];
  const steps = stepSource
    .map((step: any, index: number) => {
      if (typeof step === "string") {
        return { title: `Step ${index + 1}`, description: step };
      }
      const description = step?.description;
      if (!description) return null;
      return {
        title: step?.title || `Step ${index + 1}`,
        description
      };
    })
    .filter(Boolean) as Array<{ title: string; description: string }>;

  const toStringArray = (value: any): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) {
      return value.filter((item) => typeof item === "string");
    }
    return [];
  };

  return {
    title: raw?.title || `${fallbackName} setup guide`,
    summary: raw?.summary ?? null,
    steps: steps.length > 0 ? steps : defaultSteps,
    warnings: toStringArray(raw?.warnings),
    notes: toStringArray(raw?.notes),
    updatedAt: raw?.updated_at ?? raw?.updatedAt ?? null
  };
}

function resolveFixEntryDisplayName(
  appId: string,
  rawName: unknown,
  steamName: unknown,
  options: FixOption[]
): string {
  const optionNames = options
    .map((option) => (typeof option.name === "string" ? option.name.trim() : ""))
    .filter((value) => value.length > 0);
  const candidates = [
    typeof rawName === "string" ? rawName.trim() : "",
    ...optionNames,
    typeof steamName === "string" ? steamName.trim() : "",
  ].filter((value) => value.length > 0);

  for (const candidate of candidates) {
    if (!isPlaceholderSteamName(candidate, appId)) {
      return candidate;
    }
  }
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  return appId;
}

function mapFixEntry(raw: any): FixEntry {
    const appId = String(raw.app_id ?? raw.appId ?? "");
    const options = Array.isArray(raw.options) ? raw.options.map(mapFixOption) : [];
    const steam = raw.steam ? mapSteamCatalogItem(raw.steam) : null;
    const name = resolveFixEntryDisplayName(appId, raw.name, steam?.name, options);
    const patchedSteam =
      steam && isPlaceholderSteamName(steam.name, appId) ? { ...steam, name } : steam;
    return {
      appId,
      name,
      steam: patchedSteam,
      options,
      denuvo: Boolean(
        raw.denuvo ??
          raw.has_denuvo ??
          raw.hasDenuvo ??
          raw.steam?.denuvo ??
          raw.steam?.has_denuvo ??
          raw.steam?.hasDenuvo ??
          false
      )
    };
  }

function mapFixEntryDetail(raw: any, fallbackKind: "online-fix" | "bypass"): FixEntryDetail {
  const base = mapFixEntry(raw);
  const categoryId = String(raw?.category?.id ?? "").toLowerCase();
  const denuvo = base.denuvo || categoryId === "denuvo";
  return {
    ...base,
    denuvo,
    kind: raw?.kind ?? fallbackKind,
    category: raw?.category
      ? {
          id: String(raw.category.id ?? ""),
          name: raw.category.name ?? "",
          description: raw.category.description ?? null,
          icon: raw.category.icon ?? null
        }
      : null,
    guide: mapFixGuide(raw?.guide, fallbackKind, base.steam?.name || base.name)
  };
}

function mapDownloadOptions(raw: any): DownloadOptions {
  return {
    appId: String(raw.app_id ?? raw.appId ?? ""),
    name: raw.name ?? "",
    sizeBytes: raw.size_bytes ?? raw.sizeBytes ?? null,
    sizeLabel: raw.size_label ?? raw.sizeLabel ?? null,
    methods: Array.isArray(raw.methods)
      ? raw.methods.map((method: any) => ({
          id: method.id ?? "",
          label: method.label ?? method.id ?? "",
          description: method.description ?? null,
          note: method.note ?? null,
          noteKey: method.note_key ?? method.noteKey ?? null,
          availabilityCode: method.availability_code ?? method.availabilityCode ?? null,
          recommended: Boolean(method.recommended),
          enabled: method.enabled ?? true
        }))
      : [],
    versions: Array.isArray(raw.versions)
      ? raw.versions.map((version: any) => ({
          id: version.id ?? "",
          label: version.label ?? version.id ?? "",
          isLatest: Boolean(version.is_latest ?? version.isLatest),
          sizeBytes: version.size_bytes ?? version.sizeBytes ?? null
        }))
      : [],
    onlineFix: Array.isArray(raw.online_fix) ? raw.online_fix.map(mapFixOption) : [],
    bypass: raw.bypass ? mapFixOption(raw.bypass) : null,
    installRoot: raw.install_root ?? raw.installRoot ?? "",
    installPath: raw.install_path ?? raw.installPath ?? "",
    freeBytes: raw.free_bytes ?? raw.freeBytes ?? null,
    totalBytes: raw.total_bytes ?? raw.totalBytes ?? null
  };
}

function mapWorkshopItem(raw: any): WorkshopItem {
  return {
    id: raw.id,
    gameId: raw.game_id,
    creatorId: raw.creator_id,
    title: raw.title,
    description: raw.description ?? undefined,
    itemType: raw.item_type ?? undefined,
    visibility: raw.visibility,
    totalDownloads: raw.total_downloads ?? 0,
    totalSubscriptions: raw.total_subscriptions ?? 0,
    ratingUp: raw.rating_up ?? 0,
    ratingDown: raw.rating_down ?? 0,
    tags: raw.tags ?? [],
    previewImageUrl: raw.preview_image_url ?? undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    source: raw.source ?? undefined
  };
}

function mapWorkshopSubscription(raw: any): WorkshopSubscription {
  return {
    id: raw.id,
    workshopItemId: raw.workshop_item_id,
    subscribedAt: raw.subscribed_at,
    autoUpdate: raw.auto_update,
    item: raw.item ? mapWorkshopItem(raw.item) : undefined
  };
}

function mapInventoryItem(raw: any): InventoryItem {
  return {
    id: raw.id,
    userId: raw.user_id,
    gameId: raw.game_id ?? null,
    itemType: raw.item_type,
    name: raw.name,
    rarity: raw.rarity,
    quantity: raw.quantity ?? 1,
    metadata: raw.metadata ?? raw.item_metadata ?? {},
    createdAt: raw.created_at
  };
}

function mapTradeOffer(raw: any): TradeOffer {
  return {
    id: raw.id,
    fromUserId: raw.from_user_id,
    toUserId: raw.to_user_id,
    offeredItemIds: raw.offered_item_ids ?? [],
    requestedItemIds: raw.requested_item_ids ?? [],
    status: raw.status,
    createdAt: raw.created_at,
    expiresAt: raw.expires_at ?? null
  };
}

function mapWishlistEntry(raw: any): WishlistEntry {
  return {
    id: raw.id,
    createdAt: raw.created_at,
    game: mapGame(raw.game, 0)
  };
}

function mapActivityEvent(raw: any): ActivityEvent {
  return {
    id: raw.id,
    userId: raw.user_id,
    eventType: raw.event_type,
    payload: raw.payload ?? {},
    createdAt: raw.created_at
  };
}

function mapCommunityComment(raw: any): CommunityComment {
  return {
    id: raw.id,
    userId: raw.user_id,
    username: raw.username ?? "unknown",
    displayName: raw.display_name ?? null,
    avatarUrl: raw.avatar_url ?? null,
    message: raw.message ?? "",
    appId: raw.app_id ?? null,
    appName: raw.app_name ?? null,
    createdAt: raw.created_at
  };
}

function mapReview(raw: any): Review {
  return {
    id: raw.id,
    user: {
      id: raw.user?.id,
      username: raw.user?.username,
      displayName: raw.user?.display_name ?? null
    },
    gameId: raw.game_id,
    rating: raw.rating,
    title: raw.title ?? null,
    body: raw.body ?? null,
    recommended: raw.recommended,
    helpfulCount: raw.helpful_count ?? 0,
    createdAt: raw.created_at
  };
}

function mapBundle(raw: any): Bundle {
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    description: raw.description ?? null,
    price: raw.price ?? 0,
    discountPercent: raw.discount_percent ?? 0,
    gameIds: raw.game_ids ?? []
  };
}

function mapDlc(raw: any): DlcItem {
  return {
    id: raw.id,
    baseGameId: raw.base_game_id,
    title: raw.title,
    description: raw.description ?? null,
    price: raw.price ?? 0,
    isSeasonPass: Boolean(raw.is_season_pass),
    releaseDate: raw.release_date ?? null
  };
}

function mapPreorder(raw: any): Preorder {
  return {
    id: raw.id,
    status: raw.status,
    preorderAt: raw.preorder_at,
    preloadAvailable: Boolean(raw.preload_available),
    game: mapGame(raw.game, 0)
  };
}

function mapRemoteDownload(raw: any): RemoteDownload {
  return {
    id: raw.id,
    game: mapGame(raw.game, 0),
    targetDevice: raw.target_device,
    status: raw.status,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at
  };
}

function mapGraphicsConfig(raw: any): GraphicsConfig {
  return {
    id: raw.id ?? null,
    gameId: raw.game_id ?? raw.gameId ?? "",
    dx12Flags: Array.isArray(raw.dx12_flags) ? raw.dx12_flags : [],
    dx11Flags: Array.isArray(raw.dx11_flags) ? raw.dx11_flags : [],
    vulkanFlags: Array.isArray(raw.vulkan_flags) ? raw.vulkan_flags : [],
    overlayEnabled: Boolean(raw.overlay_enabled),
    recommendedApi: raw.recommended_api ?? null,
    executable: raw.executable ?? null,
    gameDir: raw.game_dir ?? null,
    source: raw.source ?? null
  };
}

function mapLaunchConfig(raw: any): LaunchConfig {
  return {
    gameId: raw.game_id ?? raw.gameId ?? "",
    appId: raw.app_id ?? raw.appId ?? null,
    rendererPriority: Array.isArray(raw.renderer_priority) ? raw.renderer_priority : [],
    recommendedApi: raw.recommended_api ?? "dx12",
    overlayEnabled: Boolean(raw.overlay_enabled),
    flags: raw.flags ?? {},
    launchArgs: Array.isArray(raw.launch_args) ? raw.launch_args : [],
    executable: raw.executable ?? null,
    gameDir: raw.game_dir ?? null,
    source: raw.source ?? "default"
  };
}

function mapDeveloperAnalytics(raw: any): DeveloperAnalytics {
  return {
    gameId: raw.game_id,
    metrics: raw.metrics ?? {},
    createdAt: raw.created_at
  };
}

function mapDeveloperDepot(raw: any): DeveloperDepot {
  return {
    id: raw.id,
    gameId: raw.game_id,
    name: raw.name,
    platform: raw.platform,
    branch: raw.branch,
    createdAt: raw.created_at
  };
}

function mapDeveloperBuild(raw: any): DeveloperBuild {
  return {
    id: raw.id,
    depotId: raw.depot_id,
    version: raw.version,
    manifest: raw.manifest_json ?? {},
    createdAt: raw.created_at
  };
}

export async function fetchWorkshopItems(
  token: string,
  gameId?: string,
  search?: string
): Promise<WorkshopItem[]> {
  const params = new URLSearchParams();
  if (gameId) params.set("game_id", gameId);
  if (search) params.set("search", search);
  const suffix = params.toString();
  const data = await requestJson<any[]>(
    `/workshop/items${suffix ? `?${suffix}` : ""}`,
    {},
    token
  );
  return data.map(mapWorkshopItem);
}

export async function fetchSteamWorkshopItems(
  appId?: string,
  search?: string
): Promise<WorkshopItem[]> {
  const params = new URLSearchParams();
  if (appId) params.set("app_id", appId);
  if (search) params.set("search", search);
  const suffix = params.toString();
  const data = await requestJson<any[]>(
    `/workshop/steam${suffix ? `?${suffix}` : ""}`
  );
  return data.map(mapWorkshopItem);
}

export async function fetchLocalWorkshopInstalls(appIds: string[]): Promise<LocalWorkshopInstall[]> {
  if (!isTauri()) return [];
  if (!appIds.length) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const installs = await invoke<LocalWorkshopInstall[]>("list_local_workshop_items", {
    appIds
  });
  return Array.isArray(installs) ? installs : [];
}

export async function syncWorkshopToGame(
  appId: string,
  itemIds?: string[]
): Promise<WorkshopSyncResult | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<WorkshopSyncResult>("sync_workshop_to_game", {
    appId,
    itemIds: itemIds && itemIds.length > 0 ? itemIds : undefined
  });
  return result || null;
}

export async function fetchWorkshopVersions(itemId: string, token: string): Promise<WorkshopVersion[]> {
  const data = await requestJson<any[]>(`/workshop/items/${itemId}/versions`, {}, token);
  return data.map((raw) => ({
    id: raw.id,
    workshopItemId: raw.workshop_item_id,
    version: raw.version,
    changelog: raw.changelog ?? undefined,
    fileSize: raw.file_size ?? 0,
    downloadUrl: raw.download_url ?? undefined,
    createdAt: raw.created_at
  }));
}

export async function fetchWorkshopSubscriptions(token: string): Promise<WorkshopSubscription[]> {
  const data = await requestJson<any[]>("/workshop/subscriptions", {}, token);
  return data.map(mapWorkshopSubscription);
}

export async function subscribeWorkshopItem(itemId: string, token: string): Promise<WorkshopSubscription> {
  const data = await requestJson<any>(`/workshop/items/${itemId}/subscribe`, { method: "POST" }, token);
  return mapWorkshopSubscription(data);
}

export async function unsubscribeWorkshopItem(itemId: string, token: string) {
  return requestJson<any>(`/workshop/items/${itemId}/subscribe`, { method: "DELETE" }, token);
}

export async function fetchDiscoveryQueue(token: string): Promise<Game[]> {
  const data = await requestJson<any[]>("/discovery/queue", {}, token);
  return data.map((raw, index) => mapGame(raw, index));
}

export async function refreshDiscoveryQueue(token: string): Promise<Game[]> {
  const data = await requestJson<any[]>("/discovery/queue/refresh", { method: "POST" }, token);
  return data.map((raw, index) => mapGame(raw, index));
}

export async function fetchAnimeHome(params?: {
  limitPerSection?: number;
  refresh?: boolean;
}): Promise<AnimeHome> {
  const query = new URLSearchParams();
  if (params?.limitPerSection) {
    query.set("limit_per_section", String(params.limitPerSection));
  }
  if (params?.refresh) {
    query.set("refresh", "true");
  }
  const suffix = query.toString();
  const data = await requestJson<any>(
    `/discovery/anime/home${suffix ? `?${suffix}` : ""}`
  );
  return mapAnimeHome(data);
}

export async function searchAnimeCatalog(
  query: string,
  params?: { limit?: number; refresh?: boolean }
): Promise<AnimeItem[]> {
  const queryParams = new URLSearchParams();
  queryParams.set("q", query);
  if (params?.limit) {
    queryParams.set("limit", String(params.limit));
  }
  if (params?.refresh) {
    queryParams.set("refresh", "true");
  }
  const data = await requestJson<any[]>(
    `/discovery/anime/search?${queryParams.toString()}`
  );
  return Array.isArray(data) ? data.map(mapAnimeItem) : [];
}

export async function fetchAnimeDetail(
  detailUrl: string,
  episodeLimit = 40
): Promise<AnimeDetail> {
  const query = new URLSearchParams();
  query.set("url", detailUrl);
  query.set("episode_limit", String(episodeLimit));
  const data = await requestJson<any>(`/discovery/anime/detail?${query.toString()}`);
  return mapAnimeDetail(data);
}

export async function fetchAnimeEpisodeSources(
  episodeUrl: string
): Promise<AnimeEpisodeSource> {
  const query = new URLSearchParams();
  query.set("url", episodeUrl);
  const data = await requestJson<any>(`/discovery/anime/episode?${query.toString()}`);
  return mapAnimeEpisodeSource(data);
}

export async function fetchWishlist(token: string): Promise<WishlistEntry[]> {
  const data = await requestJson<any[]>("/wishlist", {}, token);
  return data.map(mapWishlistEntry);
}

export async function addToWishlist(gameId: string, token: string): Promise<WishlistEntry> {
  const data = await requestJson<any>(`/wishlist/${gameId}`, { method: "POST" }, token);
  return mapWishlistEntry(data);
}

export async function removeFromWishlist(gameId: string, token: string) {
  return requestJson<any>(`/wishlist/${gameId}`, { method: "DELETE" }, token);
}

export async function fetchInventory(token: string): Promise<InventoryItem[]> {
  const data = await requestJson<any[]>("/inventory", {}, token);
  return data.map(mapInventoryItem);
}

export async function dropInventoryCard(gameId: string, token: string): Promise<InventoryItem> {
  const data = await requestJson<any>(`/inventory/cards/drop/${gameId}`, { method: "POST" }, token);
  return mapInventoryItem(data);
}

export async function craftInventoryBadge(gameId: string, token: string): Promise<InventoryItem> {
  const data = await requestJson<any>(`/inventory/badges/craft/${gameId}`, { method: "POST" }, token);
  return mapInventoryItem(data);
}

export async function fetchTrades(token: string): Promise<TradeOffer[]> {
  const data = await requestJson<any[]>("/inventory/trades", {}, token);
  return data.map(mapTradeOffer);
}

export async function createTradeOffer(
  token: string,
  payload: { toUserId: string; offeredItemIds: string[]; requestedItemIds: string[] }
): Promise<TradeOffer> {
  const data = await requestJson<any>(
    "/inventory/trades",
    {
      method: "POST",
      body: JSON.stringify({
        to_user_id: payload.toUserId,
        offered_item_ids: payload.offeredItemIds,
        requested_item_ids: payload.requestedItemIds
      })
    },
    token
  );
  return mapTradeOffer(data);
}

export async function respondTrade(
  token: string,
  tradeId: string,
  action: "accept" | "decline" | "cancel"
): Promise<TradeOffer> {
  const data = await requestJson<any>(`/inventory/trades/${tradeId}/${action}`, { method: "POST" }, token);
  return mapTradeOffer(data);
}

export async function fetchActivity(token: string): Promise<ActivityEvent[]> {
  const data = await requestJson<any[]>("/community/activity", {}, token);
  return data.map(mapActivityEvent);
}

export async function fetchReviews(gameId: string): Promise<Review[]> {
  const data = await requestJson<any[]>(`/community/reviews/${gameId}`);
  return data.map(mapReview);
}

export async function postReview(
  gameId: string,
  token: string,
  payload: { rating: number; title?: string; body?: string; recommended: boolean }
): Promise<Review> {
  const data = await requestJson<any>(
    `/community/reviews/${gameId}`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    token
  );
  return mapReview(data);
}

export async function markReviewHelpful(reviewId: string, token: string): Promise<Review> {
  const data = await requestJson<any>(`/community/reviews/${reviewId}/helpful`, { method: "POST" }, token);
  return mapReview(data);
}

export async function fetchBundles(): Promise<Bundle[]> {
  const data = await requestJson<any[]>("/store/bundles");
  return data.map(mapBundle);
}

export async function fetchDlc(gameId: string): Promise<DlcItem[]> {
  const data = await requestJson<any[]>(`/store/dlc/${gameId}`);
  return data.map(mapDlc);
}

export async function fetchPreorders(token: string): Promise<Preorder[]> {
  const data = await requestJson<any[]>("/store/preorders/me", {}, token);
  return data.map(mapPreorder);
}

export async function preorderGame(gameId: string, token: string): Promise<Preorder> {
  const data = await requestJson<any>(`/store/preorders/${gameId}`, { method: "POST" }, token);
  return mapPreorder(data);
}

export async function fetchRemoteDownloads(token: string): Promise<RemoteDownload[]> {
  const data = await requestJson<any[]>("/remote-downloads", {}, token);
  return data.map(mapRemoteDownload);
}

export async function queueRemoteDownload(
  gameId: string,
  targetDevice: string,
  token: string
): Promise<RemoteDownload> {
  const data = await requestJson<any>(
    "/remote-downloads/queue",
    {
      method: "POST",
      body: JSON.stringify({ game_id: gameId, target_device: targetDevice })
    },
    token
  );
  return mapRemoteDownload(data);
}

export async function fetchUserProfile(token: string): Promise<UserProfile | null> {
  const data = await requestJson<any>("/community/profile/me", {}, token);
  return data.profile
    ? {
        userId: data.profile.user_id,
        nickname: data.profile.nickname ?? data.user?.display_name ?? null,
        avatarUrl: data.profile.avatar_url ?? data.user?.avatar_url ?? null,
        headline: data.profile.headline,
        bio: data.profile.bio,
        location: data.profile.location,
        backgroundImage: data.profile.background_image ?? null,
        socialLinks: data.profile.social_links ?? {}
      }
    : null;
}

export async function updateUserProfile(
  token: string,
  payload: Partial<UserProfile>
): Promise<UserProfile> {
  const data = await requestJson<any>(
    "/community/profile",
    {
      method: "POST",
      body: JSON.stringify({
        nickname: payload.nickname ?? null,
        avatar_url: payload.avatarUrl ?? null,
        headline: payload.headline ?? null,
        bio: payload.bio ?? null,
        location: payload.location ?? null,
        background_image: payload.backgroundImage ?? null,
        social_links: payload.socialLinks ?? null
      })
    },
    token
  );
  return {
    userId: data.user_id,
    nickname: data.nickname ?? null,
    avatarUrl: data.avatar_url ?? null,
    headline: data.headline,
    bio: data.bio,
    location: data.location,
    backgroundImage: data.background_image ?? null,
    socialLinks: data.social_links ?? {}
  };
}

export async function fetchCommunityComments(
  params: { appId?: string; limit?: number } = {}
): Promise<CommunityComment[]> {
  const query = new URLSearchParams();
  if (params.appId) query.set("app_id", params.appId);
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.toString();
  const data = await requestJson<any[]>(`/community/comments${suffix ? `?${suffix}` : ""}`);
  return data.map(mapCommunityComment);
}

export async function postCommunityComment(
  token: string,
  payload: { message: string; appId?: string; appName?: string }
): Promise<CommunityComment> {
  const data = await requestJson<any>(
    "/community/comments",
    {
      method: "POST",
      body: JSON.stringify({
        message: payload.message,
        app_id: payload.appId ?? null,
        app_name: payload.appName ?? null
      })
    },
    token
  );
  return mapCommunityComment(data);
}

export async function fetchDeveloperAnalytics(
  token: string,
  gameId?: string
): Promise<DeveloperAnalytics[]> {
  const params = new URLSearchParams();
  if (gameId) {
    params.set("game_id", gameId);
  }
  const suffix = params.toString();
  const data = await requestJson<any[]>(
    `/developer/analytics${suffix ? `?${suffix}` : ""}`,
    {},
    token
  );
  return data.map(mapDeveloperAnalytics);
}

export async function fetchDeveloperDepots(
  gameId: string,
  token: string
): Promise<DeveloperDepot[]> {
  const data = await requestJson<any[]>(`/developer/games/${gameId}/depots`, {}, token);
  return data.map(mapDeveloperDepot);
}

export async function createDeveloperDepot(
  gameId: string,
  token: string,
  payload: { name: string; platform?: string; branch?: string }
): Promise<DeveloperDepot> {
  const data = await requestJson<any>(
    `/developer/games/${gameId}/depots`,
    {
      method: "POST",
      body: JSON.stringify({
        name: payload.name,
        platform: payload.platform || "windows",
        branch: payload.branch || "main"
      })
    },
    token
  );
  return mapDeveloperDepot(data);
}

export async function fetchDeveloperBuilds(
  depotId: string,
  token: string
): Promise<DeveloperBuild[]> {
  const data = await requestJson<any[]>(`/developer/depots/${depotId}/builds`, {}, token);
  return data.map(mapDeveloperBuild);
}

export async function uploadDeveloperBuild(
  depotId: string,
  token: string,
  payload: { version: string; file: File }
): Promise<DeveloperBuild> {
  const form = new FormData();
  form.append("version", payload.version);
  form.append("file", payload.file);
  const data = await requestForm<any>(`/developer/depots/${depotId}/builds`, form, token);
  return mapDeveloperBuild(data);
}

export async function fetchGames(): Promise<Game[]> {
  const limit = 100;
  const maxPages = 50;
  let page = 1;
  let all: any[] = [];
  while (page <= maxPages) {
    const data = await requestJson<any[]>(`/games?page=${page}&limit=${limit}`);
    if (Array.isArray(data) && data.length > 0) {
      all = all.concat(data);
      if (data.length < limit) {
        break;
      }
    } else {
      break;
    }
    page += 1;
  }
  return all.map((game, index) => mapGame(game, index));
}

export async function login(email: string, password: string) {
  return requestJson<{ access_token: string; refresh_token: string; user: any }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export async function refreshToken(refresh_token: string) {
  return requestJson<{ access_token: string; refresh_token: string; user: any }>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token })
  });
}


export async function register(payload: {
  email: string;
  username: string;
  password: string;
  display_name?: string;
}) {
  return requestJson<AuthUser>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchLibrary(token: string): Promise<LibraryEntry[]> {
  const data = await requestJson<any[]>("/library", {}, token);
  return data.map((entry: any, index: number) => {
    const game = mapGame(entry.game, index);
    return {
      id: entry.id,
      game: {
        ...game,
        installed: Boolean(entry.installed_version),
        playtimeHours: entry.playtime_hours || 0
      },
      installedVersion: entry.installed_version,
      playtimeHours: entry.playtime_hours || 0
    };
  });
}

export async function purchaseGame(gameId: string, token: string): Promise<LibraryEntry> {
  const entry = await requestJson<any>(`/library/purchase/${gameId}`, { method: "POST" }, token);
  const game = mapGame(entry.game, 0);
  return {
    id: entry.id,
    game,
    installedVersion: entry.installed_version,
    playtimeHours: entry.playtime_hours || 0
  };
}

export async function markInstalled(entryId: string, token: string, version = "1.0.0") {
  return requestJson<any>(`/library/${entryId}/install?version=${version}`, { method: "POST" }, token);
}

const activeDownloadStatuses = new Set(["queued", "downloading", "verifying", "paused"]);
const DOWNLOAD_V2_ENABLED = String(import.meta.env.VITE_DOWNLOAD_V2_ENABLED || "").trim() === "1";
const SELF_HEAL_V2_ENABLED = String(import.meta.env.VITE_SELF_HEAL_V2_ENABLED || "").trim() === "1";
const ANTI_DEBUG_V2_ENABLED = String(import.meta.env.VITE_ANTI_DEBUG_V2_ENABLED || "").trim() === "1";
const CDN_V2_ENABLED = String(import.meta.env.VITE_CDN_V2_ENABLED || "").trim() === "1";
const DOWNLOAD_V2_SESSION_MAP_KEY = "otoshi.download.v2.sessions";

export const V2_RUNTIME_FLAGS = {
  DOWNLOAD_V2_ENABLED,
  SELF_HEAL_V2_ENABLED,
  ANTI_DEBUG_V2_ENABLED,
  CDN_V2_ENABLED,
} as const;

type DownloadV2SessionMap = Record<string, { sessionId: string; updatedAt: number }>;
let downloadV2SessionMapCache: DownloadV2SessionMap | null = null;

const loadDownloadV2SessionMap = (): DownloadV2SessionMap => {
  if (downloadV2SessionMapCache) {
    return downloadV2SessionMapCache;
  }
  if (typeof window === "undefined") {
    downloadV2SessionMapCache = {};
    return downloadV2SessionMapCache;
  }
  try {
    const raw = window.localStorage.getItem(DOWNLOAD_V2_SESSION_MAP_KEY);
    if (!raw) {
      downloadV2SessionMapCache = {};
      return downloadV2SessionMapCache;
    }
    const parsed = JSON.parse(raw);
    downloadV2SessionMapCache = parsed && typeof parsed === "object" ? parsed : {};
    return downloadV2SessionMapCache;
  } catch {
    downloadV2SessionMapCache = {};
    return downloadV2SessionMapCache;
  }
};

const persistDownloadV2SessionMap = () => {
  if (typeof window === "undefined" || !downloadV2SessionMapCache) return;
  try {
    window.localStorage.setItem(DOWNLOAD_V2_SESSION_MAP_KEY, JSON.stringify(downloadV2SessionMapCache));
  } catch {
    // Ignore storage write errors.
  }
};

const rememberDownloadV2Session = (downloadId?: string, sessionId?: string) => {
  if (!downloadId || !sessionId) return;
  const map = loadDownloadV2SessionMap();
  map[downloadId] = { sessionId, updatedAt: Date.now() };
  downloadV2SessionMapCache = map;
  persistDownloadV2SessionMap();
};

const forgetDownloadV2Session = (downloadId: string) => {
  const map = loadDownloadV2SessionMap();
  if (!(downloadId in map)) return;
  delete map[downloadId];
  downloadV2SessionMapCache = map;
  persistDownloadV2SessionMap();
};

const getDownloadV2SessionId = (downloadId: string): string | undefined => {
  const map = loadDownloadV2SessionMap();
  return map[downloadId]?.sessionId;
};

const mapV2Status = (rawStatus: unknown, stage: unknown): DownloadTask["status"] => {
  const normalizedStatus = String(rawStatus || "").toLowerCase();
  if (normalizedStatus === "paused" || String(stage || "").toLowerCase() === "transfer_paused") {
    return "paused";
  }
  if (normalizedStatus === "cancelled" || String(stage || "").toLowerCase() === "cancelled") {
    return "cancelled";
  }
  if (normalizedStatus === "completed" || String(stage || "").toLowerCase() === "finalize") {
    return "completed";
  }
  if (normalizedStatus === "failed") {
    return "failed";
  }
  if (normalizedStatus === "verifying" || String(stage || "").toLowerCase() === "verify") {
    return "verifying";
  }
  return "downloading";
};

const mapDownloadTaskFromV2State = (state: any): DownloadTask => {
  const session = state?.session || {};
  const task = state?.task || {};
  const baseline = mapDownloadTaskFromApi({
    ...task,
    id: task?.id || session?.download_id,
    game_id: task?.game_id || session?.game_id,
    game: {
      ...(task?.game || {}),
      id: task?.game?.id || task?.game_id || session?.game_id,
      slug: task?.game?.slug || session?.slug,
      title: task?.game?.title || session?.slug || "Download",
    },
  });
  return {
    ...baseline,
    id: String(session?.download_id || baseline.id),
    sessionId: session?.id || baseline.sessionId,
    protocol: "v2",
    status: mapV2Status(task?.status ?? session?.status, session?.stage),
    gameId: String(task?.game_id || session?.game_id || baseline.gameId || ""),
    gameSlug: session?.slug || baseline.gameSlug,
    eta:
      mapV2Status(task?.status ?? session?.status, session?.stage) === "completed"
        ? "Done"
        : baseline.eta || "--",
  };
};

function formatDownloadSpeed(value: unknown): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "0 MB/s";
  }
  return `${parsed.toFixed(2)} MB/s`;
}

function extractAppIdFromSlug(slug?: string | null): string | undefined {
  if (!slug) return undefined;
  const matched = /^steam-(\d+)$/.exec(String(slug).trim().toLowerCase());
  return matched?.[1];
}

function mapDownloadTaskFromApi(task: any): DownloadTask {
  const rawStatus = String(task?.status || "queued").toLowerCase();
  const appId =
    task?.game?.steam_app_id ||
    task?.game?.steamAppId ||
    task?.app_id ||
    task?.appId ||
    extractAppIdFromSlug(task?.game?.slug);
  const imageCandidate =
    task?.game?.header_image ||
    task?.game?.headerImage ||
    task?.game?.hero_image ||
    task?.game?.heroImage ||
    null;
  const iconCandidate =
    task?.game?.icon_image ||
    task?.game?.iconImage ||
    imageCandidate;
  const etaMinutes = Number(task?.eta_minutes);
  const downloadedBytes = Number(task?.downloaded_bytes ?? task?.downloadedBytes);
  const totalBytes = Number(task?.total_bytes ?? task?.totalBytes);
  const speedMbps = Number(task?.speed_mbps ?? task?.speedMpbs ?? task?.speedMbps ?? 0);
  const networkBps = Number(task?.network_bps ?? task?.networkBps ?? 0);
  const diskReadBps = Number(task?.disk_read_bps ?? task?.diskReadBps ?? 0);
  const diskWriteBps = Number(task?.disk_write_bps ?? task?.diskWriteBps ?? 0);
  const readBytes = Number(task?.read_bytes ?? task?.readBytes ?? 0);
  const writtenBytes = Number(task?.written_bytes ?? task?.writtenBytes ?? 0);
  const remainingBytes = Number(task?.remaining_bytes ?? task?.remainingBytes ?? 0);
  const speedHistory = Array.isArray(task?.speed_history ?? task?.speedHistory)
    ? (task?.speed_history ?? task?.speedHistory)
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value))
    : [];
  const updatedAt = Number(task?.updated_at ?? task?.updatedAt ?? 0);

  return {
    id: String(task?.id ?? ""),
    sessionId: task?.session_id ?? task?.sessionId ?? undefined,
    protocol: task?.protocol === "v2" ? "v2" : "v1",
    title: String(task?.game?.title || task?.game?.name || task?.title || "Download"),
    progress: Number(task?.progress ?? 0),
    speed: formatDownloadSpeed(speedMbps),
    speedMbps: Number.isFinite(speedMbps) ? speedMbps : 0,
    status: (activeDownloadStatuses.has(rawStatus) || rawStatus === "completed" || rawStatus === "failed" || rawStatus === "cancelled"
      ? rawStatus
      : "queued") as DownloadTask["status"],
    eta: Number.isFinite(etaMinutes) && etaMinutes > 0 ? `${etaMinutes} min` : rawStatus === "completed" ? "Done" : "--",
    etaMinutes: Number.isFinite(etaMinutes) ? etaMinutes : 0,
    gameId: String(task?.game?.id || task?.game_id || task?.gameId || appId || ""),
    gameSlug: task?.game?.slug ?? task?.game_slug ?? undefined,
    appId: appId ? String(appId) : undefined,
    imageUrl: imageCandidate || undefined,
    iconUrl: iconCandidate || imageCandidate || undefined,
    downloadedBytes: Number.isFinite(downloadedBytes) ? downloadedBytes : undefined,
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : undefined,
    networkBps: Number.isFinite(networkBps) ? networkBps : 0,
    diskReadBps: Number.isFinite(diskReadBps) ? diskReadBps : 0,
    diskWriteBps: Number.isFinite(diskWriteBps) ? diskWriteBps : 0,
    readBytes: Number.isFinite(readBytes) ? readBytes : 0,
    writtenBytes: Number.isFinite(writtenBytes) ? writtenBytes : 0,
    remainingBytes: Number.isFinite(remainingBytes) ? remainingBytes : undefined,
    speedHistory,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
  };
}

export async function fetchDownloads(token?: string): Promise<DownloadTask[]> {
  // Return empty array if no token - endpoint allows unauthenticated access
  // but we optimize by not making the request at all
  if (!token) {
    return [];
  }
  const data = await requestJson<any[]>("/downloads", {}, token);
  let tasks = data.map(mapDownloadTaskFromApi);

  if (DOWNLOAD_V2_ENABLED) {
    const links = Object.entries(loadDownloadV2SessionMap());
    if (links.length > 0) {
      try {
        const { getDownloadSessionStateV2 } = await import("./api_v2");
        const v2Tasks: DownloadTask[] = [];
        for (const [downloadId, info] of links) {
          try {
            const state = await getDownloadSessionStateV2(info.sessionId, token);
            const mapped = mapDownloadTaskFromV2State(state);
            rememberDownloadV2Session(mapped.id, mapped.sessionId);
            v2Tasks.push(mapped);
          } catch (error: any) {
            const raw = String(error?.message || error || "");
            if (raw.includes("404")) {
              forgetDownloadV2Session(downloadId);
            }
          }
        }
        const byId = new Map<string, DownloadTask>(tasks.map((task) => [task.id, task]));
        for (const v2Task of v2Tasks) {
          byId.set(v2Task.id, { ...(byId.get(v2Task.id) || {}), ...v2Task, protocol: "v2" });
        }
        tasks = Array.from(byId.values());
      } catch {
        // Keep v1 list if v2 state fetch fails.
      }
    }
  }

  return tasks;
}

export async function startDownload(gameId: string, token: string): Promise<DownloadTask> {
  const task = await requestJson<any>(`/downloads/start/${gameId}`, { method: "POST" }, token);
  return mapDownloadTaskFromApi(task);
}

export async function startSteamDownload(appId: string, token: string): Promise<DownloadTask> {
  const task = await requestJson<any>(`/downloads/steam/${appId}`, { method: "POST" }, token);
  return mapDownloadTaskFromApi(task);
}

export async function startSteamDownloadWithOptions(
  appId: string,
  payload: DownloadPreparePayload,
  token: string
): Promise<DownloadTask> {
  // Validate token exists
  if (!token || token.trim() === "") {
    throw new Error("Authentication required. Please login to download games.");
  }

  if (DOWNLOAD_V2_ENABLED) {
    try {
      const { createDownloadSessionV2 } = await import("./api_v2");
      const state = await createDownloadSessionV2(
        {
          app_id: appId,
          method: payload.method,
          version: payload.version,
          install_path: payload.installPath,
          create_subfolder: payload.createSubfolder,
        },
        token
      );
      const mapped = mapDownloadTaskFromV2State(state);
      rememberDownloadV2Session(mapped.id, mapped.sessionId);

      if (isTauri() && state?.session?.id && state?.session?.download_id) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("start_download_v2", {
          payload: {
            gameId: state.session.game_id,
            slug: state.session.slug,
            downloadId: state.session.download_id,
            method: payload.method,
            version: payload.version,
            channel: state.session.channel,
            installPath: payload.installPath,
          },
        });
      }
      return mapped;
    } catch (error) {
      console.warn("[DownloadV2] Falling back to v1 start flow", error);
    }
  }

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const createSubfolder = payload.createSubfolder ?? true;
    const invokePayloadCandidates: any[] = [
      {
        appId,
        token,
        payload: {
          method: payload.method,
          version: payload.version,
          installPath: payload.installPath,
          createSubfolder
        }
      },
      {
        appId,
        token,
        payload: {
          method: payload.method,
          version: payload.version,
          install_path: payload.installPath,
          create_subfolder: createSubfolder
        }
      },
      {
        app_id: appId,
        token,
        payload: {
          method: payload.method,
          version: payload.version,
          installPath: payload.installPath,
          createSubfolder
        }
      },
      {
        app_id: appId,
        token,
        payload: {
          method: payload.method,
          version: payload.version,
          install_path: payload.installPath,
          create_subfolder: createSubfolder
        }
      }
    ];

    let lastError: unknown = null;
    for (let attempt = 0; attempt < invokePayloadCandidates.length; attempt += 1) {
      const invokePayload = invokePayloadCandidates[attempt];
      try {
        console.log("[Download] invoke start_steam_download", {
          appId,
          method: payload.method,
          version: payload.version,
          installPath: payload.installPath,
          attempt: attempt + 1
        });
        const task = await invoke<any>("start_steam_download", invokePayload);
        console.log("[Download] start_steam_download success", {
          taskId: task?.id,
          status: task?.status,
          gameId: task?.game?.id,
          attempt: attempt + 1
        });

        return mapDownloadTaskFromApi(task);
      } catch (error: any) {
        lastError = error;
        const raw =
          typeof error === "string"
            ? error
            : error?.message
              ? String(error.message)
              : JSON.stringify(error ?? "Unknown error");
        const isArgShapeError = /invalid args|missing required key|unknown field/i.test(raw);
        console.warn("[Download] start_steam_download invoke attempt failed", {
          attempt: attempt + 1,
          isArgShapeError,
          raw
        });
        if (!isArgShapeError || attempt === invokePayloadCandidates.length - 1) {
          console.error("[Download] start_steam_download failed", {
            appId,
            payload,
            error
          });
          if (raw.includes("Authentication required") || raw.includes("401")) {
            throw new Error("Authentication required. Please login to download games.");
          }
          throw new Error(raw);
        }
      }
    }

    const fallbackRaw =
      typeof lastError === "string"
        ? lastError
        : (lastError as any)?.message
          ? String((lastError as any).message)
          : "Unknown invoke error";
    throw new Error(fallbackRaw);
  }
  
  try {
    const task = await requestJson<any>(
      `/downloads/steam/${appId}/start`,
      {
        method: "POST",
        body: JSON.stringify({
          method: payload.method,
          version: payload.version,
          install_path: payload.installPath,
          create_subfolder: payload.createSubfolder
        })
      },
      token
    );
    return mapDownloadTaskFromApi(task);
  } catch (error: any) {
    if (error.message?.includes("401") || error.message?.includes("Authentication required")) {
      throw new Error("Authentication required. Please login to download games.");
    }
    throw error;
  }
}

export async function pauseDownload(downloadId: string, token: string) {
  if (DOWNLOAD_V2_ENABLED) {
    const sessionId = getDownloadV2SessionId(downloadId);
    if (sessionId) {
      if (!token) {
        throw new Error("Authentication required.");
      }
      const { controlDownloadSessionV2 } = await import("./api_v2");
      const state = await controlDownloadSessionV2(sessionId, "pause", token);
      const mapped = mapDownloadTaskFromV2State(state);
      rememberDownloadV2Session(mapped.id, mapped.sessionId);
      return mapped;
    }
  }
  const task = await requestJson<any>(`/downloads/${downloadId}/pause`, { method: "POST" }, token);
  return mapDownloadTaskFromApi(task);
}

export async function resumeDownload(downloadId: string, token: string) {
  if (DOWNLOAD_V2_ENABLED) {
    const sessionId = getDownloadV2SessionId(downloadId);
    if (sessionId) {
      if (!token) {
        throw new Error("Authentication required.");
      }
      const { controlDownloadSessionV2 } = await import("./api_v2");
      const state = await controlDownloadSessionV2(sessionId, "resume", token);
      const mapped = mapDownloadTaskFromV2State(state);
      rememberDownloadV2Session(mapped.id, mapped.sessionId);
      return mapped;
    }
  }
  const task = await requestJson<any>(`/downloads/${downloadId}/resume`, { method: "POST" }, token);
  return mapDownloadTaskFromApi(task);
}

export async function cancelDownload(downloadId: string, token: string) {
  if (DOWNLOAD_V2_ENABLED) {
    const sessionId = getDownloadV2SessionId(downloadId);
    if (sessionId) {
      if (!token) {
        throw new Error("Authentication required.");
      }
      const { controlDownloadSessionV2 } = await import("./api_v2");
      const state = await controlDownloadSessionV2(sessionId, "cancel", token);
      const mapped = mapDownloadTaskFromV2State(state);
      rememberDownloadV2Session(mapped.id, mapped.sessionId);
      return mapped;
    }
  }
  const task = await requestJson<any>(`/downloads/${downloadId}/cancel`, { method: "POST" }, token);
  return mapDownloadTaskFromApi(task);
}

export async function logout(token: string) {
  return requestJson<any>("/auth/logout", { method: "POST" }, token);
}

export async function fetchLicensePublicKey() {
  return requestJson<{ public_key: string }>("/licenses/public-key");
}

export async function issueLicense(
  gameId: string,
  token: string,
  hardwareId?: string | null
): Promise<SignedLicense> {
  return requestJson<SignedLicense>(
    "/licenses/issue",
    {
      method: "POST",
      body: JSON.stringify({
        game_id: gameId,
        hardware_id: hardwareId
      })
    },
    token
  );
}

export async function activateLicense(
  licenseId: string,
  token: string,
  hardwareId?: string | null
) {
  const query = hardwareId ? `?hardware_id=${encodeURIComponent(hardwareId)}` : "";
  return requestJson<any>(`/licenses/${licenseId}/activate${query}`, { method: "POST" }, token);
}

export async function requestAchievementUnlock(
  gameId: string,
  achievementKey: string,
  token: string
) {
  return requestJson<any>(
    "/achievements/unlock",
    {
      method: "POST",
      body: JSON.stringify({ game_id: gameId, achievement_key: achievementKey })
    },
    token
  );
}

/**
 * Clear frontend cache for a specific game or all games
 * This will force a fresh fetch of DLC, achievements, news, etc. on next load
 */
export function clearGameCache(appId?: string): void {
  try {
    // Clear localStorage game cache
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      // Clear specific game cache
      if (appId && key.includes(`game:${appId}`)) {
        localStorage.removeItem(key);
      }
      // Clear extended data cache
      else if (appId && key.includes(`extended:${appId}`)) {
        localStorage.removeItem(key);
      }
      // Clear all game caches
      else if (!appId && (key.includes('game:') || key.includes('extended:'))) {
        localStorage.removeItem(key);
      }
    });
    
    // Clear sessionStorage as well
    const sessionKeys = Object.keys(sessionStorage);
    sessionKeys.forEach(key => {
      if (appId && (key.includes(`game:${appId}`) || key.includes(`extended:${appId}`))) {
        sessionStorage.removeItem(key);
      } else if (!appId && (key.includes('game:') || key.includes('extended:'))) {
        sessionStorage.removeItem(key);
      }
    });

    console.log(`[Cache] Cleared ${appId ? `cache for app ${appId}` : 'all game cache'}`);
  } catch (err) {
    console.error('[Cache] Error clearing cache:', err);
  }

  // Also clear backend cache so DLC/news tabs don't stay stale in packaged runtime.
  if (appId) {
    const baseUrl = getPreferredApiBase();
    fetch(`${baseUrl}/steam/games/${encodeURIComponent(appId)}/cache/clear`, {
      method: "POST",
    }).catch(() => {
      // Ignore backend cache clear failures; frontend cache already cleared.
    });
  }
}

/**
 * Clear ONLY backend-side Steam cache for a given appId.
 * Use this when we detect incomplete/stale Steam detail payloads (missing screenshots/movies).
 */
export async function clearSteamGameBackendCache(appId: string): Promise<void> {
  await requestJson(`/steam/games/${encodeURIComponent(appId)}/cache/clear`, {
    method: "POST"
  });
}

export async function buildOAuthStartUrl(provider: string, next: string = "/"): Promise<{url: string; requestId?: string}> {
  const baseUrl = getPreferredApiBase();

  if (isTauri()) {
    const requestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const redirect = `otoshi://oauth/callback?next=${encodeURIComponent(next)}`;
    const url = `${baseUrl}/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(redirect)}&request_id=${encodeURIComponent(requestId)}`;
    return { url, requestId };
  }

  const redirect = `${window.location.origin}/oauth/callback?next=${encodeURIComponent(next)}`;
  const url = `${baseUrl}/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(redirect)}`;
  return { url };
}

export async function pollOAuthStatus(requestId: string): Promise<{ code: string } | null> {
  const baseUrl = getPreferredApiBase();
  try {
    const resp = await fetch(`${baseUrl}/auth/oauth/poll/${requestId}`);
    if (resp.ok) {
        return await resp.json();
    }
  } catch (e) {
      // ignore
  }
  return null;
}
