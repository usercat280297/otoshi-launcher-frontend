import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import Hero from "../components/store/Hero";
import FeaturedRow from "../components/store/FeaturedRow";
import SteamCard from "../components/store/SteamCard";
import StoreSubnav from "../components/store/StoreSubnav";
import GuidedTour from "../components/common/GuidedTour";
import { useGames } from "../hooks/useGames";
import { useSteamSearchMemory } from "../hooks/useSteamSearchMemory";
import {
  fetchSteamCatalog,
  fetchSteamIndexCatalog,
  fetchSteamGridAssetsBatch,
  searchSteamIndexCatalog,
  getApiDebugInfo,
  runLauncherFirstRunDiagnostics,
} from "../services/api";
import { Game, SteamCatalogItem } from "../types";
import { useLocale } from "../context/LocaleContext";

const ALL_GAMES_PAGE_SIZE = 48;
const SEARCH_STORAGE_KEY = "otoshi.search.steam";
const SEARCH_PREVIEW_LIMIT = 6;
const CATALOG_CACHE_KEY = "otoshi.catalog.page2";
const CATALOG_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const CATALOG_FETCH_MAX_ATTEMPTS = 5;
const CATALOG_FETCH_RETRY_BASE_MS = 500;
const CATALOG_FETCH_RETRY_MAX_MS = 2500;
const FIRST_RUN_DIAGNOSTIC_KEY = "otoshi.first_run.diagnostics.v1";
const normalizeSearch = (value: string) => value.trim().toLowerCase();
const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const getCatalogRetryDelayMs = (attempt: number) =>
  Math.min(
    CATALOG_FETCH_RETRY_MAX_MS,
    CATALOG_FETCH_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
  );

function mergeSteamGridAssets(
  items: SteamCatalogItem[],
  assetsByAppId: Record<string, { grid?: string | null; hero?: string | null; logo?: string | null; icon?: string | null } | null>
): SteamCatalogItem[] {
  return items.map((item) => {
    const key = String(item.appId || "").trim();
    const assets = key ? assetsByAppId[key] : null;
    if (!assets) {
      return item;
    }

    const grid = assets.grid || item.artwork?.t3 || item.headerImage || item.capsuleImage || null;
    const hero = assets.hero || item.background || item.artwork?.t4 || grid;
    const icon = assets.icon || item.artwork?.t0 || item.capsuleImage || item.headerImage || null;

    return {
      ...item,
      headerImage: grid || item.headerImage,
      capsuleImage: grid || item.capsuleImage,
      background: hero || item.background,
      artwork: {
        ...(item.artwork || {}),
        t0: icon,
        t1: grid || item.artwork?.t1 || item.capsuleImage || null,
        t2: grid || item.artwork?.t2 || item.headerImage || null,
        t3: grid || item.artwork?.t3 || item.capsuleImage || item.headerImage || null,
        t4: hero || item.artwork?.t4 || item.background || item.headerImage || null,
        version: Number(item.artwork?.version || 1) + 1,
      },
    };
  });
}

