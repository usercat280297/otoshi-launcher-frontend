import { useEffect, useRef, useState, useCallback } from "react";
import {
  Download,
  Gamepad2,
  Zap,
  Cloud,
  Users,
  Shield,
  ChevronDown,
  Check,
  Sparkles,
  Library,
  Wrench,
  ArrowRight,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLocale } from "../context/LocaleContext";
import { Link, useNavigate } from "react-router-dom";
import { isTauri } from "@tauri-apps/api/core";
import Hls from "hls.js";
import { getMediaProtectionProps } from "../utils/mediaProtection";
import { openExternal } from "../utils/openExternal";

type LauncherArtifact = {
  kind: "installer" | "portable" | string;
  version: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  download_url: string;
};

// Helper to get video URL based on environment
const getVideoUrl = (path: string, type: "hls" | "cdn") => {
  // In development, use proxy to bypass CORS
  if (import.meta.env.DEV) {
    if (type === "hls") {
      return `/steam-video${path}`;
    }
    return `/steam-cdn${path}`;
  }
  // In production (Tauri), use direct URLs (no CORS issue)
  if (type === "hls") {
    return `https://video.akamai.steamstatic.com${path}`;
  }
  return `https://cdn.cloudflare.steamstatic.com${path}`;
};

// Featured games data - using HLS streaming from Steam CDN with mp4 fallback
const featuredGames = [
  {
    id: 1,
    title: "Black Myth: Wukong",
    image: "https://cdn.cloudflare.steamstatic.com/steam/apps/2358720/header.jpg",
    hls: getVideoUrl("/store_trailers/2358720/743632/6acf4311bb6a59d300b902ab6a3f445215089d9c/1750812851/hls_264_master.m3u8", "hls"),
    mp4: getVideoUrl("/steam/apps/257048125/movie_max.mp4", "cdn"),
    genre: "Action RPG",
  },
  {
    id: 2,
    title: "Elden Ring",
    image: "https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg",
    hls: getVideoUrl("/store_trailers/1245620/385999/944b71682fb4887ce28f8f281529d7f712a02bf9/1750649922/hls_264_master.m3u8", "hls"),
    mp4: getVideoUrl("/steam/apps/256843493/movie_max.mp4", "cdn"),
    genre: "Action RPG",
  },
  {
    id: 3,
    title: "Cyberpunk 2077",
    image: "https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg",
    hls: getVideoUrl("/store_trailers/1091500/798578/0d0c54b81225b2b7760d1a99b6c5950cb85a1767/1750617872/hls_264_master.m3u8", "hls"),
    mp4: getVideoUrl("/steam/apps/257081132/movie_max.mp4", "cdn"),
    genre: "RPG",
  },
  {
    id: 4,
    title: "Red Dead Redemption 2",
    image: "https://cdn.cloudflare.steamstatic.com/steam/apps/1174180/header.jpg",
    hls: getVideoUrl("/store_trailers/1174180/296976/f8e9a7b6c5d4e3f2a1b0c9d8e7f6a5b4/1750812850/hls_264_master.m3u8", "hls"),
    mp4: getVideoUrl("/steam/apps/256768371/movie_max.mp4", "cdn"),
    genre: "Action Adventure",
  },
  {
    id: 5,
    title: "God of War",
    image: "https://cdn.cloudflare.steamstatic.com/steam/apps/1593500/header.jpg",
    hls: getVideoUrl("/store_trailers/1593500/407167/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/1750812850/hls_264_master.m3u8", "hls"),
    mp4: getVideoUrl("/steam/apps/256864834/movie_max.mp4", "cdn"),
    genre: "Action Adventure",
  },
  {
    id: 6,
    title: "Hogwarts Legacy",
    image: "https://cdn.cloudflare.steamstatic.com/steam/apps/990080/header.jpg",
    hls: getVideoUrl("/store_trailers/990080/628396/b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7/1750812850/hls_264_master.m3u8", "hls"),
    mp4: getVideoUrl("/steam/apps/256925940/movie_max.mp4", "cdn"),
    genre: "Action RPG",
  },
];

