# Deskfolk

若叶睦桌面伙伴，使用实时 3D Q 版模型陪伴 Codex 编码。当前公开版本为 **0.1.0**，项目内部交付标记为 V42。

## 功能

- 透明桌面宠物、系统托盘设置、拖拽移动及位置记忆。
- Blender 衍生的实时 3D Q 版模型，独立眼睛与四肢；待机、浇水、小憩、触碰和后衣领悬吊式挣扎动作。
- 待机及单项目工作时的视线与身体跟随。
- 工作中的代码式眼部流光双眼同步，速度为此前的 1.5 倍；至少两个不同项目目录同时工作时进入全力工作状态。同目录多个聊天计为一个项目。
- 本机 Codex 结构化状态观察、工作结束与待询问气泡；询问按钮打开 Codex，问题在官方面板处理。
- 当前仅启用 Q 版；既有华丽形态资源保留为存档。

工作流光在桌面尺寸下保持可见，系统或应用的减少动画模式仍保留眼部工作指示。

## Windows 安装

从 [Releases](https://github.com/DeriitoMe/Deskfolk/releases) 下载 `Deskfolk-Setup-0.1.0.exe`，运行安装。当前 Windows 内部应用名称仍为 Liquid Glass Pet。设置通过系统托盘打开；从托盘选择退出可结束宠物和本地接收器。

## 开发与构建

需要 Windows、Node.js 20.19 或更新版本。使用锁定依赖：

```powershell
npm ci
npm run dev
```

生产构建与 Windows 安装包：

```powershell
npm run build
node scripts/stage-v42-package.mjs
npx electron-builder --projectDir .cache/v42-package --win nsis
node scripts/verify-v42-package.mjs
```

安装包输出到 `release/v42`，这些构建目录不进入版本控制。

## Codex 接入

宠物会从本机 `CODEX_HOME/sessions` 观察实际轮次事件；未设置 `CODEX_HOME` 时使用当前用户的 `.codex` 目录。可在 PowerShell 中安装配套本机插件：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-codex.ps1
```

安装后重启 Codex，在插件与 Hook 管理界面启用并信任相关入口。MCP 桥接用于阶段通知；任务是否开始或结束以实际可关联的原生记录为依据。

## 源稿与验证

- [发布前检查与回退记录](docs/V42_RELEASE_PREFLIGHT.md)
- [工作流光修补](docs/V42_WORK_GLOW_FIX.md)
- [像素图标与同步工作流光验证](docs/V42_ICON_AND_WORK_FLOW.md)
- [状态接口与边界](docs/V42_STATE_PREFLIGHT.md)
- [内存与画质测量](docs/V42_MEMORY_PREFLIGHT.md)
- [上传前隐私检查](docs/V42_PRIVACY_PREFLIGHT.md)
- [当前 Blender、Krita 与 Aseprite 源稿](assets/characters/wakaba-mutsumi/v42-motion/source)

## 隐私与限制

本地桥接仅监听回环地址，并使用随机令牌认证。通知、状态和偏好保存在本机应用数据目录；不要在通知中写入机密内容。仓库排除了本机会话、令牌、浏览器配置、构建缓存和回退副本。

目前提供 Windows 版本。若 Codex 崩溃或额度错误未产生结构化结束记录，现有日志接口无法可靠确认停止，宠物会保留最后验证的状态；没有使用固定超时猜测工作结束。
