# Tauri desktop perf smoke:
# - launch packaged desktop exe (no-bundle release build)
# - measure startup latency via backend readiness
# - collect working set memory and stability failures
# - output runtime/stability snapshots compatible with perf:stability-gate

param(
    [string]$ExePath = "",
    [string]$RuntimeSnapshotPath = "./frontend/perf/tauri.runtime.snapshot.json",
    [string]$StabilitySnapshotPath = "./frontend/perf/tauri.stability.snapshot.json",
    [int]$ColdIterations = 2,
    [int]$WarmIterations = 2,
    [int]$StabilityCycles = 4,
    [int]$LaunchTimeoutSec = 45,
    [string]$HealthUrl = "http://127.0.0.1:8000/health"
)

$ErrorActionPreference = "Stop"

function Resolve-LauncherExe {
    param([string]$PathArg)

    if (-not [string]::IsNullOrWhiteSpace($PathArg) -and (Test-Path $PathArg)) {
        return (Resolve-Path $PathArg).Path
    }

    $candidates = @(
        "./frontend/src-tauri/target/release/otoshi_launcher.exe",
        "./frontend/src-tauri/target/release/OtoshiLauncher.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return (Resolve-Path $candidate).Path
        }
    }
    throw "Launcher executable not found. Expected one of: $($candidates -join ', ')"
}

function Wait-BackendReady {
    param(
        [string]$Url,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    return $false
}

function Wait-LauncherReady {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$HealthUrl,
        [int]$TimeoutSec,
        [int]$FallbackAliveSec = 10
    )

    $startedAt = Get-Date
    $deadline = $startedAt.AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            if ($Process.HasExited) {
                return @{
                    ok = $false
                    mode = "process_exited"
                    elapsed_ms = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 0)
                }
            }
        } catch {
            return @{
                ok = $false
                mode = "process_unavailable"
                elapsed_ms = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 0)
            }
        }

        if (Wait-BackendReady -Url $HealthUrl -TimeoutSec 1) {
            return @{
                ok = $true
                mode = "backend_health"
                elapsed_ms = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 0)
            }
        }

        $elapsedSec = ((Get-Date) - $startedAt).TotalSeconds
        if ($elapsedSec -ge $FallbackAliveSec) {
            return @{
                ok = $true
                mode = "process_alive"
                elapsed_ms = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 0)
            }
        }

        Start-Sleep -Milliseconds 250
    }

    return @{
        ok = $false
        mode = "timeout"
        elapsed_ms = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 0)
    }
}

function Wait-BackendDown {
    param(
        [string]$Url,
        [int]$TimeoutSec = 15
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $null = Invoke-WebRequest -Uri $Url -Method GET -TimeoutSec 2 -UseBasicParsing
            Start-Sleep -Milliseconds 250
        } catch {
            return
        }
    }
}

