import { useEffect, useRef, useState } from "react";
import { artworkGet, artworkPrefetch } from "../../services/api";
import { Game } from "../../types";
import { getMediaProtectionProps } from "../../utils/mediaProtection";
import Badge from "../common/Badge";

const POSTER_PLACEHOLDER = "/icons/game-placeholder.svg";

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
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [incomingImage, setIncomingImage] = useState<string | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const fallbackTimerRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const activeImageRef = useRef<string | null>(null);
  const incomingImageRef = useRef<string | null>(null);
  const FALLBACK_DELAY_MS = 1500;
  const fallbackImage = game.capsuleImage || game.headerImage || game.heroImage || null;
  const steamStaticBase =
    game.steamAppId && /^\d+$/.test(String(game.steamAppId))
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}`
      : null;

  const posterCandidates = [
    game.capsuleImage,
    game.headerImage,
    game.heroImage,
    game.iconImage,
    steamStaticBase ? `${steamStaticBase}/library_600x900.jpg` : null,
    steamStaticBase ? `${steamStaticBase}/header.jpg` : null,
    steamStaticBase ? `${steamStaticBase}/capsule_616x353.jpg` : null,
    steamStaticBase ? `${steamStaticBase}/capsule_231x87.jpg` : null,
    steamStaticBase ? `${steamStaticBase}/capsule_sm_120.jpg` : null,
    steamStaticBase ? `${steamStaticBase}/capsule_184x69.jpg` : null,
    steamStaticBase ? `${steamStaticBase}/icon.jpg` : null,
    steamStaticBase ? `${steamStaticBase}/logo.png` : null,
    POSTER_PLACEHOLDER,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value, index, self) => Boolean(value) && self.indexOf(value) === index);

  const getNextPosterCandidate = (current: string | null): string | null => {
    if (!posterCandidates.length) return null;
    const idx = current ? posterCandidates.indexOf(current) : -1;
    for (let next = idx + 1; next < posterCandidates.length; next += 1) {
      const candidate = posterCandidates[next];
      if (candidate && candidate !== current) return candidate;
    }
    return null;
  };

  useEffect(() => {
    activeImageRef.current = activeImage;
  }, [activeImage]);

  useEffect(() => {
    incomingImageRef.current = incomingImage;
  }, [incomingImage]);

  const requestImage = (value: string | null) => {
    const src = typeof value === "string" ? value.trim() : "";
    if (!src) return;
    const current = activeImageRef.current;
    const incoming = incomingImageRef.current;
    if (src === current || src === incoming) return;
    setIncomingReady(false);
    setIncomingImage(src);
  };

  useEffect(() => {
    if (!incomingImage || !incomingReady) return;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = window.setTimeout(() => {
      setActiveImage(incomingImage);
      setIncomingImage(null);
      setIncomingReady(false);
    }, 220);
    return () => {
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
      }
    };
  }, [incomingImage, incomingReady]);

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
      setActiveImage(null);
      setIncomingImage(null);
      setIncomingReady(false);
      return () => {
        active = false;
      };
    }
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!active) return;
      if (!activeImageRef.current && !incomingImageRef.current) {
        requestImage(posterCandidates[0] || fallbackImage);
      }
    }, FALLBACK_DELAY_MS);
    const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));

    const loadProgressive = async () => {
      const gameId = resolveId(game);
      const sources = mapSources(game);
      const lowTier = await artworkGet(gameId, 1, dpr, sources).catch(() => null);
      if (!active) return;
      if (lowTier) {
        requestImage(lowTier);
      } else {
        requestImage(posterCandidates[0] || fallbackImage);
      }

      const highTier = await artworkGet(gameId, 3, dpr, sources).catch(() => null);
      if (!active || !highTier) return;
      requestImage(highTier);
    };

    void loadProgressive();

    return () => {
      active = false;
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
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
            activeImage || (incomingImage && incomingReady) ? "opacity-0" : "opacity-100"
          }`}
          aria-hidden
        />
        {activeImage && (
          <img
            src={activeImage}
            alt={game.title}
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
            onError={() => {
              const next = getNextPosterCandidate(activeImageRef.current);
              if (next && next !== activeImageRef.current) {
                requestImage(next);
              }
            }}
            {...getMediaProtectionProps()}
          />
        )}
        {incomingImage && (
          <img
            src={incomingImage}
            alt={game.title}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
              incomingReady ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setIncomingReady(true)}
            onError={() => {
              const current = incomingImageRef.current || incomingImage;
              const next = getNextPosterCandidate(current);
              if (next && next !== current) {
                setIncomingReady(false);
                setIncomingImage(next);
              } else {
                setIncomingReady(false);
                setIncomingImage(null);
              }
            }}
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
