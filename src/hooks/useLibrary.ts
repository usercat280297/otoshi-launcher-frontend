import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { LibraryEntry } from "../types";
import * as api from "../services/api";

export function useLibrary() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.fetchLibrary(token);
      setEntries(data);
    } catch (err: any) {
      setError(err.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const purchase = useCallback(
    async (gameId: string) => {
      if (!token) {
        throw new Error("Not authenticated");
      }
      const entry = await api.purchaseGame(gameId, token);
      setEntries((prev) => {
        if (prev.find((item) => item.id === entry.id)) {
          return prev;
        }
        return [entry, ...prev];
      });
      return entry;
    },
    [token]
  );

  const markInstalled = useCallback(
    async (entryId: string) => {
      if (!token) {
        throw new Error("Not authenticated");
      }
      await api.markInstalled(entryId, token);
      await refresh();
    },
    [token, refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, error, refresh, purchase, markInstalled };
}
