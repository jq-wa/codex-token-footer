# Codex Token Footer

一个供 Windows Codex 本地聊天使用的只读插件。每轮回答结束时，从当前会话日志显示输入、输出、合计、缓存命中 token、缓存命中率和整轮耗时。当前版本：0.1.1。

显示内容示例（演示数字）：

> 本轮 Token · 输入 42,600 · 输出 1,240 · 合计 43,840 · 缓存命中 36,000 · 缓存命中率 84.5% · 耗时 28.6 秒

**显示方式：Codex `Stop` hook 的 `systemMessage` 提示。**统计通过 `hook/completed` 通知发送给客户端，界面样式和位置由 Codex 决定，可能显示警告图标或需要展开 hook 详情。Windows 桌面端的实际渲染尚未验证。

## 安装

需要 Node.js，以及支持 `codex plugin` 和 `Stop` hooks 的 Codex。已验证的环境为 `codex-cli 0.162.0-alpha.17.2`、Node.js `v24.21.0`。

1. 克隆本仓库，或下载并解压到准备长期保留的位置。
2. 在这个文件夹打开 PowerShell，运行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
   ```

   安装脚本用 Codex 自带命令添加本地 marketplace、安装插件。不会自动信任 hook。
3. 在 Codex CLI 中运行 `codex`，输入 `/hooks`，检查并信任 **Codex Token Footer** 的 Stop hook。命令只运行本地 Node.js 脚本，读取当前会话日志。
4. 完全退出并重新打开 Codex 桌面应用，开始新的本地聊天，发一句短消息，确认回答结束后是否出现统计提示。

如果客户端不呈现 hook 提示，则不会在聊天界面显示统计。

## 统计口径

- 统计整轮所有记录的模型请求，包括推理和工具调用过程中发生的模型请求，不只最后一段可见回答。
- 输入包含缓存命中的 token；缓存命中是其中一部分，不能再加进合计。
- 缓存命中率 = 本轮缓存命中 token ÷ 本轮输入 token × 100%，保留一位小数。输入为零时显示“—”；缺少缓存计数时不显示该项。
- 输出包含上游记录的推理输出，不能把推理数再加进合计。
- 用累计计数的增量计算本轮用量，忽略重复的 token_count 通知。首次采样或累计计数重置时使用实际 last_token_usage。
- 耗时包括思考、工具执行及等待，并非纯生成耗时。因此不将“输出 / 整轮耗时”标成模型生成速度。
- 缺少日志、找不到当前 turn 或统计未写入时显示“暂不可用”，不猜测 token 数。
- 数据来自本机日志，不等于订阅套餐剩余额度，也不是费用账单。日志格式不是官方稳定接口，后续客户端升级可能需要适配。

## 本地行为

插件没有网络请求、第三方依赖或模型调用，不读取认证配置。不写入或修改聊天记录，不注入提示词，不阻止回答结束，也不触发模型续写。

## 卸载

```powershell
codex plugin remove codex-token-footer@codex-token-footer-local
codex plugin marketplace remove codex-token-footer-local
```

## 开发与验证

```powershell
node --test .\tests\token-footer.test.cjs
node .\plugins\codex-token-footer\scripts\token-footer.cjs --inspect 'C:\path\to\rollout.jsonl' 'turn-id'
```

## 验证结果

- 0.1.1 的 8 个统计与 hook 行为测试通过，覆盖多次模型请求、重复用量通知、指定轮次、首次采样、累计计数重置、缺少统计、部分日志写入，以及零缓存命中与零输入的区别。
- 已与真实会话日志的累计 token 增量比对，整轮输入、输出、缓存和合计一致。
- 已在隔离的 `CODEX_HOME` 中添加 marketplace、安装并启用插件。
- 已用本机模拟响应验证真实 Codex app-server：Stop hook 执行成功，`hook/completed` 通知包含 `kind: warning` 和完整统计文本，未触发额外模型请求。
- 已验证版本的 `codex exec --json` 不会把该 hook 提示打印到标准输出。

官方依据：[Hooks](https://developers.openai.com/codex/hooks)、[插件打包与本地安装](https://developers.openai.com/codex/plugins/build)。
