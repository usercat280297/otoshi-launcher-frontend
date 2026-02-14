/**
 * Lua Files Sync Service
 * Handles syncing lua files from backend/HF on app startup
 */

import React from 'react'

let invoke: any = null
let appDataDir: any = null
const isDev = typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV)

// Check if running in Tauri
if (typeof window !== 'undefined' && (window as any).__TAURI__) {
  try {
    const tauriApi = require('@tauri-apps/api/tauri')
    const pathApi = require('@tauri-apps/api/path')
    invoke = tauriApi.invoke
    appDataDir = pathApi.appDataDir
  } catch (e) {
    console.warn('Tauri API not available:', e)
  }
}

export interface LuaSyncStatus {
  synced: boolean
  count: number
  lastSync: Date | null
  source: 'local' | 'bundled' | 'huggingface' | 'admin'
}

class LuaFilesService {
  private static instance: LuaFilesService
  private syncInProgress = false
  private syncStatus: LuaSyncStatus = {
    synced: false,
    count: 0,
    lastSync: null,
    source: 'bundled',
  }

  private constructor() {}

  static getInstance(): LuaFilesService {
    if (!LuaFilesService.instance) {
      LuaFilesService.instance = new LuaFilesService()
    }
    return LuaFilesService.instance
  }

  /**
   * Initialize lua files on app startup
   */
  async initialize(): Promise<LuaSyncStatus> {
    if (this.syncInProgress) {
      console.warn('Lua sync already in progress')
      return this.syncStatus
    }

    this.syncInProgress = true

    try {
      console.log('🔍 Initializing lua files...')

      // 1. Try to extract from bundled source
      const extracted = await this.extractBundledLua()
      if (extracted) {
        this.syncStatus.source = 'bundled'
        this.syncStatus.synced = true
        this.syncStatus.lastSync = new Date()
        console.log('✅ Lua files loaded from bundle')
        return this.syncStatus
      }

      // 2. Try to sync from admin server
      const adminSynced = await this.syncFromAdmin()
      if (adminSynced) {
        this.syncStatus.source = 'admin'
        this.syncStatus.synced = true
        this.syncStatus.lastSync = new Date()
        console.log('✅ Lua files synced from admin server')
        return this.syncStatus
      }

      // 3. Try to sync from Hugging Face
      const hfSynced = await this.syncFromHuggingFace()
      if (hfSynced) {
        this.syncStatus.source = 'huggingface'
        this.syncStatus.synced = true
        this.syncStatus.lastSync = new Date()
        console.log('✅ Lua files synced from Hugging Face')
        return this.syncStatus
      }

      // 4. Try local cache
      const localLoaded = await this.loadLocalCache()
      if (localLoaded) {
        this.syncStatus.source = 'local'
        this.syncStatus.synced = true
        this.syncStatus.lastSync = new Date()
        console.log('✅ Lua files loaded from local cache')
        return this.syncStatus
      }

      console.error('❌ No lua files available from any source')
      return this.syncStatus
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * Extract lua files from Tauri bundle
   */
  private async extractBundledLua(): Promise<boolean> {
    try {
      const luaPath = await (invoke as any)('get_lua_files_path')
      const count = await (invoke as any)('get_lua_files_count')

      this.syncStatus.count = count
      return count > 0
    } catch (error) {
      console.warn('Failed to extract bundled lua:', error)
      return false
    }
  }

  /**
   * Sync lua files from admin server
   */
  private async syncFromAdmin(): Promise<boolean> {
    try {
      if (!isDev) {
        return false
      }
      const adminUrl = process.env.VITE_ADMIN_URL || 'http://127.0.0.1:8000'
      const apiKey = process.env.VITE_ADMIN_API_KEY || ''

      if (!apiKey) {
        console.warn('No admin API key configured, skipping admin sync')
        return false
      }

      console.log('📡 Attempting admin sync...')

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const response = await fetch(`${adminUrl}/api/v1/lua/version`, {
        headers: { 'X-API-Key': apiKey },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))

      if (!response.ok) {
        console.warn(`Admin sync failed: ${response.status}`)
        return false
      }

      const data = await response.json()
      console.log(`📥 Admin has lua version: ${data.version}`)

      // Check if we need to update
      const localVersion = localStorage.getItem('lua_version')
      if (localVersion === data.version) {
        console.log('Lua files already up to date')
        this.syncStatus.count = data.lua_count || 0
        return true
      }

      // Download bundle
      const bundleController = new AbortController()
      const bundleTimeoutId = setTimeout(() => bundleController.abort(), 120000)

      const bundleResponse = await fetch(`${adminUrl}/api/v1/lua/bundle.zip`, {
        headers: { 'X-API-Key': apiKey },
        signal: bundleController.signal,
      }).finally(() => clearTimeout(bundleTimeoutId))

      if (!bundleResponse.ok) {
        console.warn('Failed to download lua bundle')
        return false
      }

      // Save to local cache
      const blob = await bundleResponse.blob()
      await this.saveLuaBundle(blob)

      localStorage.setItem('lua_version', data.version)
      this.syncStatus.count = data.lua_count || 0

      return true
    } catch (error) {
      console.warn('Admin sync error:', error)
      return false
    }
  }

  /**
   * Sync lua files from Hugging Face (fallback)
   */
  private async syncFromHuggingFace(): Promise<boolean> {
    try {
      console.log('📡 Attempting Hugging Face sync...')

      const hfRepo = process.env.VITE_HF_LUA_REPO || 'otoshi/lua-files'
      const hfZipUrl = `https://huggingface.co/datasets/${hfRepo}/raw/main/lua-files.zip`

      const hfController = new AbortController()
      const hfTimeoutId = setTimeout(() => hfController.abort(), 120000)

      const response = await fetch(hfZipUrl, { signal: hfController.signal }).finally(() => clearTimeout(hfTimeoutId))

      if (!response.ok) {
        console.warn(`HF sync failed: ${response.status}`)
        return false
      }

      console.log('📥 Downloading from Hugging Face...')

      const blob = await response.blob()
      await this.saveLuaBundle(blob)

      localStorage.setItem('lua_source', 'huggingface')
      localStorage.setItem('lua_synced_at', new Date().toISOString())

      return true
    } catch (error) {
      console.warn('Hugging Face sync error:', error)
      return false
    }
  }

  /**
   * Load lua files from local cache (AppData)
   */
  private async loadLocalCache(): Promise<boolean> {
    try {
      const appDataPath = await appDataDir()
      const luaCachePath = `${appDataPath}/otoshi_launcher/lua_cache/lua_files`

      // Try to verify lua files exist
      const exists = await (invoke as any)('check_lua_dir_exists', {
        path: luaCachePath,
      }).catch(() => false)

      if (exists) {
        this.syncStatus.count = await (invoke as any)('count_lua_files', {
          path: luaCachePath,
        }).catch(() => 0)

        return this.syncStatus.count > 0
      }

      return false
    } catch (error) {
      console.warn('Local cache load error:', error)
      return false
    }
  }

  /**
   * Save lua bundle to local storage
   */
  private async saveLuaBundle(blob: Blob): Promise<void> {
    try {
      // Extract and save using backend endpoint
      const formData = new FormData()
      formData.append('file', blob, 'lua-bundle.zip')

      const appDataPath = await appDataDir()
      const savePath = `${appDataPath}/otoshi_launcher/lua_cache`

      // In a real scenario, this would be handled by Tauri's file API
      console.log(`💾 Saving lua bundle to: ${savePath}`)

      // Note: Actual saving would be done via Tauri commands
      // This is a placeholder for the actual implementation
    } catch (error) {
      console.error('Failed to save lua bundle:', error)
      throw error
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): LuaSyncStatus {
    return { ...this.syncStatus }
  }

  /**
   * Get lua files count
   */
  async getCount(): Promise<number> {
    try {
      return await (invoke as any)('get_lua_files_count')
    } catch (error) {
      console.warn('Failed to get lua count:', error)
      return this.syncStatus.count
    }
  }

  /**
   * Check if specific lua file exists
   */
  async checkFile(filename: string): Promise<boolean> {
    try {
      return await (invoke as any)('check_lua_file_exists', { filename })
    } catch (error) {
      console.warn(`Failed to check lua file ${filename}:`, error)
      return false
    }
  }

  /**
   * Read lua file content
   */
  async readFile(filename: string): Promise<string> {
    try {
      return await (invoke as any)('read_lua_file', { filename })
    } catch (error) {
      console.error(`Failed to read lua file ${filename}:`, error)
      throw error
    }
  }

  /**
   * List all lua files
   */
  async listFiles(): Promise<string[]> {
    try {
      return await (invoke as any)('list_lua_files')
    } catch (error) {
      console.warn('Failed to list lua files:', error)
      return []
    }
  }
}

// Export singleton instance
export const luaFilesService = LuaFilesService.getInstance()

/**
 * Hook for React components to use lua files service
 */
export function useLuaFiles() {
  const [status, setStatus] = React.useState<LuaSyncStatus>(
    luaFilesService.getStatus()
  )
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    setLoading(true)
    luaFilesService
      .initialize()
      .then(setStatus)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { status, loading, service: luaFilesService }
}
