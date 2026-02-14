import { AnimatePresence, motion } from "framer-motion";
import { ShoppingCart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Game } from "../../types";
import Button from "../common/Button";
import { useLocale } from "../../context/LocaleContext";

type HeroProps = {
  game: Game;
  rail: Game[];
  onOpen: (game: Game) => void;
  autoAdvanceMs?: number;
  slides?: Game[];
};

const heroVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } }
};

const railContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.02 } }
};

const railItem = {
  hidden: { opacity: 0, x: 8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.2 } }
};

export default function Hero({
  game,
  rail,
  onOpen,
  autoAdvanceMs = 7000,
  slides
}: HeroProps) {
  const { t } = useLocale();

  const playlist = useMemo(() => {
    const base = slides && slides.length ? slides : [game, ...rail];
    const seen = new Set<string>();
    return base.filter((item) => {
      if (!item) return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [game, rail, slides]);

  const [activeIndex, setActiveIndex] = useState(0);
  const prefetchedRef = useRef(new Set<string>());
  useEffect(() => {
    const idx = playlist.findIndex((item) => item.id === game.id);
    setActiveIndex(idx >= 0 ? idx : 0);
  }, [game.id, playlist]);

  useEffect(() => {
    if (playlist.length <= 1) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((prev) => (prev + 1) % playlist.length);
    }, autoAdvanceMs);
    return () => window.clearTimeout(timer);
  }, [activeIndex, autoAdvanceMs, playlist.length]);

  const activeGame = playlist[activeIndex] ?? game;
  const discounted = activeGame.discountPercent > 0;
  const price = (activeGame.price * (1 - activeGame.discountPercent / 100)).toFixed(2);
  const displayPrice = activeGame.price <= 0 ? t("common.free") : `$${price}`;
  const slidesForRail = playlist.slice(0, 5);

  useEffect(() => {
    slidesForRail.forEach((item) => {
      const src = item.iconImage || item.headerImage || item.capsuleImage || item.heroImage;
      if (!src || prefetchedRef.current.has(src)) return;
      prefetchedRef.current.add(src);
      const img = new Image();
      img.src = src;
    });
  }, [slidesForRail]);

  return (
    <motion.section
      className="grid gap-6 lg:grid-cols-[2.2fr_1fr]"
      variants={heroVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.35 }}
    >
      <div className="relative min-h-[360px] overflow-hidden rounded-2xl border border-background-border bg-background-elevated shadow-panel">
        <AnimatePresence mode="wait">
          <motion.img
            key={activeGame.id}
            src={activeGame.heroImage}
            alt={activeGame.title}
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            loading="eager"
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" />
        <div className="relative z-10 flex h-full flex-col justify-end gap-4 px-8 py-8">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-text-muted">
              {t("store.featured")}
            </p>
            {activeGame.logoImage ? (
              <motion.img
                key={`${activeGame.id}-logo`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                src={activeGame.logoImage}
                alt={`${activeGame.title} logo`}
                className="mt-3 h-16 w-auto max-w-[320px] object-contain"
              />
            ) : (
              <motion.h2
                key={`${activeGame.id}-title`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 text-3xl font-semibold leading-tight md:text-4xl"
              >
                {activeGame.title}
              </motion.h2>
            )}
          </div>
          <p className="max-w-xl text-sm text-text-secondary md:text-base">
            {activeGame.shortDescription || activeGame.tagline}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black">
              {t("action.save_now")}
            </button>
            <Button size="sm" variant="secondary" icon={<ShoppingCart size={14} />}>
              {discounted ? displayPrice : `$${activeGame.price.toFixed(2)}`}
            </Button>
            <button
              onClick={() => onOpen(activeGame)}
              className="text-xs font-semibold uppercase tracking-[0.3em] text-text-secondary transition hover:text-text-primary"
            >
              {t("action.learn_more")}
            </button>
          </div>
        </div>
      </div>

      <motion.div className="space-y-3" variants={railContainer} initial="hidden" animate="show">
        <div className="flex items-center justify-between">
          <span className="epic-pill">{t("store.top_picks")}</span>
          <span className="text-xs uppercase tracking-[0.3em] text-text-muted">
            {t("store.this_week")}
          </span>
        </div>
        <div className="space-y-3">
          {slidesForRail.map((item, index) => {
            const isActive = item.id === activeGame.id;
            return (
              <motion.button
                variants={railItem}
                key={item.id}
                onClick={() => {
                  if (isActive) {
                    onOpen(item);
                    return;
                  }
                  setActiveIndex(index);
                }}
                className={`relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3 py-3 text-left transition ${
                  isActive
                    ? "border-primary bg-background-surface"
                    : "border-background-border bg-background-elevated hover:border-primary"
                }`}
              >
                {isActive && playlist.length > 1 && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
                    <motion.div
                      key={`fill-${activeIndex}`}
                      initial={{ width: "0%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: autoAdvanceMs / 1000, ease: "linear" }}
                      className="h-full bg-white/10"
                    />
                  </div>
                )}
                <div className="relative z-10 flex w-full items-center gap-3">
                  <img
                    src={item.iconImage || item.headerImage || item.capsuleImage}
                    alt={item.title}
                    className="h-14 w-14 rounded-lg object-cover"
                    loading="eager"
                    decoding="async"
                  />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-text-muted">
                      {item.price <= 0 ? t("common.free") : `$${item.price.toFixed(2)}`}
                    </p>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </motion.section>
  );
}
