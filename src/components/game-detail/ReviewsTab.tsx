import { useEffect, useState } from "react";
import { Star, ThumbsUp } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLocale } from "../../context/LocaleContext";
import { fetchReviews, markReviewHelpful, postReview } from "../../services/api";
import { Review } from "../../types";
import Button from "../common/Button";

type ReviewsTabProps = {
  gameId: string;
};

export default function ReviewsTab({ gameId }: ReviewsTabProps) {
  const { token } = useAuth();
  const { t } = useLocale();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [recommended, setRecommended] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchReviews(gameId)
      .then((data) => {
        if (mounted) {
          setReviews(data);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message || "Failed to load reviews");
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
  }, [gameId]);

  const handleSubmit = async () => {
    if (!token) {
      setError("Sign in to post a review.");
      return;
    }
    setError(null);
    const next = await postReview(gameId, token, {
      rating,
      title,
      body,
      recommended
    });
    setReviews((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    setTitle("");
    setBody("");
  };

  const handleHelpful = async (reviewId: string) => {
    if (!token) {
      setError("Sign in to vote helpful.");
      return;
    }
    const updated = await markReviewHelpful(reviewId, token);
    setReviews((current) =>
      current.map((review) => (review.id === updated.id ? updated : review))
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-text-muted">Critics</p>
          <p className="text-3xl font-semibold">
            {reviews.length > 0
              ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)
              : "0.0"}
          </p>
        </div>
        <div className="text-right text-sm text-text-secondary">
          <p>Based on {reviews.length} reviews</p>
          <p className="text-xs">Game ID: {gameId}</p>
        </div>
      </div>

      {loading ? (
        <div className="glass-panel p-4 text-sm text-text-secondary">Loading reviews...</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {reviews.length === 0 && (
            <div className="glass-panel p-4 text-sm text-text-secondary">
              No reviews yet. Be the first to share feedback.
            </div>
          )}
          {reviews.map((review) => (
            <div key={review.id} className="glass-card space-y-3 p-4">
              <div className="flex items-center justify-between text-sm text-text-secondary">
                <span>{review.user.displayName || review.user.username}</span>
                <span className="flex items-center gap-1 text-primary">
                  <Star size={14} fill="currentColor" />
                  {review.rating}.0
                </span>
              </div>
              {review.title && <p className="text-sm font-semibold">{review.title}</p>}
              <p className="text-sm text-text-secondary">{review.body || "No written review."}</p>
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>{review.recommended ? "Recommended" : "Not recommended"}</span>
                <button
                  onClick={() => handleHelpful(review.id)}
                  className="flex items-center gap-1 text-primary hover:text-primary-hover"
                >
                  <ThumbsUp size={14} /> Helpful ({review.helpfulCount})
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="glass-panel space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs uppercase tracking-[0.3em] text-text-muted">Your review</span>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={recommended}
                onChange={() => setRecommended((value) => !value)}
              />
              Recommend
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {[5, 4, 3, 2, 1].map((value) => (
            <button
              key={value}
              onClick={() => setRating(value)}
              className={`flex items-center gap-1 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                rating === value
                  ? "border-primary text-primary"
                  : "border-background-border text-text-muted"
              }`}
            >
              <Star size={12} />
              {value}
            </button>
          ))}
        </div>
        <input
          className="input-field"
          placeholder={t("reviews.headline_placeholder")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <textarea
          className="input-field min-h-[120px]"
          placeholder={t("reviews.body_placeholder")}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        {error && <p className="text-sm text-accent-red">{error}</p>}
        <Button onClick={handleSubmit}>{t("reviews.publish")}</Button>
      </div>
    </div>
  );
}
