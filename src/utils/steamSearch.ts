import { SteamCatalogItem, SteamGameDetail } from "../types";

const DEMO_HINTS = [" demo", "playtest", " beta", " trial"];
const DLC_HINTS = [
  " dlc",
  "season pass",
  "expansion",
  "soundtrack",
  "costume",
  " pack",
  "add-on",
  " crossover",
  " collaboration",
];
const STEAM_PLACEHOLDER_NAME_PATTERN = /^steam app\s+\d+$/i;
const STEAM_FALLBACK_ART_PATTERN =
  /cdn\.cloudflare\.steamstatic\.com\/steam\/apps\/\d+\/(?:header\.jpg|capsule_616x353\.jpg|library_hero\.jpg|library_600x900\.jpg)(?:[?#].*)?$/i;
const DLC_NAME_HINTS = [
  /\bdlc\b/i,
  /\bseason pass\b/i,
  /\bexpansion\b/i,
  /\bsoundtrack\b/i,
  /\badd[- ]?on\b/i,
  /\bbonus\b/i,
  /\bcostume\b/i,
  /\bpack\b/i,
  /\bcrossover\b/i,
  /\bcollab(?:oration)?\b/i,
  /\bexpansion pass\b/i,
  /(?:^|\s)[x×✕](?:\s|$)/i,
];

export const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const hasAnyHint = (value: string, hints: string[]) => {
  const lowered = ` ${value.toLowerCase()} `;
  return hints.some((hint) => lowered.includes(hint));
};

export const isDemoQuery = (value: string) => hasAnyHint(value, DEMO_HINTS);

export const isDlcQuery = (value: string) => hasAnyHint(value, DLC_HINTS);

export const isDemoItem = (item: SteamCatalogItem) => {
  const type = String(item.itemType || "").toLowerCase();
  if (type.includes("demo") || type.includes("playtest")) return true;
  return hasAnyHint(item.name || "", DEMO_HINTS);
};

export const hasCatalogArtwork = (item: SteamCatalogItem) =>
  Boolean(
    item.artwork?.t3 ||
      item.artwork?.t2 ||
      item.artwork?.t1 ||
      item.headerImage ||
      item.capsuleImage ||
      item.background
  );

export const isPlaceholderCatalogTitle = (
  name?: string | null,
  appId?: string | null
): boolean => {
  const text = String(name || "").trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (STEAM_PLACEHOLDER_NAME_PATTERN.test(text)) return true;
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId) return false;
  const lowered = text.toLowerCase();
  return (
    lowered === normalizedAppId.toLowerCase() ||
    lowered === `steam app ${normalizedAppId}`.toLowerCase()
  );
};

export const isLikelyBrokenSteamFallbackUrl = (
  value?: string | null
): boolean => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed, "https://dummy.local");
    const embedded = parsed.searchParams.get("url");
    const resolved = embedded ? decodeURIComponent(embedded) : trimmed;
    return STEAM_FALLBACK_ART_PATTERN.test(resolved);
  } catch {
    return STEAM_FALLBACK_ART_PATTERN.test(trimmed);
  }
};

export const hasBrokenSteamFallbackArt = (item: SteamCatalogItem): boolean =>
  [
    item.artwork?.t3,
    item.artwork?.t2,
    item.artwork?.t1,
    item.headerImage,
    item.capsuleImage,
    item.background,
  ].some((value) => isLikelyBrokenSteamFallbackUrl(value));

export const isLikelyDlcName = (name?: string | null): boolean => {
  const normalized = String(name || "").trim();
  if (!normalized) return false;
  return DLC_NAME_HINTS.some((pattern) => pattern.test(normalized));
};

export const shouldEnrichSteamCatalogItemFromDetail = (
  item: SteamCatalogItem
): boolean => {
  const staleClassification =
    !Boolean(item.isDlc || item.itemType === "dlc") &&
    isLikelyDlcName(item.name);
  return (
    isPlaceholderCatalogTitle(item.name, item.appId) ||
    !hasCatalogArtwork(item) ||
    hasBrokenSteamFallbackArt(item) ||
    staleClassification
  );
};

