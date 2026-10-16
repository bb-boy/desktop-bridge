param([switch]$Purge,[string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$argsForInstaller = @{'Uninstall'=$true}
if ($Purge) { $argsForInstaller['Purge']=$true }
if ($DataDirectory) { $argsForInstaller['DataDirectory']=$DataDirectory }
& (Join-Path $PSScriptRoot 'install.ps1') @argsForInstaller
