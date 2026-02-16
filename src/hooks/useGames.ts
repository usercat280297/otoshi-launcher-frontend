import { useEffect, useState } from "react";
import {
  fetchGames,
  fetchSteamCatalog,
  fetchSteamGridAssets,
  fetchSteamGridAssetsBatch,
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
  const iconImage = item.artwork?.t0 || null;
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
        const filtered = steamCatalog.items.filter(
          (item) => !isPlaceholderSteamTitle(item.name)
        );
        if (!filtered.length) {
          return [];
        }
        const mapped = filtered.map((item, index) => {
          const game = mapSteamItemToGame(item, index);
          return { ...game, studio: "Otoshi" };
        });
        return mapped;
      };

      try {
        for (let attempt = 1; attempt <= STARTUP_MAX_ATTEMPTS; attempt += 1) {
          try {
          let data: Game[] = [];
          data = await loadFromLuaCatalog();
          debugLog("[useGames] Lua catalog response:", data.length);

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
                .map((game) => ({
                  appId: game.steamAppId || null,
                  title: game.title,
                }));
              const batchResult = await fetchSteamGridAssetsBatch(batchPayload).catch(() => ({}));
              const missingBatch: Game[] = [];

              for (const game of data) {
                const appId = game.steamAppId ? String(game.steamAppId) : "";
                const artFromBatch = appId ? batchResult[appId] : null;
                if (artFromBatch) {
                  queueArtPatch(game.id, artFromBatch);
                } else {
                  missingBatch.push(game);
                }
              }

              if (!missingBatch.length) {
                return;
              }

              await mapWithLimit(missingBatch, ART_CONCURRENCY, async (game) => {
                const art = await fetchSteamGridAssets(game.title, game.steamAppId);
                if (!mounted || !art) {
                  return game;
                }
                queueArtPatch(game.id, art);
                return game;
              });
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
