import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { WishlistEntry } from "../types";
import * as api from "../services/api";

export function useWishlist() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
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
      const data = await api.fetchWishlist(token);
      setEntries(data);
    } catch (err: any) {
      setError(err.message || "Failed to load wishlist");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const add = useCallback(
    async (gameId: string) => {
      if (!token) {
        throw new Error("Not authenticated");
      }
      const entry = await api.addToWishlist(gameId, token);
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

  const remove = useCallback(
    async (gameId: string) => {
      if (!token) {
        throw new Error("Not authenticated");
      }
      await api.removeFromWishlist(gameId, token);
      setEntries((prev) => prev.filter((item) => item.game.id !== gameId));
    },
    [token]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, error, refresh, add, remove };
}
