import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { isTauri as detectTauriRuntime } from "@tauri-apps/api/core";
import { ArrowLeft, Download, ExternalLink, Tag, Wrench, ShieldOff, Star, Info, Trophy, Package, Newspaper, ThumbsUp, Settings, RefreshCw, MessageSquare, Pause, Play, Square } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { openExternal } from "../utils/openExternal";
import {
  fetchSteamDownloadOptions,
  prepareSteamDownload,
  resolveDownloadErrorI18nKey,
  startSteamDownloadWithOptions,
  verifyAgeGate,
  fetchSteamExtended,
  clearGameCache
} from "../services/api";
import type { DownloadOptions, DownloadPreparePayload, SteamPrice, FixEntry, FixOption, SteamExtendedData } from "../types";
import { useSteamGame } from "../hooks/useSteamGame";
import { useDownloads } from "../hooks/useDownloads";
import Badge from "../components/common/Badge";
import Button from "../components/common/Button";
import MediaGallery from "../components/game-detail/MediaGallery";
import AgeGateModal from "../components/common/AgeGateModal";
import DownloadOptionsModal from "../components/downloads/DownloadOptionsModal";
import CrackDownloadModal from "../components/fixes/CrackDownloadModal";
import DLCSection from "../components/game-detail/DLCSection";
import AchievementsSection from "../components/game-detail/AchievementsSection";
import NewsSection from "../components/game-detail/NewsSection";
import ReviewsSummary from "../components/game-detail/ReviewsSummary";
import PropertiesSection from "../components/game-detail/PropertiesSection";
import CommunityCommentsSection from "../components/game-detail/CommunityCommentsSection";
import { isAgeGateAllowed, resolveRequiredAge, storeAgeGate } from "../utils/ageGate";
import { getMediaProtectionProps } from "../utils/mediaProtection";
import Modal from "../components/common/Modal";

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

function renderParagraphs(text?: string | null) {
  if (!text) return null;
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => (
      <p key={`${line.slice(0, 12)}-${index}`} className="text-sm text-text-secondary">
        {line}
      </p>
    ));
}

