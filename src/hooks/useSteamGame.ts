import { useEffect, useState } from "react";
import {
  clearSteamGameBackendCache,
  fetchSteamGameDetail,
  fetchSteamGridAssets,
  fetchSteamIndexGameDetail
} from "../services/api";
import { SteamGameDetail } from "../types";
import {
  readPersistentCacheValue,
  writePersistentCacheValue,
} from "../utils/persistentCache";

const STEAM_GAME_DETAIL_CACHE_KEY = "otoshi.cache.steam.game_detail.v1";
const STEAM_GAME_DETAIL_CACHE_TTL_MS = 1000 * 60 * 30;
const STEAM_GAME_DETAIL_CACHE_MAX_ENTRIES = 24;

const resolveDetailCacheEntryKey = (appId: string, locale?: string | null) =>
  `${String(appId || "").trim()}::${String(locale || "default")
    .trim()
    .toLowerCase() || "default"}`;

export function useSteamGame(appId?: string, locale?: string | null) {
  const [game, setGame] = useState<SteamGameDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!appId) return () => undefined;

    const load = async () => {
      setError(null);
      const cacheEntryKey = resolveDetailCacheEntryKey(appId, locale);
      const cachedDetail = readPersistentCacheValue<SteamGameDetail>(
        STEAM_GAME_DETAIL_CACHE_KEY,
        cacheEntryKey
      );

      if (mounted) {
        if (cachedDetail) {
          setGame(cachedDetail);
          setLoading(false);
        } else {
          setGame(null);
          setLoading(true);
        }
      }
      try {
        const isLikelyBrokenFallbackUrl = (value?: string | null) =>
          typeof value === "string" &&
          /cdn\.cloudflare\.steamstatic\.com\/steam\/apps\/\d+\/(?:header\.jpg|capsule_616x353\.jpg|library_hero\.jpg|library_600x900\.jpg)(?:[?#].*)?$/i.test(
            value
          );
        const normalizeMediaUrl = (value?: string | null) => {
          if (!value || typeof value !== "string") return "";
          return value.trim().toLowerCase();
        };
        const scoreMedia = (detail: SteamGameDetail) => {
          const shots = Array.isArray(detail.screenshots) ? detail.screenshots.filter(Boolean) : [];
          const fallbackCandidates = new Set(
            [
              detail.headerImage,
              detail.capsuleImage,
              detail.background,
              detail.heroImage
            ]
              .filter((value): value is string => typeof value === "string" && value.length > 0)
              .map((value) => normalizeMediaUrl(value))
          );
          const realShots = new Set(
            shots
              .map((shot) => normalizeMediaUrl(shot))
              .filter((shot) => shot.length > 0)
              .filter((shot) => !fallbackCandidates.has(shot))
              .filter((shot) => !isLikelyBrokenFallbackUrl(shot))
          ).size;
          const movies = Array.isArray(detail.movies) ? detail.movies.filter(Boolean) : [];
          const playableVideos = movies.filter((movie) =>
            Boolean(
              (typeof movie.url === "string" && movie.url.trim()) ||
                (typeof movie.hls === "string" && movie.hls.trim()) ||
                (typeof movie.dash === "string" && movie.dash.trim())
            )
          ).length;
          return realShots + playableVideos * 4;
        };
        const chooseRicherDetail = (current: SteamGameDetail, candidate: SteamGameDetail) =>
          scoreMedia(candidate) > scoreMedia(current) ? candidate : current;
        const looksLikeFallbackMedia = (detail: SteamGameDetail) => {
          const shots = Array.isArray(detail.screenshots) ? detail.screenshots.filter(Boolean) : [];
          const movies = Array.isArray(detail.movies) ? detail.movies.filter(Boolean) : [];
          const hasPlayableVideo =
            movies.length > 0 &&
            movies.some((movie) =>
              Boolean(
                (typeof movie.url === "string" && movie.url.trim()) ||
                  (typeof movie.hls === "string" && movie.hls.trim()) ||
                  (typeof movie.dash === "string" && movie.dash.trim())
              )
            );
          if (hasPlayableVideo && shots.length > 3) return false;
          const fallbackCandidates = new Set(
            [
              detail.headerImage,
              detail.capsuleImage,
              detail.background,
              detail.heroImage
            ].filter((value): value is string => typeof value === "string" && value.length > 0)
          );
          const shotsAreFallback =
            shots.length > 0 && shots.every((shot) => fallbackCandidates.has(shot));
          const shotsLookBrokenFallback =
            shots.length > 0 && shots.every((shot) => isLikelyBrokenFallbackUrl(shot));
          const moviesMissing = !hasPlayableVideo;
          // If media payload is empty, purely fallback, or clearly broken fallback URLs,
          // force one cache-clear retry to refresh stale backend detail payloads.
          return moviesMissing || shotsAreFallback || shotsLookBrokenFallback;
        };

        let detail = await fetchSteamGameDetail(appId, locale);

        // If Steam cache returned a minimal payload (common when upstream fetch failed once),
        // auto-clear backend cache and retry once so users don't need to manually reload.
        if (looksLikeFallbackMedia(detail)) {
          try {
            await clearSteamGameBackendCache(appId);
            const refreshed = await fetchSteamGameDetail(appId, locale);
            detail = chooseRicherDetail(detail, refreshed);
          } catch {
            // Ignore refresh failures; we still show whatever we have.
          }
        }
        if (looksLikeFallbackMedia(detail) && locale && !/^en/i.test(locale)) {
          try {
            const englishDetail = await fetchSteamGameDetail(appId, "en-US");
            detail = chooseRicherDetail(detail, englishDetail);
          } catch {
            // Ignore fallback locale failures.
          }
        }
        if (looksLikeFallbackMedia(detail)) {
          try {
            const indexDetail = await fetchSteamIndexGameDetail(appId);
            detail = chooseRicherDetail(detail, indexDetail);
          } catch {
            // Ignore index fallback failures.
          }
        }

        const initial = { ...detail };
        if (!initial.heroImage) {
          initial.heroImage = initial.background ?? initial.headerImage ?? initial.gridImage ?? null;
        }
        if (mounted) {
          setGame(initial);
        }
        writePersistentCacheValue(
          STEAM_GAME_DETAIL_CACHE_KEY,
          cacheEntryKey,
          initial,
          {
            ttlMs: STEAM_GAME_DETAIL_CACHE_TTL_MS,
            maxEntries: STEAM_GAME_DETAIL_CACHE_MAX_ENTRIES,
          }
        );

        fetchSteamGridAssets(detail.name, appId)
          .then((art) => {
            if (!mounted || !art) return;
            setGame((current) => {
              if (!current || current.appId !== appId) return current;
              const enriched = {
                ...current,
                gridImage: art.grid ?? current.gridImage ?? null,
                heroImage: art.hero ?? current.heroImage ?? null,
                logoImage: art.logo ?? current.logoImage ?? null,
                iconImage: art.icon ?? current.iconImage ?? null
              };
              if (!enriched.heroImage) {
                enriched.heroImage =
                  enriched.background ?? enriched.headerImage ?? enriched.gridImage ?? null;
              }
              writePersistentCacheValue(
                STEAM_GAME_DETAIL_CACHE_KEY,
                cacheEntryKey,
                enriched,
                {
                  ttlMs: STEAM_GAME_DETAIL_CACHE_TTL_MS,
                  maxEntries: STEAM_GAME_DETAIL_CACHE_MAX_ENTRIES,
                }
              );
              return enriched;
            });
          })
          .catch(() => {
            // Do not fail page load if artwork provider is slow/unavailable.
          });
      } catch (err: any) {
        if (mounted && !cachedDetail) {
          setError(err.message || "Failed to load Steam game");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [appId, locale]);

  return { game, loading, error };
}
