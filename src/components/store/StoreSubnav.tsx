import { SyntheticEvent, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { NavLink } from "react-router-dom";
import { SearchSuggestion } from "../../types";
import { useLocale } from "../../context/LocaleContext";

type StoreSubnavProps = {
  placeholder?: string;
  activeTab?: "discover" | "browse" | "steam" | "news";
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
  suggestions?: SearchSuggestion[];
  onSuggestionSelect?: (suggestion: SearchSuggestion) => void;
  hideSearch?: boolean;
};

export default function StoreSubnav({
  placeholder,
  activeTab,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  suggestions,
  onSuggestionSelect,
  hideSearch = false
}: StoreSubnavProps) {
  const { t } = useLocale();

  const handlePreviewImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.dataset.fallbackTried === "1") return;
    img.dataset.fallbackTried = "1";

    try {
      const rawSrc = img.getAttribute("src") || "";
      const parsed = new URL(rawSrc, window.location.origin);
      const original = parsed.searchParams.get("url");
      if (original) {
        img.src = decodeURIComponent(original);
      }
    } catch {
      // No fallback available: keep current broken state.
    }
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
  const { historyItems, popularItems, resultItems } = useMemo(() => {
    const history = (suggestions || []).filter((item) => item.kind === "history");
    const popular = (suggestions || []).filter((item) => item.kind === "popular");
    const results = (suggestions || []).filter((item) => item.kind === "result");
    return { historyItems: history, popularItems: popular, resultItems: results };
  }, [suggestions]);
  const hasSuggestions =
    historyItems.length > 0 || popularItems.length > 0 || resultItems.length > 0;

  const handleSelect = (item: SearchSuggestion) => {
    onSuggestionSelect?.(item);
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {!hideSearch && (
        <div className="relative w-full max-w-xs">
          <Search
            className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
            size={16}
          />
          <input
            className="w-full rounded-full border border-background-border bg-background-surface py-2 pl-10 pr-4 text-sm text-text-primary outline-none transition focus:border-primary"
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
          {open && hasSuggestions && (
            <div className="absolute z-30 mt-3 w-full overflow-hidden rounded-2xl border border-background-border bg-background-elevated shadow-xl">
              {resultItems.length > 0 && (
                <div className="border-b border-background-border px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-text-muted">
                    {t("search.results")}
                  </p>
                  <div className="mt-3 space-y-2">
                    {resultItems.map((item) => (
                      <button
                        key={item.id}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-primary transition hover:bg-background-muted"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(item);
                        }}
                      >
                        {item.image && (
                          <img
                            src={item.image}
                            alt={item.label}
                            className="h-9 w-9 rounded-lg object-cover"
                            onError={handlePreviewImageError}
                          />
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-semibold">{item.label}</p>
                          {item.meta && (
                            <p className="text-[11px] text-text-muted">{item.meta}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {historyItems.length > 0 && (
                <div className="border-b border-background-border px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-text-muted">
                    {t("search.recent")}
                  </p>
                  <div className="mt-3 space-y-2">
                    {historyItems.map((item) => (
                      <button
                        key={item.id}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-text-primary transition hover:bg-background-muted"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(item);
                        }}
                      >
                        <span>{item.label}</span>
                        {item.meta && (
                          <span className="text-[10px] uppercase tracking-[0.3em] text-text-muted">
                            {item.meta}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {popularItems.length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-text-muted">
                    {t("search.popular")}
                  </p>
                  <div className="mt-3 space-y-2">
                    {popularItems.map((item) => (
                      <button
                        key={item.id}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-primary transition hover:bg-background-muted"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          handleSelect(item);
                        }}
                      >
                        {item.image && (
                          <img
                            src={item.image}
                            alt={item.label}
                            className="h-9 w-9 rounded-lg object-cover"
                            onError={handlePreviewImageError}
                          />
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-semibold">{item.label}</p>
                          {item.meta && (
                            <p className="text-[11px] text-text-muted">{item.meta}</p>
                          )}
                        </div>
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
