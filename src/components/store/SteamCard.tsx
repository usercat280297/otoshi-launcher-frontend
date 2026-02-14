import { useEffect, useRef, useState } from "react";
import { fetchSteamGridAssets } from "../../services/api";
import { SteamCatalogItem, SteamPrice } from "../../types";
import { getMediaProtectionProps } from "../../utils/mediaProtection";
import Badge from "../common/Badge";

type SteamCardProps = {
  item: SteamCatalogItem;
  onOpen: (item: SteamCatalogItem) => void;
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

export default function SteamCard({ item, onOpen }: SteamCardProps) {
  const discounted = (item.price?.discountPercent ?? 0) > 0;
  const displayPrice = formatPrice(item.price);
  const [gridImage, setGridImage] = useState<string | null>(null);
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const FALLBACK_DELAY_MS = 2500;
  const fallbackGrid = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appId}/library_600x900.jpg`;
  const steamFallback = item.capsuleImage || item.headerImage || fallbackGrid;
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [artReady, setArtReady] = useState(false);
  const hasDenuvo = Boolean(item.denuvo);

  useEffect(() => {
    let active = true;
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
    }
    if (!artReady) {
      return () => {
        active = false;
      };
    }
    if (!gridImage) {
      fallbackTimerRef.current = window.setTimeout(() => {
        if (!active) return;
        const img = new Image();
        img.onload = () => {
          if (!active) return;
          setDisplayImage(steamFallback);
        };
        img.onerror = () => {
          if (!active) return;
          setDisplayImage(steamFallback);
        };
        img.src = steamFallback;
      }, FALLBACK_DELAY_MS);
    }
    return () => {
      active = false;
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
    };
  }, [artReady, gridImage, steamFallback]);

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
    let mounted = true;
    if (!artReady) return () => {
      mounted = false;
    };
    fetchSteamGridAssets(item.name, item.appId)
      .then((asset) => {
        if (!mounted || !asset) return;
        setGridImage(asset.grid ?? null);
        setLogoImage(asset.logo ?? null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [artReady, item.appId, item.name]);

  useEffect(() => {
    let active = true;
    if (!gridImage) return;
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
    }
    const img = new Image();
    img.onload = () => {
      if (!active) return;
      setDisplayImage(gridImage);
    };
    img.src = gridImage;
    return () => {
      active = false;
    };
  }, [gridImage]);

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
        {logoImage && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/60 to-transparent p-3">
            <img
              src={logoImage}
              alt={`${item.name} logo`}
              className="h-6 w-auto max-w-full"
              loading="lazy"
              decoding="async"
              {...getMediaProtectionProps()}
            />
          </div>
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
