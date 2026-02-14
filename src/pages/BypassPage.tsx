import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import FixEntryCard from "../components/fixes/FixEntryCard";
import { fetchBypassCategories, BypassCategory } from "../services/api";
import { useLocale } from "../context/LocaleContext";
import { FixEntry } from "../types";

// Logo paths for each category
const CATEGORY_LOGOS: Record<string, string> = {
  ea: "/images/bypass-logos/Electronic-Arts-Logo.svg.png",
  ubisoft: "/images/bypass-logos/Ubisoft_logo.svg.png",
  rockstar: "/images/bypass-logos/Rockstar_Games_Logo.svg.png",
  denuvo: "/images/bypass-logos/Denuvo_logo.png",
};

// Category icons using actual logo images
const CategoryIcon = ({ icon, className = "" }: { icon: string; className?: string }) => {
  const logoPath = CATEGORY_LOGOS[icon];

  if (logoPath) {
    return (
      <div className={`w-full h-full flex items-center justify-center bg-white/10 rounded-lg p-1.5 ${className}`}>
        <img
          src={logoPath}
          alt={icon}
          className="w-full h-full object-contain"
          onError={(e) => {
            // Fallback to text if image fails to load
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            target.parentElement!.innerHTML = `<span class="text-white font-bold text-xs uppercase">${icon}</span>`;
          }}
        />
      </div>
    );
  }

  // Fallback for unknown icons
  return (
    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-600 to-gray-800 rounded-lg p-2 ${className}`}>
      <ShieldOff size={20} className="text-white" />
    </div>
  );
};

export default function BypassPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<BypassCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchBypassCategories()
      .then((data) => {
        if (mounted) {
          setCategories(data);
          if (data.length > 0 && !selectedCategory) {
            setSelectedCategory(data[0].id);
          }
        }
      })
      .catch((err: any) => {
        if (mounted) {
          setError(err.message || t("bypass.error"));
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
    navigate(`/fixes/bypass/${entry.appId}`);
  };

  const currentCategory = categories.find((c) => c.id === selectedCategory);
  const totalGames = categories.reduce((sum, cat) => sum + cat.total, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="glass-panel flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.35em] text-text-muted">
            <ShieldOff size={14} className="text-primary" />
            {t("nav.bypass")}
          </div>
          <h1 className="text-2xl font-semibold">{t("bypass.title")}</h1>
          <p className="text-sm text-text-secondary">{t("bypass.description")}</p>
        </div>
        <div className="text-xs uppercase tracking-[0.35em] text-text-muted">
          {totalGames} {t("store.titles_count")}
        </div>
      </section>

      {error && (
        <div className="glass-panel p-4 text-sm text-red-400">{error}</div>
      )}

      {loading && (
        <div className="glass-panel p-6 text-sm text-text-secondary">
          {t("bypass.loading")}
        </div>
      )}

      {!loading && categories.length > 0 && (
        <>
          {/* Category Tabs */}
          <div className="flex flex-wrap gap-3">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                  ${
                    selectedCategory === cat.id
                      ? "bg-primary/20 border-2 border-primary shadow-lg shadow-primary/20"
                      : "glass-panel hover:bg-white/5 border-2 border-transparent"
                  }
                `}
              >
                <div className="w-10 h-10 flex-shrink-0">
                  <CategoryIcon icon={cat.icon} />
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm">{cat.name}</div>
                  <div className="text-xs text-text-muted">{cat.total} {t("store.titles_count")}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Category Description */}
          {currentCategory && (
            <div className="glass-panel p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 flex-shrink-0">
                  <CategoryIcon icon={currentCategory.icon} />
                </div>
                <div>
                  <h2 className="font-semibold text-lg">{currentCategory.name}</h2>
                  <p className="text-sm text-text-secondary">
                    {currentCategory.description}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Games Grid */}
          {currentCategory && currentCategory.games.length > 0 && (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {currentCategory.games.map((entry) => (
                <FixEntryCard
                  key={entry.appId}
                  entry={entry}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          )}

          {currentCategory && currentCategory.games.length === 0 && (
            <div className="glass-panel p-6 text-sm text-text-secondary">
              {t("bypass.category_empty")}
            </div>
          )}
        </>
      )}

      {!loading && categories.length === 0 && !error && (
        <div className="glass-panel p-6 text-sm text-text-secondary">
          {t("bypass.empty")}
        </div>
      )}
    </div>
  );
}
