import { useEffect, useMemo, useState } from "react";
import LibraryHeader from "../components/library/LibraryHeader";
import type { LibraryEntry, LaunchConfig } from "../types";
import VirtualGameGrid from "../components/library/VirtualGameGrid";
import VirtualGameList from "../components/library/VirtualGameList";
import { useLibrary } from "../hooks/useLibrary";
import { useDownloads } from "../hooks/useDownloads";
import PlayOptionsModal from "../components/launcher/PlayOptionsModal";
import { getGameLaunchPref, launchGame, setGameLaunchPref, type GameLaunchPref } from "../services/launcher";
import { fetchLaunchConfig } from "../services/api";
import {
  derivePlayOptions,
  getDefaultPlayOptions,
  loadPlayOptions,
  savePlayOptions
} from "../utils/playOptions";
import type { PlayOptions } from "../utils/playOptions";

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const { entries, loading, error, markInstalled } = useLibrary();
  const { start } = useDownloads();
  const [playEntry, setPlayEntry] = useState<LibraryEntry | null>(null);
  const [playOptionsOpen, setPlayOptionsOpen] = useState(false);
  const [playBusy, setPlayBusy] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig | null>(null);
  const [launchConfigLoading, setLaunchConfigLoading] = useState(false);
  const [storedPlayOptions, setStoredPlayOptions] = useState<PlayOptions | null>(null);
  const [launchPref, setLaunchPref] = useState<GameLaunchPref | null>(null);
  const [launchPrefLoading, setLaunchPrefLoading] = useState(false);

  const handleInstall = async (entry: LibraryEntry) => {
    try {
      await start(entry.game.id);
      await markInstalled(entry.id);
    } catch {
      // No-op for now, surfaced by hook error states if needed.
    }
  };

  const handlePlay = (entry: LibraryEntry) => {
    setPlayError(null);
    setPlayEntry(entry);
    setPlayOptionsOpen(true);
    setLaunchConfig(null);
    setLaunchPref(null);
    setLaunchConfigLoading(true);
    setLaunchPrefLoading(true);
    fetchLaunchConfig(entry.game.id)
      .then((cfg) => {
        setLaunchConfig(cfg);
        const stored = loadPlayOptions(entry.game.id);
        if (!stored) {
          const derived = derivePlayOptions(null, cfg);
          savePlayOptions(entry.game.id, derived);
          setStoredPlayOptions(derived);
        } else {
          setStoredPlayOptions(stored);
        }
      })
      .catch(() => setLaunchConfig(null))
      .finally(() => setLaunchConfigLoading(false));

    getGameLaunchPref(entry.game.id)
      .then((pref) => setLaunchPref(pref))
      .catch(() => setLaunchPref(null))
      .finally(() => setLaunchPrefLoading(false));
  };

  useEffect(() => {
    if (!playEntry) {
      setStoredPlayOptions(null);
      setLaunchPref(null);
      return;
    }
    setStoredPlayOptions(loadPlayOptions(playEntry.game.id));
  }, [playEntry]);

  const initialPlayOptions = useMemo(() => {
    if (!playEntry) {
      return getDefaultPlayOptions();
    }
    return derivePlayOptions(storedPlayOptions, launchConfig);
  }, [playEntry, launchConfig, storedPlayOptions]);

  const handleConfirmPlay = async (
    options: PlayOptions,
    rememberRenderer: boolean,
    launchPolicy: { requireAdmin: boolean; rememberAdmin: boolean }
  ) => {
    if (!playEntry) {
      return;
    }
    setPlayBusy(true);
    setPlayError(null);
    try {
      if (rememberRenderer) {
        savePlayOptions(playEntry.game.id, options);
      }
      const pref = await setGameLaunchPref(
        playEntry.game.id,
        launchPolicy.requireAdmin,
        !launchPolicy.rememberAdmin
      );
      setLaunchPref(pref);
      await launchGame({
        gameId: playEntry.game.id,
        slug: playEntry.game.slug,
        title: playEntry.game.title,
        renderer: options.renderer,
        overlayEnabled: options.overlayEnabled,
        steamAppId: playEntry.game.steamAppId ?? null,
        executable: launchConfig?.executable ?? null,
        gameDir: launchConfig?.gameDir ?? null
      });
      setPlayOptionsOpen(false);
    } catch (err: any) {
      setPlayError(err?.message || "Launch failed.");
    } finally {
      setPlayBusy(false);
    }
  };

  const filtered = useMemo(() => {
    return entries.filter((entry) =>
      entry.game.title.toLowerCase().includes(search.toLowerCase())
    );
  }, [entries, search]);

  return (
    <div className="flex min-h-[calc(100vh-220px)] flex-col gap-6">
      <PlayOptionsModal
        open={playOptionsOpen}
        onClose={() => setPlayOptionsOpen(false)}
        gameTitle={playEntry?.game.title ?? "Game"}
        initialOptions={initialPlayOptions}
        initialRequireAdmin={launchPref?.requireAdmin ?? false}
        adminPrefKnown={Boolean(launchPref && !launchPref.askEveryTime)}
        launchConfig={launchConfig}
        busy={playBusy || launchConfigLoading || launchPrefLoading}
        error={playError}
        onConfirm={handleConfirmPlay}
      />
      <div>
        <h2 className="text-3xl font-semibold">Your Library</h2>
        <p className="text-text-secondary">
          Synced with your Steam-like entitlements and cloud saves.
        </p>
      </div>

      <LibraryHeader
        search={search}
        onSearch={setSearch}
        view={view}
        onViewChange={setView}
      />

      {error && (
        <div className="glass-panel p-4 text-sm text-text-secondary">
          {error}
        </div>
      )}

      {loading ? (
        <div className="glass-panel p-6 text-sm text-text-secondary">
          Loading your library...
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel p-6 text-sm text-text-secondary">
          No titles yet. Grab something from the store.
        </div>
      ) : (
        <div className="glass-panel h-[65vh] min-h-[420px] flex-1 p-3 md:h-[calc(100vh-300px)]">
          {view === "grid" ? (
            <VirtualGameGrid
              entries={filtered}
              onInstall={handleInstall}
              onPlay={handlePlay}
            />
          ) : (
            <VirtualGameList
              entries={filtered}
              onInstall={handleInstall}
              onPlay={handlePlay}
            />
          )}
        </div>
      )}
    </div>
  );
}
