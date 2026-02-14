import { useEffect, useMemo, useState } from "react";
import { Package, Tag } from "lucide-react";
import { isTauri as isTauriRuntimeFn } from "@tauri-apps/api/core";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { openExternal } from "../utils/openExternal";
import {
  fetchLocalWorkshopInstalls,
  fetchSteamWorkshopItems,
  fetchWorkshopItems,
  fetchWorkshopSubscriptions,
  syncWorkshopToGame,
  subscribeWorkshopItem,
  unsubscribeWorkshopItem
} from "../services/api";
import { WorkshopItem } from "../types";

const isTauriRuntime = isTauriRuntimeFn;

export default function WorkshopPage() {
  const { token } = useAuth();
  const { t, locale } = useLocale();
  const [items, setItems] = useState<WorkshopItem[]>([]);
  const [steamItems, setSteamItems] = useState<WorkshopItem[]>([]);
  const [steamMode, setSteamMode] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Set<string>>(new Set());
  const [localInstalls, setLocalInstalls] = useState<Map<string, string>>(new Map());
  const [localLoading, setLocalLoading] = useState(false);
  const [syncingItems, setSyncingItems] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [steamLoading, setSteamLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      setSteamMode(false);
      try {
        if (token) {
          const [itemsData, subscriptionsData] = await Promise.all([
            fetchWorkshopItems(token, undefined, search || undefined),
            fetchWorkshopSubscriptions(token)
          ]);
          if (!mounted) return;
          setItems(itemsData);
          setSubscriptions(
            new Set(subscriptionsData.map((subscription) => subscription.workshopItemId))
          );
          if (itemsData.length > 0) {
            setSteamItems([]);
            setSteamMode(false);
            setLoading(false);
            return;
          }
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || t("workshop.error.load"));
        }
      }

      if (!mounted) return;
      setSteamLoading(true);
      try {
        const steamData = await fetchSteamWorkshopItems(undefined, search || undefined);
        if (!mounted) return;
        setSteamItems(steamData);
        setSteamMode(true);
        if (isTauriRuntime()) {
          setLocalLoading(true);
          try {
            const appIds = Array.from(
              new Set(steamData.map((item) => item.gameId).filter(Boolean))
            );
            const installs = await fetchLocalWorkshopInstalls(appIds);
            if (!mounted) return;
            const next = new Map(
              installs.map((install) => [
                `${install.appId}:${install.itemId}`,
                install.path
              ])
            );
            setLocalInstalls(next);
          } catch (err: any) {
            if (mounted) {
              setError(err.message || t("workshop.error.local_installs"));
            }
          } finally {
            if (mounted) {
              setLocalLoading(false);
            }
          }
        } else {
          setLocalInstalls(new Map());
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || t("workshop.error.load_steam"));
        }
      } finally {
        if (mounted) {
          setSteamLoading(false);
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [token, search, locale]);

  const refreshLocalInstalls = async () => {
    if (!isTauriRuntime() || steamItems.length === 0) return;
    setLocalLoading(true);
    try {
      const appIds = Array.from(
        new Set(steamItems.map((item) => item.gameId).filter(Boolean))
      );
      const installs = await fetchLocalWorkshopInstalls(appIds);
      const next = new Map(
        installs.map((install) => [`${install.appId}:${install.itemId}`, install.path])
      );
      setLocalInstalls(next);
    } catch (err: any) {
      setError(err.message || t("workshop.error.refresh_local"));
    } finally {
      setLocalLoading(false);
    }
  };

  const handleSteamSubscribe = async (steamId: string) => {
    const url = isTauriRuntime()
      ? `steam://url/CommunityFilePage/${steamId}`
      : `https://steamcommunity.com/sharedfiles/filedetails/?id=${steamId}`;
    await openExternal(url);
    if (isTauriRuntime()) {
      setTimeout(() => {
        refreshLocalInstalls();
      }, 4000);
    }
  };

  const handleSyncToGame = async (appId: string, steamId: string) => {
    if (!isTauriRuntime()) return;
    const key = `${appId}:${steamId}`;
    setSyncingItems((prev) => new Set(prev).add(key));
    try {
      const result = await syncWorkshopToGame(appId, [steamId]);
      if (result && result.errors.length > 0) {
        setError(result.errors.join(" | "));
      } else {
        setError(null);
      }
    } catch (err: any) {
      setError(err.message || t("workshop.error.sync"));
    } finally {
      setSyncingItems((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleToggle = async (itemId: string) => {
    if (!token) return;
    const isSubscribed = subscriptions.has(itemId);
    try {
      if (isSubscribed) {
        await unsubscribeWorkshopItem(itemId, token);
        setSubscriptions((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      } else {
        await subscribeWorkshopItem(itemId, token);
        setSubscriptions((prev) => new Set(prev).add(itemId));
      }
    } catch (err: any) {
      setError(err.message || t("workshop.error.subscription"));
    }
  };

  const filteredItems = useMemo(() => {
    if (!search) return items;
    return items.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()));
  }, [items, search]);

  const steamFilteredItems = useMemo(() => {
    if (!search) return steamItems;
    return steamItems.filter((item) =>
      item.title.toLowerCase().includes(search.toLowerCase())
    );
  }, [steamItems, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-text-secondary">
            <Package size={18} />
            <p className="text-xs uppercase tracking-[0.4em]">{t("workshop.title")}</p>
          </div>
          <h1 className="text-3xl font-semibold text-glow">{t("workshop.heading")}</h1>
          <p className="text-sm text-text-secondary">
            {t("workshop.subtitle")}
          </p>
          <p className="text-sm text-accent-amber">{t("workshop.notice_unavailable")}</p>
          {steamMode && (
            <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
              {t("workshop.steam_read_only")}
            </p>
          )}
        </div>
        <div className="w-full max-w-sm">
          <input
            className="input-field"
            placeholder={t("workshop.search_placeholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {steamMode && isTauriRuntime() && (
          <button
            onClick={refreshLocalInstalls}
            className="text-xs font-semibold uppercase tracking-[0.3em] text-text-muted hover:text-text-primary"
            disabled={localLoading}
          >
            {localLoading ? t("workshop.syncing") : t("workshop.sync_local")}
          </button>
        )}
      </div>

      {error && <div className="glass-panel p-4 text-sm text-text-secondary">{error}</div>}

      {loading || steamLoading ? (
        <div className="glass-panel p-6 text-sm text-text-secondary">{t("workshop.loading")}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(steamMode ? steamFilteredItems : filteredItems).map((item) => {
            const subscribed = subscriptions.has(item.id);
            const isSteamItem = item.source === "steam" || item.id.startsWith("steam:");
            const steamId = isSteamItem ? item.id.replace("steam:", "") : "";
            const installKey = isSteamItem ? `${item.gameId}:${steamId}` : "";
            const installPath = isSteamItem ? localInstalls.get(installKey) : undefined;
            const isInstalled = Boolean(installPath);
            const isSyncing = syncingItems.has(installKey);
            return (
              <div key={item.id} className="glass-card space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{item.title}</p>
                  {isSteamItem ? (
                    <div className="flex items-center gap-3">
                      {isInstalled ? (
                        <>
                          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">
                            {t("workshop.installed")}
                          </span>
                          {isTauriRuntime() && (
                            <button
                              onClick={() => handleSyncToGame(item.gameId, steamId)}
                              className="text-xs font-semibold uppercase tracking-[0.3em] text-text-muted hover:text-text-primary"
                              disabled={isSyncing}
                            >
                              {isSyncing ? t("workshop.syncing") : t("workshop.apply_to_game")}
                            </button>
                          )}
                          {installPath && (
                            <button
                              onClick={async () => {
                                if (isTauriRuntime()) {
                                  const { invoke } = await import("@tauri-apps/api/core");
                                  await invoke("open_folder", { path: installPath });
                                  return;
                                }
                                await openExternal(installPath);
                              }}
                              className="text-xs font-semibold uppercase tracking-[0.3em] text-text-muted hover:text-text-primary"
                            >
                              {t("workshop.open_folder")}
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => handleSteamSubscribe(steamId)}
                          className="text-xs font-semibold uppercase tracking-[0.3em] text-text-muted hover:text-text-primary"
                        >
                          {t("workshop.install_on_steam")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleToggle(item.id)}
                      className={`text-xs font-semibold uppercase tracking-[0.3em] ${
                        subscribed ? "text-primary" : "text-text-muted"
                      }`}
                    >
                      {subscribed ? t("workshop.subscribed") : t("workshop.subscribe")}
                    </button>
                  )}
                </div>
                <p className="text-sm text-text-secondary">
                  {item.description || t("workshop.default_description")}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <Tag size={12} />
                  {item.tags.length > 0 ? item.tags.join(" | ") : t("workshop.general")}
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>{item.totalSubscriptions} {t("workshop.subscribers")}</span>
                  <span>{item.totalDownloads} {t("workshop.downloads")}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
