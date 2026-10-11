[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$toolbarNode = (Get-Command node.exe -ErrorAction Stop).Source
# Installed next to runtime.json; support custom CODEX_HOME when started by shortcut.
$env:CODEX_HOME = Split-Path -Parent $PSScriptRoot
$clientPath = Join-Path $PSScriptRoot 'scripts\desktop\toolbar-client.cjs'
if (-not (Test-Path -LiteralPath $clientPath)) { throw '请先运行 Install-DesktopToolbar.ps1。' }
Start-Process -FilePath $toolbarNode -ArgumentList @(('"' + $clientPath + '"')) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'stderr.log')

