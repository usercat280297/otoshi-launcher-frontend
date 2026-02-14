import { useEffect, useRef, useState } from "react";
import { Game } from "../../types";
import { getMediaProtectionProps } from "../../utils/mediaProtection";
import Badge from "../common/Badge";

export default function GameCard({
  game,
  onOpen
}: {
  game: Game;
  onOpen: (game: Game) => void;
}) {
  const discounted = game.discountPercent > 0;
  const price = (game.price * (1 - game.discountPercent / 100)).toFixed(2);
  const displayPrice = game.price <= 0 ? "Free" : `$${price}`;
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const FALLBACK_DELAY_MS = 2000;
  const hasSteamGridArt = Boolean(game.logoImage || game.iconImage);

  useEffect(() => {
    let active = true;
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
    }
    if (!game.headerImage) {
      setDisplayImage(null);
      return () => {
        active = false;
      };
    }

    const revealImage = (src: string) => {
      const img = new Image();
      img.onload = () => {
        if (!active) return;
        setDisplayImage(src);
      };
      img.onerror = () => {
        if (!active) return;
        setDisplayImage(src);
      };
      img.src = src;
    };

    if (hasSteamGridArt) {
      revealImage(game.headerImage);
      return () => {
        active = false;
      };
    }

    setDisplayImage(null);
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!active) return;
      revealImage(game.headerImage);
    }, FALLBACK_DELAY_MS);

    return () => {
      active = false;
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, [game.headerImage, hasSteamGridArt]);

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
