import { Trophy, Lock, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { SteamAchievement } from "../../types";

type AchievementsSectionProps = {
  achievements: SteamAchievement[];
  appId: string;
};

export default function AchievementsSection({ achievements, appId }: AchievementsSectionProps) {
  const [showHidden, setShowHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hoveredAchievement, setHoveredAchievement] = useState<string | null>(null);

  if (!achievements || achievements.length === 0) {
    return null;
  }

  // Filter out invalid achievements
  const validAchievements = achievements.filter(a => a && a.name && a.displayName);

  if (validAchievements.length === 0) {
    return null;
  }

  const visibleAchievements = showHidden
    ? validAchievements
    : validAchievements.filter((a) => !a.hidden);

  const displayAchievements = expanded
    ? visibleAchievements
    : visibleAchievements.slice(0, 12);

  const hiddenCount = validAchievements.filter((a) => a.hidden).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-accent-amber" />
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
            Achievements
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">
            {validAchievements.length} total
          </span>
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="flex items-center gap-1 text-xs text-text-muted transition hover:text-text-primary"
            >
              {showHidden ? <EyeOff size={12} /> : <Eye size={12} />}
              {showHidden ? "Hide" : "Show"} {hiddenCount} hidden
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {displayAchievements.map((achievement) => {
          const isHovered = hoveredAchievement === achievement.name;

          return (
            <div
              key={achievement.name}
              onMouseEnter={() => setHoveredAchievement(achievement.name)}
              onMouseLeave={() => setHoveredAchievement(null)}
              className={`group relative flex items-start gap-3 rounded-lg border p-3 transition-all duration-200 cursor-default ${
                isHovered
                  ? "border-primary bg-primary/10 shadow-lg shadow-primary/10 scale-[1.02] z-10"
                  : "border-background-border bg-background-surface hover:border-primary/50"
              }`}
            >
              {/* Achievement Icon */}
              <div className={`relative flex-shrink-0 transition-transform duration-200 ${isHovered ? "scale-110" : ""}`}>
                {achievement.icon ? (
                  <img
                    src={isHovered ? achievement.icon : (achievement.iconGray || achievement.icon)}
                    alt={achievement.displayName}
                    className={`h-14 w-14 rounded-lg object-cover transition-all duration-200 ${
                      isHovered ? "brightness-110 saturate-110" : "grayscale-[30%]"
                    }`}
                  />
                ) : (
                  <div className={`flex h-14 w-14 items-center justify-center rounded-lg transition-colors duration-200 ${
                    isHovered ? "bg-accent-amber/20" : "bg-background-muted"
                  }`}>
                    {achievement.hidden ? (
                      <Lock size={20} className={`transition-colors duration-200 ${isHovered ? "text-primary" : "text-text-muted"}`} />
                    ) : (
                      <Trophy size={20} className={`transition-colors duration-200 ${isHovered ? "text-accent-amber" : "text-text-muted"}`} />
                    )}
                  </div>
                )}
                {/* Glow effect on hover */}
                {isHovered && achievement.icon && (
                  <div className="absolute inset-0 rounded-lg bg-primary/20 blur-md -z-10" />
                )}
              </div>

              {/* Achievement Info */}
              <div className="min-w-0 flex-1">
                <p className={`font-medium transition-colors duration-200 ${
                  isHovered ? "text-primary" : "text-text-primary"
                } ${achievement.hidden && !showHidden ? "italic" : ""}`}>
                  {achievement.hidden && !showHidden ? "Hidden Achievement" : achievement.displayName}
                </p>

                {achievement.description && !achievement.hidden && (
                  <p className={`mt-1 text-xs transition-colors duration-200 ${
                    isHovered ? "text-text-secondary" : "text-text-muted"
                  } ${isHovered ? "" : "line-clamp-2"}`}>
                    {achievement.description}
                  </p>
                )}

                {achievement.globalPercent != null && typeof achievement.globalPercent === 'number' && !isNaN(achievement.globalPercent) && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-background-muted">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isHovered ? "bg-accent-amber" : "bg-accent-amber/50"
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, achievement.globalPercent))}%`,
                          boxShadow: isHovered ? "0 0 8px rgba(245, 158, 11, 0.5)" : "none"
                        }}
                      />
                    </div>
                    <span className={`text-xs font-medium transition-colors duration-200 ${
                      isHovered ? "text-accent-amber" : "text-text-muted"
                    }`}>
                      {achievement.globalPercent.toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Rarity indicator */}
              {achievement.globalPercent != null && typeof achievement.globalPercent === 'number' && (
                <div className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-all duration-200 ${
                  achievement.globalPercent <= 5
                    ? "bg-purple-500/20 text-purple-400"
                    : achievement.globalPercent <= 20
                    ? "bg-accent-amber/20 text-accent-amber"
                    : achievement.globalPercent <= 50
                    ? "bg-accent-blue/20 text-accent-blue"
                    : "bg-background-muted text-text-muted"
                } ${isHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                  {achievement.globalPercent <= 5
                    ? "Ultra Rare"
                    : achievement.globalPercent <= 20
                    ? "Rare"
                    : achievement.globalPercent <= 50
                    ? "Uncommon"
                    : "Common"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {visibleAchievements.length > 12 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary transition hover:underline"
        >
          {expanded
            ? "Show less"
            : `Show all ${visibleAchievements.length} achievements`}
        </button>
      )}
    </div>
  );
}
