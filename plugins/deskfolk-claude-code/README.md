# Deskfolk × Claude Code

让 Deskfolk 跟随本机 Claude Code 的工作状态：工作流光、完成庆祝、提问/权限提醒，以及右键木牌上的 `Current session: xx%`。

## 安装

前提：已安装 Claude Code 和 Node.js，Deskfolk 为包含 Claude Code 适配器的版本。

```powershell
node plugins/deskfolk-claude-code/setup.mjs
```

脚本把 hook 与状态栏写入 `%USERPROFILE%\.claude\settings.json`，原文件先备份为 `settings.json.deskfolk-backup-<时间>`。已有的其他 hook 保留；已有其他状态栏时默认不覆盖（加 `--replace-statusline` 才替换）。重新打开 Claude Code 后生效。

移除：

```powershell
node plugins/deskfolk-claude-code/setup.mjs --uninstall
```

脚本记录的是本目录的绝对路径；移动 Deskfolk 目录后需重新运行一次。

## 对应关系

| Claude Code 官方事件 | 桌宠表现 |
| --- | --- |
| `UserPromptSubmit` | 开始工作（流光、“祥，工作”） |
| `PreToolUse` · `AskUserQuestion` / `Notification` · 权限、MCP 输入 | 提问提醒 |
| `PreToolUse` · `Bash` / `PowerShell` | 敲键盘 + 小终端（跑命令） |
| `PreToolUse` · `Edit` / `Write` / `MultiEdit` / `NotebookEdit` | 拿笔记本写字（改文件） |
| `PostToolUse(Failure)` / `PermissionDenied` / `ElicitationResult` | 提醒解除，回到工作；工具动作至少保留 2.4 秒后结束 |
| `Stop`（主 agent） | 完成并庆祝 |
| `StopFailure` | 失败；`rate_limit`、`billing_error` 为额度耗尽 |
| `Notification` · `idle_prompt`（仍在工作且无待答） | 暂停（按 Esc 中断时 Claude Code 不触发 `Stop`） |
| `SessionEnd`（仍在工作） | 暂停 |
| 状态栏 `rate_limits.five_hour` | 木牌 `Current session: xx%`（已用百分比，与 Claude `/usage` 一致） |

子 agent 的 `Stop` 不结束主任务。Claude Code 与 Codex 在不同项目同时工作时，计为超级工作；正在跑命令或改文件时，工具动作优先于超级工作。工具动作的眼睛仍是普通工作流光。

## 限制与隐私

- 只转发事件名、会话/提示 ID、工作目录、工具名、通知类型和错误类型；不发送提示词、回复、工具参数或对话记录。
- Current session 只对 Claude Pro/Max 订阅可用，并在会话第一次回复后出现；API Key 用户显示“暂不可用”。数据由状态栏推送，Claude Code 未打开时不会更新；重置时间过后显示“待刷新”。
- 木牌显示最近一次开始工作的那个 Agent 的额度。
- 桌宠关闭时脚本静默退出，不影响 Claude Code。
- Claude Code 的提醒不会去打开 Codex，请回到 Claude Code 窗口处理。
