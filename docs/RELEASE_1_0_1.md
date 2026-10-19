# Deskfolk v1.0.1

这一版的重点：**DeepSeek Harness 可以直接接入了**。只下载安装包，就能让若叶睦跟随 DeepSeek Harness 的工作状态，不需要源码。

## 接入 DeepSeek Harness

需要 DeepSeek Harness 0.2.1-rc.2 或更高版本（低于 0.3.0）和 Node.js 22 或更高版本。插件随安装包附带，位于安装目录的 `resources\plugins\deskfolk-deepseek-harness\`。

1. 先打开一次要接入的 Harness 应用来初始化 profile，然后完全退出。桌面版的 profile 是 `desktop`，浏览器版是 `web`。桌面版还要在应用菜单的 **Manage dsh Command…** 里安装 `dsh` 命令，再打开新终端。
2. 在 PowerShell 运行下面的命令（浏览器版把 `desktop` 换成 `web`；装在其他目录时换成实际路径；加 `--dry-run` 可以先预览）：

   ```powershell
   node "$env:LOCALAPPDATA\Programs\Deskfolk\resources\plugins\deskfolk-deepseek-harness\setup.mjs" --profile desktop
   ```

3. 重新启动 Harness 和 Deskfolk，在设置的“跟随”里选“全部”或“DeepSeek”。

接入后，她会：

- Harness 开始工作时亮起代码流光；运行命令时敲键盘，写文件时拿笔记本写字。
- 请求权限或提问时冒出“等你回复”的气泡。
- 主会话真正完成时拍手庆祝；中止、出错和额度耗尽不会误报成完成，子 Agent 完成也不会替主会话报完成。
- Deskfolk 重启后恢复正在进行的会话和待答提醒。

脚本通过 Harness 官方的 `dsh plugin add` 安装，保留你已有的 Harness 配置。移除时在同一命令后加 `--uninstall`。详见[插件说明](https://github.com/DeriitoMe/Deskfolk/blob/v1.0.1/plugins/deskfolk-deepseek-harness/README.md)。

## 其他改动

- **Claude Code**：接入插件现在也随安装包附带，不再需要源码。装好 Node.js 后，在 PowerShell 运行一次 `node "$env:LOCALAPPDATA\Programs\Deskfolk\resources\plugins\deskfolk-claude-code\setup.mjs"`，重新打开 Claude Code 后生效。
- **修复**：AppData 或安装目录经过 junction（例如挪到其他磁盘）时，两个接入脚本运行后没有任何效果。
- **Codex** 仍然不用设置，自动跟随。

## 下载

下载下方 **Assets** 里的 `Deskfolk-Setup-1.0.1.exe`（Windows x64）。安装前先退出正在运行的 Deskfolk，原来的设置、通知记录和桌面位置都会保留。安装包没有数字签名，可以用 `SHA256SUMS.txt` 核对。

## 已知限制

- 目前只有 Windows x64 安装包，角色只有若叶睦。
- 安装包没有数字签名。
- DeepSeek Harness 没有提供额度数据，右键木牌显示“暂不可用”。
- 在 DeepSeek Harness 中，用 `run_code` 编排的工具调用本身没有专门动作，其中实际运行的命令仍会触发敲键盘。

## English

Deskfolk v1.0.1 lets you connect DeepSeek Harness straight from the installer, without the source code. With DeepSeek Harness 0.2.1-rc.2 or newer (below 0.3.0) and Node.js 22 or newer, run `node "$env:LOCALAPPDATA\Programs\Deskfolk\resources\plugins\deskfolk-deepseek-harness\setup.mjs" --profile desktop` in PowerShell (use `web` for the browser app), then restart Harness and Deskfolk and follow "All" or "DeepSeek". She then shows when Harness is working, running commands, editing files, waiting for your answer and finishing the main session. The Claude Code plugin now ships in the installer too, and both setup scripts work from junctioned folders. Download `Deskfolk-Setup-1.0.1.exe` below; the installer is unsigned, so verify it with `SHA256SUMS.txt`.
