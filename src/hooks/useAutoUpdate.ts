import { useState, useCallback, useEffect } from 'react';

interface UpdateInfo {
  version: string;
  notes: string;
  pub_date: string;
  url: string;
  signature: string;
}

interface UpdateCheckResult {
  update_available: boolean;
  current_version: string;
  latest_version?: string;
  update_info?: UpdateInfo;
}

interface RemoteConfig {
  features: Record<string, boolean>;
  announcements: Array<{
    id: string;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'error';
    dismissible: boolean;
  }>;
  maintenance_mode: boolean;
  maintenance_message: string;
}

const normalizeApiBase = (base: string): string =>
  String(base || '').trim().replace(/\/+$/, '');

const isLoopbackBase = (base: string): boolean => {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
};

const resolveApiBases = (): string[] => {
  const fromEnv = normalizeApiBase(String(import.meta.env.VITE_API_URL || ''));
  const remoteFallback = normalizeApiBase(
    String(import.meta.env.VITE_REMOTE_API_FALLBACK || 'https://api.otoshi-launcher.me')
  );
  const envFallbacks = String(import.meta.env.VITE_API_FALLBACKS || '')
    .split(',')
    .map((value) => normalizeApiBase(value))
    .filter(Boolean);

  let primaryBase = fromEnv;
  if (!primaryBase) {
    const port = String(import.meta.env.VITE_BACKEND_PORT || import.meta.env.BACKEND_PORT || '8000');
    if (typeof window !== 'undefined') {
      const host = String(window.location.hostname || '').trim().toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost') {
        primaryBase = `http://${host}:${port}`;
      } else {
        primaryBase = `http://127.0.0.1:${port}`;
      }
    } else {
      primaryBase = `http://127.0.0.1:${port}`;
    }
  }

  const shouldIncludeRemoteFallback =
    Boolean(remoteFallback) &&
    (!primaryBase || isLoopbackBase(primaryBase) || Boolean(import.meta.env.DEV));

  return Array.from(
    new Set(
      [primaryBase, ...(shouldIncludeRemoteFallback ? [remoteFallback] : []), ...envFallbacks]
        .map(normalizeApiBase)
        .filter(Boolean)
    )
  );
};

const API_BASES = resolveApiBases();
const initialResolvedBase =
  Boolean(import.meta.env.DEV) &&
  API_BASES.length > 1 &&
  isLoopbackBase(API_BASES[0])
    ? API_BASES.find((base) => !isLoopbackBase(base)) || API_BASES[0]
    : API_BASES[0];
let resolvedApiBase: string | null = initialResolvedBase || null;

async function requestJsonWithFallback<T>(path: string, init: RequestInit = {}): Promise<T> {
  const bases = resolvedApiBase
    ? [resolvedApiBase, ...API_BASES.filter((base) => base !== resolvedApiBase)]
    : API_BASES;
  let lastError: Error | null = null;

  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const payload = (await response.json()) as T;
      resolvedApiBase = base;
      return payload;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Failed to fetch');
    }
  }

  throw lastError || new Error('Failed to fetch');
}

export function useAutoUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = useCallback(async (currentVersion?: string) => {
    setIsChecking(true);
    setError(null);
    
    try {
      const version = currentVersion || '0.1.0';
      const result = await requestJsonWithFallback<UpdateCheckResult>(
        `/updates/check?current_version=${encodeURIComponent(version)}`
      );
      setUpdateAvailable(result.update_available);
      setUpdateInfo(result.update_info || null);
      setLastChecked(new Date());
      
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check for updates';
      setError(message);
      console.error('[AutoUpdate] Check failed:', err);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  return {
    updateAvailable,
    updateInfo,
    isChecking,
    lastChecked,
    error,
    checkForUpdates,
  };
}

export function useRemoteConfig() {
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await requestJsonWithFallback<RemoteConfig>('/updates/config');
      setConfig(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch remote config';
      setError(message);
      console.error('[RemoteConfig] Fetch failed:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const isFeatureEnabled = useCallback((featureName: string): boolean => {
    if (!config) return true; // Default to enabled if no config
    return config.features[featureName] ?? true;
  }, [config]);

  // Auto-fetch on mount
  useEffect(() => {
    fetchConfig();
    // Refresh every 5 minutes
    const interval = setInterval(fetchConfig, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchConfig]);

  return {
    config,
    isLoading,
    error,
    fetchConfig,
    isFeatureEnabled,
    maintenanceMode: config?.maintenance_mode ?? false,
    maintenanceMessage: config?.maintenance_message ?? '',
    announcements: config?.announcements ?? [],
  };
}

export function useManifestRefresh() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshManifests = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    
    try {
      const result = await requestJsonWithFallback<any>('/updates/manifest/refresh', {
        method: 'POST'
      });
      setLastRefreshed(new Date());
      
      if (!result.success) {
        throw new Error(result.message || 'Failed to refresh manifests');
      }
      
      console.log('[ManifestRefresh] Refreshed manifests:', result.manifests?.length);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to refresh manifests';
      setError(message);
      console.error('[ManifestRefresh] Failed:', err);
      return null;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return {
    isRefreshing,
    lastRefreshed,
    error,
    refreshManifests,
  };
}
