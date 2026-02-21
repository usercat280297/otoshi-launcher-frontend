import { useEffect, useMemo, useRef, useState } from "react";
import { artworkGet, artworkPrefetch } from "../../services/api";
import { SteamCatalogItem, SteamPrice } from "../../types";
import { getMediaProtectionProps } from "../../utils/mediaProtection";
import { useLocale } from "../../context/LocaleContext";
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
const POSTER_PLACEHOLDER = "/icons/game-placeholder.svg";

function decodeThumbnailSource(value: string): string {
  try {
    const parsed = new URL(value, window.location.origin);
    const embedded = parsed.searchParams.get("url");
    if (embedded) {
      return decodeURIComponent(embedded);
    }
  } catch {
    // ignore malformed URL and keep original value
  }
  return value;
}

function scorePosterCandidate(value: string): number {
  const source = decodeThumbnailSource(value).toLowerCase();
  let score = 0;
  if (/library_600x900|\/grids\/|\/grid\//.test(source)) score += 20;
  if (/\/logo\.png|\/icon\.jpg/.test(source)) score -= 20;
  if (/header|capsule_616x353|library_hero|hero/.test(source)) score -= 8;
  if (source.includes("steamgriddb.com")) score += 4;
  return score;
}

function pickBestPoster(candidates: Array<string | null | undefined>): string | null {
  const valid = candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  if (!valid.length) return null;

  let selected = valid[0];
  let best = scorePosterCandidate(selected);
  for (const candidate of valid.slice(1)) {
    const score = scorePosterCandidate(candidate);
    if (score > best) {
      best = score;
      selected = candidate;
    }
  }
  return selected;
}

function mapArtworkSources(item: SteamCatalogItem, fallback: string) {
  const art = item.artwork ?? {};
  const poster = pickBestPoster([
    art.t3,
    art.t2,
    art.t1,
    fallback,
    item.capsuleImage,
    item.headerImage,
    art.t4,
  ]);
  const hero = pickBestPoster([art.t4, item.background, item.headerImage, fallback]);
  return {
    t0: art.t0 ?? item.capsuleImage ?? item.headerImage ?? poster ?? fallback,
    t1: poster ?? fallback,
    t2: poster ?? fallback,
    t3: poster ?? fallback,
    t4: hero ?? poster ?? fallback,
  };
}

export default function SteamCard({ item, onOpen, prefetchItems = [] }: SteamCardProps) {
  const { t } = useLocale();
  const discounted = (item.price?.discountPercent ?? 0) > 0;
  const displayPrice = formatPrice(item.price);
  const [activeImage, setActiveImage] = useState<string | null>(null);
  const [incomingImage, setIncomingImage] = useState<string | null>(null);
  const [incomingReady, setIncomingReady] = useState(false);
  const fallbackTimerRef = useRef<number | null>(null);
  const commitTimerRef = useRef<number | null>(null);
  const activeImageRef = useRef<string | null>(null);
  const incomingImageRef = useRef<string | null>(null);
  const steamStaticBase = `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.appId}`;
  const fallbackGrid = `${steamStaticBase}/library_600x900.jpg`;
  const fallbackHeader = `${steamStaticBase}/header.jpg`;
  const fallbackCapsule = `${steamStaticBase}/capsule_616x353.jpg`;
  const steamFallback =
    pickBestPoster([fallbackGrid, fallbackHeader, fallbackCapsule, item.capsuleImage, item.headerImage]) ||
    fallbackHeader;
  const artworkSources = useMemo(
    () => mapArtworkSources(item, steamFallback),
    [item, steamFallback]
  );

  const posterCandidates = useMemo(() => {
    const candidates = [
      artworkSources.t3,
      artworkSources.t2,
      artworkSources.t1,
      artworkSources.t0,
      item.capsuleImage,
      item.headerImage,
      fallbackGrid,
      fallbackHeader,
      fallbackCapsule,
      `${steamStaticBase}/capsule_231x87.jpg`,
      `${steamStaticBase}/capsule_sm_120.jpg`,
      `${steamStaticBase}/capsule_184x69.jpg`,
      POSTER_PLACEHOLDER,
    ];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const value of candidates) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }, [
    artworkSources.t0,
    artworkSources.t1,
    artworkSources.t2,
    artworkSources.t3,
    fallbackCapsule,
    fallbackGrid,
    fallbackHeader,
    item.capsuleImage,
    item.headerImage,
    steamStaticBase,
  ]);

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
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [artReady, setArtReady] = useState(false);
  const hasDenuvo = Boolean(item.denuvo);
  const hasDlc = Boolean(item.isDlc || item.itemType === "dlc");

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
      if (!activeImageRef.current && !incomingImageRef.current) {
        requestImage(posterCandidates[0] || steamFallback);
      }
    }, FALLBACK_DELAY_MS);

    const dpr = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    const run = async () => {
      const lowTier = await artworkGet(item.appId, 1, dpr, artworkSources).catch(() => null);
      if (!active) return;
      if (lowTier) {
        requestImage(lowTier);
      } else {
        requestImage(posterCandidates[0] || steamFallback);
      }

      const highTier = await artworkGet(item.appId, 3, dpr, artworkSources).catch(() => null);
      if (!active || !highTier) return;
      requestImage(highTier);
    };

    void run();

    return () => {
      active = false;
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
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
            activeImage || (incomingImage && incomingReady) ? "opacity-0" : "opacity-100"
          }`}
          aria-hidden
        />
        {activeImage && (
          <img
            src={activeImage}
            alt={item.name}
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
            loading="lazy"
            decoding="async"
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
            alt={item.name}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
              incomingReady ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            decoding="async"
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
            -{item.price?.discountPercent}%
          </span>
        )}
        {hasDenuvo && (
          <div className="absolute right-3 top-3">
            <Badge label="Denuvo" tone="danger" />
          </div>
        )}
        {hasDlc && (
          <div className="absolute left-3 bottom-3">
            <Badge label={t("game.dlc")} tone="secondary" />
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
