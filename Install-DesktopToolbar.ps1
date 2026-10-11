[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$toolbarNode = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = & $toolbarNode -p 'process.versions.node'
if ([version]$nodeVersion -lt [version]'22.13.0') { throw '桌面统计需要 Node.js 22.13 或更新版本。建议使用 Node.js 24。' }
$package = Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1
if (-not $package) { throw '未找到 Windows Codex 桌面应用。' }
$codexDataRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$toolbarRoot = Join-Path $codexDataRoot 'token-toolbar'
$runtimeFile = Join-Path $toolbarRoot 'runtime.json'
if (Test-Path -LiteralPath $runtimeFile) {
    $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
    $helper = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$runtime.helperPid)
    if ($helper -and $helper.CommandLine -like '*toolbar-client.cjs*') {
        Stop-Process -Id $runtime.helperPid -ErrorAction Stop
    }
}
New-Item -ItemType Directory -Path $toolbarRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'plugins\codex-token-footer\scripts') -Destination $toolbarRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-DesktopToolbar.ps1') -Destination $toolbarRoot -Force
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Token统计.lnk'))
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $toolbarRoot 'Start-DesktopToolbar.ps1') + '"'
$shortcut.WorkingDirectory = $toolbarRoot
$shortcut.WindowStyle = 7
$shortcut.IconLocation = (Join-Path $package.InstallLocation 'app\ChatGPT.exe')
$shortcut.Save()
Write-Host '复制栏统计脚本已安装，桌面快捷方式已创建。'

