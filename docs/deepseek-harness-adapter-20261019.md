# DeepSeek Harness 原生接入（2026-10-19）

分支：`feature/deepseek-harness`。基线：Claude 分支提交 `0224e86`。实现保存在独立工作树，原有工作树的未提交文件保留。

## 行为

Harness Cordis 插件监听原生生命周期，通过 Deskfolk 每次启动生成的本机端口和认证令牌发送事件。主进程使用独立的 `deepseek-harness` 来源、`deepseek-harness:` 会话命名空间和 `deepseek` 跟随选项。

- 原生 `turn/start` 开始工作；只有主会话的 `turn/end`、`reason.kind=completed` 能庆祝。
- `approval/asked` / `approval/decided` 按请求 ID 显示、解除权限提醒。提问仍在 Harness 原界面处理。
- 观察 `user-questions/request`，原样返回原生答案和异常。定时提问、PTC 提问及迟到回答使用 Harness 的 `userQuestions` 投影同步，问题在请求回合结束后仍可保持待答。
- `tools/execute` 中的 `bash`、`terminal_open`、`terminal_send` 对应敲键盘；`edit`、`write` 对应写字。只有真正进入执行阶段的工具触发动作。状态快照包含当前执行工具的 ID 和名称。
- 子 Agent 使用官方 `header.origin=subagent` 识别；普通 fork 的 `parentSession` 保留主会话身份。支持与 Codex、Claude Code 跨项目聚合。
- 中止、阻塞和失败按实际结束原因处理。`QUOTA` / `ACCOUNT_QUOTA` 触发额度耗尽反馈；`RATE_LIMIT` 为请求失败。额度牌显示 DeepSeek 数据暂不可用。

## 状态与顺序

插件每 5 秒发送当前状态快照。首次载入、桌宠重启和重新连接时，快照静默恢复工作、待答和工具状态。主进程超过 20 秒未收到有效数据后清理本地工作和提醒；定时器每 5 秒检查一次。清理本地状态不代表 Harness 已回答问题，重新连接后可恢复同一个待答请求。

每个插件进程拥有独立 `streamId`，每个会话拥有递增的 `sequence` 和原生数字 `turn`。只有快照可以采纳新流；已退休的流、旧回合及重复顺序号不能清理新问题或触发完成。长原生 ID 使用稳定摘要，避免截断后身份冲突。错误代码随快照保留。

桥接发送使用有界异步队列；关闭的桌宠不会阻塞 Harness。发送失败不会重播历史庆祝，后续快照修正当前状态。

## 安装与交付

完整安装、预览和卸载命令见[插件说明](../plugins/deskfolk-deepseek-harness/README.md)。安装器要求明确指定已初始化的 profile，通过官方 `dsh plugin ... add/remove` 管理组合包，不自行重写 Cordis 配置。

Windows 安装包包含插件源码和安装器。实际启用时，进入安装目录的 `resources/plugins/deskfolk-deepseek-harness/`，执行 `node setup.mjs --profile <实际使用的名称>`。使用源码开发时直接运行仓库内的安装脚本。

本轮完成代码、构建与隔离验证；没有安装到用户真实 Harness profile，也没有更新公开发布版本。当前本机 Harness 版本尚未核实，且 `dsh` 不在已检出的 PATH 中；实际运行实例仍需核对版本及所用 profile。

## 验证

- Node 自动测试：270 项通过，覆盖已有 Codex / Claude 行为及新增 Harness 生命周期、工具、安装器与传输。
- TypeScript：`tsc --noEmit` 通过；`npm run build` 通过。
- 官方运行时：真实 `@deepseek-ai/cordis@4.0.5`、`@deepseek-ai/dsh-session@0.2.1-rc.2` 和 `@deepseek-ai/dsh-session-projection@0.2.1-rc.2` 中挂载插件通过。Agent 注册表和回答器为隔离 fixture；验证原生返回值、答案、异常保持原样，以及卸载清理。可复现命令见插件说明。
- Electron：真实构建的主进程、预加载脚本、渲染界面和本机桥接联测通过，覆盖权限、工具动作、持续提问、跟随切换、完成庆祝和设置界面。
- Electron 冷启动：先隔离持久状态，再从真实插件快照恢复已结束回合中的可答问题；心跳失效后清理、重连后恢复及迟到回答解除均通过。
- 隐私：桥接不包含提示词、模型回复、提问正文、答案、工具参数/结果或 API 凭据；测试断言私密标记未进入事件历史。

```powershell
node --test shared/*.test.ts electron/*.test.ts plugins/deskfolk-claude-code/*.test.mjs plugins/liquid-glass-pet/hooks/*.test.mjs plugins/deskfolk-deepseek-harness/*.test.mjs renderer/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
npm run build
```

隔离 Electron 检查（在 PowerShell 中清除 `ELECTRON_RUN_AS_NODE` 后执行）：

```powershell
$env:ELECTRON_RUN_AS_NODE=$null
& .\node_modules\electron\dist\electron.exe scripts/qa-v42-deepseek-harness.cjs | Out-String
& .\node_modules\electron\dist\electron.exe scripts/qa-v42-deepseek-harness.cjs --restart-fixture --lease-recovery | Out-String
```

报告与界面截图位于忽略的 `.cache/deepseek-qa-*/` 下，包含的会话均为测试 fixture。

## 上游依据

实现核对提交：[`687f282e8625c6b8d11ff58211a90524be2e4317`](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317)，源码版本 `0.2.1-rc.2`。

精确原生事件、组合包及桌面命令文档链接集中在[插件说明](../plugins/deskfolk-deepseek-harness/README.md)。
