param([ValidateSet('start','stop','status','pair')][string]$Action,[string]$DataDirectory)
$ErrorActionPreference = 'Stop'
for ($i = 0; $i -lt $args.Count; $i++) {
    if ($args[$i] -eq '--root') { $i++; if ($i -ge $args.Count) { throw '--root requires a directory.' }; $DataDirectory = $args[$i] }
    else { throw ('Unknown option: ' + $args[$i]) }
}
$root = if ($DataDirectory) { $DataDirectory } elseif (Test-Path (Join-Path $PSScriptRoot '.desktop-bridge-client')) { $PSScriptRoot } else { Join-Path $env:LOCALAPPDATA 'DesktopBridgeClient' }
$launchPath = Join-Path $root 'launch.json'
if (-not (Test-Path $launchPath)) { throw 'Install Desktop Bridge first.' }
$launch = Get-Content $launchPath -Raw | ConvertFrom-Json
& $launch.node (Join-Path $root 'control.mjs') $Action --root $root
exit $LASTEXITCODE
