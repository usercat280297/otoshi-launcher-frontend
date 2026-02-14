/**
 * Update Banner Component - Simplified Template
 * This is a template/placeholder component for update notifications
 * The actual update logic is handled by updateClient.ts
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, AlertCircle, CheckCircle } from 'lucide-react';

interface UpdateInfo {
  available: boolean;
  version: string;
  releaseDate: string;
  changelog?: string[];
  downloadUrl?: string;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
  speed: number;
  eta: number;
}

interface UpdateBannerState {
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
  isDownloading: boolean;
  isInstalling: boolean;
  error: string | null;
}

export const UpdateBanner: React.FC = () => {
  const [state, setState] = useState<UpdateBannerState>({
    updateInfo: null,
    downloadProgress: null,
    isDownloading: false,
    isInstalling: false,
    error: null,
  });

  const [isDismissed, setIsDismissed] = useState(false);

  // In a real implementation, this component would:
  // 1. Initialize updateClient on mount
  // 2. Check for updates periodically
  // 3. Display notifications when updates are available
  // 4. Handle download and installation UI

  if (!state.updateInfo || isDismissed) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="fixed top-4 right-4 z-50"
      >
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg shadow-2xl p-4 w-96 border border-blue-400">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              <h3 className="font-semibold">Update Available</h3>
            </div>
            {!state.isDownloading && !state.isInstalling && (
              <button
                onClick={() => setIsDismissed(true)}
                className="text-blue-200 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Version Info */}
          <div className="text-sm text-blue-100 mb-3">
            <p>New version: <span className="font-semibold">{state.updateInfo.version}</span></p>
            <p className="text-xs mt-1">Released: {new Date(state.updateInfo.releaseDate).toLocaleDateString()}</p>
          </div>

          {/* Changelog */}
          {state.updateInfo.changelog && state.updateInfo.changelog.length > 0 && (
            <div className="bg-blue-800/50 rounded p-2 mb-3 max-h-24 overflow-y-auto text-xs">
              <ul className="space-y-1">
                {state.updateInfo.changelog.map((item: string, idx: number) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-blue-300 flex-shrink-0">•</span>
                    <span className="text-blue-100">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Download Progress */}
          {state.isDownloading && state.downloadProgress && (
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span>Downloading...</span>
                <span>{Math.round(state.downloadProgress.percentage)}%</span>
              </div>
              <div className="w-full bg-blue-900 rounded-full h-2">
                <motion.div
                  className="bg-green-400 h-2 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${state.downloadProgress.percentage}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <div className="flex justify-between text-xs text-blue-200 mt-1">
                <span>{(state.downloadProgress.downloaded / 1024 / 1024).toFixed(1)}MB / {(state.downloadProgress.total / 1024 / 1024).toFixed(1)}MB</span>
                <span>{(state.downloadProgress.speed / 1024 / 1024).toFixed(1)}MB/s</span>
              </div>
            </div>
          )}

          {/* Installing Status */}
          {state.isInstalling && (
            <div className="flex items-center gap-2 mb-3 text-sm">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <CheckCircle className="w-4 h-4" />
              </motion.div>
              <span>Installing update...</span>
            </div>
          )}

          {/* Error Message */}
          {state.error && (
            <div className="bg-red-500/20 border border-red-400 rounded p-2 mb-3 text-sm text-red-100 flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{state.error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {!state.isDownloading && !state.isInstalling && !state.error && (
              <>
                <button
                  onClick={() => {}}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded transition flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
                <button
                  onClick={() => setIsDismissed(true)}
                  className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded transition"
                >
                  Later
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default UpdateBanner;
