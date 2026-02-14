# Otoshi Launcher Debug Script
# Kiểm tra trạng thái và xem logs

Write-Host "=== OTOSHI LAUNCHER DEBUG ===" -ForegroundColor Cyan
Write-Host ""

# 1. Kiểm tra processes
Write-Host "[1] Checking processes..." -ForegroundColor Yellow
$processes = Get-Process | Where-Object { $_.Name -like "*otoshi*" }
if ($processes) {
    Write-Host "✓ Found Otoshi processes:" -ForegroundColor Green
    $processes | Format-Table Name, Id, Path -AutoSize
} else {
    Write-Host "✗ No Otoshi processes running" -ForegroundColor Red
}
Write-Host ""

# 2. Kiểm tra port 8000
Write-Host "[2] Checking backend port 8000..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✓ Backend is responding: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "   Response: $($response.Content)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Backend is not responding" -ForegroundColor Red
    Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
}
Write-Host ""

# 3. Kiểm tra database
Write-Host "[3] Checking database..." -ForegroundColor Yellow
$dbPath = "$env:APPDATA\com.otoshi.launcher\otoshi.db"
if (Test-Path $dbPath) {
    $dbSize = (Get-Item $dbPath).Length / 1KB
    Write-Host "✓ Database found: $dbPath" -ForegroundColor Green
    Write-Host "   Size: $([math]::Round($dbSize, 2)) KB" -ForegroundColor Gray
} else {
    Write-Host "✗ Database not found: $dbPath" -ForegroundColor Red
}
Write-Host ""

# 4. Kiểm tra logs
Write-Host "[4] Checking logs..." -ForegroundColor Yellow
$logDir = "$env:APPDATA\com.otoshi.launcher\logs"
$backendLog = "$logDir\backend.log"
$launcherLog = "$logDir\launcher.log"

if (Test-Path $backendLog) {
    $backendSize = (Get-Item $backendLog).Length / 1KB
    Write-Host "✓ Backend log found: $([math]::Round($backendSize, 2)) KB" -ForegroundColor Green

    Write-Host "   Last 10 lines of backend.log:" -ForegroundColor Gray
    Get-Content $backendLog -Tail 10 | ForEach-Object {
        Write-Host "   $_" -ForegroundColor DarkGray
    }
} else {
    Write-Host "✗ Backend log not found" -ForegroundColor Red
}
Write-Host ""

if (Test-Path $launcherLog) {
    $launcherSize = (Get-Item $launcherLog).Length / 1KB
    Write-Host "✓ Launcher log found: $([math]::Round($launcherSize, 2)) KB" -ForegroundColor Green

    Write-Host "   Last 10 lines of launcher.log:" -ForegroundColor Gray
    Get-Content $launcherLog -Tail 10 | ForEach-Object {
        Write-Host "   $_" -ForegroundColor DarkGray
    }
} else {
    Write-Host "✗ Launcher log not found" -ForegroundColor Red
}
Write-Host ""

# 5. Kiểm tra backend executable
Write-Host "[5] Checking backend executable..." -ForegroundColor Yellow
$backendExe = "E:\OTOSHI LAUNCHER\frontend\src-tauri\resources\otoshi-backend.exe"
if (Test-Path $backendExe) {
    $exeSize = (Get-Item $backendExe).Length / 1MB
    Write-Host "✓ Backend exe found: $([math]::Round($exeSize, 2)) MB" -ForegroundColor Green
} else {
    Write-Host "✗ Backend exe not found: $backendExe" -ForegroundColor Red
}
Write-Host ""

# 6. Menu options
Write-Host "=== ACTIONS ===" -ForegroundColor Cyan
Write-Host "[1] Open logs folder"
Write-Host "[2] Open app data folder"
Write-Host "[3] Watch backend log (live)"
Write-Host "[4] Watch launcher log (live)"
Write-Host "[5] Export all logs to file"
Write-Host "[6] Kill all Otoshi processes"
Write-Host "[7] Clean app data (DELETE ALL)"
Write-Host "[Q] Quit"
Write-Host ""

$choice = Read-Host "Choose action"

switch ($choice) {
    "1" {
        if (Test-Path $logDir) {
            explorer $logDir
        } else {
            Write-Host "Logs folder not found" -ForegroundColor Red
        }
    }
    "2" {
        $appData = "$env:APPDATA\com.otoshi.launcher"
        if (Test-Path $appData) {
            explorer $appData
        } else {
            Write-Host "App data folder not found" -ForegroundColor Red
        }
    }
    "3" {
        if (Test-Path $backendLog) {
            Write-Host "Watching backend.log (Ctrl+C to stop)..." -ForegroundColor Yellow
            Get-Content $backendLog -Wait -Tail 50
        } else {
            Write-Host "Backend log not found" -ForegroundColor Red
        }
    }
    "4" {
        if (Test-Path $launcherLog) {
            Write-Host "Watching launcher.log (Ctrl+C to stop)..." -ForegroundColor Yellow
            Get-Content $launcherLog -Wait -Tail 50
        } else {
            Write-Host "Launcher log not found" -ForegroundColor Red
        }
    }
    "5" {
        $date = Get-Date -Format "yyyy-MM-dd_HHmmss"
        $outputFile = "otoshi_logs_$date.txt"

        "=== Otoshi Launcher Debug Report ===" | Out-File $outputFile
        "Generated: $(Get-Date)" | Out-File $outputFile -Append
        "" | Out-File $outputFile -Append

        "=== Backend Log ===" | Out-File $outputFile -Append
        if (Test-Path $backendLog) {
            Get-Content $backendLog | Out-File $outputFile -Append
        } else {
            "Backend log not found" | Out-File $outputFile -Append
        }
        "" | Out-File $outputFile -Append

        "=== Launcher Log ===" | Out-File $outputFile -Append
        if (Test-Path $launcherLog) {
            Get-Content $launcherLog | Out-File $outputFile -Append
        } else {
            "Launcher log not found" | Out-File $outputFile -Append
        }

        Write-Host "✓ Logs exported to: $outputFile" -ForegroundColor Green
        explorer /select,$outputFile
    }
    "6" {
        $confirm = Read-Host "Kill all Otoshi processes? (y/n)"
        if ($confirm -eq "y") {
            Get-Process | Where-Object { $_.Name -like "*otoshi*" } | Stop-Process -Force
            Write-Host "✓ Processes killed" -ForegroundColor Green
        }
    }
    "7" {
        Write-Host "WARNING: This will delete ALL app data including:" -ForegroundColor Red
        Write-Host "  - Database" -ForegroundColor Red
        Write-Host "  - Logs" -ForegroundColor Red
        Write-Host "  - Settings" -ForegroundColor Red
        Write-Host "  - Downloaded games" -ForegroundColor Red
        $confirm = Read-Host "Are you ABSOLUTELY SURE? (type 'DELETE' to confirm)"
        if ($confirm -eq "DELETE") {
            $appData = "$env:APPDATA\com.otoshi.launcher"
            if (Test-Path $appData) {
                Remove-Item $appData -Recurse -Force
                Write-Host "✓ App data cleaned" -ForegroundColor Green
            } else {
                Write-Host "App data folder not found" -ForegroundColor Yellow
            }
        } else {
            Write-Host "Cancelled" -ForegroundColor Yellow
        }
    }
    default {
        Write-Host "Exiting..." -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
