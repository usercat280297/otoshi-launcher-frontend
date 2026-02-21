import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import StoreSubnav from "../components/store/StoreSubnav";
import SteamCard from "../components/store/SteamCard";
import { useSteamSearchMemory } from "../hooks/useSteamSearchMemory";
import {
  fetchSteamCatalog,
  fetchSteamIndexCatalog,
  fetchSteamIndexAssetsBatch,
  prefetchSteamIndexAssets,
  searchSteamIndexCatalog,
} from "../services/api";
import { SteamCatalogItem } from "../types";
import { useLocale } from "../context/LocaleContext";

const PAGE_SIZE = 24;
const SEARCH_STORAGE_KEY = "otoshi.search.steam";
const IMAGE_PLACEHOLDER = "/icons/game-placeholder.svg";
const VISIBLE_FORCE_REFRESH_DEBOUNCE_MS = 300;
const VISIBLE_FORCE_REFRESH_MAX_IDS = 120;
const normalizeSearch = (value: string) => value.trim().toLowerCase();

type IndexAssetEntry = {
  selectedSource?: string | null;
  assets?: { grid?: string | null; hero?: string | null; logo?: string | null; icon?: string | null } | null;
};

const isSteamGridUrl = (value?: string | null) =>
  typeof value === "string" && value.toLowerCase().includes("steamgriddb.com");

const shouldPreferSteamGridAssets = (entry?: IndexAssetEntry | null) => {
  if (!entry?.assets) return false;
  if (String(entry.selectedSource || "").toLowerCase() === "steamgriddb") {
    return true;
  }
  const { grid, hero, logo, icon } = entry.assets;
  return [grid, hero, logo, icon].some((value) => isSteamGridUrl(value));
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
    if (!entry || !shouldPreferSteamGridAssets(entry)) {
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

export default function SteamCatalogPage() {
  const navigate = useNavigate();
  const { t } = useLocale();
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
  const forceRefreshSeenRef = useRef(new Set<string>());
  const forceRefreshInflightRef = useRef(new Set<string>());
  const forceRefreshTimerRef = useRef<number | null>(null);
  const { suggestions, recordSearch } = useSteamSearchMemory();

  const load = useCallback(
    async (pageIndex: number, searchValue: string) => {
      const cacheKey = `${normalizeSearch(searchValue)}::${pageIndex}`;
      const cached = searchCacheRef.current.get(cacheKey);
      if (cached) {
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
        try {
          if (searchValue) {
            data = await searchSteamIndexCatalog({
              q: searchValue,
              limit: PAGE_SIZE,
              offset: nextOffset,
              source: "global",
              includeDlc: false,
              mustHaveArtwork: true,
            });
          } else {
            data = await fetchSteamIndexCatalog({
              limit: PAGE_SIZE,
              offset: nextOffset,
              sort: "priority",
              scope: "all",
              includeDlc: false,
              mustHaveArtwork: true,
            });
          }
        } catch {
          data = await fetchSteamCatalog({
            limit: PAGE_SIZE,
            offset: nextOffset,
            search: searchValue || undefined,
            artMode: "tiered",
            thumbW: 460
          });
        }
        const totalCount = data.total ?? 0;
        setTotal(totalCount);
        setPage(pageIndex);
        let enrichedItems = data.items;
        if (enrichedItems.length) {
          try {
            const batchResult = await fetchSteamIndexAssetsBatch({
              appIds: enrichedItems.map((item) => item.appId),
            });
            const assetsMap: Record<string, IndexAssetEntry | null> = {};
            for (const [appId, info] of Object.entries(batchResult)) {
              assetsMap[String(appId)] = {
                selectedSource: info?.selectedSource ?? null,
                assets: info?.assets ?? null,
              };
            }
            enrichedItems = mergeSteamGridAssets(enrichedItems, assetsMap);
          } catch {
            // keep base Steam catalog assets on batch failure
          }
        }
        setItems(enrichedItems);
        searchCacheRef.current.set(cacheKey, {
          items: enrichedItems,
          total: totalCount
        });
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
      const cacheKey = `${normalizeSearch(nextQuery)}::${pageIndex}`;
      const cached = searchCacheRef.current.get(cacheKey);
      if (record) {
        if (nextQuery) {
          localStorage.setItem(SEARCH_STORAGE_KEY, nextQuery);
          recordSearch(nextQuery);
        } else {
          localStorage.removeItem(SEARCH_STORAGE_KEY);
        }
      }
      if (cached) {
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
      runSearch(nextQuery, true);
    },
    [query, runSearch]
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === lastSubmittedRef.current) return;
    const timer = window.setTimeout(() => {
      runSearch(trimmed, false);
    }, 350);
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
      meta: `#${item.appId}`,
      isDlc: Boolean(item.isDlc),
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
            if (shouldPreferSteamGridAssets(entry)) {
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
        onSearchChange={setQuery}
        onSearchSubmit={() => handleSearchSubmit()}
        suggestions={combinedSuggestions}
        onSuggestionSelect={(item) => {
          if (item.kind === "result" && item.appId) {
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
          {loading && <span className="text-xs text-text-muted">Loading...</span>}
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
                onOpen={() => navigate(`/steam/${item.appId}`)}
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
