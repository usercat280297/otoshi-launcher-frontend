import { useCallback, useEffect, useMemo, useState } from "react";
import { BellDot } from "lucide-react";
import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
import { Game } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import { emitOverlayNotification } from "../../utils/notify";
import {
  buildStoreNewsPayload,
  countStoreNewsAlerts,
  hasStoreNewsContent,
  serializeStoreNewsPayload,
  STORE_NEWS_AUTO_OPEN_SESSION_KEY,
  STORE_NEWS_PAYLOAD_CACHE_KEY,
} from "../../utils/storeNews";

const POPUP_WIDTH = 920;
const POPUP_HEIGHT = 640;

type StoreNewsOverlayProps = {
  games: Game[];
};

function resolvePopupPosition() {
  if (typeof window === "undefined") {
    return { left: 120, top: 120 };
  }
  const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - POPUP_WIDTH) / 2));
  const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2));
  return { left, top };
}

export default function StoreNewsOverlay({ games }: StoreNewsOverlayProps) {
  const { locale } = useLocale();
  const [opening, setOpening] = useState(false);

  const payload = useMemo(() => buildStoreNewsPayload(games), [games]);
  const hasNewsContent = useMemo(() => hasStoreNewsContent(payload), [payload]);
  const alertCount = useMemo(() => countStoreNewsAlerts(payload), [payload]);

  const openNewsWindow = useCallback(async () => {
    if (opening) return;
    setOpening(true);

    const encodedPayload = serializeStoreNewsPayload(payload);
    const url = `/steam-news?payload=${encodedPayload}`;

    try {
      if (isTauriRuntime()) {
        await invoke("open_store_news_window", { payload: encodedPayload });
        return;
      }

      const { left, top } = resolvePopupPosition();
      const popup = window.open(
        url,
        "otoshi-steam-news",
        `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );

      if (!popup) {
        window.location.assign(url);
      }
    } catch (error) {
      emitOverlayNotification({
        tone: "error",
        title: locale === "vi" ? "Khong mo duoc cua so news" : "Unable to open news window",
        message:
          error instanceof Error
            ? error.message
            : locale === "vi"
              ? "Da xay ra loi khi mo cua so news."
              : "An unexpected error occurred while opening the news window.",
        source: "store",
        durationMs: 4200,
      });
    } finally {
      setOpening(false);
    }
  }, [locale, opening, payload]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasNewsContent) return;
    const encodedPayload = serializeStoreNewsPayload(payload);
    window.localStorage.setItem(STORE_NEWS_PAYLOAD_CACHE_KEY, encodedPayload);
  }, [hasNewsContent, payload]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (typeof window === "undefined" || !hasNewsContent) return;
    const seen = window.sessionStorage.getItem(STORE_NEWS_AUTO_OPEN_SESSION_KEY) === "1";
    if (seen) return;
    window.sessionStorage.setItem(STORE_NEWS_AUTO_OPEN_SESSION_KEY, "1");
    const timer = window.setTimeout(() => {
      void openNewsWindow();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [hasNewsContent, openNewsWindow]);

  return (
    <button
      type="button"
      onClick={() => void openNewsWindow()}
      className="group fixed bottom-24 right-4 z-[95] rounded-full border border-cyan-300/40 bg-background-elevated/95 p-3 text-cyan-200 shadow-[0_14px_34px_rgba(0,0,0,0.5)] backdrop-blur transition hover:border-cyan-200 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 md:bottom-28"
      aria-label={locale === "vi" ? "Mo cua so Steam News" : "Open Steam News window"}
      disabled={opening}
    >
      <BellDot size={20} />
      {alertCount > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-black">
          {alertCount > 99 ? "99+" : alertCount}
        </span>
      )}
    </button>
  );
}
