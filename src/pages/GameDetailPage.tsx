import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download, Heart, Play, Share2 } from "lucide-react";
import { useGames } from "../hooks/useGames";
import { useLibrary } from "../hooks/useLibrary";
import { useDownloads } from "../hooks/useDownloads";
import { useWishlist } from "../hooks/useWishlist";
import { useAuth } from "../context/AuthContext";
import { unlockAchievement } from "../services/achievements";
import { fetchLaunchConfig, verifyAgeGate } from "../services/api";
import Badge from "../components/common/Badge";
import Button from "../components/common/Button";
import PlayOptionsModal from "../components/launcher/PlayOptionsModal";
import MediaGallery from "../components/game-detail/MediaGallery";
import RequirementsTab from "../components/game-detail/RequirementsTab";
import ReviewsTab from "../components/game-detail/ReviewsTab";
import AboutTab from "../components/game-detail/AboutTab";
import AgeGateModal from "../components/common/AgeGateModal";
import { isAgeGateAllowed, resolveRequiredAge, storeAgeGate } from "../utils/ageGate";
import { launchGame } from "../services/launcher";
import {
  derivePlayOptions,
  getDefaultPlayOptions,
  loadPlayOptions,
  savePlayOptions
} from "../utils/playOptions";
import type { PlayOptions } from "../utils/playOptions";
import type { LaunchConfig } from "../types";

