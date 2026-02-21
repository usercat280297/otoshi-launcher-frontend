/**
 * Update Client for Tauri Launcher
 * Handles:
 * - Checking for updates from backend
 * - Downloading updates
 * - Delta patching (efficient updates)
 * - Live-reload Lua/UI without restart
 * - Automatic rollback on failure
 */

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';

const resolveApiBase = (): string => {
  const fromEnv = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const port = String(import.meta.env.VITE_BACKEND_PORT || import.meta.env.BACKEND_PORT || '8000');
  if (typeof window !== 'undefined') {
    const host = String(window.location.hostname || '').trim().toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost') {
      return `http://${host}:${port}`;
    }
  }
  return `http://127.0.0.1:${port}`;
};

const DEFAULT_API_BASE = resolveApiBase();

// Note: For file operations, use fetch API instead of tauri fs module
// This avoids dependency issues and works with both Tauri and browser environments

interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion?: string;
  changelog?: string;
  forceUpdate?: boolean;
  downloadUrl?: string;
}

interface VersionInfo {
  version: string;
  releaseDate: string;
  files: Array<{
    path: string;
    hash: string;
    size: number;
    isLua?: boolean;
    isUi?: boolean;
    requiresRestart?: boolean;
  }>;
  changelog: string;
  forceUpdate?: boolean;
}

interface DeltaPatch {
  fromVersion: string;
  toVersion: string;
  added?: Record<string, any>;
  modified?: Record<string, any>;
  removed?: string[];
  createdAt: string;
}

class UpdateClient {
  private apiUrl: string;
  private v2ApiUrl: string;
  private updateCheckInterval: number = 24 * 60 * 60 * 1000; // 24 hours
  private currentVersion: string = '';

  constructor(
    apiUrl: string = `${DEFAULT_API_BASE}/api/updates`,
    v2ApiUrl: string = `${DEFAULT_API_BASE}/v2/updates`
  ) {
    this.apiUrl = apiUrl;
    this.v2ApiUrl = v2ApiUrl;
    this.initUpdateCheck();
  }

  /**
   * Initialize periodic update checks
   */
  private initUpdateCheck(): void {
    this.checkForUpdates().then(() => {
      // Check again after interval
      setInterval(() => this.checkForUpdates(), this.updateCheckInterval);
    });
  }

  /**
   * Check if updates are available
   */
  async checkForUpdates(): Promise<UpdateInfo> {
    try {
      if (!this.currentVersion) {
        this.currentVersion = await getVersion();
      }

      const response = await fetch(`${this.apiUrl}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_version: this.currentVersion,
          launcher_type: 'tauri',
        }),
      });

      const raw = await response.json();
      const data: UpdateInfo = {
        updateAvailable: Boolean(raw?.updateAvailable ?? raw?.update_available),
        latestVersion: raw?.latestVersion ?? raw?.latest_version,
        changelog: raw?.changelog,
        forceUpdate: Boolean(raw?.forceUpdate ?? raw?.force_update),
        downloadUrl: raw?.downloadUrl ?? raw?.download_url,
      };

      if (data.updateAvailable) {
        console.log(`Update available: ${data.latestVersion}`);
        // Emit update event for UI
        window.dispatchEvent(
          new CustomEvent('update-available', { detail: data })
        );
      }

      return data;
    } catch (error) {
      console.error('Error checking for updates:', error);
      return { updateAvailable: false };
    }
  }

  /**
   * Download and apply delta patch for efficient updates
   */
  async downloadDeltaPatch(fromVersion: string, toVersion: string): Promise<void> {
    try {
      let response = await fetch(
        `${this.v2ApiUrl}/delta?from=${encodeURIComponent(fromVersion)}&to=${encodeURIComponent(toVersion)}`
      );
      if (!response.ok) {
        // Backward-compat fallback while v1 and v2 contracts run in parallel.
        response = await fetch(
          `${this.apiUrl}/delta?from_version=${encodeURIComponent(fromVersion)}&to_version=${encodeURIComponent(toVersion)}`
        );
      }
      const patchPayload = await response.json();
      const deltaAvailable = Boolean(
        patchPayload?.delta_available ?? patchPayload?.deltaAvailable ?? true
      );
      const planMode = String(patchPayload?.plan?.mode || "").toLowerCase();
      if (!deltaAvailable || planMode === "full_download") {
        await this.downloadFullVersion(toVersion);
        return;
      }

      const patch: DeltaPatch = (patchPayload?.patch || patchPayload) as DeltaPatch;
      const added = patch?.added && typeof patch.added === "object" ? patch.added : {};
      const modified =
        patch?.modified && typeof patch.modified === "object" ? patch.modified : {};
      const removed = Array.isArray(patch?.removed) ? patch.removed : [];

      console.log(`Applying delta patch: ${fromVersion} -> ${toVersion}`);

      // Apply added files
      for (const [path, fileInfo] of Object.entries(added)) {
        await this.downloadFile(path, fileInfo as any);
      }

      // Apply modified files
      for (const [path, fileInfo] of Object.entries(modified)) {
        await this.downloadFile(path, fileInfo as any);
      }

      // Remove deleted files
      for (const path of removed) {
        // File deletion would be handled by Tauri invoke command
        try {
          await invoke('delete_file', { path });
        } catch (e) {
          console.warn(`Could not delete ${path}:`, e);
        }
      }

      console.log('Delta patch applied successfully');
    } catch (error) {
      console.error('Error applying delta patch:', error);
      throw error;
    }
  }

  /**
   * Download full version update
   */
  async downloadFullVersion(version: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/version/${version}`);
      const raw = await response.json();
      const versionInfo: VersionInfo = {
        version: raw?.version ?? version,
        releaseDate: raw?.releaseDate ?? raw?.release_date ?? "",
        changelog: raw?.changelog ?? "",
        forceUpdate: Boolean(raw?.forceUpdate ?? raw?.force_update),
        files: Array.isArray(raw?.files)
          ? raw.files.map((file: any) => ({
              path: file?.path ?? "",
              hash: file?.hash ?? "",
              size: Number(file?.size ?? 0),
              isLua: Boolean(file?.isLua ?? file?.is_lua),
              isUi: Boolean(file?.isUi ?? file?.is_ui),
              requiresRestart: Boolean(file?.requiresRestart ?? file?.requires_restart),
            }))
          : [],
      };

      console.log(`Downloading version ${version}...`);

      for (const file of versionInfo.files) {
        await this.downloadFile(file.path, file);
      }

      console.log(`Version ${version} downloaded successfully`);
    } catch (error) {
      console.error('Error downloading version:', error);
      throw error;
    }
  }

