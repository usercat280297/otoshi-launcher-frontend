import { ReactNode, SyntheticEvent, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { NavLink } from "react-router-dom";
import { SearchSuggestion } from "../../types";
import { useLocale } from "../../context/LocaleContext";

type StoreSubnavProps = {
  placeholder?: string;
  activeTab?: "discover" | "browse" | "steam" | "news";
  searchValue?: string;
  searchLoading?: boolean;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
  suggestions?: SearchSuggestion[];
  onSuggestionSelect?: (suggestion: SearchSuggestion) => void;
  onViewAllResults?: () => void;
  hideSearch?: boolean;
};

const SEARCH_IMAGE_PLACEHOLDER = "/icons/game-placeholder.svg";

function decodeEmbeddedThumbnail(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const original = parsed.searchParams.get("url");
    if (!original) return null;
    const decoded = decodeURIComponent(original);
    return decoded && decoded !== url ? decoded : null;
  } catch {
    return null;
  }
}

function pushCandidate(target: string[], value?: string | null) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (target.includes(trimmed)) return;
  target.push(trimmed);
}

function buildImageCandidates(item: SearchSuggestion): string[] {
  const candidates: string[] = [];
  const values = [
    ...(Array.isArray(item.imageCandidates) ? item.imageCandidates : []),
    item.image,
  ];
  for (const value of values) {
    pushCandidate(candidates, value);
    if (typeof value === "string") {
      pushCandidate(candidates, decodeEmbeddedThumbnail(value));
    }
  }

  const appId = String(item.appId || "").trim();
  if (/^\d+$/.test(appId)) {
    const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
    pushCandidate(candidates, `${base}/capsule_sm_120.jpg`);
    pushCandidate(candidates, `${base}/capsule_184x69.jpg`);
    pushCandidate(candidates, `${base}/capsule_231x87.jpg`);
    pushCandidate(candidates, `${base}/capsule_616x353.jpg`);
    pushCandidate(candidates, `${base}/header.jpg`);
    pushCandidate(candidates, `${base}/library_600x900.jpg`);
    pushCandidate(candidates, `${base}/icon.jpg`);
  }

  pushCandidate(candidates, SEARCH_IMAGE_PLACEHOLDER);
  return candidates;
}

