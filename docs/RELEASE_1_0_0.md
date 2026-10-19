# Deskfolk v1.0.0

住在 Windows 桌面上的若叶睦，陪你等 AI 编程助手干活。

## 下载

下载下方 **Assets** 里的 `Deskfolk-Setup-1.0.0.exe`（Windows x64）。安装前先退出正在运行的 Deskfolk，原来的设置、通知记录和桌面位置都会保留。安装包没有数字签名，可以用 `SHA256SUMS.txt` 核对。

## 支持的 Agent

- **Codex**：不用设置，自动跟随本机 Codex 的工作状态。
- **Claude Code**：插件已随安装包附带，位于安装目录的 `resources/plugins/deskfolk-claude-code/`，需要 Node.js。在 PowerShell 运行一次 `node "$env:LOCALAPPDATA\Programs\Deskfolk\resources\plugins\deskfolk-claude-code\setup.mjs"`（装在其他目录时换成实际路径），重新打开 Claude Code 后生效。详见[插件说明](https://github.com/DeriitoMe/Deskfolk/blob/v1.0.0/plugins/deskfolk-claude-code/README.md)。
- **DeepSeek Harness**：插件已随安装包附带，位于安装目录的 `resources/plugins/deskfolk-deepseek-harness/`，需要 Harness 0.2.1-rc.2 或更高版本。安装方法见[插件说明](https://github.com/DeriitoMe/Deskfolk/blob/v1.0.0/plugins/deskfolk-deepseek-harness/README.md)。
- 设置里的“跟随”可以选择 全部 / DeepSeek / Codex / Claude Code。

## 她会做什么

- **工作状态**：开始工作时眼睛亮起代码流光；跑命令时敲键盘，改文件时拿笔记本写字；两个以上项目同时进行时全力工作。
- **提醒**：Agent 提问或请求权限时冒出“等你回复”的气泡；确认任务成功后拍手庆祝。中断、失败和额度用完不会误报成完成。
- **互动**：摸头、连点十下会委屈、拖起来会晃、绕圈会头晕；没事时打盹、给黄瓜浇水。
- **额度木牌**：右键她，显示 Codex 或 Claude Code 的五小时剩余额度。DeepSeek Harness 没有提供额度数据，木牌显示“暂不可用”。

## 已知限制

- 目前只有 Windows x64 安装包，角色只有若叶睦。
- 安装包没有数字签名。
- 在 DeepSeek Harness 中，用 `run_code` 编排的工具调用本身没有专门动作，其中实际运行的命令仍会触发敲键盘。

## English

A Windows desktop companion featuring a chibi Wakaba Mutsumi. She shows what your AI coding agents are doing: working, running commands, editing files, waiting for your answer and celebrating completed tasks. Supported agents are Codex (automatic), Claude Code (plugin included in the installer; with Node.js installed, run `node "$env:LOCALAPPDATA\Programs\Deskfolk\resources\plugins\deskfolk-claude-code\setup.mjs"` once in PowerShell) and DeepSeek Harness 0.2.1-rc.2 or newer (plugin included in the installer). Download `Deskfolk-Setup-1.0.0.exe` below. The installer is unsigned; verify it with `SHA256SUMS.txt`.

---

本版本在 2026-10-18 加入 Claude Code 支持、2026-10-19 加入 DeepSeek Harness 支持时重新打包过，`v1.0.0` 标签和安装包已随之更新。
