import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import FixEntryCard from "../components/fixes/FixEntryCard";
import { fetchFixCatalog } from "../services/api";
import { useLocale } from "../context/LocaleContext";
import { FixCatalog, FixEntry } from "../types";

export default function OnlineFixPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<FixCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchFixCatalog("online-fix", { limit: 100, offset: 0 })
      .then((data) => {
        if (mounted) {
          setCatalog(data);
        }
      })
      .catch((err: any) => {
        if (mounted) {
          setError(err.message || t("online_fix.error"));
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [t]);

  const handleOpen = (entry: FixEntry) => {
    navigate(`/fixes/online/${entry.appId}`);
  };

  return (
    <div className="space-y-8">
      <section className="glass-panel flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-text-muted">
            <ShieldCheck size={14} className="text-primary" />
            {t("nav.online_fix")}
          </div>
          <h1 className="text-2xl font-semibold">{t("online_fix.tagline")}</h1>
          <p className="text-sm text-text-secondary">{t("online_fix.description")}</p>
        </div>
        <div className="text-xs uppercase tracking-[0.35em] text-text-muted">
          {catalog?.total ?? 0} {t("store.titles_count")}
        </div>
      </section>

      {error && <div className="glass-panel p-4 text-sm text-text-secondary">{error}</div>}
      {loading && (
        <div className="glass-panel p-6 text-sm text-text-secondary">{t("common.loading")}</div>
      )}

      {!loading && catalog && catalog.items.length === 0 && (
        <div className="glass-panel p-6 text-sm text-text-secondary">
          {t("online_fix.empty")}
        </div>
      )}

      {catalog && catalog.items.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {catalog.items.map((entry) => (
            <FixEntryCard
              key={entry.appId}
              entry={entry}
              onOpen={handleOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}
