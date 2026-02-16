import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const perfDir = path.join(root, "perf");
const runtimeSnapshotPath = path.join(perfDir, "runtime.snapshot.json");
const stabilitySnapshotPath = path.join(perfDir, "stability.snapshot.json");
const previewPort = Number(process.env.OTOSHI_PREVIEW_PORT || 4173);
const previewHost = process.env.OTOSHI_PREVIEW_HOST || "127.0.0.1";
const previewUrl = `http://${previewHost}:${previewPort}`;
const iterationsCold = Number(process.env.OTOSHI_PERF_COLD_ITERATIONS || 3);
const iterationsWarm = Number(process.env.OTOSHI_PERF_WARM_ITERATIONS || 3);
const stabilityCycles = Number(process.env.OTOSHI_PERF_STABILITY_CYCLES || 8);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

async function waitForPreview(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1200, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(350);
  }
  throw new Error(`Timed out waiting for preview server: ${url}`);
}

function startPreviewServer() {
  const viteCli = path.join(root, "node_modules", "vite", "bin", "vite.js");
  console.log("[perf-benchmark] starting preview via vite cli:", viteCli, "cwd=", root);
  const child = spawn(process.execPath, [viteCli, "preview", "--host", previewHost, "--port", String(previewPort)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      BROWSER: "none",
    },
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[preview] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[preview] ${chunk}`));
  return child;
}

function stopProcess(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          child.kill("SIGKILL");
        }
      }
      finish();
    }, 2500);
  });
}

async function collectPageMetrics(page, url) {
  const start = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 7_000 }).catch(() => undefined);
  const startupMs = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    if (!nav) return 0;
    const domInteractive = Number(nav.domInteractive || 0);
    const domComplete = Number(nav.domComplete || 0);
    const responseEnd = Number(nav.responseEnd || 0);
    return Math.round(Math.max(domInteractive, domComplete, responseEnd, 0));
  });

  const interactiveMs = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = performance.now() + 8_000;
    while (performance.now() < deadline) {
      if (document.querySelector("[data-tour='store-allgames']")) {
        return Math.round(performance.now());
      }
      await wait(50);
    }
    return null;
  });

  return {
    startupMs: startupMs || Math.max(0, Date.now() - start),
    interactiveMs:
      interactiveMs ?? startupMs ?? Math.max(0, Date.now() - start),
  };
}

async function collectScrollStats(page) {
  return page.evaluate(async () => {
    const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    let longTasks = 0;
    let observer = null;
    try {
      if (
        typeof PerformanceObserver !== "undefined" &&
        Array.isArray(PerformanceObserver.supportedEntryTypes) &&
        PerformanceObserver.supportedEntryTypes.includes("longtask")
      ) {
        observer = new PerformanceObserver((list) => {
          longTasks += list.getEntries().length;
        });
        observer.observe({ type: "longtask", buffered: true });
      }
    } catch {
      observer = null;
    }

    const durations = [];
    const durationMs = 5000;
    const start = performance.now();
    let last = start;
    const maxScroll = Math.max(1000, document.body.scrollHeight - window.innerHeight);
    while (performance.now() - start < durationMs) {
      const elapsed = performance.now() - start;
      const ratio = Math.min(1, Math.max(0, elapsed / durationMs));
      window.scrollTo(0, Math.round(maxScroll * ratio));
      await waitFrame();
      const now = performance.now();
      durations.push(now - last);
      last = now;
    }
    observer?.disconnect();

    const avgFrame =
      durations.length > 0
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : 16.67;
    const fpsAvg = avgFrame > 0 ? 1000 / avgFrame : 0;
    return {
      longTasks,
      fpsAvg: Number(fpsAvg.toFixed(2)),
    };
  });
}

async function sampleIdleNodeStats(ms = 2500) {
  const cpuStart = process.cpuUsage();
  const timeStart = process.hrtime.bigint();
  const rssStart = process.memoryUsage().rss;
  await sleep(ms);
  const cpuDelta = process.cpuUsage(cpuStart);
  const elapsedUs = Number(process.hrtime.bigint() - timeStart) / 1000;
  const cpuPct =
    elapsedUs > 0 ? ((cpuDelta.user + cpuDelta.system) / elapsedUs) * 100 : 0;
  const rssEnd = process.memoryUsage().rss;
  return {
    idleCpuPct: Number(cpuPct.toFixed(2)),
    idleRamMb: Number((Math.max(rssStart, rssEnd) / (1024 * 1024)).toFixed(2)),
  };
}

async function main() {
  fs.mkdirSync(perfDir, { recursive: true });

  const preview = startPreviewServer();
  let browser;
  try {
    await waitForPreview(previewUrl);

    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });

    const coldStartup = [];
    const coldInteractive = [];
    for (let i = 0; i < iterationsCold; i += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const sample = await collectPageMetrics(page, `${previewUrl}/store`);
      coldStartup.push(sample.startupMs);
      coldInteractive.push(sample.interactiveMs);
      await context.close();
    }

    const warmStartup = [];
    const warmInteractive = [];
    const warmContext = await browser.newContext();
    const warmPage = await warmContext.newPage();
    await collectPageMetrics(warmPage, `${previewUrl}/store`);
    for (let i = 0; i < iterationsWarm; i += 1) {
      const sample = await collectPageMetrics(warmPage, `${previewUrl}/store`);
      warmStartup.push(sample.startupMs);
      warmInteractive.push(sample.interactiveMs);
    }

    const scrollStats = await collectScrollStats(warmPage);

    let cycleFailures = 0;
    for (let i = 0; i < stabilityCycles; i += 1) {
      try {
        const page = await warmContext.newPage();
        await collectPageMetrics(page, `${previewUrl}/store`);
        await page.close();
      } catch {
        cycleFailures += 1;
      }
    }
    await warmContext.close();

    const idleStats = await sampleIdleNodeStats();

    const runtimeSnapshot = {
      cold_start_p95_ms: Math.round(percentile(coldStartup, 95)),
      warm_start_p95_ms: Math.round(percentile(warmStartup, 95)),
      store_first_interactive_ms: Math.round(percentile(coldInteractive, 95)),
      long_tasks: Number(scrollStats.longTasks || 0),
      fps_avg: Number(scrollStats.fpsAvg || 0),
      idle_cpu_pct: Number(idleStats.idleCpuPct || 0),
      idle_ram_mb: Number(idleStats.idleRamMb || 0),
      details: {
        cold_start_samples_ms: coldStartup,
        warm_start_samples_ms: warmStartup,
        cold_interactive_samples_ms: coldInteractive,
        warm_interactive_samples_ms: warmInteractive,
        cold_start_median_ms: Number(median(coldStartup).toFixed(2)),
        warm_start_median_ms: Number(median(warmStartup).toFixed(2)),
      },
      generated_at: new Date().toISOString(),
    };

    const stabilitySnapshot = {
      crash_blockers: cycleFailures,
      release_blockers: cycleFailures > 0 ? 1 : 0,
      cycles: stabilityCycles,
      failures: cycleFailures,
      generated_at: new Date().toISOString(),
    };

    fs.writeFileSync(runtimeSnapshotPath, `${JSON.stringify(runtimeSnapshot, null, 2)}\n`);
    fs.writeFileSync(stabilitySnapshotPath, `${JSON.stringify(stabilitySnapshot, null, 2)}\n`);

    console.log("[perf-benchmark] runtime snapshot:", runtimeSnapshotPath);
    console.log("[perf-benchmark] stability snapshot:", stabilitySnapshotPath);
    console.log("[perf-benchmark] runtime", JSON.stringify(runtimeSnapshot, null, 2));
    console.log("[perf-benchmark] stability", JSON.stringify(stabilitySnapshot, null, 2));
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    await stopProcess(preview);
  }
}

main().catch((error) => {
    console.error("[perf-benchmark] failed:", error);
    process.exit(2);
  });
