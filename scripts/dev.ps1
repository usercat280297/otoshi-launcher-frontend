# Dev runner (frontend + backend) with port auto-selection

param(
    [int]$PreferredBackendPort = 8000,
    [int]$PreferredFrontendPort = 5173
)

$ErrorActionPreference = "Stop"
$strictKill = $env:DEV_KILL_STRICT -eq "1"
$script:BackendReuseAllowed = $true

function Get-ProcessInfo([int]$procId) {
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    } catch {
        return $null
    }
}

function Should-KillProcess([int]$procId, [string]$root) {
    $proc = Get-ProcessInfo $procId
    if (-not $proc) { return $false }
    $name = $proc.Name
    $cmd = $proc.CommandLine
    if ($name -match "^otoshi-backend" -or $name -match "^otoshi_backend") { return $true }
    if ($cmd -and $cmd -match "uvicorn" -and $cmd -match "app\\.main:app") { return $true }
    if ($cmd -and $cmd -match "vite" -and $cmd -match [regex]::Escape($root)) { return $true }
    return $false
}

function Stop-ProcessByPort([int]$port, [string]$root) {
    $matches = netstat -ano -p tcp | Select-String -Pattern (":$port\\s")
    foreach ($m in $matches) {
        $parts = ($m.Line -split "\\s+") | Where-Object { $_ }
        $pidValue = $parts[-1]
        if ($pidValue -match "^\\d+$") {
            $pidInt = [int]$pidValue
            if (Should-KillProcess $pidInt $root) {
                Stop-Process -Id $pidInt -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Stop-ProcessByPortAny([int]$port) {
    # Method 1: Try using Get-NetTCPConnection (more reliable)
    $tcpConnections = @()
    try {
        $tcpConnections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -match "127\.0\.0\.1|::" }
    } catch { }
    
    # Method 2: Fallback to netstat
    if (-not $tcpConnections) {
        $netstatMatches = netstat -ano -p tcp 2>$null | Select-String -Pattern (":$port\s+")
        foreach ($match in $netstatMatches) {
            $parts = ($match.Line -split "\s+") | Where-Object { $_ }
            if ($parts[-1] -match "^\d+$") {
                $processId = [int]$parts[-1]
                $tcpConnections += @(@{ OwningProcess = $processId })
            }
        }
    }
    
    foreach ($conn in $tcpConnections) {
        $processId = $conn.OwningProcess
        Write-Host "Trying to kill process on port $port (PID: $processId)..." -ForegroundColor Yellow
        
        # Use multiple kill methods for reliability
        try { 
            taskkill /F /PID $processId /T 2>$null | Out-Null
            Write-Host "  -> taskkill /F /PID $processId succeeded" -ForegroundColor Green
        } catch { 
            Write-Host "  -> taskkill /F /PID $processId failed" -ForegroundColor Gray
        }
        try { 
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
            Write-Host "  -> Stop-Process succeeded" -ForegroundColor Green
        } catch { 
            Write-Host "  -> Stop-Process failed" -ForegroundColor Gray
        }
        Start-Sleep -Milliseconds 500
    }
    
    # Extra aggressive wait
    Start-Sleep -Seconds 1
}

function Clear-TimeWaitConnections([int]$port) {
    # Clear TIME_WAIT connections on the port using netsh
    Write-Host "Clearing TIME_WAIT connections on port $port..." -ForegroundColor Yellow
    try {
        # Get all connections in TIME_WAIT state on this port
        $timeWaitConns = netstat -ano | Select-String -Pattern ":$port.*TIME_WAIT"
        if ($timeWaitConns) {
            Write-Host "Found TIME_WAIT connections, attempting to close..." -ForegroundColor Yellow
            # Kill processes associated with TIME_WAIT connections
            foreach ($conn in $timeWaitConns) {
                $parts = ($conn.Line -split "\s+") | Where-Object { $_ }
                if ($parts[-1] -match "^\d+$") {
                    $pid = [int]$parts[-1]
                    taskkill /F /PID $pid /T 2>$null | Out-Null
                }
            }
            Start-Sleep -Milliseconds 500
        }
    } catch {
        Write-Host "Note: Could not clear TIME_WAIT (may already be cleared)" -ForegroundColor Gray
    }
}

function Show-PortOwner([int]$port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn -and $conn.OwningProcess) {
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "Port $port owned by PID $($proc.ProcessId): $($proc.Name)" -ForegroundColor Yellow
                if ($proc.CommandLine) {
                    Write-Host "CommandLine: $($proc.CommandLine)" -ForegroundColor DarkGray
                }
                return
            }
        }
    } catch { }

    try {
        $netstatMatches = netstat -ano -p tcp 2>$null | Select-String -Pattern (":$port\s+")
        foreach ($match in $netstatMatches) {
            $parts = ($match.Line -split "\s+") | Where-Object { $_ }
            if ($parts[-1] -match "^\d+$") {
                $pid = [int]$parts[-1]
                $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Host "Port $port owned by PID $($proc.ProcessId): $($proc.Name)" -ForegroundColor Yellow
                    if ($proc.CommandLine) {
                        Write-Host "CommandLine: $($proc.CommandLine)" -ForegroundColor DarkGray
                    }
                }
            }
        }
    } catch { }
}

