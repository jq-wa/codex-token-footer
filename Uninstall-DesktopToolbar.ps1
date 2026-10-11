[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$codexDataRoot = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$runtimeFile = Join-Path $codexDataRoot 'token-toolbar\runtime.json'
if (Test-Path -LiteralPath $runtimeFile) {
    $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
    $helper = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$runtime.helperPid)
    if ($helper -and $helper.CommandLine -like '*toolbar-client.cjs*') {
        Stop-Process -Id $runtime.helperPid -ErrorAction Stop
    }
}
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Token统计.lnk'
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
Write-Host '启动器已停用，快捷方式已移除。请关闭使用该快捷方式打开的 Codex，再从普通入口启动。'
Write-Host '本机 token-toolbar 文件夹已保留，其中包含独立的界面设置；会话和插件未删除。'

