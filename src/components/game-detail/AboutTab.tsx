import type { Game } from "../../types";

type AboutTabProps = {
  game: Game;
};

const experienceHighlights = [
  "Cloud saves with cross-device sync",
  "Adaptive patching for fast updates",
  "Matchmaking across regions",
  "Steam-style achievement tracking"
];

export default function AboutTab({ game }: AboutTabProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm uppercase tracking-[0.3em] text-text-muted">Overview</p>
        <p className="text-text-secondary">{game.description}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {experienceHighlights.map((item) => (
          <div key={item} className="glass-card p-4 text-sm text-text-secondary">
            {item}
          </div>
        ))}
      </div>

      <div className="glass-panel grid gap-4 p-4 text-sm text-text-secondary md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Studio</p>
          <p className="text-text-primary">{game.studio}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Release date</p>
          <p className="text-text-primary">{game.releaseDate}</p>
        </div>
      </div>
    </div>
  );
}
