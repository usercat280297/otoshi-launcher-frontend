import { ExternalLink, Package } from "lucide-react";
import { useMemo, useState } from "react";
import type { SteamDLC, SteamPrice } from "../../types";
import { openExternal } from "../../utils/openExternal";

function formatDLCPrice(price?: SteamPrice | null): string {
  if (!price) return "Free";
  if (price.finalFormatted) return price.finalFormatted;
  if (price.formatted) return price.formatted;
  if (price.final != null) {
    return `$${(price.final / 100).toFixed(2)}`;
  }
  return "Free";
}

type DLCSectionProps = {
  dlcList: SteamDLC[];
  appId: string;
  gameName: string;
};

const placeholderSvg = (label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#1b1f2a"/>
          <stop offset="100%" stop-color="#2d3444"/>
        </linearGradient>
      </defs>
      <rect width="240" height="140" rx="12" fill="url(#g)"/>
      <rect x="18" y="18" width="204" height="104" rx="10" fill="#11151d" opacity="0.65"/>
      <text x="120" y="80" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" fill="#a7b0c3" letter-spacing="2">${label}</text>
    </svg>`
  )}`;

function buildDlcImageCandidates(appId: string, headerImage?: string | null) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return [
    headerImage ?? undefined,
    `${base}/capsule_184x69.jpg`,
    `${base}/capsule_sm_120.jpg`,
    `${base}/library_600x900.jpg`,
    `${base}/header.jpg`,
    placeholderSvg("DLC"),
  ].filter(Boolean) as string[];
}

function DLCImage({ dlc }: { dlc: SteamDLC }) {
  const candidates = useMemo(
    () => buildDlcImageCandidates(dlc.appId, dlc.headerImage ?? undefined),
    [dlc.appId, dlc.headerImage]
  );
  const [index, setIndex] = useState(0);
  const src = candidates[index];

  if (!src) {
    return (
      <div className="flex h-14 w-24 flex-shrink-0 items-center justify-center rounded-md bg-background-muted">
        <Package size={20} className="text-text-muted" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={dlc.name}
      className="h-14 w-24 flex-shrink-0 rounded-md object-cover transition-transform duration-200 group-hover:scale-105"
      loading="lazy"
      onError={() => {
        if (index < candidates.length - 1) {
          setIndex(index + 1);
        }
      }}
    />
  );
}

export default function DLCSection({ dlcList, appId, gameName }: DLCSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!dlcList || dlcList.length === 0) {
    return null;
  }

  const displayDlc = expanded ? dlcList : dlcList.slice(0, 9);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-accent-blue" />
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
            Downloadable Content
          </p>
        </div>
        <span className="text-xs text-text-muted">{dlcList.length} DLC available</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {displayDlc.map((dlc) => (
          <button
            type="button"
            key={dlc.appId}
            onClick={() => void openExternal(`https://store.steampowered.com/app/${dlc.appId}`)}
            className="group flex items-center gap-3 rounded-lg border border-background-border bg-background-surface p-3 transition-all duration-200 hover:border-primary hover:bg-primary/5 hover:scale-[1.02] hover:shadow-lg text-left"
          >
            <DLCImage dlc={dlc} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-primary transition-colors group-hover:text-primary">
                {dlc.name}
              </p>
              <p className="text-xs text-text-muted">{formatDLCPrice(dlc.price)}</p>
              {dlc.releaseDate && (
                <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted">
                  {dlc.releaseDate}
                </p>
              )}
              <p className="mt-1 text-xs text-text-muted line-clamp-2">
                {dlc.description || "Additional content for this game."}
              </p>
            </div>
            <ExternalLink size={14} className="flex-shrink-0 text-text-muted opacity-0 transition group-hover:opacity-100" />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4">
        {dlcList.length > 9 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary transition hover:underline"
          >
            {expanded ? "Show less" : `Show all ${dlcList.length} DLC`}
          </button>
        )}
        <button
          type="button"
          onClick={() => void openExternal(`https://store.steampowered.com/dlc/${appId}/${encodeURIComponent(gameName.replace(/\s+/g, "_"))}/`)}
          className="inline-flex items-center gap-1 text-xs text-text-muted transition hover:text-text-primary"
        >
          View on Steam
          <ExternalLink size={11} />
        </button>
      </div>
    </div>
  );
}
