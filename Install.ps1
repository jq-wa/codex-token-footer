[CmdletBinding()]
param([switch]$HookOnly)

$ErrorActionPreference = 'Stop'
$marketplaceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$codexCommand = Get-Command codex -ErrorAction Stop
$null = Get-Command node -ErrorAction Stop

& $codexCommand.Source plugin marketplace add $marketplaceRoot
if ($LASTEXITCODE -ne 0) { throw '添加本地插件源失败。' }
& $codexCommand.Source plugin add 'codex-token-footer@codex-token-footer-local'
if ($LASTEXITCODE -ne 0) { throw '安装插件失败。' }

if (-not $HookOnly) {
    & (Join-Path $PSScriptRoot 'Install-DesktopToolbar.ps1')
}

Write-Host ''
Write-Host '插件已安装。请重启 Codex，再在新的本地聊天中测试。'
Write-Host '需要由你检查并信任 Stop hook；安装不会自动信任 hook。'
Write-Host '可在 Codex CLI 中运行 /hooks，检查并信任 Codex Token Footer 的定义。'
if ($HookOnly) {
    Write-Host '统计以 hook 提示显示；界面的最终样式和位置由 Codex 决定。'
} else {
    Write-Host '桌面复制栏统计：请使用桌面的 Codex Token统计 快捷方式打开客户端。'
}
