import { useEffect, useMemo, useState } from "react";
import { BarChart3, Box, UploadCloud } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useGames } from "../hooks/useGames";
import {
  createDeveloperDepot,
  fetchDeveloperAnalytics,
  fetchDeveloperBuilds,
  fetchDeveloperDepots,
  uploadDeveloperBuild
} from "../services/api";
import type {
  DeveloperAnalytics,
  DeveloperBuild,
  DeveloperDepot
} from "../types";
import Input from "../components/common/Input";
import Button from "../components/common/Button";

export default function DeveloperPage() {
  const { token } = useAuth();
  const { t } = useLocale();
  const { games } = useGames();
  const [analytics, setAnalytics] = useState<DeveloperAnalytics[]>([]);
  const [depots, setDepots] = useState<DeveloperDepot[]>([]);
  const [builds, setBuilds] = useState<DeveloperBuild[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [selectedDepotId, setSelectedDepotId] = useState("");
  const [depotName, setDepotName] = useState("");
  const [depotPlatform, setDepotPlatform] = useState("windows");
  const [depotBranch, setDepotBranch] = useState("main");
  const [buildVersion, setBuildVersion] = useState("");
  const [buildFile, setBuildFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const gameMap = useMemo(() => {
    return new Map(games.map((game) => [game.id, game]));
  }, [games]);

  useEffect(() => {
    if (!selectedGameId && games.length > 0) {
      setSelectedGameId(games[0].id);
    }
  }, [games, selectedGameId]);

  useEffect(() => {
    let mounted = true;
    if (!token) return;
    setLoading(true);
    fetchDeveloperAnalytics(token, selectedGameId || undefined)
      .then((data) => {
        if (mounted) {
          setAnalytics(data);
        }
      })
      .catch((err: any) => {
        if (mounted) {
          setStatus(err.message || "Developer analytics failed.");
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
  }, [token, selectedGameId]);

  useEffect(() => {
    let mounted = true;
    if (!token || !selectedGameId) {
      setDepots([]);
      return;
    }
    fetchDeveloperDepots(selectedGameId, token)
      .then((data) => {
        if (!mounted) return;
        setDepots(data);
        const nextId = data[0]?.id || "";
        const hasSelection = data.some((depot) => depot.id === selectedDepotId);
        if (!hasSelection) {
          setSelectedDepotId(nextId);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [token, selectedGameId, selectedDepotId]);

  useEffect(() => {
    let mounted = true;
    if (!token || !selectedDepotId) return;
    fetchDeveloperBuilds(selectedDepotId, token)
      .then((data) => {
        if (mounted) {
          setBuilds(data);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [token, selectedDepotId]);

  const handleCreateDepot = async () => {
    if (!token || !selectedGameId) return;
    setStatus(null);
    try {
      const depot = await createDeveloperDepot(selectedGameId, token, {
        name: depotName,
        platform: depotPlatform,
        branch: depotBranch
      });
      setDepots((prev) => [depot, ...prev]);
      setDepotName("");
      setStatus("Depot created.");
    } catch (err: any) {
      setStatus(err.message || "Depot creation failed.");
    }
  };

  const handleUploadBuild = async () => {
    if (!token || !selectedDepotId || !buildFile || !buildVersion) {
      setStatus("Provide version and build file.");
      return;
    }
    setStatus(null);
    try {
      const build = await uploadDeveloperBuild(selectedDepotId, token, {
        version: buildVersion,
        file: buildFile
      });
      setBuilds((prev) => [build, ...prev]);
      setBuildVersion("");
      setBuildFile(null);
      setStatus("Build uploaded.");
    } catch (err: any) {
      setStatus(err.message || "Build upload failed.");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3 text-text-secondary">
        <BarChart3 size={18} />
        <p className="text-xs uppercase tracking-[0.4em]">Developer portal</p>
      </div>
      <div>
        <h1 className="text-3xl font-semibold text-glow">Analytics and depots</h1>
        <p className="text-sm text-text-secondary">
          Manage builds, branches, and live metrics for your catalog.
        </p>
      </div>

      {status && <div className="glass-panel p-4 text-sm text-text-secondary">{status}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="glass-panel space-y-4 p-6">
          <h2 className="section-title">Analytics snapshot</h2>
          <label className="flex flex-col gap-2 text-sm text-text-secondary">
            <span className="text-xs uppercase tracking-[0.3em] text-text-muted">Game</span>
            <select
              className="input-field"
              value={selectedGameId}
              onChange={(event) => setSelectedGameId(event.target.value)}
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.title}
                </option>
              ))}
            </select>
          </label>
          {loading ? (
            <div className="text-sm text-text-secondary">Loading analytics...</div>
          ) : analytics.length === 0 ? (
            <div className="text-sm text-text-secondary">No analytics available.</div>
          ) : (
            <div className="space-y-3">
              {analytics.map((snapshot) => {
                const game = gameMap.get(snapshot.gameId);
                const metrics = snapshot.metrics || {};
                return (
                  <div key={snapshot.gameId} className="glass-card space-y-2 p-4">
                    <p className="text-sm font-semibold">
                      {game?.title || snapshot.gameId}
                    </p>
                    <div className="grid gap-2 text-xs text-text-secondary md:grid-cols-2">
                      <span>Total sales: ${metrics.total_sales ?? 0}</span>
                      <span>Transactions: {metrics.total_transactions ?? 0}</span>
                      <span>Library count: {metrics.library_count ?? 0}</span>
                      <span>Downloads: {metrics.total_downloads ?? 0}</span>
                      <span>Rating: {metrics.rating ?? 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="glass-panel space-y-4 p-6">
          <div className="flex items-center gap-2 text-text-secondary">
            <Box size={18} />
            <h2 className="section-title">Create depot</h2>
          </div>
          <Input
            label={t("developer.depot_name")}
            value={depotName}
            onChange={(event) => setDepotName(event.target.value)}
            placeholder={t("developer.placeholder.depot_name")}
          />
          <Input
            label={t("developer.platform")}
            value={depotPlatform}
            onChange={(event) => setDepotPlatform(event.target.value)}
            placeholder={t("developer.placeholder.platform")}
          />
          <Input
            label={t("developer.branch")}
            value={depotBranch}
            onChange={(event) => setDepotBranch(event.target.value)}
            placeholder={t("developer.placeholder.branch")}
          />
          <Button onClick={handleCreateDepot} variant="secondary">
            Create depot
          </Button>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="glass-panel space-y-4 p-6">
          <h2 className="section-title">Depots</h2>
          {depots.length === 0 ? (
            <div className="text-sm text-text-secondary">No depots yet.</div>
          ) : (
            <div className="space-y-3">
              {depots.map((depot) => (
                <button
                  key={depot.id}
                  onClick={() => setSelectedDepotId(depot.id)}
                  className={`glass-card w-full space-y-1 p-4 text-left transition ${
                    selectedDepotId === depot.id ? "border-primary" : ""
                  }`}
                >
                  <p className="text-sm font-semibold">{depot.name}</p>
                  <p className="text-xs text-text-secondary">
                    {depot.platform} | {depot.branch}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="glass-panel space-y-4 p-6">
          <div className="flex items-center gap-2 text-text-secondary">
            <UploadCloud size={18} />
            <h2 className="section-title">Builds</h2>
          </div>
          <Input
            label={t("developer.version")}
            value={buildVersion}
            onChange={(event) => setBuildVersion(event.target.value)}
            placeholder={t("developer.placeholder.version")}
          />
          <input
            type="file"
            onChange={(event) => setBuildFile(event.target.files?.[0] || null)}
            className="w-full rounded-md border border-background-border bg-background-surface px-4 py-2 text-sm text-text-secondary"
          />
          <Button onClick={handleUploadBuild}>
            Upload build
          </Button>
          {builds.length === 0 ? (
            <div className="text-sm text-text-secondary">No builds uploaded.</div>
          ) : (
            <div className="space-y-3">
              {builds.map((build) => (
                <div key={build.id} className="glass-card space-y-1 p-4">
                  <p className="text-sm font-semibold">Version {build.version}</p>
                  <p className="text-xs text-text-secondary">
                    {build.manifest.file_name || "Build artifact"} (
                    {build.manifest.file_size || 0} bytes)
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
