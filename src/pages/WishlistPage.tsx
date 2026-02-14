import { Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useWishlist } from "../hooks/useWishlist";
import GameCard from "../components/store/GameCard";

export default function WishlistPage() {
  const navigate = useNavigate();
  const { entries, loading, error, remove } = useWishlist();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-text-secondary">
        <Heart size={18} />
        <p className="text-xs uppercase tracking-[0.4em]">Wishlist</p>
      </div>
      <div>
        <h1 className="text-3xl font-semibold text-glow">Saved for later</h1>
        <p className="text-sm text-text-secondary">
          Track upcoming deals and notify remote devices when you are ready to install.
        </p>
      </div>

      {error && <div className="glass-panel p-4 text-sm text-text-secondary">{error}</div>}

      {loading ? (
        <div className="glass-panel p-6 text-sm text-text-secondary">Loading wishlist...</div>
      ) : entries.length === 0 ? (
        <div className="glass-panel p-6 text-sm text-text-secondary">
          Your wishlist is empty.
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {entries.map((entry) => (
            <div key={entry.id} className="space-y-3">
              <GameCard game={entry.game} onOpen={() => navigate(`/games/${entry.game.slug}`)} />
              <button
                onClick={() => remove(entry.game.id)}
                className="w-full rounded-md border border-background-border bg-background-surface py-2 text-xs font-semibold uppercase tracking-[0.3em] text-text-muted transition hover:border-primary hover:text-text-primary"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
