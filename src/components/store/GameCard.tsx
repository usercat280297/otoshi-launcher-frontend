import { useEffect, useRef, useState } from "react";
import { artworkGet, artworkPrefetch } from "../../services/api";
import { Game } from "../../types";
import { getMediaProtectionProps } from "../../utils/mediaProtection";
import Badge from "../common/Badge";

export default function GameCard({
  game,
  onOpen,
  prefetchGames = []
}: {
  game: Game;
  onOpen: (game: Game) => void;
  prefetchGames?: Game[];
}) {
  const discounted = game.discountPercent > 0;
  const price = (game.price * (1 - game.discountPercent / 100)).toFixed(2);
  const displayPrice = game.price <= 0 ? "Free" : `$${price}`;
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const FALLBACK_DELAY_MS = 1500;
  const fallbackImage = game.capsuleImage || game.headerImage || game.heroImage || null;

  const mapSources = (item: Game) => ({
    t0: item.capsuleImage || item.iconImage || item.headerImage || item.heroImage || null,
    t1: item.capsuleImage || item.headerImage || item.heroImage || null,
    t2: item.headerImage || item.capsuleImage || item.heroImage || null,
    t3: item.heroImage || item.headerImage || item.capsuleImage || null,
    t4: item.heroImage || item.headerImage || item.capsuleImage || null,
  });

  const resolveId = (item: Game) => item.steamAppId || item.id;

  useEffect(() => {
    let active = true;
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
    }
    if (!fallbackImage) {
      setDisplayImage(null);
      return () => {
        active = false;
      };
    }
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!active) return;
      setDisplayImage((current) => current || fallbackImage);
    }, FALLBACK_DELAY_MS);
    const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));

    const loadProgressive = async () => {
      const gameId = resolveId(game);
      const sources = mapSources(game);
      const lowTier = await artworkGet(gameId, 1, dpr, sources).catch(() => null);
      if (!active) return;
      if (lowTier) {
        setDisplayImage(lowTier);
      } else {
        setDisplayImage(fallbackImage);
      }

      const highTier = await artworkGet(gameId, 3, dpr, sources).catch(() => null);
      if (!active || !highTier) return;
      setDisplayImage(highTier);
    };

    void loadProgressive();

    return () => {
      active = false;
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, [fallbackImage, game]);

  useEffect(() => {
    if (!prefetchGames.length) return;
    const payload = prefetchGames.slice(0, 8).map((item) => ({
      gameId: resolveId(item),
      sources: mapSources(item),
    }));
    void artworkPrefetch(payload, 2).catch(() => undefined);
  }, [prefetchGames]);

  return (
    <button
      onClick={() => onOpen(game)}
      className="group w-40 flex-shrink-0 text-left sm:w-44 lg:w-48"
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-background-border bg-background-surface shadow-soft">
        <div
          className={`absolute inset-0 ghost-placeholder transition-opacity duration-500 ${
            displayImage ? "opacity-0" : "opacity-100"
          }`}
          aria-hidden
        />
        {displayImage && (
          <img
            src={displayImage}
            alt={game.title}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
            {...getMediaProtectionProps()}
          />
        )}
        {discounted && (
          <span className="absolute left-3 top-3 rounded-full bg-primary px-2 py-1 text-[10px] font-semibold text-black">
            -{game.discountPercent}%
          </span>
        )}
        {game.denuvo && (
          <div className="absolute right-3 top-3">
            <Badge label="Denuvo" tone="danger" />
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted">
          Base Game
        </p>
        <h4 className="text-sm font-semibold text-text-primary">{game.title}</h4>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          {discounted ? (
            <>
              <span className="font-semibold text-text-primary">{displayPrice}</span>
              <span className="line-through text-text-muted">
                ${game.price.toFixed(2)}
              </span>
            </>
          ) : (
            <span className="font-semibold text-text-primary">{displayPrice}</span>
          )}
        </div>
      </div>
    </button>
  );
}
