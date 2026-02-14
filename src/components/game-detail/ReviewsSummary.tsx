import { ThumbsUp, ThumbsDown, Users, Star } from "lucide-react";
import type { SteamReviewSummary } from "../../types";

type ReviewsSummaryProps = {
  reviews: SteamReviewSummary;
  playerCount?: number | null;
};

function getScoreColor(score: number): string {
  if (score >= 7) return "text-accent-green";
  if (score >= 5) return "text-accent-amber";
  return "text-accent-red";
}

function getScoreBg(score: number): string {
  if (score >= 7) return "bg-accent-green/10";
  if (score >= 5) return "bg-accent-amber/10";
  return "bg-accent-red/10";
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

export default function ReviewsSummary({ reviews, playerCount }: ReviewsSummaryProps) {
  const positivePercent =
    reviews.totalReviews > 0
      ? Math.round((reviews.totalPositive / reviews.totalReviews) * 100)
      : 0;

  return (
    <div className="glass-panel p-6">
      <p className="mb-4 text-xs uppercase tracking-[0.3em] text-text-muted">
        Community Stats
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Review Score */}
        <div className="rounded-lg border border-background-border bg-background-surface p-4">
          <div className="flex items-center gap-2">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${getScoreBg(reviews.reviewScore)}`}>
              <Star size={18} className={getScoreColor(reviews.reviewScore)} />
            </div>
            <div>
              <p className={`text-xl font-semibold ${getScoreColor(reviews.reviewScore)}`}>
                {reviews.reviewScoreDesc || "No Reviews"}
              </p>
              <p className="text-xs text-text-muted">
                {reviews.totalReviews > 0
                  ? `${formatNumber(reviews.totalReviews)} reviews`
                  : "No reviews yet"}
              </p>
            </div>
          </div>
        </div>

        {/* Positive/Negative */}
        <div className="rounded-lg border border-background-border bg-background-surface p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ThumbsUp size={16} className="text-accent-green" />
              <span className="text-sm font-medium text-accent-green">
                {formatNumber(reviews.totalPositive)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ThumbsDown size={16} className="text-accent-red" />
              <span className="text-sm font-medium text-accent-red">
                {formatNumber(reviews.totalNegative)}
              </span>
            </div>
          </div>
          {reviews.totalReviews > 0 && (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-accent-red/20">
                <div
                  className="h-full rounded-full bg-accent-green"
                  style={{ width: `${positivePercent}%` }}
                />
              </div>
              <p className="mt-1 text-center text-xs text-text-muted">
                {positivePercent}% positive
              </p>
            </div>
          )}
        </div>

        {/* Total Reviews */}
        <div className="rounded-lg border border-background-border bg-background-surface p-4">
          <p className="text-2xl font-semibold text-text-primary">
            {formatNumber(reviews.totalReviews)}
          </p>
          <p className="text-xs text-text-muted">Total Reviews</p>
        </div>

        {/* Player Count */}
        <div className="rounded-lg border border-background-border bg-background-surface p-4">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-accent-blue" />
            <div>
              <p className="text-2xl font-semibold text-text-primary">
                {playerCount != null ? formatNumber(playerCount) : "—"}
              </p>
              <p className="text-xs text-text-muted">Playing Now</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
