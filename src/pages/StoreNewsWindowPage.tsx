import { useMemo } from "react";
import { Clock3, Tag, X } from "lucide-react";
import { isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocale } from "../context/LocaleContext";
import { StoreNewsEntry, StoreNewsPayload } from "../utils/storeNews";

const IMAGE_PLACEHOLDER = "/icons/game-placeholder.svg";

const EMPTY_PAYLOAD: StoreNewsPayload = {
  generatedAt: 0,
  newReleases: [],
  topDiscounts: [],
};

function toTimestamp(value?: string | null): number {
  if (!value || typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEntry(raw: unknown): StoreNewsEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Partial<StoreNewsEntry>;
  const id = String(source.id || "").trim();
  const slug = String(source.slug || "").trim();
  const title = String(source.title || "").trim();
  if (!id || !slug || !title) return null;

  return {
    id,
    slug,
    steamAppId: source.steamAppId ? String(source.steamAppId) : undefined,
    title,
    releaseDate: String(source.releaseDate || ""),
    discountPercent: Number.isFinite(source.discountPercent)
      ? Number(source.discountPercent)
      : 0,
    price: Number.isFinite(source.price) ? Number(source.price) : 0,
    priceKnown: source.priceKnown,
    priceLabel: source.priceLabel ?? null,
    image:
      typeof source.image === "string" && source.image.trim()
        ? source.image
        : IMAGE_PLACEHOLDER,
  };
}

function parseEntries(raw: unknown): StoreNewsEntry[] {
  if (!Array.isArray(raw)) return [];
  const parsed: StoreNewsEntry[] = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (entry) {
      parsed.push(entry);
    }
  }
  return parsed;
}

function parsePayload(search: string): StoreNewsPayload {
  try {
    const params = new URLSearchParams(search);
    const encoded = params.get("payload");
    if (!encoded) return EMPTY_PAYLOAD;

    const json = decodeURIComponent(encoded);
    const parsed = JSON.parse(json) as Partial<StoreNewsPayload>;

    return {
      generatedAt: Number.isFinite(parsed.generatedAt) ? Number(parsed.generatedAt) : Date.now(),
      newReleases: parseEntries(parsed.newReleases),
      topDiscounts: parseEntries(parsed.topDiscounts),
    };
  } catch {
    return EMPTY_PAYLOAD;
  }
}

export default function StoreNewsWindowPage() {
  const { locale, t } = useLocale();
  const payload = useMemo(
    () => parsePayload(typeof window === "undefined" ? "" : window.location.search),
    []
  );

  const formatReleaseDate = (value?: string | null) => {
    const ts = toTimestamp(value);
    if (!ts) {
      return locale === "vi" ? "Chua co ngay phat hanh" : "Release date unavailable";
    }
    return new Date(ts).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatDiscountPrice = (entry: StoreNewsEntry) => {
    if (entry.priceKnown === false) return entry.priceLabel || t("common.price_unavailable");
    if (entry.price <= 0) return t("common.free");
    return `$${(entry.price * (1 - entry.discountPercent / 100)).toFixed(2)}`;
  };

  const generatedAtLabel = useMemo(() => {
    if (!payload.generatedAt) return null;
    return new Date(payload.generatedAt).toLocaleString(locale === "vi" ? "vi-VN" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  }, [locale, payload.generatedAt]);

  const closeWindow = async () => {
    if (isTauriRuntime()) {
      await getCurrentWindow().close();
      return;
    }
    window.close();
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1b2a43_0%,#0a0f1b_55%,#070b14_100%)] p-4 text-text-primary">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-cyan-300/20 bg-black/55 shadow-[0_28px_80px_rgba(0,0,0,0.6)] backdrop-blur">
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/80">Steam News</p>
            <h1 className="mt-1 text-xl font-semibold">
              {locale === "vi" ? "Cap nhat game moi va giam gia" : "New Releases and Discounts"}
            </h1>
            {generatedAtLabel && (
              <p className="mt-1 text-xs text-text-muted">
                {locale === "vi" ? "Cap nhat luc" : "Updated at"} {generatedAtLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void closeWindow()}
            className="rounded-lg border border-white/15 p-2 text-text-secondary transition hover:border-cyan-200 hover:text-white"
            aria-label={locale === "vi" ? "Dong cua so" : "Close window"}
          >
            <X size={16} />
          </button>
        </header>

        <div className="grid flex-1 gap-4 overflow-auto p-5 md:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/85">
              <Clock3 size={14} />
              <span>{locale === "vi" ? "Game moi" : "New Releases"}</span>
            </div>
            {payload.newReleases.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-text-secondary">
                {locale === "vi"
                  ? "Chua co du lieu ngay phat hanh de hien thi."
                  : "No release-date data available yet."}
              </p>
            ) : (
              <div className="space-y-2">
                {payload.newReleases.map((entry) => (
                  <article
                    key={`recent-${entry.id}`}
                    className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/35 px-3 py-2.5"
                  >
                    <img
                      src={entry.image || IMAGE_PLACEHOLDER}
                      alt={entry.title}
                      className="h-12 w-12 rounded-md object-cover ring-1 ring-white/15"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">{entry.title}</p>
                      <p className="text-xs text-text-secondary">
                        {locale === "vi" ? "Phat hanh" : "Released"}: {formatReleaseDate(entry.releaseDate)}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/85">
              <Tag size={14} />
              <span>{locale === "vi" ? "Dang giam gia" : "Top Discounts"}</span>
            </div>
            {payload.topDiscounts.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-sm text-text-secondary">
                {locale === "vi" ? "Chua co game giam gia." : "No discounted games right now."}
              </p>
            ) : (
              <div className="space-y-2">
                {payload.topDiscounts.map((entry) => (
                  <article
                    key={`discount-${entry.id}`}
                    className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/35 px-3 py-2.5"
                  >
                    <img
                      src={entry.image || IMAGE_PLACEHOLDER}
                      alt={entry.title}
                      className="h-12 w-12 rounded-md object-cover ring-1 ring-white/15"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">{entry.title}</p>
                      <p className="text-xs text-text-secondary">
                        -{Math.round(entry.discountPercent)}% | {formatDiscountPrice(entry)}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
