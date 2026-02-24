import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import StoreSubnav from "../components/store/StoreSubnav";
import SteamCard from "../components/store/SteamCard";
import { useSteamSearchMemory } from "../hooks/useSteamSearchMemory";
import {
  fetchSteamCatalog,
  fetchSteamGridAssets,
  fetchSteamIndexCatalog,
  fetchSteamIndexAssetsBatch,
  fetchSteamIndexGameDetail,
  prefetchSteamIndexAssets,
  sendAiSearchEvents,
  searchSteamIndexCatalog,
} from "../services/api";
import { SteamCatalogItem } from "../types";
import { useLocale } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import {
  enrichCatalogItemsWithDetail,
  hasBrokenSteamFallbackArt,
  hasCatalogArtwork,
  isDlcQuery,
  isLikelyDlcName,
  mergeAndRankSteamSearchResults,
  rankSteamSearchItems,
  shouldUseSteamSearchFallback,
} from "../utils/steamSearch";
import {
  readPersistentCacheValue,
  writePersistentCacheValue,
} from "../utils/persistentCache";

const PAGE_SIZE = 24;
const SEARCH_STORAGE_KEY = "otoshi.search.steam";
const SEARCH_RESULTS_CACHE_KEY = "otoshi.cache.steam.catalog_search.v1";
const SEARCH_RESULTS_CACHE_TTL_MS = 1000 * 60 * 30;
const SEARCH_RESULTS_CACHE_MAX_ENTRIES = 120;
const IMAGE_PLACEHOLDER = "/icons/game-placeholder.svg";
const VISIBLE_FORCE_REFRESH_DEBOUNCE_MS = 300;
const VISIBLE_FORCE_REFRESH_MAX_IDS = 120;
const DETAIL_ENRICH_LIMIT = 16;
const DETAIL_ENRICH_CONCURRENCY = 3;
const GRID_ENRICH_LIMIT = 12;
const GRID_ENRICH_CONCURRENCY = 2;
const SEARCH_EVENT_BATCH_SIZE = 20;
const SEARCH_EVENT_FLUSH_MS = 1200;
const SEARCH_VIEW_EVENT_LIMIT = 12;
const normalizeSearch = (value: string) => value.trim().toLowerCase();
const resolveSearchCacheEntryKey = (query: string, pageIndex: number) =>
  `${normalizeSearch(query)}::${Math.max(0, pageIndex)}`;

type IndexAssetEntry = {
  selectedSource?: string | null;
  assets?: { grid?: string | null; hero?: string | null; logo?: string | null; icon?: string | null } | null;
};

const isSteamGridUrl = (value?: string | null) =>
  typeof value === "string" && value.toLowerCase().includes("steamgriddb.com");

const hasRenderableAsset = (value?: string | null) =>
  typeof value === "string" && value.trim().length > 0;

const shouldApplyIndexAssets = (entry: IndexAssetEntry | null | undefined, item: SteamCatalogItem) => {
  if (!entry?.assets) return false;
  const source = String(entry.selectedSource || "").toLowerCase();
  const { grid, hero, logo, icon } = entry.assets;
  const hasAnyAsset = [grid, hero, logo, icon].some((value) => hasRenderableAsset(value));
  if (!hasAnyAsset) return false;
  const hasSteamGridHostedAsset = [grid, hero, logo, icon].some((value) => isSteamGridUrl(value));
  if (source === "epic" || source === "mixed") {
    return true;
  }
  if (source === "steamgriddb") {
    if (hasSteamGridHostedAsset) {
      return true;
    }
    return !hasCatalogArtwork(item);
  }
  if (hasSteamGridHostedAsset) {
    return true;
  }
  return !hasCatalogArtwork(item);
};

