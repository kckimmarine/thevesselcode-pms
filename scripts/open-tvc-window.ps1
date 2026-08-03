# THE VESSEL CODE — open Chrome app window at ~78% × 88% of working area (centered)
param(
    [string]$Url = 'http://localhost:3000',
    [double]$WidthRatio = 0.78,
    [double]$HeightRatio = 0.88,
    [int]$DelaySec = 2
)

Start-Sleep -Seconds $DelaySec

Add-Type -AssemblyName System.Windows.Forms | Out-Null
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$w = [Math]::Max(1100, [int]($area.Width * $WidthRatio))
$h = [Math]::Max(720, [int]($area.Height * $HeightRatio))
$w = [Math]::Min($w, $area.Width - 40)
$h = [Math]::Min($h, $area.Height - 40)
$x = [int]($area.Left + ($area.Width - $w) / 2)
$y = [int]($area.Top + ($area.Height - $h) / 2)

$chromeCandidates = @(
    (Get-Command chrome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

$args = @(
    "--app=$Url",
    "--window-size=$w,$h",
    "--window-position=$x,$y"
)

if ($chromeCandidates) {
    Start-Process -FilePath $chromeCandidates -ArgumentList $args
} else {
    Start-Process $Url
}
