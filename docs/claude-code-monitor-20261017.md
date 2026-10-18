# Claude Code 监视与界面更新（2026-10-17）

分支：`feature/claude-monitor`，基线 `v1.0.0`，接续 `claude-code-adapter-20261016.md`。

## Claude Code

- 工具动作：`Bash` / `PowerShell` → 敲键盘 + 小终端（`claude-type`），`Edit` / `Write` / `MultiEdit` / `NotebookEdit` → 笔记本写字（`claude-write`）。眼睛保持普通工作流光。
- `electron/claude-tools.ts::ClaudeToolTracker` 只读工具名与 `tool_use_id`，独立于工作状态归约；每个动作至少显示 2.4 秒，只在会话真实工作时出现，10 分钟无结束事件自动失效。经 `pet:tool` 发送给渲染层。
- 工具动作优先于超级工作；提问/权限提醒优先于工具动作。
- 接入脚本新增异步 `PreToolUse`（只匹配上述工具）与 `SessionStart`；`SessionStart` 在桌宠未运行时按设置经 `explorer.exe` 启动已安装的 `Deskfolk.exe`（读取用户目录 `launch.json`，30 秒冷却）。
- Claude Code 的提问不显示“打开 Codex”按钮。

## 设置与界面

- 跟随：全部 / Codex / Claude Code（`shared/agents.ts`）。两边状态始终在后台记录，只过滤展示（工作状态、气泡、庆祝、工具动作、额度木牌），切回时立即显示。
- 连接卡片显示 Codex 监视状态与 Claude Code 接入状态；新增“随 Claude Code 启动”；删除“待机时轻轻跳舞”。
- 设置与当前项目窗口改为浅绿色标题栏（隐藏原生标题栏，保留系统按钮的 `titleBarOverlay`），刷新卡片、滑块、滚动条、项目状态色条与事件时间线。

## 动作与美术

- 举牌：牌子随双手升降、仅在手中可见；增加预备下蹲、过冲回稳、抬头与轻摆（`shared/quota-board-motion.ts`）。
- 浇水：壶嘴出水约朝下 20°，6 束扇形半透明虚线；新的杏色水壶与带叶、卷须、黄瓜和小黄花的花盆。
- 工作眼睛：柔和光条 + 斜向光扫 + 暖光呼吸（`codeFlowStyle='soft'`，旧字符流保留为 `classic`）。
- 气泡：原椭圆精修，小圆点依次弹出、椭圆回弹展开、文字上浮；退出时向圆点方向收缩淡出；寒蝉圆体细描边代替合成粗体。

## 验证

- Node 测试 212 项全部通过。
- 隔离 profile 的真实路径检查：Claude Code 20 项、跟随切换与设置 12 项，均对安装包执行。
- 尚未在真机确认：新会话通过 `SessionStart` 拉起桌宠；桌面 App 的 Code 标签不运行自定义状态栏，Claude 额度木牌可能保持“暂不可用”。
