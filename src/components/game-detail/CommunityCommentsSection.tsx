import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Send, MessageSquare } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import {
  fetchCommunityComments,
  getPreferredApiBase,
  postCommunityComment,
} from "../../services/api";
import type { CommunityComment } from "../../types";
import Button from "../common/Button";

type Props = {
  appId?: string;
  appName?: string;
};

function upsertComment(
  current: CommunityComment[],
  incoming: CommunityComment
): CommunityComment[] {
  const exists = current.some((item) => item.id === incoming.id);
  if (exists) return current;
  const merged = [...current, incoming];
  merged.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  return merged;
}

export default function CommunityCommentsSection({ appId, appName }: Props) {
  const { token } = useAuth();
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const pollTimerRef = useRef<number | null>(null);
  const heartbeatRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetchCommunityComments({ limit: 200 })
      .then((data) => {
        if (!mounted) return;
        setComments(data);
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err?.message || "Failed to load comments.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Public near-realtime refresh for everyone.
  useEffect(() => {
    pollTimerRef.current = window.setInterval(async () => {
      try {
        const data = await fetchCommunityComments({ limit: 200 });
        setComments(data);
      } catch {
        // keep current list
      }
    }, 8000);
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  // Authenticated realtime stream via websocket.
  useEffect(() => {
    if (!token) return;

    const baseUrl = getPreferredApiBase();
    if (!baseUrl) return;
    const wsUrl = `${baseUrl.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(
      token
    )}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type !== "community_comment" || !payload?.payload) return;
        setComments((current) => upsertComment(current, payload.payload));
      } catch {
        // ignore malformed websocket event
      }
    };

    ws.onopen = () => {
      heartbeatRef.current = window.setInterval(() => {
        try {
          ws.send(JSON.stringify({ type: "heartbeat" }));
        } catch {
          // connection might already be closed
        }
      }, 20000);
    };

    return () => {
      if (heartbeatRef.current) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      ws.close();
    };
  }, [token]);

  const visibleComments = useMemo(() => {
    return comments.slice(-150);
  }, [comments]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) {
      setError("Sign in to publish a comment.");
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) return;

    setError(null);
    setSending(true);
    try {
      const created = await postCommunityComment(token, {
        message: trimmed,
        appId: appId || undefined,
        appName: appName || undefined,
      });
      setComments((current) => upsertComment(current, created));
      setMessage("");
    } catch (err: any) {
      setError(err?.message || "Failed to publish comment.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-text-secondary">
        <MessageSquare size={16} />
        <p className="text-xs uppercase tracking-[0.3em]">Community Publish</p>
      </div>

      {loading ? (
        <div className="rounded-lg border border-background-border bg-background-surface p-4 text-sm text-text-secondary">
          Loading comments...
        </div>
      ) : (
        <div className="max-h-[420px] space-y-2 overflow-y-auto rounded-lg border border-background-border bg-background-surface p-4">
          {visibleComments.length === 0 ? (
            <p className="text-sm text-text-secondary">
              No comments yet. Be the first to publish.
            </p>
          ) : (
            visibleComments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-md border border-background-border bg-background-muted/60 p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {comment.displayName || comment.username}
                    </span>
                    {comment.appName && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
                        {comment.appName}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-text-muted">
                    {new Date(comment.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-text-secondary">
                  {comment.message}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          className="input-field min-h-[92px] resize-none"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={
            token
              ? "Publish a comment to everyone..."
              : "Sign in to publish comments"
          }
          disabled={!token || sending}
          maxLength={1000}
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted">
            {token
              ? "Comments are public, saved in history, and broadcast in real time."
              : "View is public. Posting requires login."}
          </p>
          <Button
            type="submit"
            icon={<Send size={14} />}
            disabled={!token || sending || !message.trim()}
          >
            {sending ? "Publishing..." : "Publish"}
          </Button>
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-accent-red/30 bg-accent-red/10 p-3 text-sm text-accent-red">
          {error}
        </div>
      )}
    </div>
  );
}
