# Codex Token Footer

Windows Codex 本地聊天的 Token 统计插件。当前版本 **0.2.0**，包含 Stop hook 和桌面复制栏显示脚本，两者共用同一套统计函数。

回答结束后显示输入、输出、合计、缓存命中率和整轮耗时。切换或重新打开聊天后，即使客户端没有保留 hook 统计，也能从本机会话日志恢复已有回答的统计。

显示示例（演示数字）：

> Token 43,840 · 入 42,600 / 出 1,240 · 缓存 84.5% · 28.6s

鼠标悬停可查看完整统计，包括缓存命中 token 数量。

## 安装和使用

需要 Windows Codex 桌面应用、支持插件和 Stop hooks 的 Codex CLI，以及 **Node.js 22.13 或更新版本**（建议 Node.js 24）。桌面脚本使用 Node 内置 SQLite，无需安装第三方依赖。

1. 克隆本仓库或下载并解压安装包。
2. 在仓库目录打开 PowerShell，运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
   ```

   这会安装 hook 插件和桌面显示脚本，并创建 **Codex Token统计** 桌面快捷方式。脚本复制到 `CODEX_HOME\token-toolbar`；未设置 `CODEX_HOME` 时位于用户目录下的 `.codex\token-toolbar`。后续运行无需保留下载的目录。
3. 在 Codex CLI 中输入 `/hooks`，检查并信任 Codex Token Footer 的 Stop hook。安装脚本不会自动信任 hook。
4. 关闭已有 Codex 桌面窗口，通过 **Codex Token统计** 快捷方式打开客户端。统计将出现在回答的“复制”按钮同一栏。

桌面脚本使用独立的界面配置目录，但共享同一个 `CODEX_HOME` 的本地聊天数据；首次打开时可能需要重新设置界面偏好。只有通过该快捷方式启动的客户端会加载复制栏显示。回答仍在生成时，最终统计尚未完成；日志缺少用量时不估算数字。

已安装 hook 插件，只补装或更新复制栏显示：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-DesktopToolbar.ps1
```

更新前关闭通过统计快捷方式打开的 Codex，再安装并重新打开。

只安装 hook 插件，保留客户端原生显示方式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -HookOnly
```

仅从 Codex 插件市场安装插件会启用 Stop hook；复制栏显示需要额外运行本仓库提供的桌面安装脚本。

## 实现方式

- `plugins/codex-token-footer/scripts/token-footer.cjs` 读取本机会话日志，提供 `readTurnUsage()` 和 `formatFooter()`；Stop hook 和桌面启动器都调用这里的函数。
- `scripts/desktop/toolbar-client.cjs` 启动 Codex，连接仅监听 `127.0.0.1` 的本机调试接口，加载界面脚本。它只读查询本地 SQLite 中的聊天日志路径，将相应轮次的统计交给界面。
- `scripts/desktop/token-toolbar.js` 在复制栏显示统计。优先使用客户端已有的 hook 结果；缺失时使用日志统计。切换聊天和重新加载界面后会重新显示。
- 启动器每 1.5 秒检查当前显示的回答；界面每秒刷新。未变化的日志统计使用缓存，不发送模型请求。
- 不修改 WindowsApps 中的官方安装包，不读取 API 密钥，不修改聊天日志。启动器会写入自己的运行状态、界面配置和诊断日志。

复制栏显示使用客户端内部 DOM、React 数据和本地聊天数据库。这些接口不是官方稳定接口，后续客户端升级可能需要适配。停止启动器并关闭该客户端后，普通 Codex 入口恢复原生界面。

## 统计口径

- 统计整轮所有记录的模型请求，包括推理和工具调用过程中的模型请求，不只最后一段回答。
- 输入包含缓存命中的 token，输出包含上游记录的推理输出；这些子集不能再加进合计。
- 缓存命中率 = 本轮缓存命中 token ÷ 本轮输入 token × 100%，保留一位小数。输入为零时显示“—”；缺少缓存计数时不显示该项。
- 用累计计数的增量计算本轮用量，忽略重复的 `token_count` 通知。首次采样或累计计数重置时使用实际 `last_token_usage`。
- 耗时包括思考、工具执行和等待，并非纯生成耗时。
- 缺少日志、找不到当前轮次或统计未写入时，hook 提示暂不可用；复制栏不会显示猜测的数字。
- 数据来自本机日志，不等于订阅套餐剩余额度，也不是费用账单。

统计和显示本身不调用模型、不上传日志、不注入提示词、不阻止回答结束，也不触发续写。

## 卸载

停用复制栏启动器，移除快捷方式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Uninstall-DesktopToolbar.ps1
```

然后关闭通过统计快捷方式打开的客户端，从普通 Codex 入口启动。卸载保留 `token-toolbar` 目录中的界面设置，不删除聊天数据。

卸载 hook 插件：

```powershell
codex plugin remove codex-token-footer@codex-token-footer-local
codex plugin marketplace remove codex-token-footer-local
```

## 开发与验证

```powershell
node --test .\tests\token-footer.test.cjs
node .\plugins\codex-token-footer\scripts\token-footer.cjs --inspect 'C:\path\to\rollout.jsonl' 'turn-id'
```

已验证环境：Windows Codex `26.1007.2314.0`、`codex-cli 0.162.0-alpha.17.2`、Node.js `24.21.0`。

- 8 个统计和 hook 行为测试覆盖多次模型请求、重复用量通知、指定轮次、累计计数重置、缺少统计、部分日志写入及零输入。
- 已与真实会话日志的累计计数增量比对。
- 已验证真实客户端复制栏显示和切换聊天后的统计恢复。
- 已验证真实 app-server 的 Stop hook 通知包含完整统计文本，并且不会触发额外模型请求。
- 已验证版本的 `codex exec --json` 不会把该 hook 提示打印到标准输出。

官方依据：[Hooks](https://developers.openai.com/codex/hooks)、[插件打包与本地安装](https://developers.openai.com/codex/plugins/build)。
