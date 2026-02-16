import { useCallback, useEffect, useMemo, useState } from "react";
import { getRunningGames, type RunningGame } from "../services/launcher";

export function useRunningGames(pollMs = 1000) {
  const [running, setRunning] = useState<Record<string, RunningGame>>({});

  const refresh = useCallback(async () => {
    try {
      const list = await getRunningGames();
      const next: Record<string, RunningGame> = {};
      for (const item of list) {
        next[item.gameId] = item;
      }
      setRunning(next);
    } catch {
      setRunning({});
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handle = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(handle);
  }, [pollMs, refresh]);

  const runningList = useMemo(() => Object.values(running), [running]);

  const isRunning = useCallback((gameId: string) => Boolean(running[gameId]), [running]);

  return { running, runningList, isRunning, refresh };
}

