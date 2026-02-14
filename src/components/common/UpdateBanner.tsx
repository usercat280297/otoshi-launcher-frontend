import { useEffect, useState } from 'react';
import { Download, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAutoUpdate, useRemoteConfig } from '../../hooks/useAutoUpdate';
import { useLocale } from '../../context/LocaleContext';
import { open } from '@tauri-apps/plugin-shell';

interface UpdateBannerProps {
  currentVersion?: string;
  checkOnMount?: boolean;
  checkInterval?: number; // in milliseconds
}

export function UpdateBanner({ 
  currentVersion = '0.1.0',
  checkOnMount = true,
  checkInterval = 60 * 60 * 1000, // 1 hour default
}: UpdateBannerProps) {
  const { t } = useLocale();
  const { 
    updateAvailable, 
    updateInfo, 
    isChecking, 
    checkForUpdates 
  } = useAutoUpdate();
  
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (checkOnMount) {
      checkForUpdates(currentVersion);
    }
    
    if (checkInterval > 0) {
      const interval = setInterval(() => {
        checkForUpdates(currentVersion);
      }, checkInterval);
      return () => clearInterval(interval);
    }
  }, [checkOnMount, checkInterval, currentVersion, checkForUpdates]);

  if (!updateAvailable || dismissed || !updateInfo) {
    return null;
  }

  const handleDownload = () => {
    if (updateInfo.url) {
      open(updateInfo.url);
    }
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-3 shadow-lg">
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Download className="w-5 h-5" />
          <div>
            <span className="font-medium">
              Phiên bản mới {updateInfo.version} đã sẵn sàng!
            </span>
            {updateInfo.notes && (
              <p className="text-sm text-white/80 mt-0.5 line-clamp-1">
                {updateInfo.notes}
              </p>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownload}
            className="px-4 py-1.5 bg-white text-blue-600 rounded-lg font-medium hover:bg-white/90 transition-colors"
          >
            {t("action.download")}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            title={t("common.dismiss")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function MaintenanceBanner() {
  const { maintenanceMode, maintenanceMessage } = useRemoteConfig();
  
  if (!maintenanceMode) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-yellow-900 px-4 py-3 shadow-lg">
      <div className="container mx-auto flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <p className="font-medium">
          {maintenanceMessage || 'Hệ thống đang bảo trì. Một số tính năng có thể không hoạt động.'}
        </p>
      </div>
    </div>
  );
}

export function UpdateCheckButton({ currentVersion = '0.1.0' }: { currentVersion?: string }) {
  const { isChecking, checkForUpdates, updateAvailable, lastChecked } = useAutoUpdate();
  
  return (
    <button
      onClick={() => checkForUpdates(currentVersion)}
      disabled={isChecking}
      className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors disabled:opacity-50"
    >
      <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
      <span className="text-sm">
        {isChecking ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật'}
      </span>
      {updateAvailable && (
        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
      )}
    </button>
  );
}
