$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-InstallerImage {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$Width,
        [Parameter(Mandatory = $true)][int]$Height,
        [Parameter(Mandatory = $true)][string]$Title,
        [string]$Subtitle = "",
        [int]$TitleSize = 20,
        [int]$SubtitleSize = 9,
        [ValidateSet("LeftTop","LeftCenter","LeftBottom")][string]$Layout = "LeftCenter"
    )

    $bmp = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
    $bgTop = [System.Drawing.Color]::FromArgb(11, 15, 26)
    $bgBottom = [System.Drawing.Color]::FromArgb(17, 24, 39)
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $bgTop, $bgBottom, 90)
    $g.FillRectangle($bgBrush, $rect)

    $accentHeight = [Math]::Max([int]($Height * 0.38), 18)
    $accentRect = New-Object System.Drawing.Rectangle(0, 0, $Width, $accentHeight)
    $accentA = [System.Drawing.Color]::FromArgb(30, 64, 175)
    $accentB = [System.Drawing.Color]::FromArgb(59, 130, 246)
    $accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($accentRect, $accentA, $accentB, 0)
    $g.FillRectangle($accentBrush, $accentRect)

    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(37, 99, 235), 2)
    $g.DrawLine($linePen, 0, $accentHeight - 1, $Width, $accentHeight - 1)

    $stripePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(27, 32, 45), 1)
    for ($i = -$Height; $i -lt $Width; $i += 14) {
        $g.DrawLine($stripePen, $i, 0, $i + $Height, $Height)
    }

    $titleFont = New-Object System.Drawing.Font("Segoe UI Semibold", $TitleSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $subtitleFont = New-Object System.Drawing.Font("Segoe UI", $SubtitleSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $subtitleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 220, 255))

    $paddingX = [int]($Width * 0.08)
    $paddingY = [int]($Height * 0.18)
    $y = switch ($Layout) {
        "LeftTop" { $paddingY }
        "LeftBottom" { $Height - ($TitleSize + $SubtitleSize + $paddingY) }
        default { [int](($Height / 2) - $TitleSize) }
    }

    $g.DrawString($Title, $titleFont, $titleBrush, $paddingX, $y)
    if ($Subtitle -ne "") {
        $g.DrawString($Subtitle, $subtitleFont, $subtitleBrush, $paddingX, $y + $TitleSize + 4)
    }

    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bmp.Dispose()
}

$installerDir = Resolve-Path (Join-Path $PSScriptRoot "..\\src-tauri\\icons\\installer")

New-InstallerImage -Path (Join-Path $installerDir "nsis-header.bmp") -Width 150 -Height 57 -Title "Otoshi" -Subtitle "Launcher" -TitleSize 16 -SubtitleSize 9 -Layout "LeftCenter"
New-InstallerImage -Path (Join-Path $installerDir "nsis-sidebar.bmp") -Width 164 -Height 314 -Title "Otoshi Launcher" -Subtitle "Fast. Clean. Modular." -TitleSize 18 -SubtitleSize 10 -Layout "LeftBottom"
New-InstallerImage -Path (Join-Path $installerDir "wix-banner.bmp") -Width 493 -Height 58 -Title "Otoshi Launcher" -Subtitle "Install and play" -TitleSize 20 -SubtitleSize 9 -Layout "LeftCenter"
New-InstallerImage -Path (Join-Path $installerDir "wix-dialog.bmp") -Width 493 -Height 312 -Title "Otoshi Launcher" -Subtitle "Modern launcher for your library" -TitleSize 24 -SubtitleSize 11 -Layout "LeftTop"

Write-Host "Updated installer artwork in: $installerDir"
