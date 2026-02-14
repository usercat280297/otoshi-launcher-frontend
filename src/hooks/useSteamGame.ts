import { useEffect, useState } from "react";
import { fetchSteamGameDetail, fetchSteamGridAssets } from "../services/api";
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
        const detail = await fetchSteamGameDetail(appId);
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
