import { useEffect, useMemo, useState } from "react";
import { fetchSteamGridAssets } from "../../services/api";
import { useLocale } from "../../context/LocaleContext";
import { FixEntry } from "../../types";
import Badge from "../common/Badge";

const PLACEHOLDER_STEAM_APP_PATTERN = /^steam app\s+\d+$/i;
const TITLE_SUFFIX_PATTERN =
  /\b(demo|showcase|trial|prologue|playtest|benchmark|alpha|beta|open\s*beta|closed\s*beta|technical\s*test|test\s*server|edition|deluxe|ultimate|goty|remaster|remastered|enhanced)\b.*$/i;

function isPlaceholderTitle(value?: string | null, appId?: string) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (PLACEHOLDER_STEAM_APP_PATTERN.test(text)) return true;
  const normalizedAppId = String(appId || "").trim();
  if (!normalizedAppId) return false;
  const lowered = text.toLowerCase();
  return lowered === normalizedAppId.toLowerCase() || lowered === `steam app ${normalizedAppId}`.toLowerCase();
}

function normalizeTitleForLookup(value: string): string {
  const cleaned = value.replace(/[™®©]/g, "").trim();
  if (!cleaned) return "";
  const trimmed = cleaned.replace(TITLE_SUFFIX_PATTERN, "").trim().replace(/[-:]+$/, "").trim();
  return trimmed || cleaned;
}

function buildLookupTitles(entry: FixEntry, preferredTitle: string): string[] {
  const optionNames = entry.options
    .map((option) => String(option.name || "").trim())
    .filter((value) => value.length > 0);

  const rawCandidates = [
    preferredTitle,
    ...optionNames,
    String(entry.name || "").trim(),
    String(entry.steam?.name || "").trim(),
  ];

  const normalized = rawCandidates
    .map((value) => normalizeTitleForLookup(value))
    .filter((value) => value.length > 0);
  const merged = [...rawCandidates, ...normalized]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const output: string[] = [];
  const seen = new Set<string>();
  for (const candidate of merged) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }
  return output;
}

export default function FixEntryCard({
  entry,
  onOpen
}: {
  entry: FixEntry;
  onOpen: (entry: FixEntry) => void;
}) {
  const { t } = useLocale();
  const [gridImage, setGridImage] = useState<string | null>(null);
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${entry.appId}`;
  const fallbackGrid = `${base}/library_600x900.jpg`;
  const fallbackLogo = `${base}/logo.png`;
  const title = useMemo(() => {
    const optionNames = entry.options
      .map((option) => String(option.name || "").trim())
      .filter((value) => value.length > 0);
    const candidates = [entry.name, ...optionNames, entry.steam?.name];
    for (const candidate of candidates) {
      if (!isPlaceholderTitle(candidate, entry.appId)) {
        return String(candidate || "").trim();
      }
    }
    for (const candidate of candidates) {
      const text = String(candidate || "").trim();
      if (text) return text;
    }
    return `Steam App ${entry.appId}`;
  }, [entry.appId, entry.name, entry.options, entry.steam?.name]);
  const lookupTitles = useMemo(
    () => buildLookupTitles(entry, title),
    [entry, title]
  );
  const description = entry.steam?.shortDescription || "";
  const baseImage =
    gridImage ||
    entry.steam?.artwork?.t3 ||
    entry.steam?.artwork?.t2 ||
    entry.steam?.headerImage ||
    entry.steam?.capsuleImage ||
    entry.steam?.background ||
    fallbackGrid;
  const resolvedLogo = logoImage || entry.steam?.artwork?.t0 || fallbackLogo;
  const hasDenuvo = Boolean(entry.denuvo ?? entry.steam?.denuvo);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [baseImage]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      for (const candidate of lookupTitles) {
        const asset = await fetchSteamGridAssets(candidate, entry.appId).catch(() => null);
        if (!mounted || !asset) continue;
        if (asset.grid || asset.hero || asset.logo || asset.icon) {
          setGridImage(asset.grid ?? asset.hero ?? null);
          setLogoImage(asset.logo ?? asset.icon ?? null);
          return;
        }
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [entry.appId, lookupTitles]);

  return (
    <div className="rounded-2xl border border-background-border bg-background-elevated p-4">
      <button
        onClick={() => onOpen(entry)}
        className="group flex w-full flex-col text-left"
      >
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-background-border bg-background-surface shadow-soft">
          <div
            className={`absolute inset-0 bg-gradient-to-br from-background-muted via-background-surface to-background-elevated transition-opacity duration-500 animate-pulse ${
              imageLoaded && !imageError ? "opacity-0" : "opacity-100"
            }`}
            aria-hidden
          />
          {baseImage && (
            <img
              src={baseImage}
              alt={title}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
              className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.04] ${
                imageLoaded && !imageError ? "opacity-100" : "opacity-0"
              }`}
            />
          )}
          {hasDenuvo && (
            <div className="absolute left-3 top-3">
              <Badge label="Denuvo" tone="danger" />
            </div>
          )}
          {resolvedLogo && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/60 to-transparent p-3">
              <img
                src={resolvedLogo}
                alt={`${title} logo`}
                className="h-6 w-auto max-w-full"
              />
            </div>
          )}
        </div>
        <div className="mt-3 space-y-1">
          <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted">
            {t("crack.fix_library")}
          </p>
          <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
          {description && (
            <p className="text-xs text-text-secondary">
              {description}
            </p>
          )}
        </div>
      </button>
    </div>
  );
}
