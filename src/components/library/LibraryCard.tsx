import { useEffect, useState } from "react";
import { Play, DownloadCloud, Clock, Star } from "lucide-react";
import { Game } from "../../types";
import Button from "../common/Button";

type LibraryCardProps = {
  game: Game;
  onPlay?: () => void;
  onInstall?: () => void;
};

export default function LibraryCard({ game, onPlay, onInstall }: LibraryCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [game.headerImage]);

  return (
    <div className="glass-card overflow-hidden">
      <div className="relative h-40">
        <div
          className={`absolute inset-0 bg-gradient-to-br from-background-muted via-background-surface to-background-elevated transition-opacity duration-500 animate-pulse ${
            imageLoaded && !imageError ? "opacity-0" : "opacity-100"
          }`}
          aria-hidden
        />
        <img
          src={game.headerImage}
          alt={game.title}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          className={`h-full w-full object-cover transition-opacity duration-500 ${
            imageLoaded && !imageError ? "opacity-100" : "opacity-0"
          }`}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent" />
        {game.isFavorite && (
          <div className="absolute right-3 top-3 rounded-full bg-background/70 p-2 text-warning">
            <Star size={14} fill="currentColor" />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
            {game.studio}
          </p>
          <h3 className="text-base font-semibold">{game.title}</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <Clock size={14} />
          {game.playtimeHours}h played
        </div>
        {game.installed ? (
          <Button size="sm" variant="secondary" icon={<Play size={14} />} onClick={onPlay}>
            Launch
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon={<DownloadCloud size={14} />} onClick={onInstall}>
            Install
          </Button>
        )}
      </div>
    </div>
  );
}
