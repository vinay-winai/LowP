# Automated Demo Recording Script for LowP
# Performs live interaction over ADB while capturing high-bitrate video,
# then encodes optimized MP4 and preview GIF with FFmpeg.

$adb = "X:\platform-tools\adb.exe"
$rawDeviceFile = "/sdcard/lowp_demo_recording.mp4"
$rawLocalFile = "output\lowp_demo_raw.mp4"
$finalMp4 = "output\lowp_demo.mp4"
$finalGif = "output\lowp_demo_preview.gif"

Write-Host ">>> Preparing phone state (scrolling to top)..." -ForegroundColor Cyan
# Dismiss any open dialogs / keyboard
& $adb shell input keyevent 4
Start-Sleep -Milliseconds 400
# Scroll to top of results
& $adb shell input swipe 630 1400 630 2500 400
Start-Sleep -Milliseconds 300
& $adb shell input swipe 630 1400 630 2500 400
Start-Sleep -Milliseconds 800

# Remove any old recording on device
& $adb shell rm -f $rawDeviceFile

Write-Host ">>> Starting ADB screenrecord in background..." -ForegroundColor Green
$recordJob = Start-Job -ScriptBlock {
    param($adbPath, $destFile)
    & $adbPath shell screenrecord --bit-rate 16000000 --time-limit 30 $destFile
} -ArgumentList $adb, $rawDeviceFile

# Give screenrecord 1.5s to initialize and capture initial screen
Start-Sleep -Milliseconds 1500

Write-Host ">>> [Demo Scene 1] Tapping 'milk' quick tag (Warm parallel search)..." -ForegroundColor Yellow
& $adb shell input tap 100 570

# Wait for parallel search across stores to settle (~3.5 seconds)
Start-Sleep -Milliseconds 3500

Write-Host ">>> [Demo Scene 2] Scrolling to showcase Zepto card (#F6F0FF)..." -ForegroundColor Yellow
& $adb shell input swipe 630 2000 630 1200 800
Start-Sleep -Milliseconds 1400

Write-Host ">>> [Demo Scene 3] Scrolling to showcase Blinkit card (#FFFBEA)..." -ForegroundColor Yellow
& $adb shell input swipe 630 2000 630 1200 800
Start-Sleep -Milliseconds 1400

Write-Host ">>> [Demo Scene 4] Scrolling to showcase Swiggy Instamart card (#FFF3E8)..." -ForegroundColor Yellow
& $adb shell input swipe 630 2000 630 1200 800
Start-Sleep -Milliseconds 1400

Write-Host ">>> [Demo Scene 5] Tapping 'Compare this ->' on product..." -ForegroundColor Yellow
& $adb shell input tap 820 1570
Start-Sleep -Milliseconds 2500

Write-Host ">>> [Demo Scene 6] Tapping 'Done' on Price Comparison..." -ForegroundColor Yellow
& $adb shell input tap 1150 160
Start-Sleep -Milliseconds 1000

Write-Host ">>> [Demo Scene 7] Scrolling back to top..." -ForegroundColor Yellow
& $adb shell input swipe 630 1200 630 2500 500
Start-Sleep -Milliseconds 400
& $adb shell input swipe 630 1200 630 2500 500
Start-Sleep -Milliseconds 1500

Write-Host ">>> Stopping recording..." -ForegroundColor Cyan
& $adb shell pkill -2 screenrecord
Start-Sleep -Seconds 2
Stop-Job $recordJob -ErrorAction SilentlyContinue
Remove-Job $recordJob -ErrorAction SilentlyContinue

Write-Host ">>> Pulling raw video from phone..." -ForegroundColor Cyan
if (Test-Path $rawLocalFile) { Remove-Item $rawLocalFile -Force }
& $adb pull $rawDeviceFile $rawLocalFile
& $adb shell rm -f $rawDeviceFile

if (-not (Test-Path $rawLocalFile)) {
    Write-Error "Failed to pull $rawLocalFile from device."
}

Write-Host ">>> Transcoding to web-optimized MP4 with FFmpeg..." -ForegroundColor Green
ffmpeg -y -i $rawLocalFile -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart $finalMp4

Write-Host ">>> Generating animated preview GIF with FFmpeg..." -ForegroundColor Green
$palette = "output\palette.png"
ffmpeg -y -i $finalMp4 -vf "fps=12,scale=360:-1:flags=lanczos,palettegen" $palette
ffmpeg -y -i $finalMp4 -i $palette -filter_complex "fps=12,scale=360:-1:flags=lanczos[x];[x][1:v]paletteuse" $finalGif
if (Test-Path $palette) { Remove-Item $palette -Force }

Write-Host ">>> DEMO RECORDING COMPLETE!" -ForegroundColor Green
Write-Host "Video: $finalMp4" -ForegroundColor Green
Write-Host "GIF:   $finalGif" -ForegroundColor Green
