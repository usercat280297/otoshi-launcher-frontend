import { useEffect, useState } from "react";
import { fetchSteamGridAssets } from "../../services/api";
import { useLocale } from "../../context/LocaleContext";
import { FixEntry } from "../../types";
import Badge from "../common/Badge";

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
  const title = entry.steam?.name || entry.name;
  const description = entry.steam?.shortDescription || "";
  const baseImage =
    gridImage ||
    entry.steam?.headerImage ||
    entry.steam?.capsuleImage ||
    fallbackGrid;
  const hasDenuvo = Boolean(entry.denuvo ?? entry.steam?.denuvo);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [baseImage]);

  useEffect(() => {
    let mounted = true;
    fetchSteamGridAssets(title, entry.appId)
      .then((asset) => {
        if (!mounted || !asset) return;
        setGridImage(asset.grid ?? null);
        setLogoImage(asset.logo ?? null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [entry.appId, title]);

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
          {(logoImage || fallbackLogo) && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/60 to-transparent p-3">
              <img
                src={logoImage || fallbackLogo}
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
