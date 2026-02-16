import { Link } from "react-router-dom";
import { Clock3 } from "lucide-react";
import { useLocale } from "../context/LocaleContext";

export default function DiscoverPausedPage() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-[420px] items-center justify-center">
      <div className="glass-panel w-full max-w-2xl space-y-5 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-amber/15 text-accent-amber">
          <Clock3 size={26} />
        </div>
        <p className="text-xs uppercase tracking-[0.32em] text-text-muted">
          {t("discover.anime")}
        </p>
        <h1 className="text-2xl font-semibold text-text-primary">
          {t("discover.paused.title")}
        </h1>
        <p className="text-lg font-medium text-accent-amber">
          {t("discover.paused.message")}
        </p>
        <p className="text-sm text-text-secondary">
          {t("discover.paused.context")}
        </p>
        <div className="pt-2">
          <Link
            to="/store"
            className="epic-button inline-flex px-5 py-2.5 text-sm font-semibold"
          >
            {t("discover.paused.action_store")}
          </Link>
        </div>
      </div>
    </div>
  );
}
