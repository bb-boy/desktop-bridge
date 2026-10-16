$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'DesktopBridgeClient'
$shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Desktop Bridge.lnk'
if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
if (Test-Path $root) {
    New-Item -ItemType File -Force (Join-Path $root 'maintenance.flag') | Out-Null
    if (Test-Path (Join-Path $root 'runner.pid')) {
        $runnerId = [int](Get-Content (Join-Path $root 'runner.pid'))
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$runnerId" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine.Contains((Join-Path $root 'run-client.ps1'))) { & taskkill.exe /PID $runnerId /T /F | Out-Null }
    }
    $choice = Read-Host 'Remove local credentials and saved results too? Type DELETE, or press Enter to keep them'
    if ($choice -eq 'DELETE') { Remove-Item $root -Recurse -Force }
}
Write-Host 'Client stopped. Use the device management page to unlink this computer and revoke its credential.'