const chooseString = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
};

export const mergeSteamCatalogItemFromDetail = (
  item: SteamCatalogItem,
  detail: SteamGameDetail
): SteamCatalogItem => {
  const detailName = chooseString(detail.name);
  const mergedName =
    detailName && !isPlaceholderCatalogTitle(detailName, item.appId)
      ? detailName
      : item.name;

  const resolvedHeader = chooseString(
    detail.artwork?.t3,
    detail.headerImage,
    detail.capsuleImage,
    item.artwork?.t3,
    item.headerImage,
    item.capsuleImage
  );
  const resolvedCapsule = chooseString(
    detail.artwork?.t2,
    detail.capsuleImage,
    detail.headerImage,
    item.artwork?.t2,
    item.capsuleImage,
    item.headerImage
  );
  const resolvedBackground = chooseString(
    detail.artwork?.t4,
    detail.background,
    detail.headerImage,
    item.artwork?.t4,
    item.background,
    item.headerImage
  );

  const detailMarkedAsDlc = Boolean(
    detail.isDlc || detail.itemType === "dlc" || isLikelyDlcName(mergedName)
  );
  const mergedItemTypeRaw = String(
    detail.itemType || item.itemType || (detailMarkedAsDlc ? "dlc" : "game")
  )
    .trim()
    .toLowerCase();
  const mergedItemType =
    detailMarkedAsDlc && mergedItemTypeRaw === "game"
      ? "dlc"
      : mergedItemTypeRaw || (detailMarkedAsDlc ? "dlc" : "game");

  return {
    ...item,
    name: mergedName,
    shortDescription: detail.shortDescription || item.shortDescription || null,
    headerImage: resolvedHeader || item.headerImage || null,
    capsuleImage: resolvedCapsule || item.capsuleImage || null,
    background: resolvedBackground || item.background || null,
    artwork: {
      ...(item.artwork || {}),
      ...(detail.artwork || {}),
      t0:
        chooseString(
          detail.artwork?.t0,
          item.artwork?.t0,
          detail.capsuleImage,
          detail.headerImage,
          item.capsuleImage,
          item.headerImage
        ) || null,
      t1:
        chooseString(
          detail.artwork?.t1,
          detail.artwork?.t2,
          item.artwork?.t1,
          resolvedCapsule,
          resolvedHeader
        ) || null,
      t2:
        chooseString(
          detail.artwork?.t2,
          item.artwork?.t2,
          resolvedCapsule,
          resolvedHeader
        ) || null,
      t3:
        chooseString(
          detail.artwork?.t3,
          item.artwork?.t3,
          resolvedHeader,
          resolvedCapsule
        ) || null,
      t4:
        chooseString(
          detail.artwork?.t4,
          item.artwork?.t4,
          resolvedBackground,
          resolvedHeader
        ) || null,
      version:
        Math.max(
          Number(item.artwork?.version || 1),
          Number(detail.artwork?.version || 1)
        ) + 1,
    },
    price: detail.price ?? item.price ?? null,
    genres:
      detail.genres && detail.genres.length > 0 ? detail.genres : item.genres ?? [],
    releaseDate: detail.releaseDate || item.releaseDate || null,
    platforms:
      detail.platforms && detail.platforms.length > 0
        ? detail.platforms
        : item.platforms ?? [],
    itemType: mergedItemType,
    isDlc: detailMarkedAsDlc,
    isBaseGame: !detailMarkedAsDlc,
    classificationConfidence:
      typeof detail.classificationConfidence === "number"
        ? detail.classificationConfidence
        : item.classificationConfidence,
    artworkCoverage: detail.artworkCoverage || item.artworkCoverage,
    dlcCount: Math.max(Number(item.dlcCount || 0), Number(detail.dlcCount || 0)),
  };
};

