import { Game } from "../types";

const NEWS_LIMIT = 8;
const IMAGE_PLACEHOLDER = "/icons/game-placeholder.svg";
export const STORE_NEWS_PAYLOAD_CACHE_KEY = "otoshi.store.news.payload.v1";
export const STORE_NEWS_AUTO_OPEN_SESSION_KEY = "otoshi.store.news.auto_open.session.v1";
// v2 resets stale badge state from older releases where seen alerts could be incomplete.
export const STORE_NEWS_SEEN_ALERTS_KEY = "otoshi.store.news.seen_alerts.v2";
export const STORE_NEWS_AUTO_NOTIFY_SESSION_KEY = "otoshi.store.news.auto_notify.session.v1";

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

export function hasStoreNewsContent(payload: StoreNewsPayload): boolean {
  return payload.newReleases.length > 0 || payload.topDiscounts.length > 0;
}

export function serializeStoreNewsPayload(payload: StoreNewsPayload): string {
  return encodeURIComponent(JSON.stringify(payload));
}

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

function buildAlertId(kind: "release" | "discount", entry: StoreNewsEntry): string {
  if (kind === "release") {
    return `release:${entry.id}:${entry.releaseDate || "n/a"}`;
  }
  const percent = Number.isFinite(entry.discountPercent) ? entry.discountPercent : 0;
  const price = Number.isFinite(entry.price) ? entry.price : 0;
  return `discount:${entry.id}:${percent}:${price}`;
}

export function collectStoreNewsAlertIds(payload: StoreNewsPayload): string[] {
  const unique = new Set<string>();
  payload.newReleases.forEach((entry) => unique.add(buildAlertId("release", entry)));
  payload.topDiscounts.forEach((entry) => unique.add(buildAlertId("discount", entry)));
  return Array.from(unique);
}

export function loadSeenStoreNewsAlertIds(): Set<string> {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const raw = window.localStorage.getItem(STORE_NEWS_SEEN_ALERTS_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((item) => typeof item === "string" && item.trim().length > 0));
  } catch {
    return new Set<string>();
  }
}

export function markStoreNewsAlertsSeen(payload: StoreNewsPayload): void {
  if (typeof window === "undefined") return;
  try {
    const seen = loadSeenStoreNewsAlertIds();
    collectStoreNewsAlertIds(payload).forEach((id) => seen.add(id));
    window.localStorage.setItem(STORE_NEWS_SEEN_ALERTS_KEY, JSON.stringify(Array.from(seen)));
  } catch {
    // ignore storage failures
  }
}

export function countStoreNewsAlerts(payload: StoreNewsPayload): number {
  const allIds = collectStoreNewsAlertIds(payload);
  if (!allIds.length) return 0;
  if (typeof window !== "undefined") {
    const existing = window.localStorage.getItem(STORE_NEWS_SEEN_ALERTS_KEY);
    // First-time baseline: avoid showing a noisy badge for historical data.
    if (!existing) {
      try {
        window.localStorage.setItem(STORE_NEWS_SEEN_ALERTS_KEY, JSON.stringify(allIds));
      } catch {
        // ignore storage failures
      }
      return 0;
    }
  }
  const seen = loadSeenStoreNewsAlertIds();
  let unread = 0;
  for (const id of allIds) {
    if (!seen.has(id)) {
      unread += 1;
    }
  }
  return unread;
}