export default function StorePage() {
  const navigate = useNavigate();
  const { games, loading, error, errorCode } = useGames();
  const { t } = useLocale();
  const [denuvoRail, setDenuvoRail] = useState<Game[]>([]);
  const denuvoSourceRef = useRef<Game[]>([]);
  const denuvoSourceKeyRef = useRef("");
  const [allGames, setAllGames] = useState<SteamCatalogItem[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const [allPage, setAllPage] = useState(0);
  const [allPendingPage, setAllPendingPage] = useState<number | null>(null);
  const [allJumpInput, setAllJumpInput] = useState("1");
  const [tourOpen, setTourOpen] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [introLoading, setIntroLoading] = useState(true);
  const [heroImageReady, setHeroImageReady] = useState(false);
  const [firstRunPending, setFirstRunPending] = useState(false);
  const [firstRunResult, setFirstRunResult] = useState<any | null>(null);
  const [firstRunError, setFirstRunError] = useState<string | null>(null);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPreviewItems, setSearchPreviewItems] = useState<SteamCatalogItem[]>([]);
  const searchPreviewCacheRef = useRef(new Map<string, SteamCatalogItem[]>());
  const searchPreviewRequestRef = useRef(0);
  const allPageCacheRef = useRef(new Map<number, { items: SteamCatalogItem[]; total: number }>());
  const allPageRequestSeqRef = useRef(0);
  const { suggestions, recordSearch } = useSteamSearchMemory();

  const rotateDenuvoRail = useCallback(() => {
    const source = denuvoSourceRef.current;
    if (!source.length) return;
    const shuffled = [...source].sort(() => Math.random() - 0.5);
    setDenuvoRail(shuffled.slice(0, 5));
  }, []);

  const handleOpen = (game: Game) => {
    if (game.steamAppId) {
      navigate(`/steam/${game.steamAppId}`);
      return;
    }
    navigate(`/games/${game.slug}`);
  };

  const handleOpenSteam = (item: SteamCatalogItem) => {
    navigate(`/steam/${item.appId}`);
  };

  const loadCachedCatalog = () => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { ts: number; data: { total: number; items: SteamCatalogItem[] } };
      if (!parsed || typeof parsed.ts !== "number" || !parsed.data) return null;
      if (Date.now() - parsed.ts > CATALOG_CACHE_TTL_MS) {
        window.localStorage.removeItem(CATALOG_CACHE_KEY);
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  };

  const saveCachedCatalog = (payload: { total: number; items: SteamCatalogItem[] }) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        CATALOG_CACHE_KEY,
        JSON.stringify({ ts: Date.now(), data: payload })
      );
    } catch {
      // ignore storage errors
    }
  };

  const fetchCatalogPage = useCallback(
    async (pageIndex: number) => {
      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= CATALOG_FETCH_MAX_ATTEMPTS; attempt += 1) {
        try {
          const offset = pageIndex * ALL_GAMES_PAGE_SIZE;
          let data: { total: number; offset: number; limit: number; items: SteamCatalogItem[] };
          try {
            data = await fetchSteamIndexCatalog({
              limit: ALL_GAMES_PAGE_SIZE,
              offset,
              sort: "recent",
              scope: "all",
            });
          } catch {
            data = await fetchSteamCatalog({
              limit: ALL_GAMES_PAGE_SIZE,
              offset,
              artMode: "tiered",
              thumbW: 460
            });
          }
          let enrichedItems = data.items;
          if (enrichedItems.length) {
            try {
              const batchAssets = await fetchSteamGridAssetsBatch(
                enrichedItems.map((item) => ({
                  appId: item.appId,
                  title: item.name,
                }))
              );
              enrichedItems = mergeSteamGridAssets(enrichedItems, batchAssets);
            } catch {
              // keep base Steam catalog assets on batch failure
            }
          }
          const totalCount = data.total ?? 0;
          const payload = { items: enrichedItems, total: totalCount };
          allPageCacheRef.current.set(pageIndex, payload);
          if (pageIndex === 0) {
            saveCachedCatalog(payload);
          }
          return payload;
        } catch (err: any) {
          lastError =
            err instanceof Error
              ? err
              : new Error(err?.message || "Failed to load full catalog");
          if (attempt < CATALOG_FETCH_MAX_ATTEMPTS) {
            await wait(getCatalogRetryDelayMs(attempt));
            continue;
          }
        }
      }
      throw lastError || new Error("Failed to load full catalog");
    },
    []
  );

  const prefetchCatalogPage = useCallback(
    (pageIndex: number, totalPages: number) => {
      if (pageIndex < 0 || pageIndex >= totalPages) return;
      if (allPageCacheRef.current.has(pageIndex)) return;
      void fetchCatalogPage(pageIndex).catch(() => {});
    },
    [fetchCatalogPage]
  );

  const loadAllGames = useCallback(
    async (pageIndex: number) => {
      const safePage = Math.max(0, pageIndex);
      const requestId = ++allPageRequestSeqRef.current;
      setAllLoading(true);
      setAllError(null);
      setAllPendingPage(safePage);

      const cached = allPageCacheRef.current.get(safePage);
      if (cached) {
        setAllGames(cached.items);
        setAllTotal((prev) => (prev > 0 ? prev : cached.total));
      }

      try {
        const payload = await fetchCatalogPage(safePage);
        if (requestId !== allPageRequestSeqRef.current) return;

        setAllGames(payload.items);
        setAllTotal(payload.total);

        const maxPageIndex = Math.max(
          0,
          Math.ceil(Math.max(payload.total, 1) / ALL_GAMES_PAGE_SIZE) - 1
        );
        prefetchCatalogPage(safePage + 1, maxPageIndex + 1);
        prefetchCatalogPage(safePage - 1, maxPageIndex + 1);
      } catch (err: any) {
        if (requestId !== allPageRequestSeqRef.current) return;
        setAllError(err.message || "Failed to load full catalog");
      } finally {
        if (requestId === allPageRequestSeqRef.current) {
          setAllLoading(false);
          setAllPendingPage(null);
        }
      }
    },
    [fetchCatalogPage, prefetchCatalogPage]
  );

  useEffect(() => {
    const saved = localStorage.getItem(SEARCH_STORAGE_KEY) || "";
    if (saved) {
      setSearchQuery(saved);
    }
    const cached = loadCachedCatalog();
    if (cached && cached.items?.length) {
      allPageCacheRef.current.set(0, {
        items: cached.items,
        total: cached.total ?? cached.items.length
      });
      setAllGames(cached.items);
      setAllTotal(cached.total ?? cached.items.length);
    }
    void loadAllGames(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(FIRST_RUN_DIAGNOSTIC_KEY) === "1") {
      setFirstRunDismissed(true);
      return;
    }

    let cancelled = false;
    const runDeferredDiagnostics = () => {
      setFirstRunPending(true);
      setFirstRunError(null);
      runLauncherFirstRunDiagnostics({ preloadLimit: 72, deferred: true })
        .then((result) => {
          if (cancelled) return;
          setFirstRunResult(result);
        })
        .catch((err: any) => {
          if (cancelled) return;
          setFirstRunError(err?.message || "First-run diagnostics failed");
        })
        .finally(() => {
          if (cancelled) return;
          setFirstRunPending(false);
        });
    };

    let idleId: number | null = null;
    let timeoutId: number | null = null;
    const requestIdle = (window as Window & { requestIdleCallback?: Function }).requestIdleCallback;
    const cancelIdle = (window as Window & { cancelIdleCallback?: Function }).cancelIdleCallback;

    if (typeof requestIdle === "function") {
      idleId = requestIdle(() => runDeferredDiagnostics(), { timeout: 2500 }) as number;
    } else {
      timeoutId = window.setTimeout(() => runDeferredDiagnostics(), 1200);
    }

    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId != null && typeof cancelIdle === "function") {
        cancelIdle(idleId);
      }
    };
  }, []);

  useEffect(() => {
    if (!games.length) {
      setDenuvoRail([]);
      return;
    }
    const denuvoOnly = games.filter((game) => game.denuvo);
    const source = denuvoOnly.length ? denuvoOnly : games;
    const key = source
      .map((game) => game.id)
      .sort()
      .join("|");

    denuvoSourceRef.current = source;

    if (denuvoSourceKeyRef.current !== key) {
      denuvoSourceKeyRef.current = key;
      rotateDenuvoRail();
      return;
    }

    // Update existing picks with latest art without reshuffling.
    setDenuvoRail((prev) =>
      prev.map((game) => source.find((item) => item.id === game.id) ?? game)
    );
  }, [games, rotateDenuvoRail]);

  useEffect(() => {
    const timer = window.setInterval(rotateDenuvoRail, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [rotateDenuvoRail]);

  const handleSearchSubmit = useCallback(
    (value?: string) => {
      const nextQuery = (value ?? searchQuery).trim();
      setSearchQuery(nextQuery);
      if (!nextQuery) {
        localStorage.removeItem(SEARCH_STORAGE_KEY);
        setSearchPreviewItems([]);
        return;
      }
      localStorage.setItem(SEARCH_STORAGE_KEY, nextQuery);
      recordSearch(nextQuery);
      navigate("/steam");
    },
    [navigate, recordSearch, searchQuery]
  );

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchPreviewItems([]);
      return;
    }
    const cacheKey = normalizeSearch(trimmed);
    const cached = searchPreviewCacheRef.current.get(cacheKey);
    if (cached) {
      setSearchPreviewItems(cached);
      return;
    }
    const requestId = (searchPreviewRequestRef.current += 1);
    const timer = window.setTimeout(() => {
      (async () => {
        try {
          const indexData = await searchSteamIndexCatalog({
            q: trimmed,
            limit: SEARCH_PREVIEW_LIMIT,
            offset: 0,
            source: "global",
          });
          return indexData;
        } catch {
          return fetchSteamCatalog({
            limit: SEARCH_PREVIEW_LIMIT,
            offset: 0,
            search: trimmed,
            artMode: "basic",
            thumbW: 360
          });
        }
      })()
        .then((data) => {
          if (searchPreviewRequestRef.current !== requestId) return;
          setSearchPreviewItems(data.items);
          searchPreviewCacheRef.current.set(cacheKey, data.items);
        })
        .catch(() => {
          if (searchPreviewRequestRef.current !== requestId) return;
          setSearchPreviewItems([]);
        })
        .finally(() => {
          if (searchPreviewRequestRef.current !== requestId) return;
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const resultSuggestions = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return [];
    return searchPreviewItems.slice(0, SEARCH_PREVIEW_LIMIT).map((item) => ({
      id: `result-${item.appId}`,
      label: item.name,
      value: item.name,
      kind: "result" as const,
      image: item.headerImage ?? item.capsuleImage ?? null,
      meta: `#${item.appId}`,
      appId: item.appId
    }));
  }, [searchPreviewItems, searchQuery]);

  const combinedSuggestions = useMemo(
    () => [...resultSuggestions, ...suggestions],
    [resultSuggestions, suggestions]
  );

  const heroSlides = denuvoRail.length ? denuvoRail : games.slice(0, 5);
  const heroGame = heroSlides[0];
  const heroImageSrc = heroGame?.heroImage ?? "";
  const railGames = heroSlides.slice(1);
  const discoverRow = games.slice(0, 6);
  const spotlightRow = useMemo(() => {
    const discounted = games.filter((game) => game.discountPercent > 0);
    if (discounted.length >= 6) {
      return discounted.slice(0, 6);
    }
    const seen = new Set<string>();
    return [...discounted, ...games]
      .filter((game) => {
        if (seen.has(game.id)) return false;
        seen.add(game.id);
        return true;
      })
      .slice(0, 6);
  }, [games]);

  const topSellers = games.slice(0, 5);
  const mostPlayed = games.slice(2, 7);
  const wishlisted = games.slice(4, 9);

  const promoTiles = useMemo(() => [
    {
      title: t("store.sales_specials"),
      description: t("store.save_big"),
      cta: t("store.browse"),
      image: games[1]?.heroImage
    },
    {
      title: t("store.free_games"),
      description: t("store.explore_free"),
      cta: t("store.play_now"),
      image: games[2]?.heroImage
    },
    {
      title: t("store.apps"),
      description: t("store.creative_tools"),
      cta: t("store.browse"),
      image: games[3]?.heroImage
    }
  ], [games, t]);

  const formatPrice = (game: Game) => {
    if (game.price <= 0) return t("common.free");
    const discountedPrice = (game.price * (1 - game.discountPercent / 100)).toFixed(2);
    return `$${discountedPrice}`;
  };

  useEffect(() => {
    let cancelled = false;
    const shouldWaitForHero = !loading && !error && games.length > 0;

    if (!shouldWaitForHero || !heroImageSrc) {
      setHeroImageReady(true);
      return;
    }

    setHeroImageReady(false);
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        setHeroImageReady(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setHeroImageReady(true);
      }
    };
    img.src = heroImageSrc;

    if (img.complete) {
      setHeroImageReady(true);
    }

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [loading, error, games.length, heroImageSrc]);

  const StoreList = ({ title, items }: { title: string; items: Game[] }) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <ChevronRight size={16} className="text-text-muted" />
      </div>
      <div className="space-y-3 rounded-2xl border border-background-border bg-background-elevated p-4">
        {items.map((game) => (
          <button
            key={game.id}
            onClick={() => handleOpen(game)}
            className="flex w-full items-center gap-3 text-left"
          >
            <img
              src={game.iconImage || game.headerImage}
              alt={game.title}
              className="h-12 w-12 rounded-lg object-cover"
            />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-semibold">{game.title}</p>
              <p className="text-xs text-text-muted">
                {game.price <= 0 ? t("common.free") : t("store.base_game")}
              </p>
            </div>
            <div className="text-right text-xs text-text-secondary">
              <p className="font-semibold text-text-primary">{formatPrice(game)}</p>
              {game.discountPercent > 0 && (
                <p className="text-[10px] text-primary">-{game.discountPercent}%</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const resetOnceKey = "otoshi.tour.store.reset_once";
    if (window.localStorage.getItem(resetOnceKey) !== "1") {
      window.localStorage.removeItem("otoshi.tour.store.seen");
      window.localStorage.setItem(resetOnceKey, "1");
    }
  }, []);

  const requiresHeroReady = !loading && !error && games.length > 0;
  const initialStoreContentReady =
    !loading &&
    (Boolean(error) || games.length > 0) &&
    !allLoading &&
    (Boolean(allError) || allGames.length > 0) &&
    (!requiresHeroReady || heroImageReady);

  useEffect(() => {
    if (!introLoading) return;
    if (!initialStoreContentReady) return;
    const timer = window.setTimeout(() => setIntroLoading(false), 400);
    return () => window.clearTimeout(timer);
  }, [introLoading, initialStoreContentReady]);

  const tourSteps = useMemo(
    () => [
      {
        id: "sidebar",
        title: "Sidebar Navigation",
        description:
          "Quick access to every core section: library, downloads, fixes, and settings.",
        selector: "[data-tour='sidebar']"
      },
      {
        id: "sidebar-store",
        title: "Store",
        description: "Your main hub for browsing and discovering games.",
        selector: "[data-tour='sidebar-store']"
      },
      {
        id: "sidebar-library",
        title: "Library",
        description: "See installed games and launch presets.",
        selector: "[data-tour='sidebar-library']"
      },
      {
        id: "sidebar-downloads",
        title: "Downloads",
        description: "Track chunked downloads and resume progress.",
        selector: "[data-tour='sidebar-downloads']"
      },
      {
        id: "sidebar-fixes",
        title: "Fixes",
        description: "Access online-fix and bypass resources fast.",
        selector: "[data-tour='sidebar-online-fix']"
      },
      {
        id: "sidebar-settings",
        title: "Settings",
        description: "Configure renderer defaults and storage paths.",
        selector: "[data-tour='sidebar-settings']"
      },
      {
        id: "store-search",
        title: "Search & Navigation",
        description:
          "Find any title instantly, jump to Steam detail, or explore curated rails.",
        selector: "[data-tour='store-search']"
      },
      {
        id: "store-hero",
        title: "Hero Spotlight",
        description:
          "Featured release with quick actions, curated for visibility.",
        selector: "[data-tour='store-hero']"
      },
      {
        id: "store-discover",
        title: "Discover Row",
        description:
          "Fresh picks pulled from your catalog and trending metadata.",
        selector: "[data-tour='store-discover']"
      },
      {
        id: "store-savings",
        title: "Savings Row",
        description:
          "Discounted highlights pulled by best price + rating mix.",
        selector: "[data-tour='store-savings']"
      },
      {
        id: "store-toplists",
        title: "Top Lists",
        description:
          "Quick access to top sellers, most played, and wishlisted.",
        selector: "[data-tour='store-toplists']"
      },
      {
        id: "store-allgames",
        title: "All Games Grid",
        description:
          "Full catalog browsing with lazy loading and search continuity.",
        selector: "[data-tour='store-allgames']"
      },
      {
        id: "store-promo",
        title: "Promotions",
        description:
          "Seasonal tiles for specials, free games, and apps.",
        selector: "[data-tour='store-promo']"
      }
    ],
    []
  );

  useEffect(() => {
    if (introLoading) return;
    if (firstRunPending) return;
    if (!games.length) return;
    if (typeof window === "undefined") return;
    const seen = window.localStorage.getItem("otoshi.tour.store.seen");
    if (seen !== "1") {
      setTourIndex(0);
      setTourOpen(true);
    }
  }, [introLoading, firstRunPending, games.length]);

  useEffect(() => {
    const handleStart = () => {
      setTourIndex(0);
      setTourOpen(true);
    };
    window.addEventListener("otoshi:tour:store", handleStart);
    return () => window.removeEventListener("otoshi:tour:store", handleStart);
  }, []);

  const totalPages = useMemo(() => {
    const total = allTotal || allGames.length;
    return Math.max(1, Math.ceil(total / ALL_GAMES_PAGE_SIZE));
  }, [allTotal, allGames.length]);
  const formattedAllTotal = useMemo(
    () => (allTotal > 0 ? new Intl.NumberFormat().format(allTotal) : ""),
    [allTotal]
  );

  const visiblePages = useMemo(() => {
    const current = Math.min(allPage, totalPages - 1);
    const windowSize = 5;
    let start = Math.max(0, current - Math.floor(windowSize / 2));
    let end = Math.min(totalPages - 1, start + windowSize - 1);
    if (end - start + 1 < windowSize) {
      start = Math.max(0, end - windowSize + 1);
    }
    const pages = [];
    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }
    return pages;
  }, [allPage, totalPages]);

  const handlePageChange = (pageIndex: number) => {
    if (pageIndex < 0 || pageIndex >= totalPages) return;
    setAllPage(pageIndex);
    setAllJumpInput(String(pageIndex + 1));
    void loadAllGames(pageIndex);
  };

  const handleJumpToPage = () => {
    const parsed = Number(allJumpInput);
    if (!Number.isFinite(parsed)) return;
    const targetPage = Math.min(Math.max(1, Math.floor(parsed)), totalPages) - 1;
    handlePageChange(targetPage);
  };

  const allGamesSection = (
    <section className="space-y-4" data-tour="store-allgames">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">{t("store.all_games")}</h3>
          <ChevronRight size={16} className="text-text-muted" />
        </div>
        <p className="text-xs uppercase tracking-[0.35em] text-text-muted">
          {allTotal ? `${formattedAllTotal} ${t("store.titles_count")}` : t("store.loading_catalog")}
        </p>
      </div>
      {allError && (
        <div className="glass-panel p-4 text-sm text-text-secondary">
          {allError}
        </div>
      )}
      <div className="relative min-h-[360px]">
        <div className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 ${allLoading ? "opacity-60" : ""}`}>
          {allGames.map((item, index) => (
            <SteamCard
              key={item.appId}
              item={item}
              onOpen={handleOpenSteam}
              prefetchItems={allGames.slice(index + 1, index + 11)}
            />
          ))}
        </div>
        {allLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="glass-panel flex items-center gap-2 px-4 py-2 text-xs text-text-secondary">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
              <span>
                {t("store.loading_more")}
                {allPendingPage !== null ? ` (page ${allPendingPage + 1})` : ""}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => handlePageChange(allPage - 1)}
            disabled={allPage <= 0 || allLoading}
            className="rounded-lg border border-background-border px-3 py-2 text-xs text-text-secondary transition hover:border-primary hover:text-text-primary disabled:opacity-50"
          >
            {t("common.previous")}
          </button>
          {visiblePages[0] > 0 && (
            <>
              <button
                onClick={() => handlePageChange(0)}
                className="rounded-lg border border-background-border px-3 py-2 text-xs text-text-secondary transition hover:border-primary hover:text-text-primary"
              >
                1
              </button>
              {visiblePages[0] > 1 && (
                <span className="px-2 text-xs text-text-muted">...</span>
              )}
            </>
          )}
          {visiblePages.map((pageIndex) => (
            <button
              key={`page-${pageIndex}`}
              onClick={() => handlePageChange(pageIndex)}
              disabled={allLoading}
              className={`rounded-lg px-3 py-2 text-xs transition ${
                pageIndex === allPage
                  ? "bg-primary text-black"
                  : "border border-background-border text-text-secondary hover:border-primary hover:text-text-primary"
              }`}
            >
              {pageIndex + 1}
            </button>
          ))}
          {visiblePages[visiblePages.length - 1] < totalPages - 1 && (
            <>
              {visiblePages[visiblePages.length - 1] < totalPages - 2 && (
                <span className="px-2 text-xs text-text-muted">...</span>
              )}
              <button
                onClick={() => handlePageChange(totalPages - 1)}
                className="rounded-lg border border-background-border px-3 py-2 text-xs text-text-secondary transition hover:border-primary hover:text-text-primary"
              >
                {totalPages}
              </button>
            </>
          )}
          <button
            onClick={() => handlePageChange(allPage + 1)}
            disabled={allPage >= totalPages - 1 || allLoading}
            className="rounded-lg border border-background-border px-3 py-2 text-xs text-text-secondary transition hover:border-primary hover:text-text-primary disabled:opacity-50"
          >
            {t("common.next")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={Math.max(1, totalPages)}
            value={allJumpInput}
            onChange={(event) => setAllJumpInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleJumpToPage();
              }
            }}
            className="w-24 rounded-lg border border-background-border bg-background-elevated px-3 py-2 text-xs text-text-primary outline-none transition focus:border-primary"
            placeholder={t("pagination.page")}
          />
          <button
            onClick={handleJumpToPage}
            disabled={allLoading}
            className="rounded-lg border border-background-border px-3 py-2 text-xs text-text-secondary transition hover:border-primary hover:text-text-primary disabled:opacity-50"
          >
            {t("pagination.go")}
          </button>
        </div>
      </div>
    </section>
  );

  const showIntroLoading = introLoading;
  const showFirstRunWizard =
    !firstRunDismissed && !firstRunPending && (Boolean(firstRunResult) || Boolean(firstRunError));

  const firstRunSections = useMemo(() => {
    if (!firstRunResult) return [];
    return [
      { id: "system", label: "System", data: firstRunResult.system },
      { id: "health", label: "Launcher Health", data: firstRunResult.health },
      { id: "anti_cheat", label: "Anti-cheat", data: firstRunResult.anti_cheat },
      { id: "preload", label: "Preload Cache", data: firstRunResult.preload }
    ];
  }, [firstRunResult]);

  const handleDismissFirstRun = () => {
    setFirstRunDismissed(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(FIRST_RUN_DIAGNOSTIC_KEY, "1");
    }
  };

  return (
    <div className="space-y-10">
      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {showIntroLoading ? (
                <motion.div
                  key="store-intro-loading"
                  className="intro-loading-root"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <div className="intro-loading-card">
                    <div className="intro-loading-ring" />
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-white/70">
                      <span className="intro-loading-dot" />
                      {firstRunPending ? "First-run setup" : "Loading Otoshi"}
                    </div>
                    <p className="text-sm text-white/70">
                      {firstRunPending
                        ? "Checking system, launcher health, anti-cheat compatibility, and warming cache..."
                        : "Preparing your launcher view..."}
                    </p>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}
      <GuidedTour
        open={tourOpen}
        steps={tourSteps}
        index={tourIndex}
        onClose={() => {
          setTourOpen(false);
          if (typeof window !== "undefined") {
            window.localStorage.setItem("otoshi.tour.store.seen", "1");
          }
        }}
        onPrev={() => setTourIndex((prev) => Math.max(0, prev - 1))}
        onNext={() => {
          if (tourIndex >= tourSteps.length - 1) {
            setTourOpen(false);
            if (typeof window !== "undefined") {
              window.localStorage.setItem("otoshi.tour.store.seen", "1");
            }
            return;
          }
          setTourIndex((prev) => Math.min(tourSteps.length - 1, prev + 1));
        }}
      />
      <AnimatePresence>
        {showFirstRunWizard && (
          <motion.div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="w-full max-w-2xl rounded-2xl border border-background-border bg-background-elevated p-6 shadow-2xl"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
            >
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.35em] text-text-muted">First-run wizard</p>
                <h3 className="text-xl font-semibold text-text-primary">Environment checks completed</h3>
                <p className="text-sm text-text-secondary">
                  Review the launcher readiness results before continuing.
                </p>
              </div>
              {firstRunError && (
                <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                  {firstRunError}
                </div>
              )}
              {!firstRunError && firstRunSections.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {firstRunSections.map((section) => {
                    const status = section.data?.summary?.status || "warn";
                    const counts = section.data?.summary?.counts || {};
                    const statusClass =
                      status === "pass"
                        ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                        : status === "warn"
                          ? "text-amber-200 border-amber-400/30 bg-amber-500/10"
                          : "text-red-200 border-red-500/30 bg-red-500/10";
                    return (
                      <div key={section.id} className={`rounded-lg border p-3 ${statusClass}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{section.label}</p>
                          <p className="text-xs uppercase">{status}</p>
                        </div>
                        <p className="mt-2 text-xs opacity-90">
                          pass {counts.pass ?? 0} | warn {counts.warn ?? 0} | fail {counts.fail ?? 0}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-6 flex justify-end">
                <button
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90"
                  onClick={handleDismissFirstRun}
                >
                  Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div data-tour="store-search">
        <StoreSubnav
          activeTab="browse"
        placeholder={t("store.search_placeholder")}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={() => handleSearchSubmit()}
        suggestions={combinedSuggestions}
        onSuggestionSelect={(item) => {
          if ((item.kind === "result" || item.kind === "popular") && item.appId) {
            navigate(`/steam/${item.appId}`);
            return;
          }
          handleSearchSubmit(item.value);
        }}
        />
      </div>
        {error && errorCode !== "no_lua_games" && (
          <div className="glass-panel p-4 text-sm text-text-secondary">
            {t("store.api_offline")}
            <details className="mt-2 text-xs text-text-muted">
              <summary className="cursor-pointer select-none">Details</summary>
              <div className="mt-2 space-y-1 break-all">
                {(() => {
                  const debug = getApiDebugInfo();
                  return (
                    <>
                      <div>Preferred base: {debug.preferredBase || "(empty)"}</div>
                      <div>Resolved base: {debug.resolvedBase || "(none yet)"}</div>
                      <div>Bases: {debug.bases.length ? debug.bases.join(", ") : "(empty)"}</div>
                      <div>Error: {error}</div>
                    </>
                  );
                })()}
              </div>
            </details>
          </div>
        )}
      {!showIntroLoading && loading && (
        <div className="glass-panel p-8 text-sm text-text-secondary">
          {t("store.syncing")}
        </div>
      )}

      {games.length > 0 && (
        <>
          {!loading && heroGame && (
            <div data-tour="store-hero">
              <Hero
                game={heroGame}
                rail={railGames}
                slides={heroSlides}
                onOpen={(game) => handleOpen(game)}
              />
            </div>
          )}
          <div data-tour="store-discover">
            <FeaturedRow
              title={t("store.discover_new")}
              games={discoverRow}
              onOpen={(game) => handleOpen(game)}
            />
          </div>
          <div data-tour="store-savings">
            <FeaturedRow
              title={t("store.epic_savings")}
              games={spotlightRow}
              onOpen={(game) => handleOpen(game)}
            />
          </div>
          <div className="grid gap-6 lg:grid-cols-3" data-tour="store-toplists">
            <StoreList title={t("store.top_sellers")} items={topSellers} />
            <StoreList title={t("store.most_played")} items={mostPlayed} />
            <StoreList title={t("store.top_wishlisted")} items={wishlisted} />
          </div>
          {allGamesSection}
          <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" data-tour="store-promo">
            {promoTiles.map((tile) => (
              <div
                key={tile.title}
                className="relative min-h-[220px] overflow-hidden rounded-2xl border border-background-border bg-background-elevated"
              >
                {tile.image && (
                  <img
                    src={tile.image}
                    alt={tile.title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/20 to-transparent" />
                <div className="relative z-10 flex h-full flex-col justify-end gap-3 p-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
                      {t("store.spotlight")}
                    </p>
                    <h3 className="text-xl font-semibold">{tile.title}</h3>
                  </div>
                  <p className="text-sm text-text-secondary">{tile.description}</p>
                  <button className="epic-button-secondary w-fit px-4 py-2 text-xs font-semibold">
                    {tile.cta}
                  </button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