export async function enrichCatalogItemsWithDetail(
  items: SteamCatalogItem[],
  fetchDetail: (appId: string) => Promise<SteamGameDetail>,
  options?: { limit?: number; concurrency?: number }
): Promise<SteamCatalogItem[]> {
  const limit = Math.max(1, options?.limit ?? 16);
  const concurrency = Math.max(1, options?.concurrency ?? 3);
  const targets = items
    .filter((item) => shouldEnrichSteamCatalogItemFromDetail(item))
    .slice(0, limit);

  if (!targets.length) return items;

  const patches = new Map<string, SteamCatalogItem>();
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < targets.length) {
      const current = targets[cursor];
      cursor += 1;

      const appId = String(current.appId || "").trim();
      if (!appId) continue;

      try {
        const detail = await fetchDetail(appId);
        patches.set(appId, mergeSteamCatalogItemFromDetail(current, detail));
      } catch {
        // Keep existing catalog entry when detail lookup fails.
      }
    }
  });

  await Promise.all(workers);
  if (!patches.size) return items;

  return items.map((item) => {
    const appId = String(item.appId || "").trim();
    const patched = appId ? patches.get(appId) : undefined;
    return patched ?? item;
  });
}

const hasStrongNameMatch = (item: SteamCatalogItem, normalizedQuery: string) => {
  if (!normalizedQuery) return true;
  const normalizedName = normalizeSearchText(item.name || "");
  if (!normalizedName) return false;
  if (normalizedName === normalizedQuery) return true;
  if (normalizedName.startsWith(`${normalizedQuery} `)) return true;
  return false;
};

export function rankSteamSearchItems(
  items: SteamCatalogItem[],
  query: string,
  options?: { includeDlc?: boolean }
) {
  const normalizedQuery = normalizeSearchText(query);
  const queryWantsDemo = isDemoQuery(query);
  const queryWantsDlc = options?.includeDlc ?? isDlcQuery(query);

  const score = (item: SteamCatalogItem) => {
    const normalizedName = normalizeSearchText(item.name || "");
    const isDlc = Boolean(item.isDlc || item.itemType === "dlc");
    const demo = isDemoItem(item);
    const hasArtwork = hasCatalogArtwork(item);

    let value = 0;
    if (!normalizedQuery) {
      value += hasArtwork ? 4 : 0;
      value += isDlc ? 0 : 2;
      value += demo ? 0 : 2;
      return value;
    }

    if (normalizedName === normalizedQuery) value += 60;
    else if (normalizedName.startsWith(`${normalizedQuery} `)) value += 46;
    else if (normalizedName.startsWith(normalizedQuery)) value += 38;
    else if (normalizedName.includes(normalizedQuery)) value += 30;

    if (!queryWantsDlc && !isDlc) value += 8;
    if (!queryWantsDemo && !demo) value += 10;
    if (hasArtwork) value += 6;
    if (typeof item.classificationConfidence === "number") {
      value += Math.round(item.classificationConfidence * 4);
    }
    return value;
  };

  return [...items].sort((left, right) => {
    const delta = score(right) - score(left);
    if (delta !== 0) return delta;
    return String(left.appId).localeCompare(String(right.appId));
  });
}

export function mergeAndRankSteamSearchResults(
  primary: SteamCatalogItem[],
  fallback: SteamCatalogItem[],
  query: string,
  limit: number,
  options?: { includeDlc?: boolean }
) {
  const seen = new Set<string>();
  const merged: SteamCatalogItem[] = [];

  for (const item of [...primary, ...fallback]) {
    const key = String(item.appId || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return rankSteamSearchItems(merged, query, options).slice(0, Math.max(1, limit));
}

export function shouldUseSteamSearchFallback(
  primary: SteamCatalogItem[],
  query: string,
  limit: number
) {
  if (!primary.length) return true;

  const queryWantsDemo = isDemoQuery(query);
  const normalizedQuery = normalizeSearchText(query);
  const nonDemo = primary.filter((item) => !isDemoItem(item));

  if (!queryWantsDemo && nonDemo.length === 0) return true;
  if (primary.length < Math.max(3, Math.floor(limit * 0.5))) return true;
  if (
    normalizedQuery &&
    !primary.some((item) => {
      if (!queryWantsDemo && isDemoItem(item)) return false;
      return hasStrongNameMatch(item, normalizedQuery);
    })
  ) {
    return true;
  }

  return false;
}
