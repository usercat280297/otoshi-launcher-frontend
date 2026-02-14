import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Globe, Laptop, MapPin, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useLibrary } from "../hooks/useLibrary";
import { useWishlist } from "../hooks/useWishlist";
import {
  fetchActivity,
  fetchRemoteDownloads,
  fetchUserProfile,
  queueRemoteDownload,
  updateUserProfile
} from "../services/api";
import type { ActivityEvent, RemoteDownload } from "../types";
import Input from "../components/common/Input";
import Button from "../components/common/Button";

type ProfileForm = {
  nickname: string;
  avatarUrl: string;
  backgroundImage: string;
  headline: string;
  bio: string;
  location: string;
  website: string;
  twitter: string;
  twitch: string;
  youtube: string;
};

const emptyForm: ProfileForm = {
  nickname: "",
  avatarUrl: "",
  backgroundImage: "",
  headline: "",
  bio: "",
  location: "",
  website: "",
  twitter: "",
  twitch: "",
  youtube: ""
};

export default function ProfilePage() {
  const { t } = useLocale();
  const { user, token, updateLocalUser } = useAuth();
  const { entries } = useLibrary();
  const { entries: wishlistEntries } = useWishlist();
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [remoteDownloads, setRemoteDownloads] = useState<RemoteDownload[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [queueGameId, setQueueGameId] = useState("");
  const [queueDevice, setQueueDevice] = useState("desktop-main");

  const ownedCount = entries.length;
  const installedCount = entries.filter((entry) => entry.game.installed).length;
  const wishlistCount = wishlistEntries.length;

  useEffect(() => {
    if (!queueGameId && entries.length > 0) {
      setQueueGameId(entries[0].game.id);
    }
  }, [entries, queueGameId]);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoadingProfile(false);
      return;
    }
    setLoadingProfile(true);
    fetchUserProfile(token)
      .then((profile) => {
        if (!mounted) return;
        if (!profile) {
          setForm(emptyForm);
          return;
        }
        setForm({
          nickname: profile.nickname || "",
          avatarUrl: profile.avatarUrl || "",
          backgroundImage: profile.backgroundImage || "",
          headline: profile.headline || "",
          bio: profile.bio || "",
          location: profile.location || "",
          website: profile.socialLinks?.website || "",
          twitter: profile.socialLinks?.twitter || "",
          twitch: profile.socialLinks?.twitch || "",
          youtube: profile.socialLinks?.youtube || ""
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setLoadingProfile(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setLoadingActivity(false);
      return;
    }
    setLoadingActivity(true);
    fetchActivity(token)
      .then((data) => {
        if (mounted) {
          setActivity(data);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) {
          setLoadingActivity(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  const loadRemoteDownloads = useCallback(async () => {
    if (!token) {
      setLoadingRemote(false);
      return;
    }
    setLoadingRemote(true);
    try {
      const data = await fetchRemoteDownloads(token);
      setRemoteDownloads(data);
    } catch {
      setRemoteDownloads([]);
    } finally {
      setLoadingRemote(false);
    }
  }, [token]);

  useEffect(() => {
    loadRemoteDownloads();
  }, [loadRemoteDownloads]);

  const handleProfileSave = async () => {
    if (!token) return;
    setSaving(true);
    setProfileStatus(null);
    try {
      await updateUserProfile(token, {
        nickname: form.nickname || null,
        avatarUrl: form.avatarUrl || null,
        backgroundImage: form.backgroundImage || null,
        headline: form.headline || null,
        bio: form.bio || null,
        location: form.location || null,
        socialLinks: {
          website: form.website || "",
          twitter: form.twitter || "",
          twitch: form.twitch || "",
          youtube: form.youtube || ""
        }
      });
      updateLocalUser({
        displayName: form.nickname || null
      });
      setProfileStatus("Profile updated.");
    } catch (err: any) {
      setProfileStatus(err.message || "Profile update failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleQueueRemote = async () => {
    if (!token || !queueGameId) {
      setRemoteStatus("Select a game to queue.");
      return;
    }
    setRemoteStatus(null);
    try {
      const queued = await queueRemoteDownload(
        queueGameId,
        queueDevice.trim() || "desktop-main",
        token
      );
      setRemoteDownloads((prev) => [queued, ...prev]);
      setRemoteStatus("Remote download queued.");
    } catch (err: any) {
      setRemoteStatus(err.message || "Queue request failed.");
    }
  };

  const activitySummary = useMemo(() => activity.slice(0, 8), [activity]);

  return (
    <div className="space-y-8">
      <section className="glass-panel relative overflow-hidden flex flex-wrap items-center justify-between gap-6 p-6">
        {form.backgroundImage && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
            <img
              src={form.backgroundImage}
              alt="Profile background"
              className="h-full w-full object-cover opacity-25"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/30" />
          </div>
        )}
        <div className="relative z-10 flex items-center gap-4">
          {form.avatarUrl ? (
            <img
              src={form.avatarUrl}
              alt="User avatar"
              className="h-16 w-16 rounded-2xl border border-background-border object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-lg font-semibold text-black">
              {(user?.displayName || user?.username || "OT").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-text-muted">Profile</p>
            <h1 className="text-3xl font-semibold text-glow">
              {form.nickname || user?.displayName || user?.username || "Player"}
            </h1>
            <p className="text-sm text-text-secondary">{user?.email}</p>
          </div>
        </div>
        <div className="relative z-10 flex flex-wrap gap-3 text-xs uppercase tracking-[0.3em] text-text-muted">
          <span className="rounded-full border border-background-border px-4 py-2">
            Owned {ownedCount}
          </span>
          <span className="rounded-full border border-background-border px-4 py-2">
            Installed {installedCount}
          </span>
          <span className="rounded-full border border-background-border px-4 py-2">
            Wishlist {wishlistCount}
          </span>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="glass-panel space-y-6 p-6">
          <div className="flex items-center gap-3 text-text-secondary">
            <User size={18} />
            <h2 className="section-title">Profile details</h2>
          </div>
          {loadingProfile ? (
            <div className="text-sm text-text-secondary">Loading profile...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Nickname"
                  value={form.nickname}
                  onChange={(event) => setForm((prev) => ({ ...prev, nickname: event.target.value }))}
                  placeholder={t("profile.placeholder.public_name")}
                />
                <Input
                  label="Avatar URL"
                  value={form.avatarUrl}
                  onChange={(event) => setForm((prev) => ({ ...prev, avatarUrl: event.target.value }))}
                  placeholder={t("profile.placeholder.url_example")}
                />
              </div>
              <Input
                label="Profile Background URL"
                value={form.backgroundImage}
                onChange={(event) => setForm((prev) => ({ ...prev, backgroundImage: event.target.value }))}
                placeholder={t("profile.placeholder.url_example")}
              />
              <Input
                label="Headline"
                value={form.headline}
                onChange={(event) => setForm((prev) => ({ ...prev, headline: event.target.value }))}
                placeholder={t("profile.placeholder.headline")}
              />
              <label className="flex flex-col gap-2 text-sm text-text-secondary">
                <span className="text-xs uppercase tracking-[0.3em] text-text-muted">Bio</span>
                <textarea
                  className="input-field min-h-[120px] resize-none"
                  value={form.bio}
                  onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
                  placeholder={t("profile.placeholder.bio")}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Location"
                  value={form.location}
                  onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                  placeholder={t("profile.placeholder.location")}
                  icon={<MapPin size={16} />}
                />
                <Input
                  label="Website"
                  value={form.website}
                  onChange={(event) => setForm((prev) => ({ ...prev, website: event.target.value }))}
                  placeholder={t("profile.placeholder.website")}
                  icon={<Globe size={16} />}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Input
                  label="Twitter"
                  value={form.twitter}
                  onChange={(event) => setForm((prev) => ({ ...prev, twitter: event.target.value }))}
                  placeholder={t("profile.placeholder.handle")}
                />
                <Input
                  label="Twitch"
                  value={form.twitch}
                  onChange={(event) => setForm((prev) => ({ ...prev, twitch: event.target.value }))}
                  placeholder={t("profile.placeholder.channel")}
                />
                <Input
                  label="YouTube"
                  value={form.youtube}
                  onChange={(event) => setForm((prev) => ({ ...prev, youtube: event.target.value }))}
                  placeholder={t("profile.placeholder.channel")}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleProfileSave} loading={saving}>
                  Save profile
                </Button>
                {profileStatus && (
                  <span className="text-xs text-text-secondary">{profileStatus}</span>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="glass-panel space-y-4 p-6">
          <div className="flex items-center gap-3 text-text-secondary">
            <Activity size={18} />
            <h2 className="section-title">Activity</h2>
          </div>
          {loadingActivity ? (
            <div className="text-sm text-text-secondary">Loading activity...</div>
          ) : activitySummary.length === 0 ? (
            <div className="text-sm text-text-secondary">No activity yet.</div>
          ) : (
            <div className="space-y-3">
              {activitySummary.map((event) => (
                <div key={event.id} className="glass-card space-y-1 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-text-muted">
                    {event.eventType.replace("_", " ")}
                  </p>
                  <p className="text-sm text-text-secondary">
                    {event.payload?.message ||
                      event.payload?.caption ||
                      "Activity update logged."}
                  </p>
                  <p className="text-xs text-text-muted">
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="glass-panel space-y-4 p-6">
          <div className="flex items-center gap-3 text-text-secondary">
            <Laptop size={18} />
            <h2 className="section-title">Remote downloads</h2>
          </div>
          <div className="glass-card space-y-3 p-4">
            <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Queue a game</p>
            <label className="flex flex-col gap-2 text-sm text-text-secondary">
              <span className="text-xs uppercase tracking-[0.3em] text-text-muted">Game</span>
              <select
                className="input-field"
                value={queueGameId}
                onChange={(event) => setQueueGameId(event.target.value)}
              >
                {entries.length === 0 && <option value="">No games available</option>}
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.game.id}>
                    {entry.game.title}
                  </option>
                ))}
              </select>
            </label>
            <Input
              label="Target device"
              value={queueDevice}
              onChange={(event) => setQueueDevice(event.target.value)}
              placeholder={t("profile.placeholder.target_device")}
            />
            <Button onClick={handleQueueRemote} variant="secondary">
              Queue download
            </Button>
            {remoteStatus && <p className="text-xs text-text-secondary">{remoteStatus}</p>}
          </div>
          {loadingRemote ? (
            <div className="text-sm text-text-secondary">Loading remote queue...</div>
          ) : remoteDownloads.length === 0 ? (
            <div className="text-sm text-text-secondary">No remote downloads queued.</div>
          ) : (
            <div className="space-y-3">
              {remoteDownloads.map((item) => (
                <div key={item.id} className="glass-card flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-semibold">{item.game.title}</p>
                    <p className="text-xs text-text-muted">{item.targetDevice}</p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.3em] text-text-secondary">
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="glass-panel space-y-4 p-6">
          <h2 className="section-title">Stats</h2>
          <div className="space-y-3 text-sm text-text-secondary">
            <div className="flex items-center justify-between">
              <span>Total titles</span>
              <span className="text-text-primary">{ownedCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Installed</span>
              <span className="text-text-primary">{installedCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Wishlist</span>
              <span className="text-text-primary">{wishlistCount}</span>
            </div>
          </div>
          <div className="glass-card space-y-2 p-4 text-sm text-text-secondary">
            <p className="text-xs uppercase tracking-[0.3em] text-text-muted">Next steps</p>
            <p>
              Link your social channels, then share reviews to boost your discovery score.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
