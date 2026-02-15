import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import Hls from "hls.js";
import type { MediaVideo } from "../../types";
import { getMediaProtectionProps } from "../../utils/mediaProtection";
import { useLocale } from "../../context/LocaleContext";

type MediaGalleryProps = {
  screenshots: string[];
  videos: MediaVideo[];
  className?: string;
};

type MediaItem =
  | { type: "video"; url: string; thumbnail: string; hls?: string | null; dash?: string | null }
  | { type: "image"; url: string };

export default function MediaGallery({ screenshots, videos, className }: MediaGalleryProps) {
  const { t } = useLocale();
  const media = useMemo<MediaItem[]>(() => {
    const videoItems = videos.map((video) => ({
      type: "video" as const,
      url: video.url,
      thumbnail: video.thumbnail,
      hls: video.hls ?? null,
      dash: video.dash ?? null
    }));
    const imageItems = screenshots.map((shot) => ({
      type: "image" as const,
      url: shot
    }));
    return [...videoItems, ...imageItems];
  }, [screenshots, videos]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isInView, setIsInView] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const waitingTimerRef = useRef<number | null>(null);
  const hasVideoStartedRef = useRef(false);
  const loadedVideoKeysRef = useRef<Set<string>>(new Set());

  const clearWaitingTimer = () => {
    if (waitingTimerRef.current !== null) {
      window.clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
  };

  const scheduleBufferingOverlay = () => {
    clearWaitingTimer();
    waitingTimerRef.current = window.setTimeout(() => {
      setVideoLoading(true);
      waitingTimerRef.current = null;
    }, 320);
  };

  useEffect(() => {
    if (isInView) {
      return;
    }
    const target = containerRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px", threshold: 0.01 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [isInView]);

  const current = media[activeIndex];
  const currentVideo = current?.type === "video" ? current : null;
  const currentVideoKey =
    currentVideo ? `${currentVideo.hls ?? ""}::${currentVideo.url}` : null;
  const currentVideoAlreadyLoaded = Boolean(
    currentVideoKey && loadedVideoKeysRef.current.has(currentVideoKey)
  );
  const shouldLoadVideo = isInView && Boolean(currentVideo);
  const canUseHls = Boolean(
    shouldLoadVideo && currentVideo?.hls && !currentVideo?.url && Hls.isSupported()
  );

  useEffect(() => {
    if (!current) return;
    if (current.type === "video") {
      clearWaitingTimer();
      hasVideoStartedRef.current = currentVideoAlreadyLoaded;
      setVideoLoading(shouldLoadVideo && !currentVideoAlreadyLoaded);
      setImageLoading(false);
      return;
    }
    clearWaitingTimer();
    setImageLoading(true);
    setVideoLoading(false);
  }, [current?.type, current?.url, currentVideoAlreadyLoaded, shouldLoadVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (!shouldLoadVideo || !currentVideo) {
      clearWaitingTimer();
      setVideoLoading(false);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      return;
    }
    if (!currentVideoKey) {
      return;
    }
    if (video.dataset.mediaKey === currentVideoKey) {
      return;
    }
    video.dataset.mediaKey = currentVideoKey;
    if (canUseHls && currentVideo.hls) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(currentVideo.hls);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels.length > 0) {
          const highest = hls.levels.length - 1;
          hls.currentLevel = highest;
          hls.nextLevel = highest;
          hls.loadLevel = highest;
        }
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return;
        }
        hls.destroy();
        hlsRef.current = null;
        if (currentVideo.url) {
          video.src = currentVideo.url;
          video.load();
        }
      });
      return () => {
        clearWaitingTimer();
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (currentVideo.hls && !currentVideo.url && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = currentVideo.hls;
      video.load();
      return;
    }
    if (currentVideo.url) {
      video.src = currentVideo.url;
      video.load();
    }
  }, [
    canUseHls,
    currentVideo?.hls,
    currentVideo?.url,
    currentVideoKey,
    shouldLoadVideo
  ]);

  useEffect(() => () => clearWaitingTimer(), []);

  if (!current) {
    return (
      <div className="glass-panel flex h-80 items-center justify-center text-sm text-text-secondary">
        Media is still loading for this title.
      </div>
    );
  }

  const goPrevious = () => {
    setActiveIndex((prev) => (prev === 0 ? media.length - 1 : prev - 1));
  };

  const goNext = () => {
    setActiveIndex((prev) => (prev === media.length - 1 ? 0 : prev + 1));
  };

  const containerClassName = ["space-y-4", className].filter(Boolean).join(" ");
  const markVideoReady = () => {
    clearWaitingTimer();
    if (currentVideoKey) {
      loadedVideoKeysRef.current.add(currentVideoKey);
    }
    hasVideoStartedRef.current = true;
    setVideoLoading(false);
  };

  return (
    <div ref={containerRef} className={containerClassName}>
      <div className="group relative aspect-video overflow-hidden rounded-lg border border-background-border bg-background-muted">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            {current.type === "video" ? (
              <video
                ref={videoRef}
                poster={current.thumbnail}
                controls
                preload={shouldLoadVideo ? "auto" : "metadata"}
                className="h-full w-full object-cover"
                controlsList="nodownload"
                disablePictureInPicture
                onLoadStart={() => {
                  if (
                    shouldLoadVideo &&
                    currentVideoKey &&
                    !loadedVideoKeysRef.current.has(currentVideoKey)
                  ) {
                    setVideoLoading(true);
                  }
                }}
                onWaiting={() => {
                  if (!shouldLoadVideo) {
                    return;
                  }
                  const videoEl = videoRef.current;
                  if (videoEl?.paused) {
                    return;
                  }
                  if (hasVideoStartedRef.current) {
                    return;
                  }
                  if (videoEl.currentTime > 0.01) {
                    return;
                  }
                  scheduleBufferingOverlay();
                }}
                onCanPlay={markVideoReady}
                onCanPlayThrough={markVideoReady}
                onPlaying={markVideoReady}
                onLoadedData={markVideoReady}
                onError={() => {
                  clearWaitingTimer();
                  setVideoLoading(false);
                }}
                {...getMediaProtectionProps()}
              />
            ) : (
              <img
                src={current.url}
                alt="Screenshot"
                onLoad={() => setImageLoading(false)}
                onError={() => setImageLoading(false)}
                className="h-full w-full object-cover"
                {...getMediaProtectionProps()}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {(current.type === "video" ? videoLoading : imageLoading) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm">
            <div className="flex items-center gap-3 text-sm text-text-secondary">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span>
                {current.type === "video"
                  ? t("media.loading_video")
                  : t("media.loading_image")}
              </span>
            </div>
          </div>
        )}

        {media.length > 1 && (
          <>
            <button
              onClick={goPrevious}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-background-border bg-background/80 p-2 text-text-secondary opacity-100 transition hover:text-text-primary md:left-4 md:opacity-0 md:group-hover:opacity-100"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-background-border bg-background/80 p-2 text-text-secondary opacity-100 transition hover:text-text-primary md:right-4 md:opacity-0 md:group-hover:opacity-100"
            >
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-elegant md:gap-3">
        {media.map((item, index) => (
          <button
            key={`${item.type}-${index}`}
            onClick={() => setActiveIndex(index)}
            className={`relative h-16 w-24 flex-shrink-0 overflow-hidden rounded-lg border transition md:h-20 md:w-32 ${
              index === activeIndex
                ? "border-primary"
                : "border-transparent hover:border-background-border"
            }`}
          >
            <img
              src={item.type === "video" ? item.thumbnail : item.url}
              alt="Preview"
              className="h-full w-full object-cover"
              {...getMediaProtectionProps()}
            />
            {item.type === "video" && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                <Play size={18} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
