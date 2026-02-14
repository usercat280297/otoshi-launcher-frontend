import { Filter, Grid, List, Search } from "lucide-react";
import { useLocale } from "../../context/LocaleContext";
import Input from "../common/Input";

type LibraryHeaderProps = {
  search: string;
  onSearch: (value: string) => void;
  view: "grid" | "list";
  onViewChange: (value: "grid" | "list") => void;
};

export default function LibraryHeader({
  search,
  onSearch,
  view,
  onViewChange
}: LibraryHeaderProps) {
  const { t } = useLocale();

  return (
    <div className="glass-panel flex flex-wrap items-center gap-4 p-4">
      <div className="relative flex-1 min-w-[220px]">
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={t("library.search_placeholder")}
          icon={<Search size={18} />}
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onViewChange("grid")}
          className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
            view === "grid"
              ? "border-primary text-primary"
              : "border-background-border text-text-muted"
          }`}
        >
          <Grid size={16} />
        </button>
        <button
          onClick={() => onViewChange("list")}
          className={`rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
            view === "list"
              ? "border-primary text-primary"
              : "border-background-border text-text-muted"
          }`}
        >
          <List size={16} />
        </button>
      </div>
      <button className="rounded-md border border-background-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-text-secondary transition hover:border-primary">
        <Filter size={14} className="mr-2 inline" />
        {t("library.filters")}
      </button>
    </div>
  );
}