export default function StoreSubnav({
  placeholder,
  activeTab,
  searchValue,
  searchLoading = false,
  onSearchChange,
  onSearchSubmit,
  suggestions,
  onSuggestionSelect,
  onViewAllResults,
  hideSearch = false
}: StoreSubnavProps) {
  const { t } = useLocale();

  const handlePreviewImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const encoded = img.dataset.candidates || "";
    if (!encoded) {
      img.src = SEARCH_IMAGE_PLACEHOLDER;
      return;
    }
    const candidates = encoded.split("||").map((value) => value.trim()).filter(Boolean);
    if (!candidates.length) {
      img.src = SEARCH_IMAGE_PLACEHOLDER;
      return;
    }
    const currentIndex = Number(img.dataset.candidateIndex || "0");
    const nextIndex = Number.isFinite(currentIndex) ? currentIndex + 1 : 1;
    const next = candidates[nextIndex];
    if (next) {
      img.dataset.candidateIndex = String(nextIndex);
      img.src = next;
      return;
    }
    img.dataset.candidateIndex = String(candidates.length);
    img.src = SEARCH_IMAGE_PLACEHOLDER;
  };

  const tabs = useMemo(() => [
    { key: "discover", label: t("nav.discover"), to: "/discover" },
    { key: "browse", label: t("store.browse"), to: "/store" },
    { key: "steam", label: t("store.steam_vault"), to: "/steam" },
    { key: "news", label: t("store.news"), to: "/community" }
  ], [t]);

  const searchPlaceholder = placeholder || t("store.search_placeholder");
  const [open, setOpen] = useState(false);
  const isControlled = typeof searchValue === "string";
  const queryForHighlight = String(searchValue || "").trim();
  const { historyItems, popularItems, resultItems } = useMemo(() => {
    const history = (suggestions || []).filter((item) => item.kind === "history");
    const popular = (suggestions || []).filter((item) => item.kind === "popular");
    const results = (suggestions || []).filter((item) => item.kind === "result");
    return { historyItems: history, popularItems: popular, resultItems: results };
  }, [suggestions]);
  const topResults = useMemo(() => resultItems.slice(0, 4), [resultItems]);
  const hasSuggestions =
    historyItems.length > 0 || popularItems.length > 0 || resultItems.length > 0;

  const renderHighlight = (text: string): ReactNode => {
    const query = queryForHighlight.toLowerCase();
    if (!query) return text;
    const source = text.toLowerCase();
    const firstIndex = source.indexOf(query);
    if (firstIndex < 0) return text;

    const chunks: ReactNode[] = [];
    let cursor = 0;
    let index = firstIndex;
    let safety = 0;
    while (index >= 0 && safety < 8) {
      if (index > cursor) {
        chunks.push(text.slice(cursor, index));
      }
      chunks.push(
        <span key={`${index}-${query}`} className="text-cyan-300">
          {text.slice(index, index + query.length)}
        </span>
      );
      cursor = index + query.length;
      index = source.indexOf(query, cursor);
      safety += 1;
    }
    if (cursor < text.length) {
      chunks.push(text.slice(cursor));
    }
    return <>{chunks}</>;
  };

  const resolveResultType = (item: SearchSuggestion): string => {
    if (item.kindTag === "DLC" || item.isDlc) {
      return t("search.type.add_on");
    }
    if (/\b(deluxe|edition|ultimate|bundle|season pass)\b/i.test(item.label)) {
      return t("search.type.edition");
    }
    return t("store.base_game");
  };

  const handleSelect = (item: SearchSuggestion) => {
    onSuggestionSelect?.(item);
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-5">
      {!hideSearch && (
        <div className="relative w-full max-w-md">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/55"
            size={16}
          />
          <input
            className="h-10 w-full rounded-full border border-white/10 bg-[#353841]/85 py-2 pl-10 pr-10 text-sm text-white outline-none transition focus:border-cyan-400/55 focus:bg-[#3a3e47]"
            placeholder={searchPlaceholder}
            value={isControlled ? searchValue : undefined}
            onChange={(event) => onSearchChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onSearchSubmit?.();
                setOpen(false);
              }
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setOpen(false), 120);
            }}
          />
          {searchLoading && (
            <span
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center"
              aria-label={t("store.searching")}
            >
              <span className="spinner-force-motion h-3.5 w-3.5 rounded-full border-2 border-cyan-300/35 border-t-cyan-300" />
            </span>
          )}
          {open && hasSuggestions && (
            <div className="absolute left-0 z-40 mt-3 w-[min(680px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(120deg,#474b53_0%,#2d3746_56%,#1b2736_100%)] p-4 shadow-[0_22px_56px_rgba(0,0,0,0.55)]">
              {topResults.length > 0 && (
                <div className="border-b border-white/12 pb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">
                    {t("search.top_results")}
                  </p>
                  <div className="mt-2.5 space-y-1.5">
                    {topResults.map((item) => (
                      <button
                        key={item.id}
                        className="group flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 text-left transition hover:border-white/12 hover:bg-white/8"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(item);
                        }}
                      >
                        {(() => {
                          const imageCandidates = buildImageCandidates(item);
                          const initialImage = imageCandidates[0] || SEARCH_IMAGE_PLACEHOLDER;
                          return (
                            <img
                              src={initialImage}
                              alt={item.label}
                              className="h-11 w-11 rounded-md object-cover ring-1 ring-white/15"
                              data-candidates={imageCandidates.join("||")}
                              data-candidate-index="0"
                              onError={handlePreviewImageError}
                            />
                          );
                        })()}
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/50">
                            {resolveResultType(item)}
                          </p>
                          <p className="truncate text-lg font-semibold leading-tight text-white md:text-xl">
                            {renderHighlight(item.label)}
                          </p>
                          {item.meta && (
                            <p className="text-[11px] text-white/45">{item.meta}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="mt-2.5 inline-flex items-center gap-2 text-sm font-semibold text-white/80 transition hover:text-cyan-300"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (onViewAllResults) {
                        onViewAllResults();
                      } else {
                        onSearchSubmit?.();
                      }
                      setOpen(false);
                    }}
                  >
                    {t("search.view_all_results")}
                    <span aria-hidden="true">{"->"}</span>
                  </button>
                </div>
              )}
              {historyItems.length > 0 && (
                <div className="border-b border-white/12 py-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                    {t("search.recent")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {historyItems.slice(0, 6).map((item) => (
                      <button
                        key={item.id}
                        className="inline-flex items-center rounded-full border border-white/15 bg-white/6 px-3 py-1.5 text-xs font-medium text-white/90 transition hover:border-cyan-300/40 hover:text-cyan-200"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(item);
                        }}
                      >
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {popularItems.length > 0 && (
                <div className="pt-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/45">
                    {t("search.popular")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {popularItems.slice(0, 5).map((item) => (
                      <button
                        key={item.id}
                        className="inline-flex items-center rounded-full border border-cyan-300/25 bg-cyan-500/12 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/55 hover:bg-cyan-500/18"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(item);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-5 text-sm font-semibold">
        {tabs.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.to}
            className={({ isActive }) => {
              const selected = activeTab ? activeTab === tab.key : isActive;
              return `border-b-2 pb-1 transition ${
                selected
                  ? "border-text-primary text-text-primary"
                  : "border-transparent text-text-muted hover:text-text-primary"
              }`;
            }}
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
