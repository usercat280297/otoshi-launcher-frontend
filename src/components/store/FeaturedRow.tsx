import { ChevronRight } from "lucide-react";
import { Game } from "../../types";
import GameCard from "./GameCard";

type FeaturedRowProps = {
  title: string;
  games: Game[];
  onOpen: (game: Game) => void;
};

export default function FeaturedRow({ title, games, onOpen }: FeaturedRowProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <ChevronRight size={16} className="text-text-muted" />
        </div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-elegant">
        {games.map((game) => (
          <GameCard key={game.id} game={game} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
