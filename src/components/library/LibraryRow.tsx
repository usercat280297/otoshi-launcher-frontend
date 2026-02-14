import { Play, DownloadCloud } from "lucide-react";
import { Game } from "../../types";
import Button from "../common/Button";

type LibraryRowProps = {
  game: Game;
  onPlay?: () => void;
  onInstall?: () => void;
};

export default function LibraryRow({ game, onPlay, onInstall }: LibraryRowProps) {
  return (
    <div className="glass-panel flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-4">
        <img
          src={game.iconImage || game.headerImage}
          alt={game.title}
          className="h-16 w-24 rounded-md object-cover"
        />
        <div>
          <h3 className="text-base font-semibold">{game.title}</h3>
          <p className="text-xs text-text-secondary">{game.studio}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-text-secondary">
        <span>{game.playtimeHours}h</span>
        <span>{game.installed ? "Installed" : "Not installed"}</span>
      </div>
      <div className="flex items-center gap-2">
        {game.installed ? (
          <Button size="sm" icon={<Play size={14} />} onClick={onPlay}>
            Play
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