export default function GameDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { games } = useGames();
  const { entries, purchase, markInstalled } = useLibrary();
  const { entries: wishlistEntries, add: addToWishlist, remove: removeFromWishlist } = useWishlist();
  const { start } = useDownloads();
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"about" | "requirements" | "reviews">("about");
  const [ageGateOpen, setAgeGateOpen] = useState(false);
  const [ageGateError, setAgeGateError] = useState<string | null>(null);
  const [ageGateBusy, setAgeGateBusy] = useState(false);
  const [ageGateAllowed, setAgeGateAllowed] = useState(false);
  const [playOptionsOpen, setPlayOptionsOpen] = useState(false);
  const [playBusy, setPlayBusy] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [launchConfig, setLaunchConfig] = useState<LaunchConfig | null>(null);
  const [launchConfigLoading, setLaunchConfigLoading] = useState(false);
  const [storedPlayOptions, setStoredPlayOptions] = useState<PlayOptions | null>(null);

  const game = useMemo(() => games.find((item) => item.slug === slug), [games, slug]);
  const libraryEntry = useMemo(
    () => entries.find((entry) => entry.game.id === game?.id),
    [entries, game]
  );
  const wishlistEntry = useMemo(
    () => wishlistEntries.find((entry) => entry.game.id === game?.id),
    [wishlistEntries, game]
  );
  useEffect(() => {
    if (!game) {
      setStoredPlayOptions(null);
      return;
    }
    setStoredPlayOptions(loadPlayOptions(game.id));
  }, [game]);

  const initialPlayOptions = useMemo(
    () => derivePlayOptions(storedPlayOptions, launchConfig),
    [storedPlayOptions, launchConfig]
  );

  const requiredAge = resolveRequiredAge(game?.requiredAge ?? 18);
  const gateScope = game ? `game:${game.id}` : "";

  useEffect(() => {
    if (!game) return;
    if (ageGateAllowed) return;
    if (requiredAge <= 0) {
      setAgeGateAllowed(true);
      return;
    }
    if (gateScope && isAgeGateAllowed(gateScope, requiredAge)) {
      setAgeGateAllowed(true);
      return;
    }
    setAgeGateOpen(true);
  }, [ageGateAllowed, game, gateScope, requiredAge]);

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
      if (gateScope) {
        storeAgeGate(gateScope, result.age, requiredAge, payload.remember);
      }
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

  if (!game) {
    return (
      <div className="glass-panel p-8">
        <p>Game not found.</p>
      </div>
    );
  }

  const discountedPrice = (game.price * (1 - game.discountPercent / 100)).toFixed(2);
  const owned = Boolean(libraryEntry);
  const installed = Boolean(libraryEntry?.game.installed);
  const wishlisted = Boolean(wishlistEntry);

  const handlePurchase = async () => {
    if (!token) {
      navigate("/login");
      return;
    }
    setActionError(null);
    try {
      await purchase(game.id);
    } catch (err: any) {
      setActionError(err.message || "Purchase failed");
    }
  };

  const handlePlay = async () => {
    setActionError(null);
    setPlayError(null);
    setPlayOptionsOpen(true);
    if (game) {
      setLaunchConfig(null);
      setLaunchConfigLoading(true);
      fetchLaunchConfig(game.id)
        .then((cfg) => {
          setLaunchConfig(cfg);
          const stored = loadPlayOptions(game.id);
          if (!stored) {
            const derived = derivePlayOptions(null, cfg);
            savePlayOptions(game.id, derived);
            setStoredPlayOptions(derived);
          } else {
            setStoredPlayOptions(stored);
          }
        })
        .catch(() => setLaunchConfig(null))
        .finally(() => setLaunchConfigLoading(false));
    }
  };

  const handleConfirmPlay = async (options: PlayOptions, remember: boolean) => {
    setPlayBusy(true);
    setPlayError(null);
    try {
      if (remember) {
        savePlayOptions(game.id, options);
      }
      if (token) {
        await unlockAchievement(game.id, "first_launch", token);
      }
      await launchGame({
        gameId: game.id,
        slug: game.slug,
        title: game.title,
        renderer: options.renderer,
        overlayEnabled: options.overlayEnabled,
        steamAppId: game.steamAppId ?? null,
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

  const handleInstall = async () => {
    if (!token) {
      navigate("/login");
      return;
    }
    setActionError(null);
    try {
      const entry = owned ? libraryEntry : await purchase(game.id);
      await start(game.id);
      if (entry?.id) {
        await markInstalled(entry.id);
      }
    } catch (err: any) {
      setActionError(err.message || "Download start failed");
    }
  };

  const handleWishlist = async () => {
    if (!token) {
      navigate("/login");
      return;
    }
    setActionError(null);
    try {
      if (wishlisted) {
        await removeFromWishlist(game.id);
      } else {
        await addToWishlist(game.id);
      }
    } catch (err: any) {
      setActionError(err.message || "Wishlist update failed");
    }
  };

  return (
    <div className="space-y-8">
      <AgeGateModal
        open={ageGateOpen && !ageGateAllowed}
        title={game.title}
        requiredAge={requiredAge}
        onConfirm={handleAgeGateConfirm}
        onCancel={handleAgeGateCancel}
        error={ageGateError}
        busy={ageGateBusy}
      />
      <PlayOptionsModal
        open={playOptionsOpen}
        onClose={() => setPlayOptionsOpen(false)}
        gameTitle={game.title}
        initialOptions={initialPlayOptions}
        launchConfig={launchConfig}
        busy={playBusy || launchConfigLoading}
        error={playError}
        onConfirm={handleConfirmPlay}
      />
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sm text-text-secondary transition hover:text-text-primary"
      >
        <ArrowLeft size={16} />
        Back to store
      </button>

      <section className="relative overflow-hidden rounded-xl border border-background-border">
        <div className="absolute inset-0">
          <img
            src={game.backgroundImage || game.heroImage}
            alt={game.title}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        </div>
        <div className="relative z-10 grid gap-10 px-8 py-12 md:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-5">
            {game.logoImage && (
              <img
                src={game.logoImage}
                alt={`${game.title} logo`}
                className="h-20 w-auto max-w-[320px] object-contain"
              />
            )}
            <div className="flex flex-wrap gap-2">
              {game.genres.map((genre) => (
                <Badge key={genre} label={genre} tone="primary" />
              ))}
              {owned && <Badge label="Owned" tone="secondary" />}
            </div>
            <h1 className="text-4xl font-semibold text-glow md:text-5xl">
              {game.title}
            </h1>
            <p className="text-lg text-text-secondary">
              {game.shortDescription || game.tagline}
            </p>
            <div className="flex flex-wrap gap-3">
              {installed ? (
                <Button size="lg" icon={<Play size={18} />} onClick={handlePlay}>
                  Play now
                </Button>
              ) : (
                <Button size="lg" icon={<Download size={18} />} onClick={handleInstall}>
                  Install
                </Button>
              )}
              {!owned && (
                <Button
                  size="lg"
                  variant="secondary"
                  icon={<Download size={18} />}
                  onClick={handlePurchase}
                >
                  Buy now
                </Button>
              )}
              <Button
                size="lg"
                variant="ghost"
                icon={<Heart size={18} />}
                onClick={handleWishlist}
              >
                {wishlisted ? "Wishlisted" : "Wishlist"}
              </Button>
              <Button size="lg" variant="ghost" icon={<Share2 size={18} />}>
                Share
              </Button>
            </div>
            {actionError && <p className="text-sm text-accent-red">{actionError}</p>}
            {!token && (
              <p className="text-sm text-text-secondary">
                Sign in to purchase and download. <Link to="/login" className="text-primary">Sign in</Link>
              </p>
            )}
          </div>
          <div className="glass-panel space-y-4 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-text-muted">Price</p>
              <p className="text-3xl font-semibold">${discountedPrice}</p>
              {game.discountPercent > 0 && (
                <p className="text-sm text-text-secondary">
                  <span className="line-through">${game.price.toFixed(2)}</span> - {game.discountPercent}% off
                </p>
              )}
            </div>
            <div className="space-y-2 text-sm text-text-secondary">
              <div className="flex items-center justify-between">
                <span>Developer</span>
                <span className="text-text-primary">{game.studio}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Release</span>
                <span className="text-text-primary">{game.releaseDate}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Rating</span>
                <span className="text-text-primary">{game.rating} / 5</span>
              </div>
            </div>
            {!owned ? (
              <Button size="sm" variant="secondary" onClick={handlePurchase}>
                Add to library
              </Button>
            ) : (
              <p className="text-xs text-text-secondary">Already in your library</p>
            )}
          </div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="grid gap-6"
      >
        <MediaGallery screenshots={game.screenshots} videos={game.videos} />

        <div className="glass-panel p-6">
          <div className="flex flex-wrap gap-3 border-b border-background-border pb-4">
            {(["about", "requirements", "reviews"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "border-background-border text-text-muted hover:text-text-primary"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="pt-6">
            {activeTab === "about" && <AboutTab game={game} />}
            {activeTab === "requirements" && <RequirementsTab game={game} />}
            {activeTab === "reviews" && <ReviewsTab gameId={game.id} />}
          </div>
        </div>
      </motion.section>
    </div>
  );
}
