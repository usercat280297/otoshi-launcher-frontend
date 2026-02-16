import { useEffect, useState } from "react";
import { clearSteamGameBackendCache, fetchSteamGameDetail, fetchSteamGridAssets } from "../services/api";
import { SteamGameDetail } from "../types";

export function useSteamGame(appId?: string) {
  const [game, setGame] = useState<SteamGameDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!appId) return () => undefined;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const scoreMedia = (detail: SteamGameDetail) => {
          const shots = Array.isArray(detail.screenshots) ? detail.screenshots.length : 0;
          const movies = Array.isArray(detail.movies) ? detail.movies.length : 0;
          return shots + movies * 3;
        };
        const looksLikeFallbackMedia = (detail: SteamGameDetail) => {
          const shots = Array.isArray(detail.screenshots) ? detail.screenshots.filter(Boolean) : [];
          const movies = Array.isArray(detail.movies) ? detail.movies.filter(Boolean) : [];
          if (movies.length > 0 && shots.length > 3) return false;
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
          const moviesMissing = movies.length === 0;
          // If both are missing, or shots look like fallback set, treat it as suspicious/stale cache.
          return moviesMissing || shotsAreFallback;
        };

        let detail = await fetchSteamGameDetail(appId);

        // If Steam cache returned a minimal payload (common when upstream fetch failed once),
        // auto-clear backend cache and retry once so users don't need to manually reload.
        if (looksLikeFallbackMedia(detail)) {
          try {
            await clearSteamGameBackendCache(appId);
            const refreshed = await fetchSteamGameDetail(appId);
            if (scoreMedia(refreshed) > scoreMedia(detail)) {
              detail = refreshed;
            }
          } catch {
            // Ignore refresh failures; we still show whatever we have.
          }
        }

        const initial = { ...detail };
        if (!initial.heroImage) {
          initial.heroImage = initial.background ?? initial.headerImage ?? initial.gridImage ?? null;
        }
        if (mounted) {
          setGame(initial);
        }

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
              return enriched;
            });
          })
          .catch(() => {
            // Do not fail page load if artwork provider is slow/unavailable.
          });
      } catch (err: any) {
        if (mounted) {
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
  }, [appId]);

  return { game, loading, error };
}