const pickSuggestionImage = (item: SteamCatalogItem) => {
  const candidates = [
    item.artwork?.t3,
    item.artwork?.t2,
    item.artwork?.t1,
    item.capsuleImage,
    item.headerImage,
    item.background,
    item.artwork?.t0,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return IMAGE_PLACEHOLDER;
};

function mergeSteamGridAssets(
  items: SteamCatalogItem[],
  assetsByAppId: Record<string, IndexAssetEntry | null>
): SteamCatalogItem[] {
  return items.map((item) => {
    const key = String(item.appId || "").trim();
    const entry = key ? assetsByAppId[key] : null;
    if (!shouldApplyIndexAssets(entry, item)) {
      return item;
    }
    const assets = entry.assets;
    if (!assets) return item;

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

async function enrichMissingArtworkViaGrid(
  items: SteamCatalogItem[]
): Promise<SteamCatalogItem[]> {
  const targets = items
    .filter((item) => !hasCatalogArtwork(item) || hasBrokenSteamFallbackArt(item))
    .slice(0, GRID_ENRICH_LIMIT);

  if (!targets.length) return items;

  const patches = new Map<string, Partial<SteamCatalogItem>>();
  let cursor = 0;

  const workers = Array.from({ length: GRID_ENRICH_CONCURRENCY }, async () => {
    while (cursor < targets.length) {
      const current = targets[cursor];
      cursor += 1;
      const appId = String(current.appId || "").trim();
      if (!appId) continue;
      try {
        const asset = await fetchSteamGridAssets(current.name, appId);
        const grid = asset?.grid || null;
        const hero = asset?.hero || null;
        const icon = asset?.icon || null;
        if (!grid && !hero && !icon) continue;
        patches.set(appId, {
          headerImage: grid || current.headerImage || null,
          capsuleImage: grid || current.capsuleImage || current.headerImage || null,
          background: hero || current.background || grid || current.headerImage || null,
          artwork: {
            ...(current.artwork || {}),
            t0: icon || current.artwork?.t0 || current.capsuleImage || null,
            t1: grid || current.artwork?.t1 || current.capsuleImage || null,
            t2: grid || current.artwork?.t2 || current.headerImage || null,
            t3: grid || current.artwork?.t3 || current.capsuleImage || current.headerImage || null,
            t4: hero || current.artwork?.t4 || current.background || current.headerImage || null,
            version: Number(current.artwork?.version || 1) + 1,
          },
        });
      } catch {
        // Keep item unchanged when sgdb lookup fails.
      }
    }
  });

  await Promise.all(workers);
  if (!patches.size) return items;

  return items.map((item) => {
    const appId = String(item.appId || "").trim();
    const patch = appId ? patches.get(appId) : undefined;
    return patch ? { ...item, ...patch } : item;
  });
}

export default function SteamCatalogPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const { token } = useAuth();
  const [items, setItems] = useState<SteamCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSubmittedRef = useRef("");
  const [activeQuery, setActiveQuery] = useState("");
  const searchCacheRef = useRef(
    new Map<string, { items: SteamCatalogItem[]; total: number }>()
  );
  const itemsPageRef = useRef(0);
  const forceRefreshSeenRef = useRef(new Set<string>());
  const forceRefreshInflightRef = useRef(new Set<string>());
  const forceRefreshTimerRef = useRef<number | null>(null);
  const searchEventQueueRef = useRef<Array<{
    query: string;
    action: string;
    appId?: string | null;
    dwellMs?: number;
    payload?: Record<string, unknown>;
  }>>([]);
  const searchEventTimerRef = useRef<number | null>(null);
  const searchResultsShownAtRef = useRef<number | null>(null);
  const viewedResultKeysRef = useRef(new Set<string>());
  const viewedQueryRef = useRef("");
  const { suggestions, recordSearch } = useSteamSearchMemory();

  const flushSearchEvents = useCallback((reschedule: boolean = true) => {
    if (searchEventTimerRef.current != null) {
      window.clearTimeout(searchEventTimerRef.current);
      searchEventTimerRef.current = null;
    }
    if (!searchEventQueueRef.current.length) return;
    const batch = searchEventQueueRef.current.splice(0, SEARCH_EVENT_BATCH_SIZE);
    void sendAiSearchEvents(
      batch.map((event) => ({
        query: event.query,
        action: event.action,
        appId: event.appId ?? undefined,
        dwellMs: Math.max(0, Number(event.dwellMs ?? 0)),
        payload: event.payload ?? {},
      })),
      token || undefined
    )
      .catch(() => undefined)
      .finally(() => {
        if (reschedule && searchEventQueueRef.current.length) {
          searchEventTimerRef.current = window.setTimeout(
            flushSearchEvents,
            SEARCH_EVENT_FLUSH_MS
          );
        }
      });
  }, [token]);

  const emitSearchEvent = useCallback(
    (event: {
      query: string;
      action: string;
      appId?: string | null;
      dwellMs?: number;
      payload?: Record<string, unknown>;
    }) => {
      const normalizedQuery = String(event.query || "").trim();
      if (!normalizedQuery) return;
      searchEventQueueRef.current.push({
        query: normalizedQuery,
        action: String(event.action || "submit").trim().toLowerCase() || "submit",
        appId: event.appId ?? undefined,
        dwellMs: Math.max(0, Number(event.dwellMs ?? 0)),
        payload: event.payload ?? {},
      });
      if (searchEventQueueRef.current.length >= SEARCH_EVENT_BATCH_SIZE) {
        flushSearchEvents();
        return;
      }
      if (searchEventTimerRef.current == null) {
        searchEventTimerRef.current = window.setTimeout(
          flushSearchEvents,
          SEARCH_EVENT_FLUSH_MS
        );
      }
    },
    [flushSearchEvents]
  );

  const resolveSearchDwellMs = useCallback(() => {
    const shownAt = searchResultsShownAtRef.current;
    if (!shownAt) return 0;
    const elapsed = Date.now() - shownAt;
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return Math.min(600_000, Math.round(elapsed));
  }, []);

  useEffect(
    () => () => {
      if (searchEventTimerRef.current != null) {
        window.clearTimeout(searchEventTimerRef.current);
        searchEventTimerRef.current = null;
      }
      flushSearchEvents(false);
    },
    [flushSearchEvents]
  );

  const load = useCallback(
    async (pageIndex: number, searchValue: string) => {
      const cacheKey = resolveSearchCacheEntryKey(searchValue, pageIndex);
      const inMemoryCached = searchCacheRef.current.get(cacheKey);
      const persistedCached = readPersistentCacheValue<{
        items: SteamCatalogItem[];
        total: number;
      }>(SEARCH_RESULTS_CACHE_KEY, cacheKey);
      const cached = inMemoryCached || persistedCached;
      if (cached) {
        if (!inMemoryCached) {
          searchCacheRef.current.set(cacheKey, cached);
        }
        itemsPageRef.current = pageIndex;
        setItems(cached.items);
        setTotal(cached.total);
        setPage(pageIndex);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const nextOffset = pageIndex * PAGE_SIZE;
        let data: { total: number; offset: number; limit: number; items: SteamCatalogItem[] };
        if (searchValue) {
          const includeDlcForRanking = isDlcQuery(searchValue);
          try {
            const indexData = await searchSteamIndexCatalog({
              q: searchValue,
              limit: PAGE_SIZE,
              offset: nextOffset,
              source: "global",
              includeDlc: true,
              mustHaveArtwork: false,
              rankingMode: "priority",
            });
            const rankedIndex = rankSteamSearchItems(indexData.items, searchValue, {
              includeDlc: includeDlcForRanking,
            });

            if (shouldUseSteamSearchFallback(rankedIndex, searchValue, PAGE_SIZE)) {
              try {
                const fallbackData = await fetchSteamCatalog({
                  limit: PAGE_SIZE,
                  offset: nextOffset,
                  search: searchValue || undefined,
                  searchMode: "hybrid",
                  artMode: "tiered",
                  thumbW: 460
                });
                const mergedItems = mergeAndRankSteamSearchResults(
                  rankedIndex,
                  fallbackData.items,
                  searchValue,
                  PAGE_SIZE,
                  { includeDlc: includeDlcForRanking }
                );
                data = {
                  total: Math.max(
                    Number(indexData.total ?? 0),
                    Number(fallbackData.total ?? 0),
                    nextOffset + mergedItems.length
                  ),
                  offset: nextOffset,
                  limit: PAGE_SIZE,
                  items: mergedItems,
                };
              } catch {
                data = {
                  ...indexData,
                  items: rankedIndex,
                };
              }
            } else {
              data = {
                ...indexData,
                items: rankedIndex,
              };
            }
          } catch {
            const fallbackData = await fetchSteamCatalog({
              limit: PAGE_SIZE,
              offset: nextOffset,
              search: searchValue || undefined,
              searchMode: "hybrid",
              artMode: "tiered",
              thumbW: 460
            });
            data = {
              ...fallbackData,
              items: rankSteamSearchItems(fallbackData.items, searchValue, {
                includeDlc: includeDlcForRanking,
              }),
            };
          }
        } else {
          try {
            data = await fetchSteamIndexCatalog({
              limit: PAGE_SIZE,
              offset: nextOffset,
              sort: "priority",
              scope: "all",
              includeDlc: false,
              mustHaveArtwork: true,
            });
          } catch {
            data = await fetchSteamCatalog({
              limit: PAGE_SIZE,
              offset: nextOffset,
              search: searchValue || undefined,
              artMode: "tiered",
              thumbW: 460
            });
          }
        }
        const totalCount = data.total ?? 0;
        setTotal(totalCount);
        setPage(pageIndex);
        const baseItems = data.items;
        itemsPageRef.current = pageIndex;
        setItems(baseItems);
        let enrichedItems = baseItems;
        if (baseItems.length) {
          try {
            const batchResult = await fetchSteamIndexAssetsBatch({
              appIds: baseItems.map((item) => item.appId),
            });
            const assetsMap: Record<string, IndexAssetEntry | null> = {};
            for (const [appId, info] of Object.entries(batchResult)) {
              assetsMap[String(appId)] = {
                selectedSource: info?.selectedSource ?? null,
                assets: info?.assets ?? null,
              };
            }
            enrichedItems = mergeSteamGridAssets(baseItems, assetsMap);
          } catch {
            // keep base Steam catalog assets on batch failure
          }
        }
        enrichedItems = await enrichCatalogItemsWithDetail(
          enrichedItems,
          fetchSteamIndexGameDetail,
          {
            limit: DETAIL_ENRICH_LIMIT,
            concurrency: DETAIL_ENRICH_CONCURRENCY,
          }
        );
        enrichedItems = await enrichMissingArtworkViaGrid(enrichedItems);
        if (enrichedItems !== baseItems) {
          setItems(enrichedItems);
        }
        searchCacheRef.current.set(cacheKey, {
          items: enrichedItems,
          total: totalCount
        });
        writePersistentCacheValue(
          SEARCH_RESULTS_CACHE_KEY,
          cacheKey,
          {
            items: enrichedItems,
            total: totalCount,
          },
          {
            ttlMs: SEARCH_RESULTS_CACHE_TTL_MS,
            maxEntries: SEARCH_RESULTS_CACHE_MAX_ENTRIES,
          }
        );
      } catch (err: any) {
        setError(err.message || "Failed to load Steam catalog");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const saved = localStorage.getItem(SEARCH_STORAGE_KEY) || "";
    if (saved) {
      setQuery(saved);
      lastSubmittedRef.current = saved;
      setActiveQuery(saved);
      load(0, saved);
    } else {
      load(0, "");
    }
  }, []);

  const runSearch = useCallback(
    (nextQuery: string, record: boolean) => {
      lastSubmittedRef.current = nextQuery;
      setActiveQuery(nextQuery);
      const pageIndex = 0;
      const cacheKey = resolveSearchCacheEntryKey(nextQuery, pageIndex);
      const inMemoryCached = searchCacheRef.current.get(cacheKey);
      const persistedCached = readPersistentCacheValue<{
        items: SteamCatalogItem[];
        total: number;
      }>(SEARCH_RESULTS_CACHE_KEY, cacheKey);
      const cached = inMemoryCached || persistedCached;
      if (record) {
        if (nextQuery) {
          localStorage.setItem(SEARCH_STORAGE_KEY, nextQuery);
          recordSearch(nextQuery);
        } else {
          localStorage.removeItem(SEARCH_STORAGE_KEY);
        }
      }
      if (cached) {
        if (!inMemoryCached) {
          searchCacheRef.current.set(cacheKey, cached);
        }
        setError(null);
        setItems(cached.items);
        setTotal(cached.total);
        setPage(pageIndex);
        return;
      }
      setPage(0);
      load(0, nextQuery);
    },
    [recordSearch, load]
  );

  const handleSearchSubmit = useCallback(
    (value?: string) => {
      const nextQuery = (value ?? query).trim();
      setQuery(nextQuery);
      if (nextQuery) {
        emitSearchEvent({
          query: nextQuery,
          action: "submit",
          payload: { source: "steam_catalog_search" },
        });
      }
      runSearch(nextQuery, true);
    },
    [emitSearchEvent, query, runSearch]
  );

  useEffect(() => {
    const normalizedQuery = String(activeQuery || "").trim();
    if (!normalizedQuery || !items.length) {
      searchResultsShownAtRef.current = null;
      return;
    }
    if (itemsPageRef.current !== page) {
      return;
    }
    if (viewedQueryRef.current !== normalizedQuery) {
      viewedResultKeysRef.current.clear();
      viewedQueryRef.current = normalizedQuery;
    }
    searchResultsShownAtRef.current = Date.now();
    const visibleItems = items.slice(0, SEARCH_VIEW_EVENT_LIMIT);
    visibleItems.forEach((item, index) => {
      const appId = String(item.appId || "").trim();
      if (!appId) return;
      const key = `${normalizedQuery}::${page}::${appId}`;
      if (viewedResultKeysRef.current.has(key)) return;
      viewedResultKeysRef.current.add(key);
      emitSearchEvent({
        query: normalizedQuery,
        action: "view",
        appId,
        payload: {
          source: "steam_catalog_grid",
          page,
          rank: index,
        },
      });
    });
  }, [activeQuery, emitSearchEvent, items, page]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === lastSubmittedRef.current) return;
    const timer = window.setTimeout(() => {
      runSearch(trimmed, false);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, runSearch]);

  const resultSuggestions = useMemo(() => {
    const trimmed = query.trim();
    if (!activeQuery || activeQuery !== trimmed) return [];
    if (!trimmed) return [];
    return items.slice(0, 6).map((item) => ({
      id: `result-${item.appId}`,
      label: item.name,
      value: item.name,
      kind: "result" as const,
      image: pickSuggestionImage(item),
      imageCandidates: [
        item.artwork?.t3 ?? null,
        item.artwork?.t2 ?? null,
        item.artwork?.t1 ?? null,
        item.headerImage ?? null,
        item.capsuleImage ?? null,
        item.background ?? null,
        item.artwork?.t0 ?? null,
      ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
      meta: `#${item.appId}`,
      isDlc: Boolean(item.isDlc || item.itemType === "dlc" || isLikelyDlcName(item.name)),
      kindTag: ((item.isDlc || item.itemType === "dlc" || isLikelyDlcName(item.name)) ? "DLC" : "BASE") as "DLC" | "BASE",
      appId: item.appId
    }));
  }, [activeQuery, items, query]);

  const combinedSuggestions = useMemo(
    () => [...resultSuggestions, ...suggestions],
    [resultSuggestions, suggestions]
  );

  const visibleForceRefreshIds = useMemo(() => {
    const ordered: string[] = [];
    const add = (value?: string | null) => {
      const normalized = String(value || "").trim();
      if (!/^\d+$/.test(normalized)) return;
      if (ordered.includes(normalized)) return;
      ordered.push(normalized);
    };

    items.forEach((item) => add(item.appId));
    resultSuggestions.forEach((item) => add(item.appId || null));
    suggestions.forEach((item) => add(item.appId || null));
    return ordered.slice(0, VISIBLE_FORCE_REFRESH_MAX_IDS);
  }, [items, resultSuggestions, suggestions]);

  useEffect(() => {
    if (!visibleForceRefreshIds.length) {
      return;
    }
    if (forceRefreshTimerRef.current != null) {
      window.clearTimeout(forceRefreshTimerRef.current);
    }

    forceRefreshTimerRef.current = window.setTimeout(() => {
      const pending = visibleForceRefreshIds.filter(
        (appId) =>
          !forceRefreshSeenRef.current.has(appId) &&
          !forceRefreshInflightRef.current.has(appId)
      );
      if (!pending.length) {
        return;
      }
      pending.forEach((appId) => forceRefreshInflightRef.current.add(appId));

      void (async () => {
        try {
          await prefetchSteamIndexAssets({
            appIds: pending,
            forceRefresh: true,
          }).catch(() => undefined);

          const refreshed = await fetchSteamIndexAssetsBatch({
            appIds: pending,
            forceRefresh: true,
          }).catch(() => ({} as Record<string, any>));

          const assetsMap: Record<string, IndexAssetEntry | null> = {};
          const refreshedIds = new Set<string>();
          for (const [appId, info] of Object.entries(refreshed || {})) {
            const entry: IndexAssetEntry = {
              selectedSource: (info as any)?.selectedSource ?? null,
              assets: (info as any)?.assets ?? null,
            };
            const hasAny = [entry.assets?.grid, entry.assets?.hero, entry.assets?.logo, entry.assets?.icon]
              .some((value) => hasRenderableAsset(value));
            if (hasAny) {
              assetsMap[String(appId)] = entry;
              refreshedIds.add(String(appId));
            }
          }
          if (Object.keys(assetsMap).length) {
            setItems((prev) => mergeSteamGridAssets(prev, assetsMap));
            searchCacheRef.current.forEach((payload, cacheKey) => {
              searchCacheRef.current.set(cacheKey, {
                ...payload,
                items: mergeSteamGridAssets(payload.items, assetsMap),
              });
            });
          }

          pending.forEach((appId) => {
            if (refreshedIds.has(appId)) {
              forceRefreshSeenRef.current.add(appId);
            }
          });
        } finally {
          pending.forEach((appId) => forceRefreshInflightRef.current.delete(appId));
        }
      })();
    }, VISIBLE_FORCE_REFRESH_DEBOUNCE_MS);

    return () => {
      if (forceRefreshTimerRef.current != null) {
        window.clearTimeout(forceRefreshTimerRef.current);
      }
    };
  }, [visibleForceRefreshIds]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [total]);

  const visiblePages = useMemo(() => {
    const current = Math.min(page, totalPages - 1);
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
  }, [page, totalPages]);

  const handlePageChange = (pageIndex: number) => {
    if (loading) return;
    if (pageIndex < 0 || pageIndex >= totalPages) return;
    setPage(pageIndex);
    const searchValue = activeQuery || query.trim();
    load(pageIndex, searchValue);
  };

  return (
    <div className="space-y-8">
      <StoreSubnav
        activeTab="steam"
        placeholder={t("store.search_placeholder")}
        searchValue={query}
        searchLoading={loading}
        onSearchChange={setQuery}
        onSearchSubmit={() => handleSearchSubmit()}
        suggestions={combinedSuggestions}
        onSuggestionSelect={(item) => {
          if (item.kind === "result" && item.appId) {
            emitSearchEvent({
              query: item.value || activeQuery || query,
              action: "detail",
              appId: item.appId,
              dwellMs: resolveSearchDwellMs(),
              payload: { source: "steam_catalog_suggestion", page },
            });
            navigate(`/steam/${item.appId}`);
            return;
          }
          handleSearchSubmit(item.value);
        }}
      />

      <section className="glass-panel flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-text-muted">Steam Vault</p>
          <h1 className="text-2xl font-semibold">Steam-powered catalog</h1>
          <p className="text-sm text-text-secondary">
            Curated from your lua manifests with real-time Steam metadata.
          </p>
        </div>
      </section>

      {error && <div className="glass-panel p-4 text-sm text-text-secondary">{error}</div>}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.35em] text-text-muted">
            {total} titles
          </p>
          {loading && (
            <span className="inline-flex items-center gap-2 text-xs text-text-muted">
              <span className="spinner-force-motion h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary" />
              {t("store.searching")}
            </span>
          )}
        </div>
        {items.length === 0 && !loading ? (
          <div className="glass-panel p-6 text-sm text-text-secondary">
            No results yet. Try another keyword.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item, index) => (
              <SteamCard
                key={item.appId}
                item={item}
                onOpen={() => {
                  emitSearchEvent({
                    query: activeQuery || query,
                    action: "detail",
                    appId: item.appId,
                    dwellMs: resolveSearchDwellMs(),
                    payload: { source: "steam_catalog_grid", page, rank: index },
                  });
                  navigate(`/steam/${item.appId}`);
                }}
                prefetchItems={items.slice(index + 1, index + 11)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => handlePageChange(page - 1)}
            disabled={page <= 0 || loading}
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
              key={`steam-page-${pageIndex}`}
              onClick={() => handlePageChange(pageIndex)}
              disabled={loading}
              className={`rounded-lg px-3 py-2 text-xs transition ${
                pageIndex === page
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
            onClick={() => handlePageChange(page + 1)}
            disabled={page >= totalPages - 1 || loading}
            className="rounded-lg border border-background-border px-3 py-2 text-xs text-text-secondary transition hover:border-primary hover:text-text-primary disabled:opacity-50"
          >
            {t("common.next")}
          </button>
        </div>
      </section>
    </div>
  );
}