  /**
   * Download a single file
   */
  private async downloadFile(path: string, fileInfo: any): Promise<void> {
    try {
      // Download from update server
      const url = `${this.apiUrl}/files/${path}`;
      const response = await fetch(url);
      const blob = await response.blob();

      // For Tauri app, use invoke to save file
      // For browser, use download
      try {
        const buffer = await blob.arrayBuffer();
        await invoke('save_file', {
          path,
          content: Array.from(new Uint8Array(buffer)),
        });
      } catch {
        // Fallback: trigger browser download
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop() || 'file';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }

      // Verify hash
      const localHash = await this.calculateHash(await blob.arrayBuffer());
      if (localHash !== fileInfo.hash) {
        throw new Error(`Hash mismatch for ${path}`);
      }

      console.log(`Downloaded: ${path}`);
    } catch (error) {
      console.error(`Error downloading ${path}:`, error);
      throw error;
    }
  }

  /**
   * Push live edit for Lua/UI without restart
   */
  async pushLiveEdit(filePath: string, content: Uint8Array): Promise<void> {
    try {
      const contentBase64 = btoa(String.fromCharCode(...content));

      const response = await fetch(`${this.apiUrl}/live-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_path: filePath,
          content_base64: contentBase64,
        }),
      });

      const result = await response.json();
      console.log('Live edit pushed:', result);

      // Emit event for UI reload
      window.dispatchEvent(
        new CustomEvent('file-updated', { detail: { filePath } })
      );
    } catch (error) {
      console.error('Error pushing live edit:', error);
      throw error;
    }
  }

  /**
   * Rollback to previous version
   */
  async rollbackVersion(targetVersion: string): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/rollback/${targetVersion}`, {
        method: 'POST',
      });

      const result = await response.json();
      console.log('Rolled back to:', targetVersion);

      // Restart launcher
      await invoke('restart_app');
    } catch (error) {
      console.error('Error rolling back:', error);
      throw error;
    }
  }

  /**
   * Calculate SHA256 hash of content
   */
  private async calculateHash(content: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Listen for live edit updates via WebSocket
   */
  setupLiveEditListener(): void {
    const wsUrl = this.apiUrl
      .replace('http', 'ws')
      .replace('/v2/updates', '/ws/updates')
      .replace('/api/updates', '/ws/updates');
    const ws = new WebSocket(wsUrl);

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'live-edit') {
        console.log('Received live edit:', message.filePath);

        // Reload the edited file in UI
        if (message.filePath.endsWith('.lua')) {
          // Reload Lua script
          await invoke('reload_lua_script', { path: message.filePath });
        } else if (message.filePath.endsWith('.json')) {
          // Reload UI config
          window.dispatchEvent(
            new CustomEvent('reload-ui', { detail: { filePath: message.filePath } })
          );
        }
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      // Retry connection after delay
      setTimeout(() => this.setupLiveEditListener(), 5000);
    };
  }
}

// Export singleton instance
export const updateClient = new UpdateClient();

export type { UpdateInfo, VersionInfo, DeltaPatch };
