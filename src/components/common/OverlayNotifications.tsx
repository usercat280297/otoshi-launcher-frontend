import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, CircleAlert, X } from "lucide-react";
import {
  OVERLAY_NOTIFICATION_EVENT,
  OverlayNotificationPayload,
  OverlayNotificationTone,
} from "../../utils/notify";

type OverlayNotificationItem = Required<
  Pick<OverlayNotificationPayload, "title" | "message" | "tone">
> &
  Omit<OverlayNotificationPayload, "title" | "message" | "tone"> & {
    id: string;
    createdAt: number;
  };

const DEFAULT_DURATIONS: Record<OverlayNotificationTone, number> = {
  info: 3200,
  success: 3600,
  warning: 4400,
  error: 5200,
};

function normalizePayload(
  payload: OverlayNotificationPayload,
  idSeed: string
): OverlayNotificationItem | null {
  const title = String(payload.title || "").trim();
  const message = String(payload.message || "").trim();
  if (!title || !message) return null;
  const tone: OverlayNotificationTone = payload.tone || "info";
  return {
    ...payload,
    id: payload.id || idSeed,
    title,
    message,
    tone,
    createdAt: Date.now(),
  };
}

function resolveToneChipClass(tone: OverlayNotificationTone) {
  switch (tone) {
    case "success":
      return "text-emerald-300 bg-emerald-500/15 border-emerald-400/35";
    case "warning":
      return "text-amber-300 bg-amber-500/15 border-amber-400/35";
    case "error":
      return "text-rose-300 bg-rose-500/15 border-rose-400/35";
    default:
      return "text-cyan-300 bg-cyan-500/15 border-cyan-400/35";
  }
}

function resolveToneDotClass(tone: OverlayNotificationTone) {
  switch (tone) {
    case "success":
      return "bg-emerald-400";
    case "warning":
      return "bg-amber-400";
    case "error":
      return "bg-rose-400";
    default:
      return "bg-cyan-400";
  }
}

function resolveToneIcon(tone: OverlayNotificationTone) {
  switch (tone) {
    case "success":
      return CheckCircle2;
    case "warning":
      return AlertTriangle;
    case "error":
      return CircleAlert;
    default:
      return Bell;
  }
}

export default function OverlayNotifications() {
  const [items, setItems] = useState<OverlayNotificationItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const sequenceRef = useRef(0);

  const remove = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer != null) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const push = useCallback((payload: OverlayNotificationPayload) => {
    const next = normalizePayload(payload, `notify-${Date.now()}-${sequenceRef.current++}`);
    if (!next) return;
    setItems((prev) => {
      const duplicate = prev.find(
        (entry) =>
          entry.title === next.title &&
          entry.message === next.message &&
          Date.now() - entry.createdAt < 1200
      );
      if (duplicate) return prev;
      return [next, ...prev].slice(0, 5);
    });
  }, []);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<OverlayNotificationPayload>).detail;
      if (!detail) return;
      push(detail);
    };
    window.addEventListener(OVERLAY_NOTIFICATION_EVENT, onNotify as EventListener);
    return () => {
      window.removeEventListener(OVERLAY_NOTIFICATION_EVENT, onNotify as EventListener);
    };
  }, [push]);

  useEffect(() => {
    const activeIds = new Set(items.map((entry) => entry.id));
    timersRef.current.forEach((timer, id) => {
      if (!activeIds.has(id)) {
        window.clearTimeout(timer);
        timersRef.current.delete(id);
      }
    });
    items.forEach((entry) => {
      if (timersRef.current.has(entry.id)) return;
      const durationMs = Math.max(
        1400,
        Number(entry.durationMs) || DEFAULT_DURATIONS[entry.tone] || DEFAULT_DURATIONS.info
      );
      const timer = window.setTimeout(() => remove(entry.id), durationMs);
      timersRef.current.set(entry.id, timer);
    });
  }, [items, remove]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const visibleItems = useMemo(() => items.slice(0, 4), [items]);
  if (!visibleItems.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 right-4 z-[120] flex w-[min(520px,calc(100vw-1.25rem))] flex-col gap-3">
      {visibleItems.map((entry) => {
        const ToneIcon = resolveToneIcon(entry.tone);
        return (
          <article
            key={entry.id}
            className="pointer-events-auto relative overflow-hidden rounded-xl border border-white/10 bg-[#090b10]/94 p-3 shadow-[0_16px_42px_rgba(0,0,0,0.5)] backdrop-blur-md"
          >
            <div className="absolute inset-y-0 left-0 w-1 bg-white/5" />
            <div className="flex items-start gap-3">
              {entry.imageUrl ? (
                <img
                  src={entry.imageUrl}
                  alt={entry.title}
                  className="h-16 w-16 flex-shrink-0 rounded-md object-cover ring-1 ring-white/15"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-white/5 ring-1 ring-white/15">
                  <ToneIcon size={20} className="text-white/80" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-semibold uppercase tracking-[0.14em] ${resolveToneChipClass(entry.tone)}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${resolveToneDotClass(entry.tone)}`} />
                    {entry.title}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(entry.id)}
                    className="rounded p-1 text-white/45 transition hover:bg-white/8 hover:text-white/85"
                    aria-label="Close notification"
                  >
                    <X size={15} />
                  </button>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[15px] font-semibold text-white">
                  {entry.message}
                </p>
                {entry.source && (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-white/45">
                    {entry.source}
                  </p>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