function Stop-OtoshiDevProcesses {
    $root = (Resolve-Path ".").Path
    $ports = @(8000,8001,8002,8003,8004,8005,18000,18001,18002,18003,18004,18005,20000,20001,20002,20003,20004,20005)
    foreach ($p in $ports) { Stop-ProcessByPort $p $root }

    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        $procId = [int]$proc.ProcessId
        if (Should-KillProcess $procId $root) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

Stop-OtoshiDevProcesses

function Test-PortAvailable([int]$port) {
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
        $listener.ExclusiveAddressUse = $false
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) {
            try { $listener.Stop() } catch { }
        }
    }
}

function Get-FreePort {
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
        $listener.Start()
        return $listener.LocalEndpoint.Port
    } finally {
        if ($listener) {
            try { $listener.Stop() } catch { }
        }
    }
}

function Normalize-PathText([string]$value) {
    if (-not $value) { return "" }
    return ($value -replace "/", "\\").Trim().ToLowerInvariant()
}

$script:ExpectedBackendDbPath = ""
try {
    $resolved = Resolve-Path "..\\backend\\otoshi.db" -ErrorAction Stop
    $script:ExpectedBackendDbPath = Normalize-PathText $resolved.Path
} catch {
    $script:ExpectedBackendDbPath = ""
}

function Test-BackendHealthy([int]$port) {
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
        if ($resp.StatusCode -eq 200 -and $resp.Content -match '"status"\s*:\s*"ok"') {
            # Ensure backend is the updated build (news_enhanced flag present)
            if ($resp.Content -match '"news_enhanced"\s*:\s*true') {
                try {
                    $runtime = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health/runtime" -TimeoutSec 2
                    if (-not $runtime) { return $false }
                    if ($runtime.status -ne "ok") { return $false }
                    if (-not $runtime.db_exists) { return $false }
                    if ($runtime.ingest_state -eq "failed" -or $runtime.ingest_state -eq "error") {
                        return $false
                    }
                    if ($script:ExpectedBackendDbPath) {
                        $runtimeDbPath = Normalize-PathText ([string]$runtime.db_path)
                        if ($runtimeDbPath -and $runtimeDbPath -ne $script:ExpectedBackendDbPath) {
                            Write-Host "Backend on port $port uses unexpected DB path: $($runtime.db_path)" -ForegroundColor Yellow
                            return $false
                        }
                    }
                    return $true
                } catch {
                    return $false
                }
            }
        }
    } catch { }
    return $false
}

function Select-BackendPort {
    if ($PreferredBackendPort -gt 0) {
        if (-not (Test-PortAvailable $PreferredBackendPort)) {
            if (Test-BackendHealthy $PreferredBackendPort) {
                Write-Host "Backend already running on port $PreferredBackendPort. Reusing it." -ForegroundColor Yellow
                return $PreferredBackendPort
            }
            # Force free the preferred port (needed for OAuth redirect)
            Write-Host "Port $PreferredBackendPort is in use. Killing processes..." -ForegroundColor Yellow
            Stop-ProcessByPortAny $PreferredBackendPort
            Start-Sleep -Milliseconds 500
            
            # Clear any lingering TIME_WAIT connections
            Clear-TimeWaitConnections $PreferredBackendPort
            Start-Sleep -Milliseconds 500
        }
        if (Test-PortAvailable $PreferredBackendPort) {
            return $PreferredBackendPort
        }
        # NO FALLBACK: Port must be freed or fail
        Show-PortOwner $PreferredBackendPort
        Write-Host "ERROR: Cannot use port $PreferredBackendPort - unable to free it. Please close the process manually." -ForegroundColor Red
        Write-Host "To find the process: netstat -ano | findstr :$PreferredBackendPort" -ForegroundColor Red
        exit 1
    }
    return Get-FreePort
}

function Select-FrontendPort {
    if ($PreferredFrontendPort -gt 0 -and (Test-PortAvailable $PreferredFrontendPort)) {
        return $PreferredFrontendPort
    }
    return Get-FreePort
}

$backendPort = Select-BackendPort
$frontendPort = Select-FrontendPort

$env:BACKEND_PORT = $backendPort
$env:VITE_BACKEND_PORT = $backendPort
$env:VITE_API_URL = "http://127.0.0.1:$backendPort"
$env:FRONTEND_BASE_URL = "http://127.0.0.1:$frontendPort"

Write-Host "Using BACKEND_PORT=$backendPort" -ForegroundColor Cyan
Write-Host "Using FRONTEND_PORT=$frontendPort" -ForegroundColor Cyan
if ($backendPort -ne $PreferredBackendPort) {
    Write-Host "Note: Backend is not on $PreferredBackendPort. Google OAuth redirect must match this port." -ForegroundColor Yellow
}

$frontendCmd = "npx vite --open --host 127.0.0.1 --port $frontendPort"
$backendCmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"..\\backend\\scripts\\dev.ps1`""

if ($script:BackendReuseAllowed -and (Test-BackendHealthy $backendPort)) {
    Write-Host "Backend already running on port $backendPort. Starting frontend only." -ForegroundColor Yellow
    cmd /c $frontendCmd
    exit $LASTEXITCODE
}

& npx concurrently -k -n frontend,backend -c cyan,green $frontendCmd $backendCmd
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
