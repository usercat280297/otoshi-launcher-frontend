import { useEffect, useMemo, useRef, useState } from "react";
import { artworkGet, artworkPrefetch } from "../../services/api";
import { SteamCatalogItem, SteamPrice } from "../../types";
import { getMediaProtectionProps } from "../../utils/mediaProtection";
import Badge from "../common/Badge";

type SteamCardProps = {
  item: SteamCatalogItem;
  onOpen: (item: SteamCatalogItem) => void;
  prefetchItems?: SteamCatalogItem[];
};

function formatPrice(price?: SteamPrice | null) {
  if (!price) return "Free";
  if (price.finalFormatted) return price.finalFormatted;
  if (price.formatted) return price.formatted;
  if (price.final != null) {
    const value = (price.final / 100).toFixed(2);
    return price.currency ? `${value} ${price.currency}` : `$${value}`;
  }
  return "Free";
}

const prefetchedAhead = new Set<string>();
const PREFETCH_AHEAD_LIMIT = 10;
const FALLBACK_DELAY_MS = 1800;

function mapArtworkSources(item: SteamCatalogItem, fallback: string) {
  const art = item.artwork ?? {};
  return {
    t0: art.t0 ?? item.capsuleImage ?? fallback,
    t1: art.t1 ?? item.capsuleImage ?? fallback,
    t2: art.t2 ?? item.headerImage ?? item.capsuleImage ?? fallback,
    t3: art.t3 ?? item.headerImage ?? fallback,
    t4: art.t4 ?? item.headerImage ?? fallback,
  };
}

export default function SteamCard({ item, onOpen, prefetchItems = [] }: SteamCardProps) {
  const discounted = (item.price?.discountPercent ?? 0) > 0;
  const displayPrice = formatPrice(item.price);
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const fallbackGrid = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appId}/library_600x900.jpg`;
  const steamFallback = item.capsuleImage || item.headerImage || fallbackGrid;
  const artworkSources = useMemo(
    () => mapArtworkSources(item, steamFallback),
    [item, steamFallback]
  );
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [artReady, setArtReady] = useState(false);
  const hasDenuvo = Boolean(item.denuvo);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || artReady) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        setArtReady(true);
        observer.disconnect();
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [artReady]);

  useEffect(() => {
    let active = true;
    if (!artReady) return () => {
      active = false;
    };

    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
    }

    fallbackTimerRef.current = window.setTimeout(() => {
      if (!active) return;
      setDisplayImage((current) => current || steamFallback);
    }, FALLBACK_DELAY_MS);

    const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    const run = async () => {
      const lowTier = await artworkGet(item.appId, 1, dpr, artworkSources).catch(() => null);
      if (!active) return;
      if (lowTier) {
        setDisplayImage(lowTier);
      } else {
        setDisplayImage(
          artworkSources.t2 ?? artworkSources.t1 ?? artworkSources.t0 ?? steamFallback
        );
      }

      const highTier = await artworkGet(item.appId, 3, dpr, artworkSources).catch(() => null);
      if (!active || !highTier) return;
      setDisplayImage(highTier);
    };

    void run();

    return () => {
      active = false;
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, [artReady, artworkSources, item.appId, steamFallback]);

  useEffect(() => {
    if (!artReady || !prefetchItems.length) return;
    const payload = prefetchItems
      .filter((entry) => {
        const key = String(entry.appId || "").trim();
        if (!key || prefetchedAhead.has(key)) return false;
        prefetchedAhead.add(key);
        return true;
      })
      .slice(0, PREFETCH_AHEAD_LIMIT)
      .map((entry) => ({
        gameId: entry.appId,
        sources: mapArtworkSources(
          entry,
          entry.capsuleImage ||
            entry.headerImage ||
            `https://cdn.cloudflare.steamstatic.com/steam/apps/${entry.appId}/library_600x900.jpg`
        ),
      }));

    if (!payload.length) return;
    void artworkPrefetch(payload, 2).catch(() => undefined);
  }, [artReady, prefetchItems]);

  return (
    <button
      ref={cardRef}
      onClick={() => onOpen(item)}
      className="group w-44 flex-shrink-0 text-left sm:w-48 lg:w-52"
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
            alt={item.name}
            className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.04] ${
              displayImage ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            decoding="async"
            {...getMediaProtectionProps()}
          />
        )}
        {discounted && (
          <span className="absolute left-3 top-3 rounded-full bg-primary px-2 py-1 text-[10px] font-semibold text-black">
            -{item.price?.discountPercent}%
          </span>
        )}
        {hasDenuvo && (
          <div className="absolute right-3 top-3">
            <Badge label="Denuvo" tone="danger" />
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1">
        <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted">
          Steam Library
        </p>
        <h4 className="text-sm font-semibold text-text-primary">{item.name}</h4>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">{displayPrice}</span>
        </div>
      </div>
    </button>
  );
}
