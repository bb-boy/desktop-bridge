$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Join-Path $env:LOCALAPPDATA 'PersonalDesktopBridge'
$node = 'C:\Program Files\nodejs\node.exe'
$agent = Join-Path $root 'agent.mjs'
$config = Join-Path $root 'agent-config.json'
foreach ($file in @($node,$agent,$config,(Join-Path $root 'watchdog.ps1'))) {
    if (-not (Test-Path $file)) { throw "Required file is missing: $file" }
}
$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType S4U -RunLevel Highest
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $agent + '" "' + $config + '"') -WorkingDirectory $root
$boot = New-ScheduledTaskTrigger -AtStartup
$boot.Delay = 'PT25S'
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$env:USERNAME"
$logon.Delay = 'PT10S'
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(10) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Hidden
Register-ScheduledTask -TaskName 'PersonalDesktopBridge' -Action $action -Principal $principal -Trigger @($boot,$logon,$repeat) -Settings $settings -Description 'Personal MCP bridge agent; Session 0, elevated, outbound TLS, persistent device credential, automatic recovery.' -Force | Out-Null
$watchAction = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'watchdog.ps1') + '"') -WorkingDirectory $root
$watchRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$watchBoot = New-ScheduledTaskTrigger -AtStartup
$watchBoot.Delay = 'PT60S'
$watchSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 40) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'PersonalDesktopBridgeWatchdog' -Action $watchAction -Principal $principal -Trigger @($watchRepeat,$watchBoot) -Settings $watchSettings -Description 'Recover a stopped or unresponsive PersonalDesktopBridge agent; respects maintenance.flag.' -Force | Out-Null
Remove-Item (Join-Path $root 'maintenance.flag') -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'PersonalDesktopBridge'
Get-ScheduledTask -TaskName 'PersonalDesktopBridge*' | ForEach-Object {
    [pscustomobject]@{Name=$_.TaskName;State=[string]$_.State;RunLevel=[string]$_.Principal.RunLevel;LogonType=[string]$_.Principal.LogonType}
} | ConvertTo-Json
