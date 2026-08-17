<#
  Generates assets/icon.ico and assets/tray-icon.png.

  The art mirrors the widget's own gauge: a 270-degree arc in the Claude accent
  on the window background colour. Each size is drawn from scratch rather than
  downscaled from one large bitmap - a 1.5px stroke scaled to 16x16 disappears
  entirely, so stroke width and padding are proportional to the target size.
#>

param(
    [string]$OutDir = (Join-Path (Split-Path $PSScriptRoot -Parent) 'assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$bgColour     = [System.Drawing.ColorTranslator]::FromHtml('#101014')
$trackColour  = [System.Drawing.ColorTranslator]::FromHtml('#2A2A33')
$accentColour = [System.Drawing.ColorTranslator]::FromHtml('#D97757')

# Matches gauge.js: 270-degree sweep opening at the bottom. GDI+ measures
# clockwise from 3 o'clock, so 135 + 270 leaves the gap centred at the bottom.
$startAngle = 135
$sweepTotal = 270
$fillRatio  = 0.72

function New-IconBitmap {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.Clear([System.Drawing.Color]::Transparent)

        # Rounded-square plate, so the icon reads as an app tile at small sizes.
        $radius = [Math]::Max(2, [int]($Size * 0.22))
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d = $radius * 2
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
        $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
        $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
        $path.CloseFigure()

        $bgBrush = New-Object System.Drawing.SolidBrush($bgColour)
        $g.FillPath($bgBrush, $path)
        $bgBrush.Dispose()
        $path.Dispose()

        $stroke = [Math]::Max(1.6, $Size * 0.115)
        $inset = $Size * 0.24
        $box = New-Object System.Drawing.RectangleF(
            [float]$inset, [float]$inset,
            [float]($Size - $inset * 2), [float]($Size - $inset * 2))

        $trackPen = New-Object System.Drawing.Pen($trackColour, [float]$stroke)
        $trackPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $trackPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $g.DrawArc($trackPen, $box, $startAngle, $sweepTotal)
        $trackPen.Dispose()

        $accentPen = New-Object System.Drawing.Pen($accentColour, [float]$stroke)
        $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $g.DrawArc($accentPen, $box, $startAngle, [float]($sweepTotal * $fillRatio))
        $accentPen.Dispose()
    }
    finally {
        $g.Dispose()
    }
    return $bmp
}

function Get-PngBytes {
    param([System.Drawing.Bitmap]$Bitmap)

    $stream = New-Object System.IO.MemoryStream
    try {
        $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        # The leading comma stops PowerShell unrolling the array on output -
        # without it the caller receives Object[], which BinaryWriter cannot
        # write as bytes and silently truncates to one byte per payload.
        return ,$stream.ToArray()
    }
    finally {
        $stream.Dispose()
    }
}

if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

# --- assets/icon.ico -------------------------------------------------------
# Hand-built ICO container. PNG-compressed entries are valid on Vista+, and a
# width/height byte of 0 means 256.
$sizes = @(16, 32, 48, 256)
$payloads = @()
foreach ($size in $sizes) {
    $bmp = New-IconBitmap -Size $size
    try { $payloads += ,[byte[]](Get-PngBytes -Bitmap $bmp) } finally { $bmp.Dispose() }
}

foreach ($payload in $payloads) {
    if ($payload.Length -lt 100) {
        throw "PNG encoding produced $($payload.Length) bytes - refusing to write a broken icon"
    }
}

$icoPath = Join-Path $OutDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
try {
    $bw.Write([UInt16]0)            # reserved
    $bw.Write([UInt16]1)            # type: 1 = icon
    $bw.Write([UInt16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
        $bw.Write([Byte]$dim)       # width
        $bw.Write([Byte]$dim)       # height
        $bw.Write([Byte]0)          # palette size (0 = truecolour)
        $bw.Write([Byte]0)          # reserved
        $bw.Write([UInt16]1)        # colour planes
        $bw.Write([UInt16]32)       # bits per pixel
        $bw.Write([UInt32]$payloads[$i].Length)
        $bw.Write([UInt32]$offset)
        $offset += $payloads[$i].Length
    }

    foreach ($payload in $payloads) { $bw.Write([byte[]]$payload, 0, $payload.Length) }
}
finally {
    $bw.Dispose()
    $fs.Dispose()
}

# --- assets/tray-icon.png --------------------------------------------------
# tray.js already looks for this exact path and only draws its own fallback
# when the file is missing.
$trayPath = Join-Path $OutDir 'tray-icon.png'
$tray = New-IconBitmap -Size 32
try { $tray.Save($trayPath, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $tray.Dispose() }

Write-Host ("icon.ico      {0,7:N0} bytes ({1})" -f (Get-Item $icoPath).Length, ($sizes -join '/'))
Write-Host ("tray-icon.png {0,7:N0} bytes (32x32)" -f (Get-Item $trayPath).Length)