export default function SteamGameDetailPage() {
  const { appId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { t, locale } = useLocale();
  const { game, loading, error } = useSteamGame(appId, locale);
  const { tasks, pause, resume, cancel } = useDownloads();
  const [actionError, setActionError] = useState<string | null>(null);
  const [startingDownload, setStartingDownload] = useState(false);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadOptions, setDownloadOptions] = useState<DownloadOptions | null>(null);
  const [downloadOptionsLoading, setDownloadOptionsLoading] = useState(false);
  const [downloadOptionsError, setDownloadOptionsError] = useState<string | null>(null);
  const [downloadSubmitting, setDownloadSubmitting] = useState(false);
  const [downloadSubmitError, setDownloadSubmitError] = useState<string | null>(null);
  const [ageGateOpen, setAgeGateOpen] = useState(false);
  const [ageGateError, setAgeGateError] = useState<string | null>(null);
  const [ageGateBusy, setAgeGateBusy] = useState(false);
  const [ageGateAllowed, setAgeGateAllowed] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const [crackModalOpen, setCrackModalOpen] = useState(false);
  const [selectedFixEntry, setSelectedFixEntry] = useState<FixEntry | null>(null);
  const [extendedData, setExtendedData] = useState<SteamExtendedData | null>(null);
  const [extendedLoading, setExtendedLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"about" | "dlc" | "achievements" | "news" | "comments" | "properties">("about");
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [launcherPromptOpen, setLauncherPromptOpen] = useState(false);

  const isTauri = detectTauriRuntime();

  const storeUrl = useMemo(() => {
    if (!appId) return null;
    return `https://store.steampowered.com/app/${appId}`;
  }, [appId]);
  const gameDownloadSlug = useMemo(() => (appId ? `steam-${appId}` : null), [appId]);
  const currentGameTask = useMemo(() => {
    if (!gameDownloadSlug && !appId) return null;
    return tasks.find((task) => {
      const status = task.status;
      const isTracked =
        status === "queued" ||
        status === "downloading" ||
        status === "verifying" ||
        status === "paused";
      if (!isTracked) return false;
      if (appId && (task.appId === appId || task.gameId === appId)) return true;
      if (task.gameSlug && task.gameSlug === gameDownloadSlug) return true;
      if (game?.name && task.title && task.title.trim().toLowerCase() === game.name.trim().toLowerCase()) {
        return true;
      }
      return false;
    }) || null;
  }, [appId, game?.name, gameDownloadSlug, tasks]);
  const isCurrentGameDownloading = Boolean(currentGameTask);
  const downloadBusy = startingDownload || isCurrentGameDownloading;
  const isCurrentGamePaused = currentGameTask?.status === "paused";

  const handleToggleCurrentDownload = async () => {
    if (!currentGameTask) return;
    setActionError(null);
    try {
      if (currentGameTask.status === "paused") {
        await resume(currentGameTask.id);
      } else {
        await pause(currentGameTask.id);
      }
    } catch (err: any) {
      setActionError(err?.message || "Failed to toggle download state.");
    }
  };

  const handleStopCurrentDownload = async () => {
    if (!currentGameTask) return;
    setActionError(null);
    try {
      await cancel(currentGameTask.id);
    } catch (err: any) {
      setActionError(err?.message || "Failed to stop download.");
    }
  };

  const requiredAge = resolveRequiredAge(game?.requiredAge ?? 0);
  const gateScope = game?.appId ? `steam:${game.appId}` : "";
  const videoSignature = useMemo(
    () =>
      (game?.movies || [])
        .map((movie) => `${movie.hls || ""}|${movie.url}|${movie.thumbnail || ""}`)
        .join("||"),
    [game?.movies]
  );
  const videos = useMemo(
    () =>
      (game?.movies || []).map((movie) => ({
        url: movie.url,
        thumbnail: movie.thumbnail || game?.headerImage || "",
        hls: movie.hls,
        dash: movie.dash
      })),
    [videoSignature, game?.headerImage, game?.movies]
  );

  useEffect(() => {
    if (!game) return;
    if (ageGateAllowed) return;
    if (requiredAge <= 0) {
      setAgeGateAllowed(true);
      return;
    }
    if (isAgeGateAllowed(gateScope, requiredAge)) {
      setAgeGateAllowed(true);
      return;
    }
    setAgeGateOpen(true);
  }, [ageGateAllowed, gateScope, game, requiredAge]);

  useEffect(() => {
    if (!downloadModalOpen || !appId) return;
    setDownloadOptionsLoading(true);
    setDownloadOptionsError(null);
    fetchSteamDownloadOptions(appId)
      .then((options) => {
        setDownloadOptions(options);
      })
      .catch((err: any) => {
        setDownloadOptionsError(err.message || "Failed to load download options.");
      })
      .finally(() => {
        setDownloadOptionsLoading(false);
      });
  }, [appId, downloadModalOpen]);

  useEffect(() => {
    setDownloadOptions(null);
  }, [appId]);

  // Fetch extended data (DLC, achievements, news, reviews, player count)
  // Always skip frontend cache to ensure fresh DLC data
  useEffect(() => {
    if (!appId || !ageGateAllowed) return;

    let mounted = true;
    setExtendedLoading(true);

    // Clear cache and fetch fresh data with skipCache=true
    clearGameCache(appId);
    fetchSteamExtended(appId, true)
      .then((data) => {
        if (mounted) {
          setExtendedData(data);
        }
      })
      .catch((err) => {
        console.warn("Failed to fetch extended data:", err);
      })
      .finally(() => {
        if (mounted) {
          setExtendedLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [appId, ageGateAllowed]);

  useEffect(() => {
    const target = heroRef.current;
    if (!target) {
      setShowSticky(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowSticky(!entry.isIntersecting);
      },
      { rootMargin: "-120px 0px 0px 0px", threshold: 0.15 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [game?.appId]);

  const handleAgeGateConfirm = async (payload: {
    year: number;
    month: number;
    day: number;
    remember: boolean;
  }) => {
    setAgeGateError(null);
    setAgeGateBusy(true);
    try {
      const result = await verifyAgeGate({
        year: payload.year,
        month: payload.month,
        day: payload.day,
        requiredAge
      });
      if (!result.allowed) {
        setAgeGateError(`You must be at least ${requiredAge}+ to view this content.`);
        return;
      }
      storeAgeGate(gateScope, result.age, requiredAge, payload.remember);
      setAgeGateAllowed(true);
      setAgeGateOpen(false);
    } catch (err: any) {
      setAgeGateError(err.message || "Age verification failed.");
    } finally {
      setAgeGateBusy(false);
    }
  };

  const handleAgeGateCancel = () => {
    setAgeGateOpen(false);
    navigate(-1);
  };

  const handleDownload = () => {
    if (!isTauri) {
      setLauncherPromptOpen(true);
      return;
    }
    if (!token) {
      navigate("/login");
      return;
    }
    setDownloadSubmitError(null);
    setDownloadModalOpen(true);
  };

  const handleDownloadSubmit = async (payload: DownloadPreparePayload) => {
    if (!appId) {
      setDownloadSubmitError(t("download.error.start_failed"));
      return;
    }
    if (!token) {
      const messageKey = "download.error.auth_required";
      const message = t(messageKey);
      const iconUrl = game?.iconImage || game?.logoImage || game?.headerImage || undefined;
      setDownloadSubmitError(message);
      window.dispatchEvent(
        new CustomEvent("otoshi:download-error", {
          detail: { message, messageKey, iconUrl },
        })
      );
      return;
    }
    setActionError(null);
    setDownloadSubmitError(null);
    setDownloadSubmitting(true);
    setStartingDownload(true);
    try {
      console.log("[DownloadFlow] preparing steam download", { appId, payload });
      const prepared = await prepareSteamDownload(appId, payload);
      console.log("[DownloadFlow] prepare complete", {
        appId,
        installPath: prepared.installPath,
        freeBytes: prepared.freeBytes
      });
      setDownloadOptions(prepared);
      const selectedVersion = prepared.versions.find(
        (version) => version.id === payload.version
      );
      const requiredBytes = selectedVersion?.sizeBytes ?? prepared.sizeBytes ?? null;
      if (requiredBytes && prepared.freeBytes != null && prepared.freeBytes < requiredBytes) {
        setDownloadSubmitError(t("download_options.storage_not_enough"));
        return;
      }
      const preparedInstallPath = (prepared.installPath || "").trim();
      const startPayload: DownloadPreparePayload = preparedInstallPath
        ? {
            ...payload,
            installPath: preparedInstallPath,
            createSubfolder: false
          }
        : payload;
      console.log("[DownloadFlow] starting download", { appId, startPayload });
      await startSteamDownloadWithOptions(appId, startPayload, token);
      setDownloadModalOpen(false);
      const iconUrl = game?.iconImage || game?.logoImage || game?.headerImage || undefined;
      window.dispatchEvent(
        new CustomEvent("otoshi:download-started", {
          detail: { title: game?.name || appId, iconUrl },
        })
      );
      navigate("/downloads");
    } catch (err: any) {
      const messageKey = resolveDownloadErrorI18nKey(err);
      const message = t(messageKey);
      const iconUrl = game?.iconImage || game?.logoImage || game?.headerImage || undefined;
      setDownloadSubmitError(message);
      window.dispatchEvent(
        new CustomEvent("otoshi:download-error", {
          detail: { message, messageKey, iconUrl },
        })
      );
    } finally {
      setDownloadSubmitting(false);
      setStartingDownload(false);
    }
  };

  const handleRefreshDLC = async () => {
    if (!appId) return;
    setExtendedLoading(true);
    try {
      // Clear cache and fetch fresh DLC data
      clearGameCache(appId);
      const data = await fetchSteamExtended(appId, true);
      setExtendedData(data);
      console.log("[DLC] Refreshed DLC data for app", appId);
    } catch (err) {
      console.error("[DLC] Failed to refresh DLC data:", err);
    } finally {
      setExtendedLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="glass-panel p-8 text-center">
          <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-text-secondary">Loading game details...</p>
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-text-secondary transition hover:text-text-primary"
        >
          <ArrowLeft size={16} />
          Back to Steam vault
        </button>
        <div className="glass-panel p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
            <Info className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="text-lg font-medium text-text-primary mb-2">Game Not Found</h3>
          <p className="text-sm text-text-secondary max-w-md mx-auto">
            {error || "The requested Steam game could not be found. It may have been removed or the App ID is incorrect."}
          </p>
          <button
            onClick={() => navigate("/store")}
            className="mt-4 px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/90 transition"
          >
            Browse Store
          </button>
        </div>
      </div>
    );
  }

  const displayPrice = formatPrice(game.price);
  const tags = [...(game.genres || []), ...(game.categories || [])].slice(0, 6);
  const heroImage = game.heroImage || game.background || game.headerImage || "";
  const platformLabel = (game.platforms || []).join(", ") || "Unknown";
  const iconImage = game.iconImage || game.logoImage || game.headerImage || "";
  const isCurrentTitleDlc = Boolean(game.isDlc || game.itemType === "dlc");
  const resolvedDlcCount = Math.max(
    Number(game.dlcCount || 0),
    Number(extendedData?.dlc?.total || 0),
    Number(extendedData?.dlc?.items?.length || 0)
  );
  const richBlocks = Array.from(
    new Set(
      [game.aboutTheGameHtml, game.detailedDescriptionHtml]
        .map((block) => (block || "").trim())
        .filter(Boolean)
    )
  );

  return (
    <div className="space-y-8">
      <AgeGateModal
        open={ageGateOpen && !ageGateAllowed}
        title={game.name}
        requiredAge={requiredAge}
        onConfirm={handleAgeGateConfirm}
        onCancel={handleAgeGateCancel}
        error={ageGateError}
        busy={ageGateBusy}
      />
      <Modal
        isOpen={launcherPromptOpen}
        onClose={() => setLauncherPromptOpen(false)}
        title={t("steam_detail.download_launcher_title")}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t("steam_detail.download_launcher_body")}
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setLauncherPromptOpen(false)}>
              {t("steam_detail.later")}
            </Button>
            <Button
              onClick={() => {
                setLauncherPromptOpen(false);
                navigate("/download-launcher");
              }}
            >
              {t("steam_detail.open_launcher_download")}
            </Button>
          </div>
        </div>
      </Modal>
      <DownloadOptionsModal
        open={downloadModalOpen}
        options={downloadOptions}
        gameTitle={game?.name || downloadOptions?.name}
        gameImage={game?.headerImage || game?.heroImage || game?.background || null}
        gameIcon={game?.iconImage || game?.logoImage || null}
        loading={downloadOptionsLoading}
        error={downloadOptionsError}
        submitting={downloadSubmitting}
        submitError={downloadSubmitError}
        activeTask={currentGameTask}
        onPauseTask={(downloadId) => void pause(downloadId)}
        onResumeTask={(downloadId) => void resume(downloadId)}
        onCancelTask={(downloadId) => void cancel(downloadId)}
        onClose={() => setDownloadModalOpen(false)}
        onSubmit={handleDownloadSubmit}
      />
      <CrackDownloadModal
        open={crackModalOpen}
        entry={selectedFixEntry}
        onClose={() => {
          setCrackModalOpen(false);
          setSelectedFixEntry(null);
        }}
      />
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-text-secondary transition hover:text-text-primary"
      >
        <ArrowLeft size={16} />
        Back to Steam vault
      </button>

      <AnimatePresence>
        {showSticky && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="fixed left-0 right-0 top-16 z-20 hidden md:block lg:left-64"
          >
            <div className="mx-auto w-full max-w-[1400px] px-6 md:px-10">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-background-border bg-background/90 px-4 py-3 shadow-soft backdrop-blur">
                <div className="flex items-center gap-3">
                  {iconImage ? (
                    <img
                      src={iconImage}
                      alt={`${game.name} icon`}
                      className="h-10 w-10 rounded-md border border-background-border object-cover"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-md border border-background-border bg-background-muted" />
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted">
                      Steam vault
                    </p>
                    <p className="text-sm font-semibold">{game.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden text-xs text-text-secondary md:inline">
                    {displayPrice}
                  </span>
                  {isCurrentGameDownloading ? (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" icon={<Download size={14} />} disabled>
                        Downloading
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={isCurrentGamePaused ? <Play size={14} /> : <Pause size={14} />}
                        onClick={handleToggleCurrentDownload}
                      >
                        {isCurrentGamePaused ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Square size={14} />}
                        onClick={handleStopCurrentDownload}
                      >
                        Stop
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      icon={<Download size={14} />}
                      onClick={handleDownload}
                      disabled={downloadBusy}
                    >
                      {startingDownload ? "Starting..." : "Download"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section
        ref={heroRef}
        className="relative overflow-hidden rounded-xl border border-background-border"
      >
        {heroImage && (
          <div className="absolute inset-0">
            <img
              src={heroImage}
              alt={game.name}
              className="h-full w-full object-cover"
              {...getMediaProtectionProps()}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          </div>
        )}
        <div className="relative z-10 grid gap-8 px-4 py-6 sm:px-6 sm:py-8 md:grid-cols-[1.3fr_0.7fr] md:gap-10 md:px-8 md:py-12">
          <div className="space-y-5">
            {game.logoImage && (
              <img
                src={game.logoImage}
                alt={`${game.name} logo`}
                className="h-14 w-auto max-w-[240px] object-contain sm:h-16 sm:max-w-[280px] md:h-20 md:max-w-[320px]"
                {...getMediaProtectionProps()}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {game.denuvo && <Badge label="Denuvo" tone="danger" />}
              {isCurrentTitleDlc ? <Badge label={t("game.dlc")} tone="secondary" /> : null}
              {!isCurrentTitleDlc ? <Badge label={t("store.base_game")} tone="secondary" /> : null}
              {!isCurrentTitleDlc && resolvedDlcCount > 0 ? (
                <Badge label={`DLC ${resolvedDlcCount}`} tone="primary" />
              ) : null}
              {tags.map((tag) => (
                <Badge key={tag} label={tag} tone="primary" />
              ))}
              <Badge label={`AppID ${game.appId}`} tone="secondary" />
            </div>
            <h1 className="text-3xl font-semibold text-glow sm:text-4xl md:text-5xl">
              {game.name}
            </h1>
            <p className="text-base text-text-secondary sm:text-lg">
              {game.shortDescription || "Steam catalog entry."}
            </p>
            <div className="flex flex-wrap gap-3">
              {isCurrentGameDownloading ? (
                <>
                  <Button size="lg" variant="secondary" icon={<Download size={18} />} disabled>
                    Downloading
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    icon={isCurrentGamePaused ? <Play size={18} /> : <Pause size={18} />}
                    onClick={handleToggleCurrentDownload}
                  >
                    {isCurrentGamePaused ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    size="lg"
                    variant="danger"
                    icon={<Square size={18} />}
                    onClick={handleStopCurrentDownload}
                  >
                    Stop
                  </Button>
                </>
              ) : (
                <Button
                  size="lg"
                  icon={<Download size={18} />}
                  onClick={handleDownload}
                  disabled={downloadBusy}
                >
                  {startingDownload ? "Starting..." : "Download"}
                </Button>
              )}
              {storeUrl && (
                <Button
                  size="lg"
                  variant="ghost"
                  icon={<ExternalLink size={18} />}
                  onClick={() => void openExternal(storeUrl)}
                >
                  View on Steam
                </Button>
              )}
            </div>
            {actionError && <p className="text-sm text-accent-red">{actionError}</p>}
            {!token && (
              <p className="text-sm text-text-secondary">
                Sign in to download via the launcher.
              </p>
            )}
          </div>
          <div className="relative flex items-start justify-start md:justify-end">
            <div className="group relative">
              <button
                aria-label={t("steam_detail.show_price_details")}
                className="flex h-12 w-12 items-center justify-center rounded-full border border-background-border bg-background/80 text-text-secondary transition hover:border-primary hover:text-text-primary"
              >
                <Tag size={18} />
              </button>
              <div className="pointer-events-none absolute left-0 top-14 w-[calc(100vw-3rem)] max-w-xs translate-y-2 scale-95 opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:scale-100 group-focus-within:opacity-100 md:left-auto md:right-0 md:w-72 md:max-w-none">
                <div className="glass-panel space-y-4 p-6">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-text-muted">Price</p>
                    <p className="text-3xl font-semibold">{displayPrice}</p>
                    {game.price?.discountPercent ? (
                      <p className="text-sm text-text-secondary">
                        {game.price.discountPercent}% discount
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-2 text-sm text-text-secondary">
                    <div className="flex items-center justify-between">
                      <span>Developer</span>
                      <span className="text-text-primary">
                        {game.developers?.[0] || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Publisher</span>
                      <span className="text-text-primary">
                        {game.publishers?.[0] || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Release</span>
                      <span className="text-text-primary">{game.releaseDate || "TBA"}</span>
                    </div>
                    {game.metacritic?.score && (
                      <div className="flex items-center justify-between">
                        <span>Metacritic</span>
                        <span className="text-text-primary">{game.metacritic.score}</span>
                      </div>
                    )}
                    {game.recommendations && (
                      <div className="flex items-center justify-between">
                        <span>Recommendations</span>
                        <span className="text-text-primary">{game.recommendations}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-text-muted">Platforms: {platformLabel}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6">
        <MediaGallery
          screenshots={game.screenshots || []}
          videos={videos}
          className="mx-auto w-full max-w-5xl"
        />

        {/* Reviews & Stats Summary - Always visible */}
        {extendedData && (
          <ReviewsSummary
            reviews={extendedData.reviews}
            playerCount={extendedData.playerCount}
          />
        )}

        {/* Tabbed Content Section */}
        <div className="glass-panel overflow-hidden">
          {/* Tab Navigation */}
          <div className="flex flex-col gap-2 border-b border-background-border px-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-0 sm:py-0">
            <div className="flex overflow-x-auto scrollbar-elegant">
              <button
                onClick={() => setActiveTab("about")}
                className={`shrink-0 flex items-center gap-2 px-4 py-3 text-xs font-medium transition sm:px-6 sm:py-4 sm:text-sm ${
                  activeTab === "about"
                    ? "border-b-2 border-primary text-primary"
                    : "text-text-muted hover:text-text-primary hover:bg-background-muted/50"
                }`}
              >
                <Info size={16} />
                About
              </button>
              {resolvedDlcCount > 0 && (
                <button
                  onClick={() => setActiveTab("dlc")}
                  className={`shrink-0 flex items-center gap-2 px-4 py-3 text-xs font-medium transition sm:px-6 sm:py-4 sm:text-sm ${
                    activeTab === "dlc"
                      ? "border-b-2 border-primary text-primary"
                      : "text-text-muted hover:text-text-primary hover:bg-background-muted/50"
                  }`}
                >
                  <Package size={16} />
                  DLC
                  <span className="ml-1 rounded-full bg-background-muted px-2 py-0.5 text-xs">
                    {resolvedDlcCount}
                  </span>
                </button>
              )}
              {extendedData && extendedData.achievements.items.length > 0 && (
                <button
                  onClick={() => setActiveTab("achievements")}
                  className={`shrink-0 flex items-center gap-2 px-4 py-3 text-xs font-medium transition sm:px-6 sm:py-4 sm:text-sm ${
                    activeTab === "achievements"
                      ? "border-b-2 border-primary text-primary"
                      : "text-text-muted hover:text-text-primary hover:bg-background-muted/50"
                  }`}
                >
                  <Trophy size={16} />
                  Achievements
                  <span className="ml-1 rounded-full bg-background-muted px-2 py-0.5 text-xs">
                    {extendedData.achievements.items.length}
                  </span>
                </button>
              )}
              {extendedData && extendedData.news.items.length > 0 && (
                <button
                  onClick={() => setActiveTab("news")}
                  className={`shrink-0 flex items-center gap-2 px-4 py-3 text-xs font-medium transition sm:px-6 sm:py-4 sm:text-sm ${
                    activeTab === "news"
                      ? "border-b-2 border-primary text-primary"
                      : "text-text-muted hover:text-text-primary hover:bg-background-muted/50"
                  }`}
                >
                  <Newspaper size={16} />
                  News
                  <span className="ml-1 rounded-full bg-background-muted px-2 py-0.5 text-xs">
                    {extendedData.news.items.length}
                  </span>
                </button>
              )}
              <button
                onClick={() => setActiveTab("comments")}
                className={`shrink-0 flex items-center gap-2 px-4 py-3 text-xs font-medium transition sm:px-6 sm:py-4 sm:text-sm ${
                  activeTab === "comments"
                    ? "border-b-2 border-primary text-primary"
                    : "text-text-muted hover:text-text-primary hover:bg-background-muted/50"
                }`}
              >
                <MessageSquare size={16} />
                Comments
                <span className="rounded-full bg-accent-red/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-accent-red">
                  New
                </span>
              </button>
              {/* Properties Tab - Always visible */}
              <button
                onClick={() => setActiveTab("properties")}
                className={`shrink-0 flex items-center gap-2 px-4 py-3 text-xs font-medium transition sm:px-6 sm:py-4 sm:text-sm ${
                  activeTab === "properties"
                    ? "border-b-2 border-primary text-primary"
                    : "text-text-muted hover:text-text-primary hover:bg-background-muted/50"
                }`}
              >
                <Settings size={16} />
                Properties
              </button>
            </div>
            
            {/* Refresh button for DLC */}
            {activeTab === "dlc" && (
              <button
                onClick={handleRefreshDLC}
                disabled={extendedLoading}
                className="self-end mr-2 flex items-center gap-2 rounded-lg border border-background-border bg-background-surface px-3 py-2 text-xs font-medium text-text-secondary transition hover:text-text-primary hover:border-primary disabled:opacity-50 sm:mr-4"
                title={t("steam_detail.refresh_dlc_title")}
              >
                <RefreshCw size={14} className={extendedLoading ? "animate-spin" : ""} />
                {t("steam_detail.refresh")}
              </button>
            )}
          </div>

          {/* Tab Content */}
          <div className="p-6">
            <AnimatePresence mode="wait">
              {activeTab === "about" && (
                <motion.div
                  key="about"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-text-muted">About</p>
                    {richBlocks.length > 0 ? (
                      <div className="space-y-6">
                        {richBlocks.map((block, index) => (
                          <div
                            key={`steam-rich-${index}`}
                            className="steam-rich"
                            dangerouslySetInnerHTML={{ __html: block }}
                          />
                        ))}
                      </div>
                    ) : (
                      renderParagraphs(game.aboutTheGame || game.detailedDescription) || (
                        <p className="text-sm text-text-secondary">No description available yet.</p>
                      )
                    )}
                  </div>
                  {game.pcRequirements && (
                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Minimum</p>
                        <pre className="mt-2 whitespace-pre-wrap text-xs text-text-secondary">
                          {game.pcRequirements.minimum || "Not specified."}
                        </pre>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Recommended</p>
                        <pre className="mt-2 whitespace-pre-wrap text-xs text-text-secondary">
                          {game.pcRequirements.recommended || "Not specified."}
                        </pre>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === "dlc" && (
                <motion.div
                  key="dlc"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <DLCSection
                    dlcList={extendedData?.dlc?.items || []}
                    appId={appId || ""}
                    gameName={game.name}
                  />
                </motion.div>
              )}

              {activeTab === "achievements" && extendedData && (
                <motion.div
                  key="achievements"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <AchievementsSection
                    achievements={extendedData.achievements.items}
                    appId={appId || ""}
                  />
                </motion.div>
              )}

              {activeTab === "news" && extendedData && (
                <motion.div
                  key="news"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <NewsSection
                    news={extendedData.news.items}
                    appId={appId || ""}
                    gameName={game.name}
                  />
                </motion.div>
              )}

              {activeTab === "properties" && (
                <motion.div
                  key="properties"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <PropertiesSection
                    appId={appId || ""}
                    gameName={game.name}
                  />
                </motion.div>
              )}

              {activeTab === "comments" && (
                <motion.div
                  key="comments"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  <CommunityCommentsSection appId={appId || ""} appName={game.name} />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Loading state for extended data */}
            {extendedLoading && (
              <div className="py-8 text-center text-sm text-text-muted">
                Loading additional content...
              </div>
            )}
          </div>
        </div>

        {/* Fixes Section - Show available bypass/online-fix options */}
        {downloadOptions && (downloadOptions.onlineFix.length > 0 || downloadOptions.bypass) && (
          <div className="glass-panel space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Wrench size={16} className="text-primary" />
              <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
                {t("crack.fix_library")}
              </p>
            </div>

            {/* Online Fix Options */}
            {downloadOptions.onlineFix.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <ShieldOff size={14} className="text-accent-blue" />
                  {t("nav.online_fix")}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {downloadOptions.onlineFix.map((option, index) => (
                    <button
                      key={`online-fix-${index}`}
                      onClick={() => {
                        setSelectedFixEntry({
                          appId: appId || "",
                          name: game?.name || "",
                          denuvo: game?.denuvo ?? false,
                          steam: game ? {
                            appId: game.appId || "",
                            name: game.name || "",
                            shortDescription: game.shortDescription || null,
                            headerImage: game.headerImage || null,
                            denuvo: game.denuvo ?? false,
                          } : null,
                          options: [option]
                        });
                        setCrackModalOpen(true);
                      }}
                      className="flex items-center justify-between gap-3 rounded-lg border border-background-border bg-background-surface px-4 py-3 text-left transition hover:border-primary hover:bg-primary/5"
                    >
                      <div className="flex items-center gap-2">
                        {option.recommended && (
                          <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            <Star size={10} />
                            {t("crack.recommended")}
                          </span>
                        )}
                        <span className="font-medium text-text-primary">
                          {option.name || t("crack.download_fix")}
                        </span>
                        {option.version && (
                          <span className="text-xs text-text-muted">{option.version}</span>
                        )}
                      </div>
                      <Download size={14} className="text-primary" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bypass Option */}
            {downloadOptions.bypass && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <ShieldOff size={14} className="text-accent-amber" />
                  {t("nav.bypass")}
                </p>
                <button
                  onClick={() => {
                    setSelectedFixEntry({
                      appId: appId || "",
                      name: game?.name || "",
                      denuvo: game?.denuvo ?? false,
                      steam: game ? {
                        appId: game.appId || "",
                        name: game.name || "",
                        shortDescription: game.shortDescription || null,
                        headerImage: game.headerImage || null,
                        denuvo: game.denuvo ?? false,
                      } : null,
                      options: [downloadOptions.bypass!]
                    });
                    setCrackModalOpen(true);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-background-border bg-background-surface px-4 py-3 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <div className="flex items-center gap-2">
                    {downloadOptions.bypass.recommended && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <Star size={10} />
                        {t("crack.recommended")}
                      </span>
                    )}
                    <span className="font-medium text-text-primary">
                      {downloadOptions.bypass.name || t("crack.download_fix")}
                    </span>
                    {downloadOptions.bypass.version && (
                      <span className="text-xs text-text-muted">{downloadOptions.bypass.version}</span>
                    )}
                  </div>
                  <Download size={14} className="text-primary" />
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

