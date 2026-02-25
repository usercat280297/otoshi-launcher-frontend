import { Circle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchCommunityMembers } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import type { CommunityMember } from "../../types";
import { membershipTierLabel } from "../../utils/membership";

type StoreMembersSidebarProps = {
  className?: string;
  limit?: number;
  pollIntervalMs?: number;
};

const toDisplayName = (member: CommunityMember): string =>
  member.displayName || member.username || "Unknown";

const toInitials = (member: CommunityMember): string => {
  const value = toDisplayName(member).trim();
  if (!value) return "??";
  return value.slice(0, 2).toUpperCase();
};

const parseLastSeenMs = (value?: string | null): number => {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const formatMemberLastSeen = (member: CommunityMember): string => {
  if (member.isOnline) return "Online";
  if (!member.lastSeenAt) return "Offline";
  try {
    return `Seen ${new Date(member.lastSeenAt).toLocaleTimeString()}`;
  } catch {
    return "Offline";
  }
};

function MemberRow({ member }: { member: CommunityMember }) {
  const displayName = toDisplayName(member);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-background-border bg-background-muted/40 px-3 py-2">
      {member.avatarUrl ? (
        <img
          src={member.avatarUrl}
          alt={displayName}
          className="h-9 w-9 rounded-md object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-[10px] font-semibold text-black">
          {toInitials(member)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary">{displayName}</p>
        <div className="flex items-center gap-1.5">
          <Circle
            size={8}
            className={
              member.isOnline
                ? "fill-emerald-400 text-emerald-400"
                : "fill-zinc-500 text-zinc-500"
            }
          />
          <p className="truncate text-[11px] text-text-muted">
            {formatMemberLastSeen(member)}
          </p>
        </div>
      </div>
      {member.membershipTier && (member.membershipActive ?? true) ? (
        <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-cyan-200">
          {membershipTierLabel(member.membershipTier)}
        </span>
      ) : null}
    </div>
  );
}

export default function StoreMembersSidebar({
  className,
  limit = 220,
  pollIntervalMs = 30_000,
}: StoreMembersSidebarProps) {
  const { token } = useAuth();
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;

    const loadMembers = async (showSpinner: boolean) => {
      if (showSpinner && mounted) {
        setLoading(true);
      }
      try {
        const data = await fetchCommunityMembers({ limit }, token || undefined);
        if (mounted) {
          setMembers(data);
        }
      } catch {
        if (mounted && showSpinner) {
          setMembers([]);
        }
      } finally {
        if (mounted && showSpinner) {
          setLoading(false);
        }
      }
    };

    void loadMembers(true);
    const intervalId = window.setInterval(() => {
      void loadMembers(false);
    }, pollIntervalMs);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [limit, pollIntervalMs, token]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredMembers = useMemo(() => {
    if (!normalizedSearch) return members;
    return members.filter((member) => {
      const displayName = toDisplayName(member).toLowerCase();
      const username = (member.username || "").toLowerCase();
      return (
        displayName.includes(normalizedSearch) ||
        username.includes(normalizedSearch)
      );
    });
  }, [members, normalizedSearch]);

  const onlineMembers = useMemo(
    () => filteredMembers.filter((member) => member.isOnline),
    [filteredMembers]
  );

  const offlineMembers = useMemo(
    () =>
      filteredMembers
        .filter((member) => !member.isOnline)
        .sort((a, b) => parseLastSeenMs(b.lastSeenAt) - parseLastSeenMs(a.lastSeenAt)),
    [filteredMembers]
  );

  return (
    <aside className={`glass-panel flex h-full flex-col overflow-hidden p-0 ${className || ""}`}>
      <div className="border-b border-background-border p-3">
        <p className="text-xs uppercase tracking-[0.26em] text-text-muted">
          Members
        </p>
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-background-border bg-background-elevated px-3 py-2">
          <Search size={14} className="text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search members..."
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 scrollbar-elegant overscroll-contain"
        onWheel={(event) => {
          event.stopPropagation();
        }}
      >
        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted">
            Online - {onlineMembers.length}
          </p>
          {onlineMembers.length === 0 ? (
            <p className="rounded-lg border border-background-border bg-background-muted/30 px-3 py-2 text-xs text-text-muted">
              No online members.
            </p>
          ) : (
            onlineMembers.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))
          )}
        </section>

        <section className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-text-muted">
            Offline - {offlineMembers.length}
          </p>
          {offlineMembers.length === 0 ? (
            <p className="rounded-lg border border-background-border bg-background-muted/30 px-3 py-2 text-xs text-text-muted">
              No offline members.
            </p>
          ) : (
            offlineMembers.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))
          )}
        </section>

        {loading && members.length === 0 ? (
          <p className="rounded-lg border border-background-border bg-background-muted/30 px-3 py-2 text-xs text-text-muted">
            Loading members...
          </p>
        ) : null}
      </div>
    </aside>
  );
}
