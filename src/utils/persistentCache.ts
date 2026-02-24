type PersistentCacheEntry<T> = {
  value: T;
  updatedAt: number;
  expiresAt: number;
};

type PersistentCacheState<T> = {
  version: 1;
  entries: Record<string, PersistentCacheEntry<T>>;
};

type PersistentCacheWriteOptions = {
  ttlMs: number;
  maxEntries: number;
};

const CACHE_VERSION = 1 as const;

const canUseStorage = () =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const readState = <T,>(storageKey: string): PersistentCacheState<T> => {
  if (!canUseStorage()) {
    return { version: CACHE_VERSION, entries: {} };
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { version: CACHE_VERSION, entries: {} };
    }
    const parsed = JSON.parse(raw) as PersistentCacheState<T> | null;
    if (!parsed || parsed.version !== CACHE_VERSION || typeof parsed.entries !== "object") {
      return { version: CACHE_VERSION, entries: {} };
    }
    return parsed;
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
};

const pruneExpired = <T,>(state: PersistentCacheState<T>, now = Date.now()) => {
  let changed = false;
  for (const [entryKey, entry] of Object.entries(state.entries)) {
    if (!entry || typeof entry !== "object" || Number(entry.expiresAt) <= now) {
      delete state.entries[entryKey];
      changed = true;
    }
  }
  return changed;
};

const keepNewestEntries = <T,>(state: PersistentCacheState<T>, maxEntries: number) => {
  const keys = Object.keys(state.entries);
  if (keys.length <= maxEntries) return false;
  const ordered = keys.sort(
    (left, right) =>
      Number(state.entries[right]?.updatedAt || 0) -
      Number(state.entries[left]?.updatedAt || 0)
  );
  const toDelete = ordered.slice(Math.max(0, maxEntries));
  for (const key of toDelete) {
    delete state.entries[key];
  }
  return toDelete.length > 0;
};

const writeState = <T,>(storageKey: string, state: PersistentCacheState<T>, maxEntries: number) => {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    return;
  } catch {
    // Best effort: trim more aggressively and retry once when quota is tight.
  }
  try {
    keepNewestEntries(state, Math.max(1, Math.floor(maxEntries / 2)));
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
};

export function readPersistentCacheValue<T>(
  storageKey: string,
  entryKey: string
): T | null {
  if (!entryKey) return null;
  const state = readState<T>(storageKey);
  const now = Date.now();
  const changedByExpiry = pruneExpired(state, now);
  const entry = state.entries[entryKey];
  if (!entry || Number(entry.expiresAt) <= now) {
    if (state.entries[entryKey]) {
      delete state.entries[entryKey];
      writeState(storageKey, state, 1);
      return null;
    }
    if (changedByExpiry) {
      writeState(storageKey, state, 1);
    }
    return null;
  }
  if (changedByExpiry) {
    writeState(storageKey, state, Object.keys(state.entries).length || 1);
  }
  return entry.value;
}

export function writePersistentCacheValue<T>(
  storageKey: string,
  entryKey: string,
  value: T,
  options: PersistentCacheWriteOptions
) {
  if (!entryKey || options.ttlMs <= 0 || options.maxEntries <= 0) return;
  const now = Date.now();
  const state = readState<T>(storageKey);
  pruneExpired(state, now);
  state.entries[entryKey] = {
    value,
    updatedAt: now,
    expiresAt: now + options.ttlMs,
  };
  keepNewestEntries(state, options.maxEntries);
  writeState(storageKey, state, options.maxEntries);
}
