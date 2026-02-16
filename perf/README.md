# Perf and Stability Snapshots

`perf:stability-gate` can enforce runtime KPIs using snapshot files:

- `frontend/perf/runtime.snapshot.json`
- `frontend/perf/stability.snapshot.json`

When these files are present, the gate validates them against KPI thresholds.

Set strict enforcement in CI with:

- `OTOSHI_REQUIRE_RUNTIME_METRICS=1`
- `OTOSHI_REQUIRE_STABILITY_METRICS=1`

Generate snapshots locally (build + preview benchmark) with:

```bash
npm run perf:benchmark-snapshots
```

Generate desktop Tauri smoke snapshots (Windows) with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./frontend/scripts/tauri-perf-smoke.ps1
```

## Runtime snapshot schema (example)

```json
{
  "cold_start_p95_ms": 2450,
  "warm_start_p95_ms": 620,
  "store_first_interactive_ms": 930,
  "long_tasks": 8,
  "fps_avg": 58.4,
  "idle_cpu_pct": 2.2,
  "idle_ram_mb": 214
}
```

## Stability snapshot schema (example)

```json
{
  "crash_blockers": 0,
  "release_blockers": 0
}
```
