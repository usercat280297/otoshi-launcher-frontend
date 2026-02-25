import { Game } from "../types";

const NEWS_LIMIT = 8;
const IMAGE_PLACEHOLDER = "/icons/game-placeholder.svg";

type RankedGame = {
  game: Game;
  score: number;
};

export type StoreNewsEntry = {
  id: string;
  slug: string;
  steamAppId?: string;
  title: string;
  releaseDate: string;
  discountPercent: number;
  price: number;
  priceKnown?: boolean;
  priceLabel?: string | null;
  image: string;
};

export type StoreNewsPayload = {
  generatedAt: number;
  newReleases: StoreNewsEntry[];
  topDiscounts: StoreNewsEntry[];
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

export function pickRecentGames(games: Game[]): Game[] {
  const ranked: RankedGame[] = [];
  for (const game of games) {
    const ts = toReleaseTimestamp(game.releaseDate);
    if (!ts) continue;
    insertRanked(ranked, { game, score: ts }, NEWS_LIMIT);
  }
  return ranked.map((entry) => entry.game);
}

export function pickDiscountedGames(games: Game[]): Game[] {
  const ranked: RankedGame[] = [];
  for (const game of games) {
    if (!Number.isFinite(game.discountPercent) || game.discountPercent <= 0) continue;
    const score = game.discountPercent * 10_000 + Math.max(0, Number(game.rating) || 0);
    insertRanked(ranked, { game, score }, NEWS_LIMIT);
  }
  return ranked.map((entry) => entry.game);
}

export function resolveGameImage(game: Game): string {
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

function toEntry(game: Game): StoreNewsEntry {
  return {
    id: game.id,
    slug: game.slug,
    steamAppId: game.steamAppId,
    title: game.title,
    releaseDate: game.releaseDate,
    discountPercent: Number.isFinite(game.discountPercent) ? Number(game.discountPercent) : 0,
    price: Number.isFinite(game.price) ? Number(game.price) : 0,
    priceKnown: game.priceKnown,
    priceLabel: game.priceLabel,
    image: resolveGameImage(game),
  };
}

export function buildStoreNewsPayload(games: Game[]): StoreNewsPayload {
  return {
    generatedAt: Date.now(),
    newReleases: pickRecentGames(games).map(toEntry),
    topDiscounts: pickDiscountedGames(games).map(toEntry),
  };
}

export function countStoreNewsAlerts(payload: StoreNewsPayload): number {
  const unique = new Set<string>();
  payload.newReleases.forEach((game) => unique.add(game.id));
  payload.topDiscounts.forEach((game) => unique.add(game.id));
  return unique.size;
}
