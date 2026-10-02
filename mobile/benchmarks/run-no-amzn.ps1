param([int]$Round=1,[string]$Soc='Snapdragon 8s Gen 3',[string]$Output='mobile/benchmarks/no-amzn-snapdragon-2026-09-30.json',[string]$Adb='X:\platform-tools\adb.exe',[int]$CaptureWaitSeconds=12)
$ErrorActionPreference='Stop'
$oldStayAwake=(& $Adb shell settings get global stay_on_while_plugged_in).Trim()
$labels=[ordered]@{'Swiggy Instamart'='instamart';'Zepto'='zepto';'Blinkit'='blinkit';'Amazon.in'='amazon_main';'Flipkart'='flipkart'}
function ReadUi {
 & $Adb shell uiautomator dump /sdcard/lowp-ui.xml | Out-Null
 [xml]$ui=(& $Adb shell cat /sdcard/lowp-ui.xml)-join "`n"
 return $ui
}
function Bounds($node) {
 $m=[regex]::Match($node.bounds,'\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
 return @([int]$m.Groups[1].Value,[int]$m.Groups[2].Value,[int]$m.Groups[3].Value,[int]$m.Groups[4].Value)
}
function Tap($node) {
 $b=Bounds $node
 & $Adb shell input tap ([int](($b[0]+$b[2])/2)) ([int](($b[1]+$b[3])/2))
}
function MeasureLowpSearch([string]$query,[string]$phase) {
 $ui=ReadUi
 $button=$ui.SelectNodes('//node') | Where-Object { $_.text -eq $query -and $_.class -eq 'android.widget.TextView' } | Select-Object -First 1
 if(!$button){throw "Query tag not visible: $query"}
 Tap $button
 # No UI dumps during loading. Repeat this exact capture protocol on Exynos.
 Start-Sleep -Seconds $CaptureWaitSeconds
 $ui=ReadUi
 $nodes=@($ui.SelectNodes('//node') | Where-Object { $_.text -ne '' })
 if($nodes | Where-Object {$_.text -eq 'Comparing live...'}){throw 'Search unfinished after 12s; record separately'}
 $heading=$nodes | Where-Object {$_.text -eq "Results for `"$query`""} | Select-Object -First 1
 if(!$heading){throw "Wrong query after tapping $query"}
 $y=(Bounds $heading)[1]
 $total=$nodes | Where-Object {$_.text -match '^\d+\.\d+s$' -and [Math]::Abs((Bounds $_)[1]-$y)-lt 15} | Select-Object -First 1
 if(!$total){throw 'No timing displayed (possible cache hit)'}
 $totalMs=[int]([double]$total.text.TrimEnd('s')*1000)
 return [pscustomobject]@{round=$Round;phase=$phase;query=$query;totalMs=$totalMs;stores=@();timingSource="App UI rounded to 0.01s"}
}
try{
 & $Adb shell svc power stayon usb
 & $Adb shell input keyevent 224
 & $Adb shell am force-stop host.exp.exponent
 & $Adb shell am start -W -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082' -p host.exp.exponent | Out-Null
 & $Adb shell am start -W -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082' -p host.exp.exponent | Out-Null
 $deadline=[DateTime]::UtcNow.AddSeconds(25)
 do{
  $ui=ReadUi
  $searchInput=$ui.SelectNodes('//node') | Where-Object {$_.class-eq 'android.widget.EditText'} | Select-Object -First 1
  $oldResults=$ui.SelectNodes('//node') | Where-Object {$_.text-like 'Results for*'}
  if($searchInput-and !$oldResults){break}
 }while([DateTime]::UtcNow-lt $deadline)
 if(!$searchInput-or $oldResults){throw 'Fresh LowP screen unavailable'}
 $pack=$ui.SelectNodes('//node') | Where-Object {$_.text-eq 'No amzn'} | Select-Object -First 1
 if(!$pack){throw 'No amzn pack not visible'}
 Tap $pack
 Start-Sleep -Seconds 2
 $cold=MeasureLowpSearch 'Paneer 200g' 'app_restart'
 $warm=MeasureLowpSearch 'Amul Butter 500g' 'subsequent_query'
 if(Test-Path -LiteralPath $Output){$report=Get-Content -Raw -LiteralPath $Output | ConvertFrom-Json}
 else{$report=[pscustomobject]@{date=(Get-Date -Format 'yyyy-MM-dd');soc=$Soc;model=(& $Adb shell getprop ro.product.model).Trim();android=(& $Adb shell getprop ro.build.version.release).Trim();buildMode='Expo Go development via USB reverse 8082';timingCapture='App UI readouts, rounded to 0.01s';captureWaitSeconds=$CaptureWaitSeconds;pack='No amzn';stores=@($labels.Values);protocol='Paired rounds: restart app, select No amzn, Paneer 200g, then Amul Butter 500g. Wait captureWaitSeconds after submission, capture total timing at the top; per-store details require Metro logs. Sessions/website caches retained; no app-data clearing or exact-query cache hits. Keep USB screen awake only during trials.';sourceHashes=@('mobile/src/components/BackgroundScrapers.tsx','mobile/src/core/ScraperScript.ts','mobile/src/screens/HomeScreen.tsx') | ForEach-Object {[pscustomobject]@{path=$_;sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash}};trials=@()}}
 $report.trials=@($report.trials | Where-Object {$_.round-ne $Round})+@($cold,$warm)
 $report | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 -LiteralPath $Output
 @($cold,$warm) | ForEach-Object {Write-Output ("Round {0} {1}: {2}ms; {3}"-f $_.round,$_.phase,$_.totalMs,(($_.stores | ForEach-Object {"$($_.store)=$($_.elapsedMs)ms/$($_.outcome)"})-join ', '))}
}finally{& $Adb shell settings put global stay_on_while_plugged_in $oldStayAwake}




