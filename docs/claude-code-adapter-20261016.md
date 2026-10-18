# Claude Code 适配器（2026-10-16）

分支：`feature/claude-monitor`，基线 `v1.0.0`（后续更新见 `claude-code-monitor-20261017.md`）。按 `dizzy-eyes-and-agent-adapters-20261006.md` 的方案增加第二个 Agent 适配器，Codex 逻辑不变。

## 设计

- 新来源 `claude-code`。Claude Code 没有类似 Codex JSONL 的本地会话日志，官方 hook 是它自己的生命周期接口，因此与 `codex-log` 同属原生来源（`shared/reminders.ts::isNativeLifecycleSource`），可以确立工作。Codex 的辅助 `hook` 来源仍只能补充已确认回合。
- `electron/claude-code.ts::ClaudeCodeAdapter` 把 hook 负载转换成现有事件词汇；会话键为 `claude-code:<session_id>`，回合为 `prompt_id`（缺失时由适配器生成并配对）。
- 新桥接路由：`POST /claude-code`（hook 摘要）、`POST /claude-code/status`（状态栏额度）。同一 `bridge.json` 令牌校验。
- 额度：`shared/quota.ts::parseClaudeQuota` 读取 `rate_limits.five_hour`，标签 `Current session: xx%`（已用）。`selectQuota` 让木牌跟随最近开始工作的 Agent；Claude 读数保存在用户目录 `claude-quota.json`。
- Claude 提醒的“打开”按钮不再唤起 Codex。
- 接入脚本与安装说明：`plugins/deskfolk-claude-code/`。

## 验证

- 新增 `electron/claude-code.test.ts`（10 项，经由真实状态归约与展示规则）、`shared/quota.test.ts` 2 项、`plugins/deskfolk-claude-code/setup.test.mjs` 3 项。
- 全部 203 项 Node 测试通过（原 179 项不变）。
- 未在真机运行 Electron 与 Claude Code；首次安装后需按真实场景验证：开始、权限提醒、AskUserQuestion、完成庆祝、Esc 中断、额度木牌。

## 回退

切回 `main` / `v1.0.0` 并重新构建；运行 `setup.mjs --uninstall` 移除 Claude Code 设置（安装时已有备份）。
