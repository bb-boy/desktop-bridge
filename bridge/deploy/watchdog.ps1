$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (Test-Path (Join-Path $root 'maintenance.flag')) { exit 0 }
$task = Get-ScheduledTask -TaskName 'PersonalDesktopBridge' -ErrorAction SilentlyContinue
if (-not $task -or $task.State -eq 'Disabled') { exit 0 }
if ($task.State -ne 'Running') {
    Start-ScheduledTask -TaskName 'PersonalDesktopBridge'
    exit 0
}
$heartbeat = Join-Path $root 'heartbeat.json'
if ((Test-Path $heartbeat) -and ((Get-Date) - (Get-Item $heartbeat).LastWriteTime).TotalSeconds -gt 120) {
    # Only terminate the process whose executable command line names this agent.
    $processes = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + (Join-Path $root 'agent.mjs') + '*')
    }
    foreach ($process in $processes) { & taskkill.exe /PID $process.ProcessId /T /F 2>$null | Out-Null }
    Stop-ScheduledTask -TaskName 'PersonalDesktopBridge' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName 'PersonalDesktopBridge'
}
