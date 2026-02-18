import { useEffect, useState } from "react";
import {
  fetchGames,
  fetchSteamCatalog,
  fetchSteamIndexCatalog,
  fetchSteamGridAssets,
  fetchSteamIndexAssetsBatch,
  prefetchSteamIndexAssets,
} from "../services/api";
import { Game, SteamCatalogItem, SystemRequirements } from "../types";

const steamSpotlightPalette = [
  "from-blue-500/30 to-cyan-300/20",
  "from-orange-500/30 to-amber-300/20",
  "from-emerald-400/30 to-sky-300/20",
  "from-slate-500/30 to-indigo-300/20"
];

const steamDefaultRequirements: SystemRequirements = {
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

type GamesErrorCode = "no_lua_games" | "load_failed";

let dispatchedNoLua = false;

const isPlaceholderSteamTitle = (name?: string | null) => {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (/^\d+$/.test(trimmed)) return true;
  return /^steam app\s+\d+$/i.test(trimmed);
};

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const current = nextIndex;
      if (current >= items.length) {
        break;
      }
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

const ART_CONCURRENCY = 4;
const ART_BATCH_FLUSH_MS = 120;
const STARTUP_MAX_ATTEMPTS = 8;
const STARTUP_RETRY_BASE_MS = 700;
const STARTUP_RETRY_MAX_MS = 4000;
const FORCE_REFRESH_VISIBLE_LIMIT = 120;
const isDev = Boolean(import.meta.env.DEV);

const debugLog = (...args: unknown[]) => {
  if (isDev) {
    console.log(...args);
  }
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const getRetryDelayMs = (attempt: number) =>
  Math.min(STARTUP_RETRY_MAX_MS, STARTUP_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));

const mapSteamItemToGame = (item: SteamCatalogItem, index: number): Game => {
  const priceCents = item.price?.final ?? item.price?.initial ?? 0;
  const price = priceCents ? priceCents / 100 : 0;
  const discountPercent = item.price?.discountPercent ?? 0;
  const headerImage = item.artwork?.t3 || item.headerImage || item.capsuleImage || "";
  const heroImage = item.artwork?.t4 || item.background || headerImage;
  const iconImage =
    item.artwork?.t3 ||
    item.artwork?.t2 ||
    item.artwork?.t1 ||
    item.artwork?.t0 ||
    item.capsuleImage ||
    item.headerImage ||
    null;
  return {
    id: `steam-${item.appId}`,
    slug: `steam-${item.appId}`,
    steamAppId: item.appId,
    title: item.name,
    tagline: item.shortDescription || "",
    shortDescription: item.shortDescription || "",
    description: item.shortDescription || "",
    studio: "Steam",
    releaseDate: item.releaseDate || "",
    genres: item.genres || [],
    price,
    discountPercent,
    rating: 0,
    requiredAge: item.requiredAge ?? 0,
    denuvo: Boolean(item.denuvo),
    headerImage,
    heroImage,
    backgroundImage: item.background || heroImage,
    iconImage: iconImage || undefined,
    screenshots: item.background ? [item.background] : [],
    videos: [],
    systemRequirements: steamDefaultRequirements,
    spotlightColor: steamSpotlightPalette[index % steamSpotlightPalette.length],
    installed: false,
    playtimeHours: 0
  };
};

function mergeIndexAssets(
  items: SteamCatalogItem[],
  assetsByAppId: Record<
    string,
    { grid?: string | null; hero?: string | null; logo?: string | null; icon?: string | null } | null
  >
): SteamCatalogItem[] {
  return items.map((item) => {
    const key = String(item.appId || "").trim();
    const assets = key ? assetsByAppId[key] : null;
    if (!assets) {
      return item;
    }

    const grid = assets.grid || item.artwork?.t3 || item.headerImage || item.capsuleImage || null;
    const hero = assets.hero || item.background || item.artwork?.t4 || grid;
    const icon = assets.icon || item.artwork?.t0 || item.capsuleImage || item.headerImage || null;

    return {
      ...item,
      headerImage: grid || item.headerImage,
      capsuleImage: grid || item.capsuleImage,
      background: hero || item.background,
      artwork: {
        ...(item.artwork || {}),
        t0: icon,
        t1: grid || item.artwork?.t1 || item.capsuleImage || null,
        t2: grid || item.artwork?.t2 || item.headerImage || null,
        t3: grid || item.artwork?.t3 || item.capsuleImage || item.headerImage || null,
        t4: hero || item.artwork?.t4 || item.background || item.headerImage || null,
        version: Number(item.artwork?.version || 1) + 1,
      },
    };
  });
}

export function useGames() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<GamesErrorCode | null>(null);
  const allowDbFallback =
    import.meta.env.DEV &&
    String(import.meta.env.VITE_ALLOW_DB_GAMES_FALLBACK || "").trim() === "1";

  useEffect(() => {
    let mounted = true;
    const artPatchQueueRef = { current: new Map<string, Partial<Game>>() };
    const flushTimerRef = { current: null as number | null };

    const flushArtPatches = () => {
      flushTimerRef.current = null;
      if (!mounted) {
        artPatchQueueRef.current.clear();
        return;
      }
      const queued = artPatchQueueRef.current;
      if (!queued.size) {
        return;
      }
      artPatchQueueRef.current = new Map<string, Partial<Game>>();
      setGames((prev) => {
        let changed = false;
        const next = prev.map((game) => {
          const patch = queued.get(game.id);
          if (!patch) {
            return game;
          }
          changed = true;
          return { ...game, ...patch };
        });
        return changed ? next : prev;
      });
    };

    const queueArtPatch = (
      gameId: string,
      art: { grid?: string | null; hero?: string | null; logo?: string | null; icon?: string | null }
    ) => {
      const existing = artPatchQueueRef.current.get(gameId) || {};
      artPatchQueueRef.current.set(gameId, {
        ...existing,
        headerImage: art.grid || existing.headerImage,
        heroImage: art.hero || existing.heroImage,
        backgroundImage: art.hero || existing.backgroundImage,
        logoImage: art.logo || existing.logoImage,
        iconImage: art.icon || existing.iconImage,
      });

      if (flushTimerRef.current == null) {
        flushTimerRef.current = window.setTimeout(flushArtPatches, ART_BATCH_FLUSH_MS);
      }
    };

    const notifyLuaMissing = () => {
      if (typeof window === "undefined") return;
      if (dispatchedNoLua) return;
      dispatchedNoLua = true;
      window.dispatchEvent(new CustomEvent("otoshi:lua-games-missing"));
    };

    const notifyLuaLoaded = () => {
      if (typeof window === "undefined") return;
      dispatchedNoLua = false;
      window.dispatchEvent(new CustomEvent("otoshi:lua-games-loaded"));
    };

    const load = async () => {
      debugLog("[useGames] Starting to load games...");
      let lastError: Error | null = null;

      if (mounted) {
        setLoading(true);
        setError(null);
        setErrorCode(null);
      }

      const loadFromLuaCatalog = async () => {
        debugLog("[useGames] Loading lua catalog from /steam/catalog...");
        const steamCatalog = await fetchSteamCatalog({
          limit: 80,
          offset: 0,
          artMode: "tiered",
          thumbW: 460,
        });
        const withAppId = steamCatalog.items.filter(
          (item) => Boolean(String(item.appId || "").trim())
        );
        const preferred = withAppId.filter(
          (item) => !isPlaceholderSteamTitle(item.name)
        );
        const sourceItems = preferred.length ? preferred : withAppId;
        if (!sourceItems.length) {
          return [];
        }
        const mapped = sourceItems.map((item, index) => {
          const game = mapSteamItemToGame(item, index);
          return { ...game, studio: "Otoshi" };
        });
        return mapped;
      };

      const loadFromGlobalIndexCatalog = async () => {
        debugLog("[useGames] Loading global index catalog from /steam/index/catalog...");
        const steamCatalog = await fetchSteamIndexCatalog({
          limit: 80,
          offset: 0,
          sort: "priority",
          scope: "all"
        });
        const withAppId = steamCatalog.items.filter(
          (item) => Boolean(String(item.appId || "").trim())
        );
        const preferred = withAppId.filter(
          (item) => !isPlaceholderSteamTitle(item.name)
        );
        let sourceItems = preferred.length ? preferred : withAppId;
        if (!sourceItems.length) {
          return [];
        }

        // Try to enrich the most visible items first (hero/featured rails) so the UI
        // can render SGDB/Epic-quality posters without showing Steam fallback swaps.
        try {
          const visibleIds = sourceItems.slice(0, 24).map((item) => item.appId);
          const batchResult = await fetchSteamIndexAssetsBatch({ appIds: visibleIds });
          const assetsMap: Record<
            string,
            { grid?: string | null; hero?: string | null; logo?: string | null; icon?: string | null } | null
          > = {};
          for (const [appId, info] of Object.entries(batchResult)) {
            assetsMap[String(appId)] = info?.assets ?? null;
          }
          sourceItems = mergeIndexAssets(sourceItems, assetsMap);
        } catch {
          // keep base catalog assets on enrichment failure
        }

        const mapped = sourceItems.map((item, index) => {
          const game = mapSteamItemToGame(item, index);
          return { ...game, studio: "Steam" };
        });
        return mapped;
      };

      try {
        for (let attempt = 1; attempt <= STARTUP_MAX_ATTEMPTS; attempt += 1) {
          try {
          let data: Game[] = [];
          try {
            data = await loadFromGlobalIndexCatalog();
            debugLog("[useGames] Global index catalog response:", data.length);
          } catch (indexErr) {
            debugLog("[useGames] Global index failed, fallback to lua catalog.", indexErr);
          }

          if (!data.length) {
            data = await loadFromLuaCatalog();
            debugLog("[useGames] Lua catalog response:", data.length);
          }

          if (!data.length && allowDbFallback) {
            debugLog("[useGames] Fetching Otoshi games...");
            data = await fetchGames();
            debugLog("[useGames] Otoshi games response:", data.length);
          }

          if (mounted && data.length > 0) {
            setGames(data);
            setError(null);
            setErrorCode(null);
            notifyLuaLoaded();
            void (async () => {
              const batchPayload = data
                .filter((game) => Boolean(game.steamAppId))
                .map((game) => String(game.steamAppId || "").trim())
                .filter((value, index, self) => Boolean(value) && self.indexOf(value) === index);
              const batchResult = await fetchSteamIndexAssetsBatch({
                appIds: batchPayload,
              }).catch(() => ({} as Record<string, any>));
              const missingBatch: Game[] = [];

              for (const game of data) {
                const appId = game.steamAppId ? String(game.steamAppId) : "";
                const resolved = appId ? (batchResult as any)[appId] : null;
                const assets = resolved?.assets ?? null;
                if (assets) {
                  queueArtPatch(game.id, assets);
                } else {
                  missingBatch.push(game);
                }
              }

              if (!missingBatch.length) {
                // Continue with force-refresh path to sanitize stale cached assets.
              } else {
                await mapWithLimit(missingBatch, ART_CONCURRENCY, async (game) => {
                  const art = await fetchSteamGridAssets(game.title, game.steamAppId);
                  if (!mounted || !art) {
                    return game;
                  }
                  queueArtPatch(game.id, art);
                  return game;
                });
              }

              const refreshIds = batchPayload.slice(0, FORCE_REFRESH_VISIBLE_LIMIT);
              if (!refreshIds.length) {
                return;
              }
              await prefetchSteamIndexAssets({
                appIds: refreshIds,
                forceRefresh: true,
              }).catch(() => undefined);

              const refreshedBatch = await fetchSteamIndexAssetsBatch({
                appIds: refreshIds,
                forceRefresh: true,
              }).catch(() => ({} as Record<string, any>));

              for (const game of data) {
                const appId = game.steamAppId ? String(game.steamAppId) : "";
                if (!appId) continue;
                const refreshed = (refreshedBatch as any)[appId];
                const refreshedAssets = refreshed?.assets ?? null;
                if (refreshedAssets) {
                  queueArtPatch(game.id, refreshedAssets);
                }
              }
            })();
            return;
          }

          if (attempt < STARTUP_MAX_ATTEMPTS) {
            await wait(getRetryDelayMs(attempt));
            continue;
          }

          if (mounted) {
            setGames([]);
            setError("no_lua_games");
            setErrorCode("no_lua_games");
            notifyLuaMissing();
            return;
          }
          } catch (err: any) {
            const normalizedError =
              err instanceof Error
                ? err
                : new Error(err?.message || "Failed to load games");
            lastError = normalizedError;
            console.error(
              `[useGames] Error loading games (attempt ${attempt}/${STARTUP_MAX_ATTEMPTS}):`,
              normalizedError
            );
            if (attempt < STARTUP_MAX_ATTEMPTS) {
              await wait(getRetryDelayMs(attempt));
              continue;
            }
            if (mounted) {
              setGames([]);
              setError(lastError.message || "Failed to load games");
              setErrorCode("load_failed");
            }
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
      }
      artPatchQueueRef.current.clear();
    };
  }, []);

  return { games, loading, error, errorCode };
}
