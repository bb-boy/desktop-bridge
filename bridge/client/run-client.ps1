$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$lock = $null
try { $lock = [IO.File]::Open((Join-Path $root 'runner.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) } catch { exit 0 }
try {
    $PID | Set-Content (Join-Path $root 'runner.pid')
    $launch = Get-Content (Join-Path $root 'launch.json') -Raw | ConvertFrom-Json
    while (-not (Test-Path (Join-Path $root 'maintenance.flag'))) {
        try { & $launch.node $launch.agent $launch.config } catch { }
        Start-Sleep -Seconds 10
    }
} finally { $lock.Dispose() }
