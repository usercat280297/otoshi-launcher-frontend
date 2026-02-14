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

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
      const response = await fetch(
        `${API_BASE}/updates/check?current_version=${encodeURIComponent(version)}`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result: UpdateCheckResult = await response.json();
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
      const response = await fetch(`${API_BASE}/updates/config`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result: RemoteConfig = await response.json();
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
      const response = await fetch(`${API_BASE}/updates/manifest/refresh`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
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
