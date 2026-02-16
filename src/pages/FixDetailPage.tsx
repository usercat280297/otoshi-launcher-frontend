// cspell:ignore denuvo
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Download, ListChecks } from "lucide-react";
import CrackDownloadModal from "../components/fixes/CrackDownloadModal";
import Badge from "../components/common/Badge";
import { useLocale } from "../context/LocaleContext";
import { fetchFixEntryDetail } from "../services/api";
import type { FixEntry, FixEntryDetail } from "../types";

type Props = {
  kind: "online-fix" | "bypass";
};

export default function FixDetailPage({ kind }: Props) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { appId } = useParams<{ appId: string }>();
  const [detail, setDetail] = useState<FixEntryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  // Get labels from i18n
  const fixLabelKey = kind === "online-fix" ? "fix_detail.online_fix_label" : "fix_detail.bypass_label";
  const FIX_LABELS: Record<"online-fix" | "bypass", string> = {
    "online-fix": t("fix_detail.online_fix_label"),
    bypass: t("fix_detail.bypass_label"),
  };

  const FIX_PATHS: Record<"online-fix" | "bypass", string> = {
    "online-fix": "/fixes/online",
    bypass: "/fixes/bypass",
  };

  useEffect(() => {
    if (!appId) {
      setError("Missing app id.");
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);

    fetchFixEntryDetail(kind, appId)
      .then((data) => {
        if (!mounted) return;
        setDetail(data);
        const recommendedIndex = data.options.findIndex((option) => option.recommended);
        setSelectedIndex(recommendedIndex >= 0 ? recommendedIndex : 0);
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err?.message || "Unable to load fix details.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [appId, kind]);

  const selectedOption = useMemo(
    () => detail?.options?.[selectedIndex] ?? null,
    [detail, selectedIndex]
  );

  const entryForModal: FixEntry | null = useMemo(() => {
    if (!detail) return null;
    const options = detail.options || [];
    const normalizedIndex =
      selectedIndex >= 0 && selectedIndex < options.length ? selectedIndex : 0;
    const selected = options[normalizedIndex];
    const orderedOptions = selected
      ? [selected, ...options.filter((_, index) => index !== normalizedIndex)]
      : options;

    return {
      appId: detail.appId,
      name: detail.name,
      steam: detail.steam ?? null,
      options: orderedOptions,
      denuvo: detail.denuvo
    };
  }, [detail, selectedIndex]);

  const title = detail?.steam?.name || detail?.name || appId || "Fix Detail";
  const headerImage =
    detail?.steam?.headerImage ||
    detail?.steam?.capsuleImage ||
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
  const backPath = FIX_PATHS[kind];

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(backPath)}
        className="inline-flex items-center gap-2 text-sm text-text-secondary transition hover:text-text-primary"
      >
        <ArrowLeft size={14} />
        {t("fix_detail.back_to")} {FIX_LABELS[kind]}
      </button>

      {loading && (
        <div className="glass-panel p-6 text-sm text-text-secondary">{t("common.loading")}</div>
      )}

      {error && (
        <div className="glass-panel p-6">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      )}

      {!loading && detail && (
        <>
          <section className="glass-panel overflow-hidden">
            <div className="relative h-52 w-full overflow-hidden border-b border-background-border">
              <img src={headerImage} alt={title} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-text-muted">{FIX_LABELS[kind]}</p>
                  <h1 className="text-2xl font-semibold text-white">{title}</h1>
                </div>
                <div className="flex flex-wrap gap-2">
                  {detail.denuvo && <Badge label="Denuvo" tone="danger" />}
                  {detail.category?.name && <Badge label={detail.category.name} tone="secondary" />}
                </div>
              </div>
            </div>

            <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_1fr]">
              <div className="space-y-4">
                <div className="rounded-xl border border-background-border bg-background-surface p-4">
                  <p className="text-xs uppercase tracking-[0.26em] text-text-muted">{t("fix_detail.download_source")}</p>
                  <div className="mt-3 space-y-3">
                    {detail.options.length > 1 && (
                      <select
                        id="fix-download-source"
                        aria-label={t("fix_detail.download_source")}
                        title={t("fix_detail.download_source")}
                        value={selectedIndex}
                        onChange={(event) => setSelectedIndex(Number(event.target.value))}
                        className="w-full rounded-lg border border-background-border bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
                      >
                        {detail.options.map((option, index) => (
                          <option key={`${detail.appId}-${index}`} value={index}>
                            {option.name || t("fix_detail.link_number").replace("{index}", `${index + 1}`)}
                            {option.version ? ` (${option.version})` : ""}
                          </option>
                        ))}
                      </select>
                    )}

                    {selectedOption && (
                      <div className="rounded-lg border border-background-border bg-background px-3 py-2 text-xs text-text-secondary">
                        <p className="font-semibold text-text-primary">
                          {selectedOption.name || t("fix_detail.download_link")}
                        </p>
                        {selectedOption.version && <p>{t("fix_detail.version_label")}: {selectedOption.version}</p>}
                        {selectedOption.note && <p className="mt-1">{selectedOption.note}</p>}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setModalOpen(true)}
                        disabled={!selectedOption?.link}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Download size={15} />
                        {t("fix_detail.open_download_popup")}
                      </button>
                    </div>
                  </div>
                </div>

                {detail.guide.summary && (
                  <div className="rounded-xl border border-background-border bg-background-surface p-4">
                    <p className="text-sm text-text-secondary">{t(detail.guide.summary)}</p>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-background-border bg-background-surface p-4">
                <div className="flex items-center gap-2">
                  <ListChecks size={16} className="text-primary" />
                  <h2 className="text-sm font-semibold uppercase tracking-[0.22em] text-text-muted">
                    {t(detail.guide.title)}
                  </h2>
                </div>
                <div className="mt-4 space-y-3">
                  {detail.guide.steps.map((step, index) => (
                    <div key={`${step.title}-${index}`} className="rounded-lg border border-background-border bg-background p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-primary">{t(step.title)}</p>
                      <p className="mt-1 text-sm text-text-secondary">{t(step.description)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {(detail.guide.warnings.length > 0 || detail.guide.notes.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-2">
              {detail.guide.warnings.length > 0 && (
                <div className="glass-panel p-4">
                  <div className="mb-2 flex items-center gap-2 text-accent-amber">
                    <AlertTriangle size={15} />
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em]">{t("fix_detail.warnings")}</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-text-secondary">
                    {detail.guide.warnings.map((warning, index) => (
                      <li key={`warning-${index}`}>• {t(warning)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {detail.guide.notes.length > 0 && (
                <div className="glass-panel p-4">
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-text-muted">{t("fix_detail.notes")}</h3>
                  <ul className="space-y-2 text-sm text-text-secondary">
                    {detail.guide.notes.map((note, index) => (
                      <li key={`note-${index}`}>• {t(note)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <CrackDownloadModal
        open={modalOpen}
        entry={entryForModal}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