const denuvoGames = [
  { id: 2358720, title: 'Black Myth: Wukong', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2358720/header.jpg' },
  { id: 1091500, title: 'Cyberpunk 2077', image: 'https://cdn.akamai.steamstatic.com/steam/apps/1091500/header.jpg' },
  { id: 2561580, title: 'Horizon Zero Dawn', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2561580/header.jpg' },
  { id: 1716740, title: 'Starfield', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1716740/header.jpg' },
  { id: 2515020, title: 'Final Fantasy XVI', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2515020/header.jpg' },
  { id: 1142710, title: 'Total War: WARHAMMER III', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1142710/header.jpg' },
  { id: 1245620, title: 'Elden Ring', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1245620/header.jpg' },
  { id: 1593500, title: 'God of War', image: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1593500/header.jpg' },
];

// Animated background particles
const ParticleField = () => {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {[...Array(30)].map((_, i) => (
        <div
          key={i}
          className="absolute h-1 w-1 rounded-full bg-primary/20"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `float ${4 + Math.random() * 4}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 2}s`,
          }}
        />
      ))}
    </div>
  );
};

// Feature card component
interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay: number;
  isVisible: boolean;
}

const FeatureCard = ({ icon, title, description, delay, isVisible }: FeatureCardProps) => (
  <div
    className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-6 backdrop-blur-sm transition-all duration-700 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 ${
      isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
    }`}
    style={{ transitionDelay: `${delay}ms` }}
  >
    <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/5 transition-transform duration-500 group-hover:scale-150" />
    <div className="relative z-10">
      <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary transition-colors group-hover:bg-primary/20">
        {icon}
      </div>
      <h3 className="mb-2 text-lg font-bold text-text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
    </div>
  </div>
);

// Game card for showcase
interface GameCardProps {
  game: typeof featuredGames[0];
  index: number;
  isVisible: boolean;
}

const GameCard = ({ game, index, isVisible }: GameCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [useMp4Fallback, setUseMp4Fallback] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Try MP4 fallback when HLS fails
  const tryMp4Fallback = useCallback(() => {
    const video = videoRef.current;
    if (!video || !game.mp4 || useMp4Fallback) return false;

    console.log("Trying MP4 fallback for:", game.title);
    setUseMp4Fallback(true);
    setVideoError(false);

    video.src = game.mp4;
    video.load();

    const handleCanPlay = () => {
      setVideoReady(true);
      video.muted = isMuted;
      video.play().catch(console.warn);
    };

    const handleError = () => {
      setVideoError(true);
    };

    video.addEventListener("canplay", handleCanPlay, { once: true });
    video.addEventListener("error", handleError, { once: true });

    return true;
  }, [game.mp4, game.title, isMuted, useMp4Fallback]);

  // Initialize HLS when hovered
  useEffect(() => {
    const video = videoRef.current;

    // Reset state when not hovered
    if (!isHovered) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video) {
        video.pause();
        video.currentTime = 0;
        video.src = "";
      }
      setVideoReady(false);
      setVideoError(false);
      setUseMp4Fallback(false);
      return;
    }

    if (!video) return;

    // If already using mp4 fallback, just play
    if (useMp4Fallback && game.mp4) {
      if (!video.src || !video.src.includes(game.mp4)) {
        video.src = game.mp4;
        video.load();
      }
      if (videoReady) {
        video.muted = isMuted;
        video.play().catch(console.warn);
      }
      return;
    }

    // No HLS URL available, try mp4 directly
    if (!game.hls) {
      tryMp4Fallback();
      return;
    }

    // Timeout for loading
    const loadTimeout = setTimeout(() => {
      if (!videoReady && !useMp4Fallback) {
        console.warn("HLS load timeout for:", game.title);
        if (!tryMp4Fallback()) {
          setVideoError(true);
        }
      }
    }, 5000);

    // Check if HLS is supported
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        fragLoadingTimeOut: 8000,
        manifestLoadingTimeOut: 5000,
        levelLoadingTimeOut: 8000,
      });

      hlsRef.current = hls;
      hls.loadSource(game.hls);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        clearTimeout(loadTimeout);
        setVideoReady(true);
        setVideoError(false);
        video.muted = isMuted;
        video.play().catch((err) => {
          console.warn("HLS play failed:", err);
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          clearTimeout(loadTimeout);
          console.warn("HLS error, trying MP4 fallback:", data.type, data.details);
          hls.destroy();
          hlsRef.current = null;
          if (!tryMp4Fallback()) {
            setVideoError(true);
          }
        }
      });

      return () => {
        clearTimeout(loadTimeout);
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS support
      video.src = game.hls;
      const handleLoaded = () => {
        clearTimeout(loadTimeout);
        setVideoReady(true);
        video.muted = isMuted;
        video.play().catch(console.warn);
      };
      const handleError = () => {
        clearTimeout(loadTimeout);
        if (!tryMp4Fallback()) {
          setVideoError(true);
        }
      };
      video.addEventListener("loadedmetadata", handleLoaded, { once: true });
      video.addEventListener("error", handleError, { once: true });

      return () => {
        clearTimeout(loadTimeout);
      };
    } else {
      clearTimeout(loadTimeout);
      if (!tryMp4Fallback()) {
        setVideoError(true);
      }
    }
  }, [isHovered, game.hls, game.mp4, game.title, isMuted, videoReady, useMp4Fallback, tryMp4Fallback]);

  // Sync mute state
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = isMuted;
    }
  }, [isMuted]);

  const toggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMuted((prev) => !prev);
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    setIsMuted(false); // Unmute when mouse enters
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setIsMuted(true); // Mute when mouse leaves
  }, []);

  return (
    <div
      className={`group relative aspect-video cursor-pointer overflow-hidden rounded-xl transition-all duration-500 ease-out ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      } ${
        isHovered
          ? "z-30 scale-[1.15] ring-2 ring-primary/80"
          : "z-10"
      }`}
      style={{
        transitionDelay: `${index * 100}ms`,
        boxShadow: isHovered
          ? "0 0 40px 8px rgba(56, 189, 248, 0.5), 0 0 80px 20px rgba(56, 189, 248, 0.3), 0 25px 50px -12px rgba(0, 0, 0, 0.8)"
          : "0 4px 6px -1px rgba(0, 0, 0, 0.3)",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* HLS Video element */}
      <video
        ref={videoRef}
        poster={game.image}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          isHovered && videoReady && !videoError ? "opacity-100" : "opacity-0"
        }`}
        loop
        muted={isMuted}
        playsInline
        preload="none"
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        {...getMediaProtectionProps()}
      />

      {/* Image fallback */}
      <img
        src={game.image}
        alt={game.title}
        className={`h-full w-full object-cover transition-opacity duration-300 ${
          isHovered && videoReady && !videoError ? "opacity-0" : "opacity-100"
        }`}
        {...getMediaProtectionProps()}
      />

      {/* Loading indicator */}
      {isHovered && !videoReady && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}

      {/* Gradient overlay */}
      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent transition-opacity duration-300 ${
          isHovered ? "opacity-60" : "opacity-100"
        }`}
      />

      {/* Game info - always visible at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {game.genre}
        </p>
        <h4 className="text-base font-bold text-white drop-shadow-lg">{game.title}</h4>
      </div>

      {/* Sound toggle button */}
      {isHovered && (
        <button
          onClick={toggleMute}
          className="absolute bottom-4 right-4 rounded-full bg-black/70 p-2.5 text-white backdrop-blur-sm transition-all hover:bg-black/90 hover:scale-110"
        >
          {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} className="text-primary" />}
        </button>
      )}

      {/* Glow ring effect when hovered */}
      {isHovered && (
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-primary/60 ring-offset-2 ring-offset-background animate-pulse" />
      )}
    </div>
  );
};

// Download progress animation
const DownloadProgress = ({ progress, isDownloading, label }: { progress: number; isDownloading: boolean; label: string }) => {
  if (!isDownloading) return null;

  return (
    <div className="mt-4 w-full max-w-md">
      <div className="mb-2 flex justify-between text-sm">
        <span className="text-text-secondary">{label}...</span>
        <span className="font-mono text-primary">{Math.round(progress)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary via-accent-blue to-primary transition-all duration-300"
          style={{
            width: `${progress}%`,
            backgroundSize: "200% 100%",
            animation: "shimmer 2s linear infinite",
          }}
        />
      </div>
    </div>
  );
};

// Stats counter
interface StatProps {
  value: string;
  label: string;
  delay: number;
  isVisible: boolean;
}

const Stat = ({ value, label, delay, isVisible }: StatProps) => (
  <div
    className={`text-center transition-all duration-700 ${
      isVisible ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
    }`}
    style={{ transitionDelay: `${delay}ms` }}
  >
    <div className="text-3xl font-black text-primary md:text-4xl">{value}</div>
    <div className="text-sm text-text-muted">{label}</div>
  </div>
);

export default function DownloadLauncherPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [heroVisible, setHeroVisible] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState(false);
  const [gamesVisible, setGamesVisible] = useState(false);
  const [statsVisible, setStatsVisible] = useState(false);
  const [ctaVisible, setCtaVisible] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadingKind, setDownloadingKind] = useState<"installer" | "portable">("installer");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [artifacts, setArtifacts] = useState<LauncherArtifact[]>([]);

  const featuresRef = useRef<HTMLDivElement>(null);
  const gamesRef = useRef<HTMLDivElement>(null);
  const denuvoRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => setHeroVisible(true), 100);

    const observerOptions = { threshold: 0.15 };

    const observers = [
      { ref: featuresRef, setter: setFeaturesVisible },
      { ref: gamesRef, setter: setGamesVisible },
      { ref: denuvoRef, setter: () => {} }, // Always visible or lazy loaded
      { ref: statsRef, setter: setStatsVisible },
      { ref: ctaRef, setter: setCtaVisible },
    ];

    const intersectionObservers = observers.map(({ ref, setter }) => {
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) setter(true);
      }, observerOptions);
      if (ref.current) observer.observe(ref.current);
      return observer;
    });

    return () => intersectionObservers.forEach((obs) => obs.disconnect());
  }, []);

  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
    fetch(`${API_URL}/launcher-download/artifacts`)
      .then(async (resp) => {
        if (!resp.ok) return [];
        return (await resp.json()) as LauncherArtifact[];
      })
      .then((items) => {
        if (Array.isArray(items)) {
          setArtifacts(items);
        }
      })
      .catch(() => undefined);
  }, []);

  const handleDownload = async (kind: "installer" | "portable" = "installer") => {
    if (isDownloading) return;

    setDownloadingKind(kind);
    setIsDownloading(true);
    setDownloadProgress(0);

    try {
      // Get launcher info from API
      const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
      let selectedArtifact = artifacts.find((item) => item.kind === kind);
      if (!selectedArtifact && kind === "portable") {
        const artifactResp = await fetch(`${API_URL}/launcher-download/artifacts`);
        if (artifactResp.ok) {
          const latestArtifacts = (await artifactResp.json()) as LauncherArtifact[];
          selectedArtifact = latestArtifacts.find((item) => item.kind === "portable");
        }
      }
      const infoResponse = selectedArtifact
        ? { ok: true, json: async () => selectedArtifact }
        : await fetch(`${API_URL}/launcher-download/info`);

      if (infoResponse.ok) {
        const info = await infoResponse.json();

        // Simulate progress while downloading
        const progressInterval = setInterval(() => {
          setDownloadProgress((prev) => {
            if (prev >= 95) {
              return prev;
            }
            return prev + Math.random() * 8;
          });
        }, 200);

        // Download the file
        const downloadResponse = await fetch(`${API_URL}${info.download_url}`);

        if (downloadResponse.ok) {
          const blob = await downloadResponse.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = info.filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);

          clearInterval(progressInterval);
          setDownloadProgress(100);
          setDownloadComplete(true);
        } else {
          throw new Error("Download failed");
        }

        clearInterval(progressInterval);
      } else {
        // Fallback to direct file download
        fallbackDownload(kind);
      }
    } catch (error) {
      console.warn("API download failed, using fallback:", error);
      fallbackDownload(kind);
    } finally {
      setIsDownloading(false);
    }
  };

  const fallbackDownload = (kind: "installer" | "portable" = "installer") => {
    const interval = setInterval(() => {
      setDownloadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsDownloading(false);
          setDownloadComplete(true);
          const link = document.createElement("a");
          if (kind === "portable") {
            link.href = "/downloads/OtoshiLauncher-Portable.zip";
            link.download = "OtoshiLauncher-Portable.zip";
          } else {
            link.href = "/downloads/OtoshiLauncher-Setup.exe";
            link.download = "OtoshiLauncher-Setup.exe";
          }
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          return 100;
        }
        return prev + Math.random() * 12;
      });
    }, 200);
  };

  const features = [
    {
      icon: <Gamepad2 size={24} />,
      title: t("launcher.feature.library.title"),
      description: t("launcher.feature.library.desc"),
    },
    {
      icon: <Zap size={24} />,
      title: t("launcher.feature.fast.title"),
      description: t("launcher.feature.fast.desc"),
    },
    {
      icon: <Cloud size={24} />,
      title: t("launcher.feature.cloud.title"),
      description: t("launcher.feature.cloud.desc"),
    },
    {
      icon: <Wrench size={24} />,
      title: t("launcher.feature.mods.title"),
      description: t("launcher.feature.mods.desc"),
    },
    {
      icon: <Users size={24} />,
      title: t("launcher.feature.community.title"),
      description: t("launcher.feature.community.desc"),
    },
    {
      icon: <Shield size={24} />,
      title: t("launcher.feature.secure.title"),
      description: t("launcher.feature.secure.desc"),
    },
  ];

  const stats = [
    { value: "30,218", label: t("launcher.stats.games") },
    { value: "40", label: t("launcher.stats.users") },
    { value: "99.9%", label: t("launcher.stats.uptime") },
    { value: "24/7", label: t("launcher.stats.support") },
  ];

  return (
    <div className="relative min-h-screen overflow-x-hidden overflow-y-auto bg-background">
      {/* CSS Variables for glow effects + override global overflow:hidden */}
      <style>{`
        html, body, #root {
          overflow: auto !important;
          height: auto !important;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.2; }
          50% { transform: translateY(-20px) scale(1.1); opacity: 0.4; }
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .marquee-track {
          animation: marquee 30s linear infinite;
        }
        .marquee-track:hover {
          animation-play-state: paused;
        }
      `}</style>

      {/* Animated background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background-elevated" />
        <div className="absolute left-1/4 top-1/4 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 h-[400px] w-[400px] rounded-full bg-accent-blue/5 blur-[100px]" />
        <ParticleField />
      </div>

      {/* Navigation */}
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/store" className="flex items-center gap-3">
            <img src="/OTOSHI_icon.png" alt="Otoshi" className="h-8 w-8" {...getMediaProtectionProps()} />
            <span className="text-lg font-bold text-text-primary">Otoshi Launcher</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/store" className="text-sm text-text-secondary transition hover:text-text-primary">
              {t("nav.store")}
            </Link>
            <button
              onClick={() => void handleDownload("installer")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-black transition hover:bg-primary/90"
            >
              {t("launcher.download.button")}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section
        className={`relative flex min-h-screen flex-col items-center justify-center px-6 pt-20 text-center transition-all duration-1000 ${
          heroVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
        }`}
      >
        {/* Hero background image overlay */}
        <div className="absolute inset-0 -z-10">
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20"
            style={{
              backgroundImage: `url(https://cdn.cloudflare.steamstatic.com/steam/apps/2358720/library_hero.jpg)`,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
        </div>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary">
          <Sparkles size={16} />
          <span>{t("launcher.badge")}</span>
        </div>

        <h1 className="mb-6 max-w-4xl bg-gradient-to-r from-white via-primary to-accent-blue bg-clip-text text-5xl font-black tracking-tight text-transparent md:text-7xl">
          {t("launcher.hero.title")}
        </h1>

        <p className="mb-8 max-w-2xl text-lg text-text-secondary md:text-xl">
          {t("launcher.hero.subtitle")}
        </p>

        <div className="flex flex-col items-center gap-4">
          <button
            onClick={() => void handleDownload("installer")}
            disabled={isDownloading}
            className={`group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-8 py-4 text-lg font-bold transition-all duration-300 ${
              downloadComplete
                ? "bg-accent-green text-white"
                : "bg-primary text-black hover:scale-105 hover:shadow-xl hover:shadow-primary/30"
            }`}
          >
            <span
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{ animation: "shimmer 2s linear infinite" }}
            />
            {downloadComplete ? (
              <>
                <Check size={24} />
                {t("launcher.download.complete")}
              </>
            ) : (
              <>
                <Download size={24} className={isDownloading ? "animate-bounce" : ""} />
                {t("launcher.download.button")}
              </>
            )}
          </button>

          <DownloadProgress
            progress={Math.min(downloadProgress, 100)}
            isDownloading={isDownloading}
            label={downloadingKind === "portable" ? "Downloading portable" : "Downloading installer"}
          />

          <button
            onClick={() => void handleDownload("portable")}
            disabled={isDownloading}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-background-elevated px-6 py-3 text-sm font-semibold text-primary transition hover:border-primary hover:bg-primary/10 disabled:opacity-60"
          >
            <Download size={16} />
            Download Portable (.zip)
          </button>

          <p className="text-sm text-text-muted">{t("launcher.requirements")}</p>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce text-text-muted">
          <ChevronDown size={32} />
        </div>
      </section>

      {/* Features Section */}
      <section ref={featuresRef} className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div
            className={`mb-16 text-center transition-all duration-700 ${
              featuresVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
            }`}
          >
            <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
              {t("launcher.features.title")}
            </h2>
            <p className="mx-auto max-w-2xl text-text-secondary">{t("launcher.features.subtitle")}</p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <FeatureCard
                key={feature.title}
                {...feature}
                delay={index * 100}
                isVisible={featuresVisible}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Games Showcase Section */}
      <section ref={gamesRef} className="px-6 py-24 relative z-10">
        <div className="mx-auto max-w-7xl"> {/* Increased max-width for better spacing */}
          <div
            className={`mb-16 flex flex-col items-center justify-between gap-4 text-center transition-all duration-700 md:flex-row md:text-left ${
              gamesVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
            }`}
          >
            <div>
              <h2 className="mb-2 text-3xl font-bold text-text-primary md:text-4xl">
                {t("launcher.games.title")}
              </h2>
              <p className="text-text-secondary">{t("launcher.games.subtitle")}</p>
            </div>
            <Link
              to="/store"
              className="inline-flex items-center gap-2 text-primary transition hover:gap-3"
            >
              {t("launcher.games.browse")}
              <ArrowRight size={18} />
            </Link>
          </div>

          {/* Grid needs overflow-visible for scaling items */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 overflow-visible p-4">
            {featuredGames.map((game, index) => (
              <GameCard key={game.id} game={game} index={index} isVisible={gamesVisible} />
            ))}
          </div>
        </div>
      </section>

      {/* Featured Games Carousel Section */}
      <section ref={denuvoRef} className="py-16 overflow-hidden bg-gradient-to-b from-transparent via-white/[0.02] to-transparent">
         <div className="mb-10 px-6 text-center">
           <div className="inline-flex items-center gap-3 mb-4">
             <div className="h-px w-12 bg-gradient-to-r from-transparent to-primary/50" />
             <Sparkles size={20} className="text-primary" />
             <div className="h-px w-12 bg-gradient-to-l from-transparent to-primary/50" />
           </div>
           <h3 className="text-2xl font-bold text-text-primary md:text-3xl">
             {t("launcher.showcase.title")}
           </h3>
           <p className="mt-2 text-sm text-text-muted">{t("launcher.showcase.subtitle")}</p>
         </div>

         {/* Infinite Marquee Container */}
         <div className="relative w-full overflow-hidden">
           {/* Fade edges */}
           <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-32 bg-gradient-to-r from-background to-transparent" />
           <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-32 bg-gradient-to-l from-background to-transparent" />

           {/* Scrolling track */}
           <div className="marquee-track flex w-max gap-6">
             {/* First set */}
             {denuvoGames.map((game) => (
               <Link
                 key={`first-${game.id}`}
                 to={`/steam/${game.id}`}
                 className="group relative h-48 w-80 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 transition-all duration-300 hover:border-primary/50 hover:scale-105"
               >
                 <img
                   src={game.image}
                   alt={game.title}
                   className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                 />
                 <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                 <div className="absolute bottom-0 left-0 right-0 p-4">
                   <span className="text-sm font-bold text-white drop-shadow-lg">{game.title}</span>
                 </div>
               </Link>
             ))}
             {/* Duplicate set for seamless loop */}
             {denuvoGames.map((game) => (
               <Link
                 key={`second-${game.id}`}
                 to={`/steam/${game.id}`}
                 className="group relative h-48 w-80 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 transition-all duration-300 hover:border-primary/50 hover:scale-105"
               >
                 <img
                   src={game.image}
                   alt={game.title}
                   className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                 />
                 <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                 <div className="absolute bottom-0 left-0 right-0 p-4">
                   <span className="text-sm font-bold text-white drop-shadow-lg">{game.title}</span>
                 </div>
               </Link>
             ))}
           </div>
         </div>
      </section>

      {/* Stats Section */}
      <section ref={statsRef} className="px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div
            className={`rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-12 backdrop-blur-sm transition-all duration-700 ${
              statsVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
            }`}
          >
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
              {stats.map((stat, index) => (
                <Stat key={stat.label} {...stat} delay={index * 150} isVisible={statsVisible} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section ref={ctaRef} className="px-6 py-24">
        <div
          className={`mx-auto max-w-4xl overflow-hidden rounded-3xl transition-all duration-1000 ${
            ctaVisible ? "scale-100 opacity-100" : "scale-95 opacity-0"
          }`}
        >
          {/* CTA Background */}
          <div className="relative overflow-hidden border border-primary/30 bg-gradient-to-br from-primary/10 via-background-elevated to-accent-blue/10 p-12 text-center">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-accent-blue/10 blur-3xl" />

            <div className="relative z-10">
              <Library size={48} className="mx-auto mb-6 text-primary" />
              <h2 className="mb-4 text-3xl font-bold text-text-primary md:text-4xl">
                {t("launcher.cta.title")}
              </h2>
              <p className="mx-auto mb-8 max-w-xl text-text-secondary">{t("launcher.cta.subtitle")}</p>
              <button
                onClick={() => void handleDownload("installer")}
                disabled={isDownloading}
                className="inline-flex items-center gap-3 rounded-xl bg-primary px-8 py-4 text-lg font-bold text-black transition-all duration-300 hover:scale-105 hover:shadow-xl hover:shadow-primary/30"
              >
                <Download size={24} />
                {downloadComplete ? t("launcher.download.complete") : t("launcher.download.button")}
              </button>
              <button
                onClick={() => void handleDownload("portable")}
                disabled={isDownloading}
                className="ml-3 inline-flex items-center gap-3 rounded-xl border border-primary/40 bg-background-elevated px-8 py-4 text-lg font-bold text-primary transition-all duration-300 hover:scale-105 hover:bg-primary/10 disabled:opacity-60"
              >
                <Download size={24} />
                Portable (.zip)
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
          <div className="flex items-center gap-3">
            <img src="/OTOSHI_icon.png" alt="Otoshi" className="h-6 w-6" {...getMediaProtectionProps()} />
            <span className="text-sm text-text-muted">{t("launcher.footer.copyright")}</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-text-muted">
            <Link to="/privacy-policy" className="transition hover:text-text-primary">
              {t("policy.privacy_title")}
            </Link>
            <Link to="/terms-of-service" className="transition hover:text-text-primary">
              {t("policy.terms_title")}
            </Link>
            <button type="button" onClick={() => void openExternal("https://discord.gg/6q7YRdWGZJ")} className="transition hover:text-text-primary">
              {t("common.discord")}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
