# Prefer extracted desktop icon (from installed EXE) as company logo source
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'icons\extracted\desktop-256.png'
if (-not (Test-Path $src)) {
  Write-Host 'Missing icons/extracted/desktop-256.png — run extract from EXE first.'
  exit 1
}
Copy-Item -Force $src (Join-Path $root 'icons\company-logo.png')
Copy-Item -Force $src (Join-Path $root 'icons\app-icon.png')
Copy-Item -Force $src (Join-Path $root 'build\icon.png')
Add-Type -AssemblyName System.Drawing
$bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'build\icon.png'))
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $ms.ToArray()
$ms.Dispose()
$icoPath = Join-Path $root 'build\icon.ico'
$bw = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($icoPath))
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length); $bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Close()
$bmp.Dispose()
Write-Host 'Synced company logo from extracted desktop-256.png'
