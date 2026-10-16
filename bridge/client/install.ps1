param([switch]$Repair,[switch]$NoBrowser,[switch]$NoStart,[string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$source = $PSScriptRoot
$root = if ($DataDirectory) { $DataDirectory } else { Join-Path $env:LOCALAPPDATA 'DesktopBridgeClient' }
$release = Join-Path $root 'releases\0.2.0'
$configPath = Join-Path $root 'agent-config.json'
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Desktop Bridge.lnk'
New-Item -ItemType Directory -Force $release | Out-Null
# Credentials and execution results belong only to the signed-in Windows user.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $root /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' /T /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the client data directory.' }
if (Test-Path (Join-Path $root 'runner.pid')) {
    $runnerId = [int](Get-Content (Join-Path $root 'runner.pid'))
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$runnerId" -ErrorAction SilentlyContinue
    if ($proc -and $proc.CommandLine.Contains((Join-Path $root 'run-client.ps1'))) {
        & taskkill.exe /PID $runnerId /T /F | Out-Null
        Start-Sleep -Seconds 2
    }
}
$metadata = Get-Content (Join-Path $source 'node-runtime.json') -Raw | ConvertFrom-Json
$archive = Join-Path $source $metadata.filename
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256) { throw 'Runtime checksum mismatch. Download a fresh client ZIP.' }
$runtimeDir = Join-Path $root ('node-' + $metadata.version)
if (-not (Test-Path (Join-Path $runtimeDir 'node.exe'))) {
    $extract = Join-Path $root 'runtime-extract'
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive $archive $extract
    $nodeFolder = Get-ChildItem $extract -Directory | Select-Object -First 1
    Move-Item $nodeFolder.FullName $runtimeDir
    Remove-Item $extract -Recurse -Force
}
$node = Join-Path $runtimeDir 'node.exe'
$env:PATH = $runtimeDir + ';' + $env:PATH
foreach ($file in @('package.json','package-lock.json')) { Copy-Item (Join-Path $source $file) $release -Force }
New-Item -ItemType Directory -Force (Join-Path $release 'agent') | Out-Null
Copy-Item (Join-Path $source 'agent\*') (Join-Path $release 'agent') -Force
Write-Host 'Preparing Desktop Commander tools. This can take a few minutes on the first installation.'
& $node (Join-Path $runtimeDir 'node_modules\npm\bin\npm-cli.js') ci --prefix $release --omit=dev --ignore-scripts --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw 'Tool installation failed. Check network access to registry.npmjs.org, then run Install.cmd again.' }
# The lockfile includes the platform-specific ripgrep binary as an optional package.
$config = if (Test-Path $configPath) { Get-Content $configPath -Raw | ConvertFrom-Json } else { [pscustomobject]@{serverUrl=(Get-Content (Join-Path $source 'connection.json') -Raw | ConvertFrom-Json).serverUrl} }
$config | Add-Member -Force NoteProperty runtimeDir $release
$config | Add-Member -Force NoteProperty mcpEntry (Join-Path $release 'node_modules\@wonderwhy-er\desktop-commander\dist\index.js')
$config | Add-Member -Force NoteProperty defaultShell 'powershell.exe'
$config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
Remove-Item (Join-Path $root 'maintenance.flag') -Force -ErrorAction SilentlyContinue
$pairArgs = @((Join-Path $release 'agent\agent.mjs'),$configPath,'--setup-only')
if ($Repair) { $pairArgs += '--pair' }
if ($NoBrowser) { $pairArgs += '--no-browser' }
& $node @pairArgs
if ($LASTEXITCODE -ne 0) { throw 'Device pairing did not finish. Run Install.cmd to try again.' }
Copy-Item (Join-Path $source 'run-client.ps1') $root -Force
@{node=$node;agent=(Join-Path $release 'agent\agent.mjs');config=$configPath} | ConvertTo-Json | Set-Content (Join-Path $root 'launch.json') -Encoding UTF8
if (-not $NoStart) {
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($startup)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'run-client.ps1') + '"'
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Save()
Start-Process $shortcut.TargetPath -ArgumentList $shortcut.Arguments -WindowStyle Hidden
}
Write-Host 'Installed. Desktop Bridge starts automatically when you sign in to Windows.'
if (-not $NoBrowser) { Start-Process $config.serverUrl }
