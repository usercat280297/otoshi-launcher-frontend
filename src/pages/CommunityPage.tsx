import { useEffect, useState } from "react";
import { MessageCircle, ThumbsUp, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useGames } from "../hooks/useGames";
import { fetchActivity, fetchReviews, markReviewHelpful } from "../services/api";
import { ActivityEvent, Review } from "../types";
import CommunityCommentsSection from "../components/game-detail/CommunityCommentsSection";

export default function CommunityPage() {
  const { token } = useAuth();
  const { games } = useGames();
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchActivity(token)
      .then((data) => {
        if (mounted) {
          setActivity(data);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || "Failed to load activity");
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
  }, [token]);

  useEffect(() => {
    let mounted = true;
    const gameId = games[0]?.id;
    if (!gameId) {
      return;
    }
    setReviewLoading(true);
    fetchReviews(gameId)
      .then((data) => {
        if (mounted) {
          setReviews(data.slice(0, 6));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setReviewLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [games]);

  const handleHelpful = async (reviewId: string) => {
    if (!token) return;
    const updated = await markReviewHelpful(reviewId, token);
    setReviews((current) =>
      current.map((review) => (review.id === updated.id ? updated : review))
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-text-secondary">
            <Users size={18} />
            <p className="text-xs uppercase tracking-[0.4em]">Community</p>
          </div>
          <h1 className="text-3xl font-semibold text-glow">Friends and creators</h1>
          <p className="text-sm text-text-secondary">
            Follow what your friends are playing, sharing, and recommending.
          </p>
        </div>
        {!token && (
          <Link to="/login" className="epic-button px-5 py-3 text-sm">
            Sign in
          </Link>
        )}
      </div>

      {error && <div className="glass-panel p-4 text-sm text-text-secondary">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          <h2 className="section-title">Activity feed</h2>
          {loading ? (
            <div className="glass-panel p-5 text-sm text-text-secondary">Loading activity...</div>
          ) : activity.length === 0 ? (
            <div className="glass-panel p-5 text-sm text-text-secondary">
              Activity events will appear once you add friends or post reviews.
            </div>
          ) : (
            <div className="space-y-3">
              {activity.map((event) => (
                <div key={event.id} className="glass-card flex items-start gap-4 p-4">
                  <div className="mt-1 rounded-md bg-primary/20 p-2 text-primary">
                    <MessageCircle size={16} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-text-muted">
                      {event.eventType.replace("_", " ")}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {event.payload?.message || event.payload?.caption || "New activity posted."}
                    </p>
                    <p className="text-xs text-text-muted">{new Date(event.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="section-title">Trending reviews</h2>
          {reviewLoading ? (
            <div className="glass-panel p-5 text-sm text-text-secondary">Loading reviews...</div>
          ) : reviews.length === 0 ? (
            <div className="glass-panel p-5 text-sm text-text-secondary">
              No reviews available yet.
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <div key={review.id} className="glass-card space-y-2 p-4">
                  <div className="flex items-center justify-between text-sm text-text-secondary">
                    <span>{review.user.displayName || review.user.username}</span>
                    <span>{review.rating}/5</span>
                  </div>
                  <p className="text-sm font-semibold">{review.title || "Community review"}</p>
                  <p className="text-sm text-text-secondary">{review.body || "No written review."}</p>
                  <button
                    onClick={() => handleHelpful(review.id)}
                    className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary"
                  >
                    <ThumbsUp size={12} />
                    Helpful ({review.helpfulCount})
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="glass-panel p-6">
        <CommunityCommentsSection />
      </section>
    </div>
  );
}
