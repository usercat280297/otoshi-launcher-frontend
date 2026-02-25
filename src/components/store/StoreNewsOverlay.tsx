import { useMemo, useState } from "react";
import { ArrowUpRight, BellDot, Clock3, Tag } from "lucide-react";
import Modal from "../common/Modal";
import { Game } from "../../types";
import { useLocale } from "../../context/LocaleContext";

const NEWS_LIMIT = 8;
const IMAGE_PLACEHOLDER = "/icons/game-placeholder.svg";

type RankedGame = {
  game: Game;
  score: number;
};

function toReleaseTimestamp(value?: string | null): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function insertRanked(list: RankedGame[], next: RankedGame, limit: number) {
  let index = 0;
  while (index < list.length && list[index].score >= next.score) {
    index += 1;
  }
  list.splice(index, 0, next);
  if (list.length > limit) {
    list.length = limit;
  }
}

function pickRecentGames(games: Game[]): Game[] {
  const ranked: RankedGame[] = [];
  for (const game of games) {
    const ts = toReleaseTimestamp(game.releaseDate);
    if (!ts) continue;
    insertRanked(ranked, { game, score: ts }, NEWS_LIMIT);
  }
  return ranked.map((entry) => entry.game);
}

function pickDiscountedGames(games: Game[]): Game[] {
  const ranked: RankedGame[] = [];
  for (const game of games) {
    if (!Number.isFinite(game.discountPercent) || game.discountPercent <= 0) continue;
    const score = game.discountPercent * 10_000 + Math.max(0, Number(game.rating) || 0);
    insertRanked(ranked, { game, score }, NEWS_LIMIT);
  }
  return ranked.map((entry) => entry.game);
}

function resolveGameImage(game: Game): string {
  const candidates = [
    game.iconImage,
    game.capsuleImage,
    game.headerImage,
    game.heroImage,
    game.backgroundImage,
    IMAGE_PLACEHOLDER,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return IMAGE_PLACEHOLDER;
}

type StoreNewsOverlayProps = {
  games: Game[];
  onOpenGame: (game: Game) => void;
};

export default function StoreNewsOverlay({ games, onOpenGame }: StoreNewsOverlayProps) {
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(false);

  const recentGames = useMemo(() => pickRecentGames(games), [games]);
  const discountedGames = useMemo(() => pickDiscountedGames(games), [games]);

  const alertCount = useMemo(() => {
    const unique = new Set<string>();
    recentGames.forEach((game) => unique.add(game.id));
    discountedGames.forEach((game) => unique.add(game.id));
    return unique.size;
  }, [recentGames, discountedGames]);

  const formatReleaseDate = (value?: string | null) => {
    const ts = toReleaseTimestamp(value);
    if (!ts) {
      return locale === "vi" ? "Chua co ngay phat hanh" : "Release date unavailable";
    }
    return new Date(ts).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDiscountPrice = (game: Game) => {
    if (game.priceKnown === false) return game.priceLabel || t("common.price_unavailable");
    if (game.price <= 0) return t("common.free");
    return `$${(game.price * (1 - game.discountPercent / 100)).toFixed(2)}`;
  };

  const openGame = (game: Game) => {
    setOpen(false);
    onOpenGame(game);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group fixed right-4 top-1/2 z-[95] -translate-y-1/2 rounded-full border border-cyan-300/40 bg-background-elevated/95 p-3 text-cyan-200 shadow-[0_14px_34px_rgba(0,0,0,0.5)] backdrop-blur transition hover:border-cyan-200 hover:text-white"
        aria-label="Open store news overlay"
      >
        <BellDot size={20} />
        {alertCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-black">
            {alertCount > 99 ? "99+" : alertCount}
          </span>
        )}
      </button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={locale === "vi" ? "Bang tin game Steam" : "Steam News Overlay"}
        size="md"
      >
        <div className="space-y-6">
          <p className="text-sm text-text-secondary">
            {locale === "vi"
              ? "Tong hop game moi va game dang giam gia tu catalog hien tai."
              : "Quick feed for newly released and discounted games from your current catalog."}
          </p>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-text-muted">
              <Clock3 size={14} />
              <span>{locale === "vi" ? "Game moi" : "New Releases"}</span>
            </div>
            {recentGames.length === 0 ? (
              <p className="rounded-xl border border-background-border bg-background-muted px-4 py-3 text-sm text-text-secondary">
                {locale === "vi"
                  ? "Chua co du lieu ngay phat hanh de hien thi."
                  : "No release-date data available yet."}
              </p>
            ) : (
              <div className="space-y-2">
                {recentGames.map((game) => (
                  <button
                    key={`recent-${game.id}`}
                    type="button"
                    onClick={() => openGame(game)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-background-border bg-background-muted/60 px-3 py-2.5 text-left transition hover:border-cyan-300/50 hover:bg-background-muted"
                  >
                    <img
                      src={resolveGameImage(game)}
                      alt={game.title}
                      className="h-12 w-12 rounded-md object-cover ring-1 ring-white/10"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">{game.title}</p>
                      <p className="text-xs text-text-secondary">
                        {locale === "vi" ? "Phat hanh" : "Released"}: {formatReleaseDate(game.releaseDate)}
                      </p>
                    </div>
                    <ArrowUpRight size={14} className="text-text-muted transition group-hover:text-cyan-200" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-text-muted">
              <Tag size={14} />
              <span>{locale === "vi" ? "Dang giam gia" : "Top Discounts"}</span>
            </div>
            {discountedGames.length === 0 ? (
              <p className="rounded-xl border border-background-border bg-background-muted px-4 py-3 text-sm text-text-secondary">
                {locale === "vi" ? "Chua co game giam gia." : "No discounted games right now."}
              </p>
            ) : (
              <div className="space-y-2">
                {discountedGames.map((game) => (
                  <button
                    key={`discount-${game.id}`}
                    type="button"
                    onClick={() => openGame(game)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-background-border bg-background-muted/60 px-3 py-2.5 text-left transition hover:border-cyan-300/50 hover:bg-background-muted"
                  >
                    <img
                      src={resolveGameImage(game)}
                      alt={game.title}
                      className="h-12 w-12 rounded-md object-cover ring-1 ring-white/10"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">{game.title}</p>
                      <p className="text-xs text-text-secondary">
                        -{Math.round(game.discountPercent)}% | {formatDiscountPrice(game)}
                      </p>
                    </div>
                    <ArrowUpRight size={14} className="text-text-muted transition group-hover:text-cyan-200" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </Modal>
    </>
  );
}
