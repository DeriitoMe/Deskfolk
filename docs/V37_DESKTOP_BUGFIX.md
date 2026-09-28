# V37 拖拽与托盘修复（2026-09-26）

## 原因

Windows 显示缩放下，PointerEvent 的屏幕坐标可能包含小数。旧版直接把移动差值加到窗口位置，再传给 Electron 的原生窗口接口，触发 `TypeError: Error processing argument at index 1, conversion failure from`。每次鼠标移动都可能再触发异常；错误对话框也会阻塞托盘交互。

已在当前依赖 Electron 37.10.3 中复现：`setPosition(100.5, 120.5)` 产生截图中的相同错误。`setIgnoreMouseEvents(false, undefined)` 没有产生该错误。

## 修复

- 向 Electron 传递窗口位置和显示器匹配矩形之前，规范为整数坐标。
- 在一次拖拽中累计逻辑位置，避免高 DPI 的原生坐标往返舍入造成慢速拖拽卡住或漂移。
- 屏幕边缘丢弃越界位移，反方向拖动立即生效；拖拽结束清除累计位置。
- 窗口位置保存改为短时防抖，退出前再保存，避免每次移动同步写文件。
- Windows 托盘明确处理右键事件，持续保留菜单对象，每次只弹出一个菜单；其他平台保留原生自动上下文菜单。
- 鼠标 IPC 仅接受主宠物窗口；跳过重复的鼠标穿透切换。

## 验证

- 125% / 150% DPI：各 240 次含小数的连续往返移动，验证真实窗口位置与原生整数参数。
- 屏幕边缘反向拖动、非法坐标过滤、最终位置保存通过。
- 实际 Electron 托盘右键处理器 → Windows 菜单窗口 → 在菜单上选择“设置” → 设置窗口打开，通过。菜单窗口通过 Windows 窗口枚举确认，菜单导航仅发送给测试进程自身窗口。
- 原有 Electron + MCP 集成测试通过，包含触碰、拖拽后恢复询问状态、回答提交与确认、多任务隔离和结束待机。
- TypeScript 检查、构建，以及 6 项状态/问答测试通过。

回归脚本：`scripts/qa-v37-desktop.cjs`、`scripts/qa-v37-native-menu.ps1`。
本机报告：`.cache/desktop-qa-125.json`、`.cache/desktop-qa-150.json`。

修复版仍使用 `release/v37/win-unpacked/Liquid Glass Pet.exe`，用户模型与偏好无需迁移。

参考：[Electron 窗口位置接口](https://www.electronjs.org/docs/latest/api/browser-window#winsetpositionx-y-animate)、[Electron 托盘接口](https://www.electronjs.org/docs/latest/api/tray#traypopupcontextmenumenu-position)。
