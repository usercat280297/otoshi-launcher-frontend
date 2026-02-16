import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runtimeSnapshotPath =
  process.env.OTOSHI_RUNTIME_METRICS_FILE ||
  path.join(root, "perf", "runtime.snapshot.json");
const stabilitySnapshotPath =
  process.env.OTOSHI_STABILITY_METRICS_FILE ||
  path.join(root, "perf", "stability.snapshot.json");

const requireRuntimeSnapshot = process.env.OTOSHI_REQUIRE_RUNTIME_METRICS === "1";
const requireStabilitySnapshot = process.env.OTOSHI_REQUIRE_STABILITY_METRICS === "1";

const KPI = {
  coldStartP95MsMax: Number(process.env.OTOSHI_KPI_COLD_START_P95_MS || 3000),
  warmStartP95MsMax: Number(process.env.OTOSHI_KPI_WARM_START_P95_MS || 800),
  storeInteractiveMsMax: Number(process.env.OTOSHI_KPI_STORE_INTERACTIVE_MS || 1200),
  maxLongTasks: Number(process.env.OTOSHI_KPI_MAX_LONG_TASKS || 24),
  minFpsAvg: Number(process.env.OTOSHI_KPI_MIN_FPS || 50),
  idleCpuPctMax: Number(process.env.OTOSHI_KPI_IDLE_CPU_PCT || 3),
  idleRamMbMax: Number(process.env.OTOSHI_KPI_IDLE_RAM_MB || 250),
  maxCrashBlockers: Number(process.env.OTOSHI_KPI_MAX_CRASH_BLOCKERS || 0),
  maxReleaseBlockers: Number(process.env.OTOSHI_KPI_MAX_RELEASE_BLOCKERS || 0),
};

const report = {
  runtimeSnapshotPath,
  stabilitySnapshotPath,
  kpi: KPI,
  runtime: null,
  stability: null,
  failures: [],
  warnings: [],
};

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function pickNumber(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function checkMax(value, limit, label) {
  if (value == null) {
    report.warnings.push(`${label} missing`);
    return;
  }
  if (value > limit) {
    report.failures.push(`${label}=${value} exceeds max ${limit}`);
  }
}

function checkMin(value, limit, label) {
  if (value == null) {
    report.warnings.push(`${label} missing`);
    return;
  }
  if (value < limit) {
    report.failures.push(`${label}=${value} below min ${limit}`);
  }
}

const runtime = readJsonIfExists(runtimeSnapshotPath);
if (!runtime) {
  if (requireRuntimeSnapshot) {
    report.failures.push(
      `Missing runtime perf snapshot: ${runtimeSnapshotPath}`
    );
  } else {
    report.warnings.push(
      `Runtime perf snapshot not found (set OTOSHI_REQUIRE_RUNTIME_METRICS=1 to enforce): ${runtimeSnapshotPath}`
    );
  }
} else {
  const coldStart = pickNumber(runtime, [
    "cold_start_p95_ms",
    "coldStartP95Ms",
    "startup_ms",
    "startupMs",
  ]);
  const warmStart = pickNumber(runtime, ["warm_start_p95_ms", "warmStartP95Ms"]);
  const interactive = pickNumber(runtime, [
    "store_first_interactive_ms",
    "storeFirstInteractiveMs",
    "interactive_ms",
    "interactiveMs",
  ]);
  const longTasks = pickNumber(runtime, ["long_tasks", "longTasks"]);
  const fpsAvg = pickNumber(runtime, ["fps_avg", "fpsAvg"]);
  const idleCpu = pickNumber(runtime, ["idle_cpu_pct", "idleCpuPct"]);
  const idleRam = pickNumber(runtime, ["idle_ram_mb", "idleRamMb"]);

  report.runtime = {
    coldStart,
    warmStart,
    interactive,
    longTasks,
    fpsAvg,
    idleCpu,
    idleRam,
  };

  checkMax(coldStart, KPI.coldStartP95MsMax, "cold_start_p95_ms");
  checkMax(warmStart, KPI.warmStartP95MsMax, "warm_start_p95_ms");
  checkMax(interactive, KPI.storeInteractiveMsMax, "store_first_interactive_ms");
  checkMax(longTasks, KPI.maxLongTasks, "long_tasks");
  checkMin(fpsAvg, KPI.minFpsAvg, "fps_avg");
  checkMax(idleCpu, KPI.idleCpuPctMax, "idle_cpu_pct");
  checkMax(idleRam, KPI.idleRamMbMax, "idle_ram_mb");
}

const stability = readJsonIfExists(stabilitySnapshotPath);
if (!stability) {
  if (requireStabilitySnapshot) {
    report.failures.push(
      `Missing stability snapshot: ${stabilitySnapshotPath}`
    );
  } else {
    report.warnings.push(
      `Stability snapshot not found (set OTOSHI_REQUIRE_STABILITY_METRICS=1 to enforce): ${stabilitySnapshotPath}`
    );
  }
} else {
  const crashBlockers = pickNumber(stability, [
    "crash_blockers",
    "crashBlockers",
    "crash_blocker_count",
    "crashBlockerCount",
  ]);
  const releaseBlockers = pickNumber(stability, [
    "release_blockers",
    "releaseBlockers",
    "blocker_regressions",
    "blockerRegressions",
  ]);

  report.stability = {
    crashBlockers,
    releaseBlockers,
  };

  checkMax(crashBlockers, KPI.maxCrashBlockers, "crash_blockers");
  checkMax(releaseBlockers, KPI.maxReleaseBlockers, "release_blockers");
}

console.log("[perf-stability-gate]", JSON.stringify(report, null, 2));

if (report.failures.length > 0) {
  process.exit(2);
}
