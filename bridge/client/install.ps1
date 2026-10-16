param([switch]$Repair,[switch]$NoBrowser,[switch]$NoStart,[switch]$Stop,[switch]$Uninstall,[switch]$Purge,[string]$DataDirectory)
$ErrorActionPreference = 'Stop'
# Accept both PowerShell switches and the same portable CLI flags as Unix.
for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        '--repair' { $Repair = $true }
        '--no-browser' { $NoBrowser = $true }
        '--no-start' { $NoStart = $true }
        '--stop' { $Stop = $true }
        '--uninstall' { $Uninstall = $true }
        '--purge' { $Purge = $true }
        '--root' { $i++; if ($i -ge $args.Count) { throw '--root requires a directory.' }; $DataDirectory = $args[$i] }
        default { throw ('Unknown option: ' + $args[$i]) }
    }
}
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$metadata = Get-Content (Join-Path $PSScriptRoot 'node-runtime.json') -Raw | ConvertFrom-Json
$processor = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($processor.ToUpperInvariant()) { 'ARM64' { 'arm64' } 'AMD64' { 'x64' } default { throw 'Supported processors: x64 and ARM64.' } }
$entry = $metadata.platforms.('win-' + $arch)
$temp = Join-Path ([IO.Path]::GetTempPath()) ('desktop-bridge-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $temp | Out-Null
try {
    $dataRoot = if ($DataDirectory) { $DataDirectory } else { Join-Path $env:LOCALAPPDATA 'DesktopBridgeClient' }
    $existingNode = Join-Path $dataRoot ('runtime\node-v' + $metadata.version + '-win32-' + $arch + '\node.exe')
    if (Test-Path $existingNode) {
        if ($Uninstall -or $Stop) {
            # Windows cannot delete a running executable. Maintenance runs a
            # temporary copy so uninstall can remove the installed runtime.
            $node = Join-Path $temp 'node.exe'
            Copy-Item $existingNode $node
        } else { $node = $existingNode }
    } else {
        $archive = Join-Path $temp 'runtime.zip'
        Invoke-WebRequest -UseBasicParsing ('https://nodejs.org/dist/v' + $metadata.version + '/' + $entry.filename) -OutFile $archive
        if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw 'Official Node runtime checksum mismatch.' }
        Expand-Archive $archive $temp
        $node = Join-Path $temp ('node-v' + $metadata.version + '-win-' + $arch + '\node.exe')
    }
    $installArgs = @((Join-Path $PSScriptRoot 'install.mjs'))
    if ($Repair) { $installArgs += '--repair' }; if ($NoBrowser) { $installArgs += '--no-browser' }; if ($NoStart) { $installArgs += '--no-start' }
    if ($Stop) { $installArgs += '--stop' }; if ($Uninstall) { $installArgs += '--uninstall' }; if ($Purge) { $installArgs += '--purge' }
    if ($DataDirectory) { $installArgs += @('--root',$DataDirectory) }
    & $node @installArgs
    if ($LASTEXITCODE -ne 0) { throw 'Client operation failed. Review the error above and retry.' }
} finally { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
