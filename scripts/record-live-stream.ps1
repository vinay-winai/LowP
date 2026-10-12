# LowP Live Demo Capture: Pre-warm with banana & milk, then record live computing of potato
$adb = "X:\platform-tools\adb.exe"
$rawDeviceFile = "/sdcard/lowp_live_potato.mp4"
$rawLocalFile = "output\lowp_demo_raw.mp4"
$finalMp4 = "output\lowp_demo.mp4"
$finalGif = "output\lowp_demo_preview.gif"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Phase 1: Pre-warming scrapers with banana & milk " -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Ensure clean top state without keyboard
& $adb shell input keyevent 4
Start-Sleep -Milliseconds 400
& $adb shell input swipe 630 1100 630 2500 400
Start-Sleep -Milliseconds 300

Write-Host "Searching 'banana' (not recording)..." -ForegroundColor Yellow
& $adb shell input tap 700 560
Start-Sleep -Seconds 5

Write-Host "Searching 'milk' (not recording)..." -ForegroundColor Yellow
& $adb shell input swipe 630 1100 630 2500 400
Start-Sleep -Milliseconds 300
& $adb shell input tap 120 560
Start-Sleep -Seconds 4

Write-Host "Resetting view to top before live recording..." -ForegroundColor Cyan
& $adb shell input swipe 630 1100 630 2500 400
Start-Sleep -Milliseconds 300
& $adb shell input swipe 630 1100 630 2500 400
Start-Sleep -Milliseconds 600

# Remove any old recording
& $adb shell rm -f $rawDeviceFile

Write-Host "==================================================" -ForegroundColor Green
Write-Host " Phase 2: STARTING LIVE RECORDING                 " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

$recordJob = Start-Job -ScriptBlock {
    param($adbPath, $destFile)
    & $adbPath shell screenrecord --bit-rate 16000000 --time-limit 25 $destFile
} -ArgumentList $adb, $rawDeviceFile

# 1.2s lead-in to show clean initial view
Start-Sleep -Milliseconds 1200

Write-Host ">>> Tapping 'potato' to trigger live search..." -ForegroundColor Green
& $adb shell input tap 485 560

# Wait 400ms so 'Comparing live...' and initial spinners appear
Start-Sleep -Milliseconds 400

Write-Host ">>> Scrolling while results are actively computing..." -ForegroundColor Yellow
# First scroll while computing: reveals Amazon Now and Swiggy Instamart spinners & early matches
& $adb shell input swipe 630 1900 630 1200 700
Start-Sleep -Milliseconds 900

# Second scroll: reveals Zepto and Blinkit as cards stream in live
& $adb shell input swipe 630 1900 630 1200 700
Start-Sleep -Milliseconds 1200

# Third scroll: view all populated store cards with background colors
& $adb shell input swipe 630 1900 630 1200 700
Start-Sleep -Milliseconds 1500

Write-Host ">>> Scrolling back up to show settled green response time badge..." -ForegroundColor Yellow
& $adb shell input swipe 630 1200 630 2400 500
Start-Sleep -Milliseconds 400
& $adb shell input swipe 630 1200 630 2400 500
Start-Sleep -Milliseconds 2200

Write-Host ">>> Stopping recording..." -ForegroundColor Cyan
& $adb shell pkill -2 screenrecord
Start-Sleep -Seconds 2
Stop-Job $recordJob -ErrorAction SilentlyContinue
Remove-Job $recordJob -ErrorAction SilentlyContinue

Write-Host "==================================================" -ForegroundColor Green
Write-Host " Phase 3: Transferring & Transcoding with FFmpeg  " -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

if (Test-Path $rawLocalFile) { Remove-Item $rawLocalFile -Force }
& $adb pull $rawDeviceFile $rawLocalFile
& $adb shell rm -f $rawDeviceFile

if (-not (Test-Path $rawLocalFile)) {
    Write-Error "Failed to pull $rawLocalFile from phone."
}

Write-Host "Encoding high-quality MP4 via FFmpeg..." -ForegroundColor Cyan
ffmpeg -y -i $rawLocalFile -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart $finalMp4

    Write-Host "Encoding animated preview GIF via FFmpeg..." -ForegroundColor Cyan
    $palette = "output\palette.png"
    ffmpeg -y -i $finalMp4 -vf "fps=12,scale=360:-1:flags=lanczos,palettegen" $palette
    ffmpeg -y -i $finalMp4 -i $palette -filter_complex "fps=12,scale=360:-1:flags=lanczos[x];[x][1:v]paletteuse" $finalGif
    if (Test-Path $palette) { Remove-Item $palette -Force }

    Write-Host "Extracting key verification frames..." -ForegroundColor Cyan
    ffmpeg -y -ss 00:00:01.5 -i $finalMp4 -vframes 1 output\live_frame_compute.png
    ffmpeg -y -ss 00:00:03.0 -i $finalMp4 -vframes 1 output\live_frame_stream1.png
    ffmpeg -y -ss 00:00:05.0 -i $finalMp4 -vframes 1 output\live_frame_stream2.png
    ffmpeg -y -ss 00:00:08.0 -i $finalMp4 -vframes 1 output\live_frame_settled.png

    Write-Host "==================================================" -ForegroundColor Green
    Write-Host " LIVE DEMO RECORDING FINISHED!                    " -ForegroundColor Green
    Write-Host " MP4: $finalMp4                                   " -ForegroundColor Green
    Write-Host " GIF: $finalGif                                   " -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
