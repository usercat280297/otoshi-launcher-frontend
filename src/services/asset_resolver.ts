type DownloadAssetInput = {
  gameId?: string;
  gameSlug?: string;
  appId?: string;
  title?: string;
  imageUrl?: string;
  iconUrl?: string;
};

export type ResolvedDownloadAsset = {
  title: string;
  imageUrl?: string;
  iconUrl?: string;
  source: "primary" | "cache" | "secondary" | "placeholder";
};

const CACHE_KEY = "otoshi.asset.download.v2";
const PLACEHOLDER_IMAGE = "/icons/epic-games-shield.svg";

const inMemoryCache = new Map<string, { imageUrl?: string; iconUrl?: string; title?: string }>();

const normalizeKey = (input: DownloadAssetInput): string | null => {
  const gameId = input.gameId?.trim();
  if (gameId) return `game:${gameId}`;
  const appId = input.appId?.trim();
  if (appId) return `steam:${appId}`;
  const slug = input.gameSlug?.trim();
  if (slug) return `slug:${slug.toLowerCase()}`;
  return null;
};

function readPersistentCache(): Record<string, { imageUrl?: string; iconUrl?: string; title?: string }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePersistentCache(payload: Record<string, { imageUrl?: string; iconUrl?: string; title?: string }>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota failures.
  }
}

function buildSecondaryUrls(appId?: string): { imageUrl?: string; iconUrl?: string } {
  const cleaned = appId?.trim();
  if (!cleaned) {
    return {};
  }
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${cleaned}`;
  return {
    imageUrl: `${base}/header.jpg`,
    iconUrl: `${base}/capsule_184x69.jpg`,
  };
}

export function rememberDownloadAsset(input: DownloadAssetInput) {
  const key = normalizeKey(input);
  if (!key) return;

  const next = {
    imageUrl: input.imageUrl || undefined,
    iconUrl: input.iconUrl || input.imageUrl || undefined,
    title: input.title || undefined,
  };
  inMemoryCache.set(key, next);
  const persisted = readPersistentCache();
  persisted[key] = next;
  writePersistentCache(persisted);
}

export function resolveDownloadAsset(input: DownloadAssetInput): ResolvedDownloadAsset {
  const key = normalizeKey(input);
  const title = (input.title || "").trim() || "Download";
  const primaryImage = input.imageUrl?.trim();
  const primaryIcon = (input.iconUrl || input.imageUrl || "").trim();

  if (primaryImage || primaryIcon) {
    return {
      title,
      imageUrl: primaryImage || primaryIcon || PLACEHOLDER_IMAGE,
      iconUrl: primaryIcon || primaryImage || PLACEHOLDER_IMAGE,
      source: "primary",
    };
  }

  if (key) {
    const memory = inMemoryCache.get(key);
    const persisted = readPersistentCache()[key];
    const cached = memory || persisted;
    if (cached?.imageUrl || cached?.iconUrl) {
      return {
        title: cached.title || title,
        imageUrl: cached.imageUrl || cached.iconUrl || PLACEHOLDER_IMAGE,
        iconUrl: cached.iconUrl || cached.imageUrl || PLACEHOLDER_IMAGE,
        source: "cache",
      };
    }
  }

  const secondary = buildSecondaryUrls(input.appId);
  if (secondary.imageUrl || secondary.iconUrl) {
    return {
      title,
      imageUrl: secondary.imageUrl || secondary.iconUrl || PLACEHOLDER_IMAGE,
      iconUrl: secondary.iconUrl || secondary.imageUrl || PLACEHOLDER_IMAGE,
      source: "secondary",
    };
  }

  return {
    title,
    imageUrl: PLACEHOLDER_IMAGE,
    iconUrl: PLACEHOLDER_IMAGE,
    source: "placeholder",
  };
}

