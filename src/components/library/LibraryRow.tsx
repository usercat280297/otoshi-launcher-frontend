import { Play, DownloadCloud, Square } from "lucide-react";
import { Game } from "../../types";
import { useLocale } from "../../context/LocaleContext";
import Button from "../common/Button";

type LibraryRowProps = {
  game: Game;
  running?: boolean;
  onPlay?: () => void;
  onStop?: () => void;
  onInstall?: () => void;
};

export default function LibraryRow({ game, running, onPlay, onStop, onInstall }: LibraryRowProps) {
  const { t } = useLocale();
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
        <span>{game.installed ? t("library.status.installed") : t("library.status.not_installed")}</span>
      </div>
      <div className="flex items-center gap-2">
        {game.installed ? (
          <Button
            size="sm"
            icon={running ? <Square size={14} /> : <Play size={14} />}
            onClick={running ? onStop : onPlay}
            disabled={running ? !onStop : !onPlay}
          >
            {running ? t("action.stop") : t("action.play")}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" icon={<DownloadCloud size={14} />} onClick={onInstall}>
            {t("action.install")}
          </Button>
        )}
      </div>
    </div>
  );
}
