# LowP Mobile Demo Recorder Script
# Records mobile screen from connected Android device via ADB or scrcpy,
# then encodes optimized MP4 and preview GIF using FFmpeg.

param (
    [ValidateSet("native", "scrcpy")]
    [string]$Method = "scrcpy",
    [int]$Bitrate = 16, # Mbps
    [int]$TimeLimitSeconds = 60,
    [string]$OutputFile = "output\lowp_demo.mp4",
    [string]$GifFile = "output\lowp_demo_preview.gif"
)

$ErrorActionPreference = "Stop"

# Refresh PATH to include ADB, scrcpy, FFmpeg
if (Test-Path "X:\platform-tools") {
    $env:Path = "X:\platform-tools;" + $env:Path
}
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
if (Test-Path "X:\platform-tools" -and ($env:Path -notlike "*X:\platform-tools*")) {
    $env:Path = "X:\platform-tools;" + $env:Path
}

Write-Host "==========================================" -ForegroundColor Green
Write-Host " LowP Mobile Demo Recording Utility " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

# 1. Check ADB
$adbExe = if (Test-Path "X:\platform-tools\adb.exe") { "X:\platform-tools\adb.exe" } else { (Get-Command adb -ErrorAction SilentlyContinue)?.Source }
if (-not $adbExe) {
    Write-Error "ADB not found. Please ensure ADB is installed in X:\platform-tools or in PATH."
}
Set-Alias -Name adb -Value $adbExe -Scope Script

Write-Host "[1/4] Checking connected Android devices..." -ForegroundColor Cyan
$devices = adb devices | Where-Object { $_ -match "\s+device$" }

if (-not $devices) {
    Write-Host "No authorized Android device detected." -ForegroundColor Yellow
    Write-Host "Please ensure:" -ForegroundColor Yellow
    Write-Host " 1. Your phone is plugged in with a USB cable."
    Write-Host " 2. USB Debugging is ON in Developer Options."
    Write-Host " 3. You tap 'Allow USB debugging' on your phone's screen."
    Write-Host "Waiting for device to connect (adb wait-for-device)..." -ForegroundColor Cyan
    adb wait-for-device
}

$deviceInfo = adb devices | Where-Object { $_ -match "\s+device$" }
Write-Host "Connected device verified: $deviceInfo" -ForegroundColor Green

$rawVideoPath = "output\lowp_demo_raw.mp4"
if (Test-Path $rawVideoPath) {
    Remove-Item $rawVideoPath -Force
}

# 2. Start Recording
if ($Method -eq "scrcpy") {
    $scrcpyCmd = Get-Command scrcpy -ErrorAction SilentlyContinue
    if (-not $scrcpyCmd) {
        Write-Host "scrcpy not found, falling back to native ADB recording..." -ForegroundColor Yellow
        $Method = "native"
    }
}

if ($Method -eq "scrcpy") {
    Write-Host "[2/4] Recording via scrcpy (Mirror + Record directly to PC)..." -ForegroundColor Cyan
    Write-Host "A window will open showing your phone screen." -ForegroundColor Cyan
    Write-Host "Perform your demo now! Close the window or press Ctrl+C when finished." -ForegroundColor Yellow
    
    # scrcpy records directly to file
    scrcpy --record $rawVideoPath --video-bit-rate "${Bitrate}M" --stay-awake
} else {
    Write-Host "[2/4] Recording natively on device via 'adb shell screenrecord'..." -ForegroundColor Cyan
    Write-Host "Recording for up to $TimeLimitSeconds seconds (or press Ctrl+C to stop)..." -ForegroundColor Yellow
    
    $bitrateBps = $Bitrate * 1000000
    try {
        adb shell screenrecord --bit-rate $bitrateBps --time-limit $TimeLimitSeconds /sdcard/lowp_demo_raw.mp4
    } catch {
        Write-Host "Recording stopped." -ForegroundColor Cyan
    }

    Write-Host "Transferring raw recording from device..." -ForegroundColor Cyan
    adb pull /sdcard/lowp_demo_raw.mp4 $rawVideoPath
    adb shell rm /sdcard/lowp_demo_raw.mp4
}

# 3. Post-Processing with FFmpeg
if (-not (Test-Path $rawVideoPath)) {
    Write-Error "Recording file '$rawVideoPath' was not generated."
}

Write-Host "[3/4] Encoding high-quality web-ready MP4..." -ForegroundColor Cyan
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpegCmd) {
    # Transcode with faststart for streaming / web viewing, H.264 high profile
    ffmpeg -y -i $rawVideoPath -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart $OutputFile

    Write-Host "[4/4] Creating animated GIF preview for README ($GifFile)..." -ForegroundColor Cyan
    # Generate high quality GIF using palettegen
    $palettePath = "output\palette.png"
    ffmpeg -y -i $OutputFile -vf "fps=15,scale=400:-1:flags=lanczos,palettegen" $palettePath
    ffmpeg -y -i $OutputFile -i $palettePath -filter_complex "fps=15,scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse" $GifFile
    if (Test-Path $palettePath) { Remove-Item $palettePath -Force }
} else {
    Write-Host "FFmpeg not found. Raw file saved at $rawVideoPath" -ForegroundColor Yellow
    Copy-Item $rawVideoPath $OutputFile -Force
}

Write-Host "==========================================" -ForegroundColor Green
Write-Host " Demo video created successfully! " -ForegroundColor Green
Write-Host " MP4: $OutputFile" -ForegroundColor Green
Write-Host " GIF: $GifFile" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
