import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchSteamPopular,
  fetchSteamSearchHistory,
  recordSteamSearchHistory
} from "../services/api";
import { SearchHistoryItem, SearchSuggestion, SteamCatalogItem } from "../types";

const HISTORY_LIMIT = 8;
const POPULAR_LIMIT = 6;

export function useSteamSearchMemory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [popular, setPopular] = useState<SteamCatalogItem[]>([]);

  useEffect(() => {
    let active = true;
    fetchSteamSearchHistory(HISTORY_LIMIT)
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch(() => undefined);
    fetchSteamPopular(POPULAR_LIMIT, 0)
      .then((data) => {
        if (active) setPopular(data.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const recordSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    try {
      const items = await recordSteamSearchHistory(trimmed, HISTORY_LIMIT);
      setHistory(items);
    } catch {
      // ignore history failures
    }
  }, []);

  const suggestions = useMemo(() => {
    const list: SearchSuggestion[] = [];
    history.forEach((item) => {
      if (!item.query) return;
      list.push({
        id: `history-${item.query}`,
        label: item.query,
        value: item.query,
        kind: "history",
        meta: item.count > 1 ? `${item.count}x` : null
      });
    });
    popular.forEach((item) => {
      list.push({
        id: `popular-${item.appId}`,
        label: item.name,
        value: item.name,
        kind: "popular",
        image: item.headerImage ?? item.capsuleImage ?? null,
        meta: `#${item.appId}`,
        appId: item.appId
      });
    });
    return list;
  }, [history, popular]);

  return {
    history,
    popular,
    suggestions,
    recordSearch,
    setHistory
  };
}
