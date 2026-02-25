import { useEffect, useMemo, useState } from "react";
import { Circle, MessageCircle, ThumbsUp, Trophy, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useGames } from "../hooks/useGames";
import {
  fetchActivity,
  fetchCommunityMembers,
  fetchDonationLeaderboard,
  fetchReviews,
  markReviewHelpful,
} from "../services/api";
import type {
  ActivityEvent,
  CommunityMember,
  DonationLeaderboardEntry,
  Review,
} from "../types";
import CommunityCommentsSection from "../components/game-detail/CommunityCommentsSection";

type LeaderboardPeriod = "week" | "month" | "year";

export default function CommunityPage() {
  const { token } = useAuth();
  const { games } = useGames();
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [leaderboard, setLeaderboard] = useState<DonationLeaderboardEntry[]>([]);
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<LeaderboardPeriod>("week");
  const [loading, setLoading] = useState(true);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
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

  useEffect(() => {
    let mounted = true;
    setMembersLoading(true);
    fetchCommunityMembers({ limit: 220 })
      .then((data) => {
        if (mounted) {
          setMembers(data);
        }
      })
      .catch(() => {
        if (mounted) {
          setMembers([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setMembersLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setLeaderboardLoading(true);
    fetchDonationLeaderboard(leaderboardPeriod, 20)
      .then((data) => {
        if (mounted) {
          setLeaderboard(data);
        }
      })
      .catch(() => {
        if (mounted) {
          setLeaderboard([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setLeaderboardLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [leaderboardPeriod]);

  const handleHelpful = async (reviewId: string) => {
    if (!token) return;
    const updated = await markReviewHelpful(reviewId, token);
    setReviews((current) =>
      current.map((review) => (review.id === updated.id ? updated : review))
    );
  };

  const membersOnlineCount = useMemo(
    () => members.filter((member) => member.isOnline).length,
    [members]
  );

  const formatDonationAmount = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  };

  const formatMemberLastSeen = (member: CommunityMember) => {
    if (member.isOnline) {
      return "Online";
    }
    if (!member.lastSeenAt) {
      return "Offline";
    }
    try {
      return `Seen ${new Date(member.lastSeenAt).toLocaleTimeString()}`;
    } catch {
      return "Offline";
    }
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <section className="space-y-4">
              <h2 className="section-title">Activity feed</h2>
              {loading ? (
                <div className="glass-panel p-5 text-sm text-text-secondary">
                  Loading activity...
                </div>
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
                          {event.payload?.message ||
                            event.payload?.caption ||
                            "New activity posted."}
                        </p>
                        <p className="text-xs text-text-muted">
                          {new Date(event.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <h2 className="section-title">Trending reviews</h2>
              {reviewLoading ? (
                <div className="glass-panel p-5 text-sm text-text-secondary">
                  Loading reviews...
                </div>
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
                      <p className="text-sm text-text-secondary">
                        {review.body || "No written review."}
                      </p>
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

        <aside className="space-y-4">
          <section className="glass-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title text-base">Members</h2>
              <p className="text-xs uppercase tracking-[0.2em] text-text-muted">
                {membersOnlineCount}/{members.length} online
              </p>
            </div>
            {membersLoading ? (
              <p className="text-sm text-text-secondary">Loading members...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-text-secondary">No members found.</p>
            ) : (
              <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                {members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center gap-3 rounded-lg border border-background-border bg-background-muted/40 px-3 py-2"
                  >
                    {member.avatarUrl ? (
                      <img
                        src={member.avatarUrl}
                        alt={member.displayName || member.username}
                        className="h-8 w-8 rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-black">
                        {(member.displayName || member.username).slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-primary">
                        {member.displayName || member.username}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Circle
                          size={8}
                          className={member.isOnline ? "fill-emerald-400 text-emerald-400" : "fill-zinc-500 text-zinc-500"}
                        />
                        <p className="truncate text-[11px] text-text-muted">
                          {formatMemberLastSeen(member)}
                        </p>
                      </div>
                    </div>
                    {member.membershipTier ? (
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-cyan-200">
                        {member.membershipTier}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="glass-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy size={16} className="text-amber-300" />
                <h2 className="section-title text-base">Donate leaderboard</h2>
              </div>
            </div>
            <div className="mb-3 flex gap-2">
              {(["week", "month", "year"] as LeaderboardPeriod[]).map((period) => (
                <button
                  key={period}
                  type="button"
                  onClick={() => setLeaderboardPeriod(period)}
                  className={`rounded-md px-2 py-1 text-xs uppercase tracking-[0.14em] ${
                    leaderboardPeriod === period
                      ? "bg-primary text-black"
                      : "border border-background-border text-text-secondary"
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
            {leaderboardLoading ? (
              <p className="text-sm text-text-secondary">Loading leaderboard...</p>
            ) : leaderboard.length === 0 ? (
              <p className="text-sm text-text-secondary">No donations for this period.</p>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry) => (
                  <div
                    key={`${entry.userId}-${entry.rank}`}
                    className="flex items-center justify-between rounded-lg border border-background-border bg-background-muted/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text-primary">
                        #{entry.rank} {entry.displayName || entry.username}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {entry.isOnline ? "Online" : "Offline"}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-text-primary">
                      {formatDonationAmount(entry.totalAmount, entry.currency)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
