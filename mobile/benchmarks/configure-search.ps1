param(
 [ValidateSet('prepare','capture','restore')][string]$Action='prepare',
 [ValidateSet('page','extraction','off')][string]$Mode='page',
 [ValidateRange(1,3)][int]$Count=3,
 [string]$Query='Paneer 200g',
 [switch]$Restart,
 [string]$Adb='X:\platform-tools\adb.exe'
)
$ErrorActionPreference='Stop'
function ReadUi {
 & $Adb shell uiautomator dump /sdcard/lowp-ui.xml | Out-Null
 [xml]$screen=(& $Adb shell cat /sdcard/lowp-ui.xml)-join "`n"
 return $screen
}
function Bounds($node) {
 $m=[regex]::Match($node.bounds,'\[(\d+),(\d+)\]\[(\d+),(\d+)\]')
 @([int]$m.Groups[1].Value,[int]$m.Groups[2].Value,[int]$m.Groups[3].Value,[int]$m.Groups[4].Value)
}
function FindNode($ui,[string]$label,[switch]$Text) {
 $node=$ui.SelectNodes('//node') | Where-Object {
  $b=Bounds $_
  $match=if($Text){$_.text-eq $label -and $_.class-eq 'android.widget.TextView'}else{$_.'content-desc'-eq $label}
  $match -and $b[2]-gt $b[0] -and $b[3]-gt $b[1]
 } | Select-Object -First 1
 if(!$node){throw "UI control not visible: $label"}
 return $node
}
function Tap($node) {
 if($node.enabled-eq 'false'){throw 'Control disabled; wait for the active request to finish'}
 $b=Bounds $node
 & $Adb shell input tap ([int](($b[0]+$b[2])/2)) ([int](($b[1]+$b[3])/2)) | Out-Null
}
if($Restart){
 & $Adb shell am force-stop host.exp.exponent | Out-Null
 & $Adb shell am start -W -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082' -p host.exp.exponent | Out-Null
 & $Adb shell am start -W -a android.intent.action.VIEW -d 'exp://127.0.0.1:8082' -p host.exp.exponent | Out-Null
 $deadline=[DateTime]::UtcNow.AddSeconds(35)
 do{$ui=ReadUi; $ready=$ui.SelectNodes('//node') | Where-Object {$_.class-eq 'android.widget.EditText'}}while(!$ready-and [DateTime]::UtcNow-lt $deadline)
 if(!$ready){throw 'Fresh LowP unavailable'}
 Tap (FindNode $ui 'No amzn' -Text)
}
if($Action-eq 'capture'){
 # Read after Metro reports completion, never while a timed request is loading.
 & $Adb shell input swipe 540 1300 540 2240 300 | Out-Null
 & $Adb shell input swipe 540 1300 540 2240 300 | Out-Null
 $ui=ReadUi
 $text=@($ui.SelectNodes('//node') | Where-Object {$_.text-ne ''})
 $heading=$text | Where-Object {$_.text-like 'Results for*' -and (Bounds $_)[3]-gt (Bounds $_)[1]} | Select-Object -First 1
 $total=$text | Where-Object {$_.text-match '^\d+\.\d+s$' -and $heading -and [Math]::Abs((Bounds $_)[1]-(Bounds $heading)[1])-lt 15} | Select-Object -First 1
 [pscustomobject]@{heading=$heading.text;uiTotal=$total.text} | ConvertTo-Json -Compress
 exit
}
$ui=ReadUi
Tap (FindNode $ui 'Search performance options')
$ui=ReadUi
# Even tapping the selected count clears LowP's exact-query result cache.
$parallel=FindNode $ui 'Load pages in parallel'
$countButton=FindNode $ui "Concurrent stores $Count"
$done=FindNode $ui 'Close search performance options'
Tap $countButton
$wantedParallel=$Mode-eq 'extraction'
if(($parallel.checked-eq 'true')-ne $wantedParallel){Tap $parallel}
Tap $done
$ui=ReadUi
$limiter=FindNode $ui 'Limit parallel searches'
$wantedLimit=$Mode-ne 'off'
if(($limiter.checked-eq 'true')-ne $wantedLimit){Tap $limiter; $ui=ReadUi}
if($Action-eq 'restore'){
 [pscustomobject]@{restored=$true;count=$Count;mode=$Mode} | ConvertTo-Json -Compress
 exit
}
$battery=(& $Adb shell dumpsys battery)-join "`n"
$temperature=[regex]::Match($battery,'^  temperature: (\d+)','Multiline')
Tap (FindNode $ui $Query -Text)
[pscustomobject]@{submitted=$Query;count=$Count;mode=$Mode;batteryTemperatureC=([int]$temperature.Groups[1].Value/10)} | ConvertTo-Json -Compress