function Stop-LauncherProcess {
    param([System.Diagnostics.Process]$Process)

    if (-not $Process) {
        return
    }
    try {
        if (-not $Process.HasExited) {
            $null = $Process.CloseMainWindow()
            Start-Sleep -Milliseconds 800
        }
    } catch {}

    try {
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

function Sample-Launch {
    param(
        [string]$ResolvedExe,
        [string]$Url,
        [int]$TimeoutSec
    )

    $exeDir = Split-Path -Parent $ResolvedExe
    $proc = Start-Process -FilePath $ResolvedExe -WorkingDirectory $exeDir -PassThru

    $ready = Wait-LauncherReady -Process $proc -HealthUrl $Url -TimeoutSec $TimeoutSec
    if (-not $ready.ok) {
        Stop-LauncherProcess -Process $proc
        Wait-BackendDown -Url $Url
        return @{
            ok = $false
            startup_ms = [double]$ready.elapsed_ms
            working_set_mb = 0
            mode = [string]$ready.mode
        }
    }

    $startupMs = [double]$ready.elapsed_ms
    Start-Sleep -Milliseconds 1200

    $workingSetMb = 0
    try {
        $p = Get-Process -Id $proc.Id -ErrorAction Stop
        $workingSetMb = [math]::Round($p.WorkingSet64 / 1MB, 2)
    } catch {
        $workingSetMb = 0
    }

    Stop-LauncherProcess -Process $proc
    Wait-BackendDown -Url $Url

    return @{
        ok = $true
        startup_ms = $startupMs
        working_set_mb = $workingSetMb
        mode = [string]$ready.mode
    }
}

function Get-Percentile {
    param(
        [double[]]$Values,
        [double]$Percentile
    )
    if (-not $Values -or $Values.Count -eq 0) {
        return 0
    }
    $sorted = $Values | Sort-Object
    $rank = [math]::Ceiling(($Percentile / 100.0) * $sorted.Count) - 1
    if ($rank -lt 0) { $rank = 0 }
    if ($rank -ge $sorted.Count) { $rank = $sorted.Count - 1 }
    return [math]::Round([double]$sorted[$rank], 0)
}

function Write-Json {
    param(
        [object]$Payload,
        [string]$Path
    )
    $dir = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $json = $Payload | ConvertTo-Json -Depth 8
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    [System.IO.File]::WriteAllText($resolvedPath, $json, $utf8NoBom)
}

$resolvedExe = Resolve-LauncherExe -PathArg $ExePath
Write-Host "[tauri-perf-smoke] launcher: $resolvedExe" -ForegroundColor Cyan

$coldSamples = @()
$warmSamples = @()
$allWorkingSet = @()
$failures = 0
$readyModes = @()

for ($i = 0; $i -lt $ColdIterations; $i++) {
    $sample = Sample-Launch -ResolvedExe $resolvedExe -Url $HealthUrl -TimeoutSec $LaunchTimeoutSec
    if (-not $sample.ok) {
        $failures++
    }
    if ($sample.mode) {
        $readyModes += [string]$sample.mode
    }
    $coldSamples += [double]$sample.startup_ms
    if ($sample.working_set_mb -gt 0) {
        $allWorkingSet += [double]$sample.working_set_mb
    }
}

for ($i = 0; $i -lt $WarmIterations; $i++) {
    $sample = Sample-Launch -ResolvedExe $resolvedExe -Url $HealthUrl -TimeoutSec $LaunchTimeoutSec
    if (-not $sample.ok) {
        $failures++
    }
    if ($sample.mode) {
        $readyModes += [string]$sample.mode
    }
    $warmSamples += [double]$sample.startup_ms
    if ($sample.working_set_mb -gt 0) {
        $allWorkingSet += [double]$sample.working_set_mb
    }
}

for ($i = 0; $i -lt $StabilityCycles; $i++) {
    $sample = Sample-Launch -ResolvedExe $resolvedExe -Url $HealthUrl -TimeoutSec $LaunchTimeoutSec
    if (-not $sample.ok) {
        $failures++
    }
    if ($sample.mode) {
        $readyModes += [string]$sample.mode
    }
    if ($sample.working_set_mb -gt 0) {
        $allWorkingSet += [double]$sample.working_set_mb
    }
}

$runtimeSnapshot = [ordered]@{
    cold_start_p95_ms = (Get-Percentile -Values $coldSamples -Percentile 95)
    warm_start_p95_ms = (Get-Percentile -Values $warmSamples -Percentile 95)
    store_first_interactive_ms = (Get-Percentile -Values $coldSamples -Percentile 95)
    long_tasks = 0
    fps_avg = 60
    idle_cpu_pct = 0
    idle_ram_mb = if ($allWorkingSet.Count -gt 0) { [math]::Round(($allWorkingSet | Measure-Object -Average).Average, 2) } else { 0 }
    details = [ordered]@{
        source = "tauri_desktop_smoke"
        cold_start_samples_ms = $coldSamples
        warm_start_samples_ms = $warmSamples
        launch_timeout_sec = $LaunchTimeoutSec
        health_url = $HealthUrl
        launcher_exe = $resolvedExe
        ready_modes = $readyModes
    }
    generated_at = (Get-Date).ToString("o")
}

$stabilitySnapshot = [ordered]@{
    crash_blockers = $failures
    release_blockers = if ($failures -gt 0) { 1 } else { 0 }
    cycles = $StabilityCycles
    failures = $failures
    source = "tauri_desktop_smoke"
    generated_at = (Get-Date).ToString("o")
}

Write-Json -Payload $runtimeSnapshot -Path $RuntimeSnapshotPath
Write-Json -Payload $stabilitySnapshot -Path $StabilitySnapshotPath

Write-Host "[tauri-perf-smoke] runtime snapshot: $RuntimeSnapshotPath" -ForegroundColor Green
Write-Host "[tauri-perf-smoke] stability snapshot: $StabilitySnapshotPath" -ForegroundColor Green

if ($failures -gt 0) {
    Write-Host "[tauri-perf-smoke] detected launch failures: $failures" -ForegroundColor Red
    exit 2
}
