import { useEffect, useMemo, useState, type ComponentType } from "react";
import { AlertCircle, AlertTriangle, BellRing, X } from "lucide-react";
import { useRemoteConfig } from "../../hooks/useAutoUpdate";
import { useLocale } from "../../context/LocaleContext";

type AnnouncementType = "info" | "warning" | "error";

type Announcement = {
  id: string;
  title: string;
  message: string;
  type: AnnouncementType;
  dismissible: boolean;
};

type StartupAnnouncementModalProps = {
  enabled?: boolean;
};

const ANNOUNCEMENT_SEEN_KEY = "otoshi.startup_announcement.last_seen_id";

const TYPE_STYLES: Record<
  AnnouncementType,
  {
    icon: ComponentType<{ className?: string }>;
    iconClass: string;
    badgeClass: string;
  }
> = {
  info: {
    icon: BellRing,
    iconClass: "text-accent-primary",
    badgeClass: "border-accent-primary/35 bg-accent-primary/15 text-accent-primary",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-yellow-300",
    badgeClass: "border-yellow-300/35 bg-yellow-300/12 text-yellow-200",
  },
  error: {
    icon: AlertCircle,
    iconClass: "text-accent-red",
    badgeClass: "border-accent-red/35 bg-accent-red/15 text-accent-red",
  },
};

function normalizeAnnouncement(raw: unknown): Announcement | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const title = String(source.title ?? "").trim();
  const message = String(source.message ?? "").trim();
  if (!title && !message) {
    return null;
  }

  const rawType = String(source.type ?? "info").toLowerCase();
  const type: AnnouncementType =
    rawType === "warning" || rawType === "error" ? rawType : "info";

  const providedId = String(source.id ?? "").trim();
  const stableId = providedId || `${title}|${message}`;

  return {
    id: stableId,
    title: title || "Launcher notice",
    message,
    type,
    dismissible: source.dismissible !== false,
  };
}

export default function StartupAnnouncementModal({
  enabled = true,
}: StartupAnnouncementModalProps) {
  const { locale } = useLocale();
  const { announcements } = useRemoteConfig();
  const [active, setActive] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);
  const [snoozedId, setSnoozedId] = useState<string | null>(null);

  const announcementList = useMemo(
    () =>
      (announcements || [])
        .map((item) => normalizeAnnouncement(item))
        .filter((item): item is Announcement => Boolean(item)),
    [announcements]
  );

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return;
    }
    if (!announcementList.length || typeof window === "undefined") {
      return;
    }

    const seenId = window.localStorage.getItem(ANNOUNCEMENT_SEEN_KEY) || "";
    const next = announcementList.find(
      (item) => item.id !== seenId && item.id !== snoozedId
    );
    if (!next) {
      return;
    }
    setActive(next);
    setOpen(true);
  }, [announcementList, enabled, snoozedId]);

  const closeForNow = () => {
    if (active) {
      setSnoozedId(active.id);
    }
    setOpen(false);
  };

  const markAsRead = () => {
    if (!active || typeof window === "undefined") {
      setOpen(false);
      return;
    }
    window.localStorage.setItem(ANNOUNCEMENT_SEEN_KEY, active.id);
    setSnoozedId(active.id);
    setOpen(false);
  };

  if (!enabled || !open || !active) {
    return null;
  }

  const style = TYPE_STYLES[active.type];
  const Icon = style.icon;
  const closeLabel = locale === "vi" ? "Dong" : "Close";
  const remindLaterLabel = locale === "vi" ? "De sau" : "Later";
  const markReadLabel = locale === "vi" ? "Da hieu" : "Mark as read";
  const noticeLabel = locale === "vi" ? "THONG BAO MOI" : "NEW NOTICE";

  return (
    <div className="pointer-events-none fixed inset-0 z-[92] flex items-center justify-center px-4">
      <button
        type="button"
        onClick={active.dismissible ? closeForNow : undefined}
        aria-label={closeLabel}
        className="pointer-events-auto absolute inset-0 bg-black/45 backdrop-blur-[1px]"
      />

      <section className="pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-background-border bg-background-elevated/95 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        {active.dismissible && (
          <button
            type="button"
            onClick={closeForNow}
            className="absolute right-3 top-3 rounded-md p-2 text-text-muted transition hover:bg-background-muted hover:text-text-primary"
            aria-label={closeLabel}
          >
            <X size={16} />
          </button>
        )}

        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl border border-background-border bg-background-muted p-2.5">
            <Icon className={`h-5 w-5 ${style.iconClass}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] ${style.badgeClass}`}
            >
              {noticeLabel}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-text-primary">{active.title}</h3>
            {active.message && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                {active.message}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          {active.dismissible && (
            <button
              type="button"
              onClick={closeForNow}
              className="rounded-lg border border-background-border px-3 py-2 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-text-primary"
            >
              {remindLaterLabel}
            </button>
          )}
          <button
            type="button"
            onClick={markAsRead}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-black transition hover:bg-primary/90"
          >
            {markReadLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
