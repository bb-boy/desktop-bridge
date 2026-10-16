param([switch]$Repair,[switch]$NoBrowser,[switch]$NoStart,[switch]$Stop,[switch]$Uninstall,[switch]$Purge,[string]$DataDirectory,[string]$Mode,[switch]$Administrator)
$ErrorActionPreference = 'Stop'
# Validate every portable option before downloading or changing the installation.
for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        '--repair' { $Repair = $true }
        '--administrator' { $Administrator = $true }
        '--no-browser' { $NoBrowser = $true }
        '--no-start' { $NoStart = $true }
        '--stop' { $Stop = $true }
        '--uninstall' { $Uninstall = $true }
        '--purge' { $Purge = $true }
        '--mode' {
            $i++
            if ($i -ge $args.Count -or !$args[$i] -or $args[$i].StartsWith('--')) { throw '--mode 缺少 manual 或 background 参数值。' }
            if ($Mode -and $Mode -ne $args[$i]) { throw '不能同时指定不同的 --mode。' }
            $Mode = $args[$i]
        }
        '--root' {
            $i++
            if ($i -ge $args.Count -or !$args[$i] -or $args[$i].StartsWith('--')) { throw '--root 缺少目录参数值。' }
            $DataDirectory = $args[$i]
        }
        default { throw ('未知参数：' + $args[$i]) }
    }
}
if ($PSBoundParameters.ContainsKey('Mode') -and !$Mode) { throw '-Mode 缺少 manual 或 background 参数值。' }
if ($PSBoundParameters.ContainsKey('DataDirectory') -and !$DataDirectory) { throw '-DataDirectory 缺少目录参数值。' }
if ($Mode -and $Mode -cnotin @('manual','background')) { throw '--mode 只能是 manual 或 background。' }
if ($NoStart -and $Mode -eq 'background') { throw '--no-start 不能与 --mode background 同时使用。' }
if ($Stop -and $Uninstall) { throw '--stop 不能与 --uninstall 同时使用。' }
if ($Purge -and !$Uninstall) { throw '--purge 必须与 --uninstall 一起使用。' }
if ($PSVersionTable.PSVersion -lt [version]'5.1') { throw '需要 Windows PowerShell 5.1 或更新版本。' }
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { $metadata = Get-Content (Join-Path $PSScriptRoot 'node-runtime.json') -Raw | ConvertFrom-Json }
catch { throw '无法读取官方 Node 环境清单，请重新解压完整的插件安装包。' }
if ($metadata.version -ne '24.19.0') { throw 'Node 环境清单版本无效，需要 24.19.0。' }
$processor = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if (!$processor) { throw '无法识别 Windows 处理器架构。' }
$arch = switch ($processor.ToUpperInvariant()) { 'ARM64' { 'arm64' } 'AMD64' { 'x64' } default { throw '支持的处理器：x64 和 ARM64。' } }
$entry = $metadata.platforms.('win-' + $arch)
if (!$entry -or $entry.filename -ne ('node-v24.19.0-win-' + $arch + '.zip') -or $entry.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw '官方 Node 下载清单缺失或损坏，请重新解压安装包。' }
if (!$DataDirectory -and !$env:LOCALAPPDATA) { throw '无法识别当前用户数据目录，请通过 -DataDirectory 指定专用目录。' }
$dataRoot = if ($DataDirectory) { $DataDirectory } else { Join-Path $env:LOCALAPPDATA 'DesktopBridgeClient' }
$runtime = Join-Path $dataRoot ('runtime\node-v' + $metadata.version + '-win32-' + $arch)
$existingNode = Join-Path $runtime 'node.exe'
$existingNpm = Join-Path $runtime 'node_modules\npm\bin\npm-cli.js'
function Test-PrivateRuntime([string]$Node, [string]$Npm) {
    if (!(Test-Path -LiteralPath $Node -PathType Leaf) -or !(Test-Path -LiteralPath $Npm -PathType Leaf)) { return $false }
    try {
        $version = & $Node --version 2>$null
        if ($LASTEXITCODE -ne 0 -or $version -cne ('v' + $metadata.version)) { return $false }
        $npmVersion = & $Node $Npm --version 2>$null
        return $LASTEXITCODE -eq 0 -and $npmVersion -match '^\d+\.\d+\.\d+(?:[-+].*)?$'
    } catch { return $false }
}
$useExisting = Test-PrivateRuntime $existingNode $existingNpm
$installArgs = @((Join-Path $PSScriptRoot 'install.mjs'))
if ($Administrator) { $installArgs += '--administrator' }; if ($Repair) { $installArgs += '--repair' }; if ($NoBrowser) { $installArgs += '--no-browser' }; if ($NoStart) { $installArgs += '--no-start' }
if ($Stop) { $installArgs += '--stop' }; if ($Uninstall) { $installArgs += '--uninstall' }; if ($Purge) { $installArgs += '--purge' }
if ($DataDirectory) { $installArgs += @('--root',$DataDirectory) }
if ($Mode) { $installArgs += @('--mode',$Mode) }
if ($useExisting -and !$Uninstall -and !$Stop) {
    & $existingNode @installArgs
    if ($LASTEXITCODE -ne 0) { throw '客户端操作失败，请查看上方诊断后重试。' }
    exit 0
}
if (!$useExisting) {
    if (Test-Path -LiteralPath $runtime) { Write-Host '私有 Node 或 npm 无法正常运行，将下载校验后的官方环境进行修复。' }
    foreach ($tool in @('Invoke-WebRequest','Get-FileHash','Expand-Archive')) {
        if (!(Get-Command $tool -ErrorAction SilentlyContinue)) { throw ('缺少 PowerShell 原生组件 ' + $tool + '，尚未开始下载。请修复 Windows PowerShell 5.1。') }
    }
}
# Give only the current Windows user access before placing any runtime files here.
$temp = Join-Path ([IO.Path]::GetTempPath()) ('desktop-bridge-' + [Guid]::NewGuid().ToString('N'))
try {
    try {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true,$false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
        $acl.AddAccessRule($rule)
        if ($PSVersionTable.PSEdition -eq 'Desktop') { [IO.Directory]::CreateDirectory($temp,$acl) | Out-Null }
        else { [IO.FileSystemAclExtensions]::CreateDirectory([IO.DirectoryInfo]::new($temp),$acl) | Out-Null }
    } catch { throw '无法创建仅当前用户可访问的临时目录，请检查临时目录权限和磁盘空间。' }
    if ($useExisting) {
        # Maintenance must not run from the executable that uninstall removes.
        $node = Join-Path $temp 'node.exe'
        Copy-Item -LiteralPath $existingNode -Destination $node
    } else {
        $archive = Join-Path $temp 'runtime.zip'
        Write-Host '正在准备经过 SHA-256 校验的官方 Node 24.19.0 环境…'
        try { Invoke-WebRequest -UseBasicParsing ('https://nodejs.org/dist/v' + $metadata.version + '/' + $entry.filename) -OutFile $archive -TimeoutSec 60 }
        catch { throw '官方环境下载失败，请检查网络、HTTPS 证书或代理设置。' }
        try { $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() }
        catch { throw '无法读取下载文件进行 SHA-256 校验，请检查文件权限。' }
        if ($actual -cne $entry.sha256) { throw '官方 Node 环境校验失败（checksum mismatch），已拒绝执行。' }
        try { Expand-Archive -LiteralPath $archive -DestinationPath $temp }
        catch { throw '官方环境解压失败，请检查压缩包、磁盘空间和临时目录权限。' }
        $node = Join-Path $temp ('node-v' + $metadata.version + '-win-' + $arch + '\node.exe')
        $npm = Join-Path (Split-Path $node -Parent) 'node_modules\npm\bin\npm-cli.js'
        if (!(Test-PrivateRuntime $node $npm)) { throw '下载的 Node 或 npm 无法运行，请检查系统架构、执行权限并重新下载。' }
    }
    & $node @installArgs
    if ($LASTEXITCODE -ne 0) { throw '客户端操作失败，请查看上方诊断后重试。' }
} finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue } }
