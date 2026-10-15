# 右键举牌与五小时额度（2026-10-14）

## 使用

右键点击小睦，双手抬起并在头发后展开木牌，显示 `5小时剩余额度: xx%`；保持片刻后木牌淡化、收起，双手落回。完整动作约 3.8 秒，相比初版 6.2 秒为 1.63 倍速。举牌期间再次右键会刷新额度；左键摸头和拖拽沿用现有操作，任务状态仍可正常恢复。

## 动作与源稿

- 使用现有实时 3D 模型；完整袖臂组作刚体变换，手掌的局部连接与模型尺度保持原样。
- 木牌独立在头发后方升起及旋转展开，保持恒定宽高，收起时淡出并下降。
- 公开显示画布固定为 1024×768，普通动作、举牌和拖拽均保持原模型像素密度和脚底锚点。WebGL 离屏分别采用 512×512、768×768 和 1024×768，在完整绘制后平移合成，避免动作切换时清空公开画布。
- 可编辑木框源稿：`assets/characters/wakaba-mutsumi/quota-board-20261014/runtime/quota-board-frame.svg`。
- 动作参数：`shared/quota-board-motion.ts`；模型动作实现：`renderer/three-rig.ts`。
- 输入与恢复：`renderer/main.ts`；预览入口：`renderer/v41-review.ts`。

## 额度依据

- 只采用明确为 300 分钟的 Codex 账户额度窗口，剩余为 `100 - usedPercent`。
- 后台从已有原生 `token_count.rate_limits` 日志更新；右键通过官方 `account/rateLimits/read` 只读刷新，进程短暂运行后退出，最长等待约 3 秒。
- 周窗口、Token 数量、其他模型桶不会替代五小时百分比。无数据显示“暂不可用”；已过真实重置时间但未取得新数据时显示“待刷新”。
- 不创建、继续或修改 Codex 任务，不读取或展示凭据原文。测试模式的 `PET_QUOTA_LOG_ONLY=1` 仅使用隔离日志，不访问真实账户。
- 实现为 `shared/quota.ts`、`electron/codex-quota.ts` 及 `electron/main.ts` / `electron/preload.ts` 的只读额度 IPC；原项目聚合与状态事件逻辑原样保留。

接口依据：[官方 App Server 的额度接口](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)。本机官方读取已实测成功；预览内数字是录制采样，运行时随真实额度更新。

## 初版验证与回退

- 额度解析、日志监测和原超级工作门控共 11 项检查通过，构建成功。
- 打包保留 30 份既有美术、字体、样式和音频资源，原模型源稿未覆盖。
- 隔离实际 Electron 交互 12 项通过，包括右键、真实格式原生日志余量、周窗口隔离、未知及过期、普通/超级工作恢复、左键打断、拖拽和托盘右键。
- 相同方法测得待机 55.21 FPS、举牌 55.00 FPS；无渲染错误。170 帧真实模型预览已检查抬举、掌缘接触木框、收回过程，未发现袖手拉伸或模型缩小。
- 本机已安装并重启，桥接健康检查通过。安装包 SHA256 为 `f0b22cae247571b45ff9e448309f70afd38e8d23327e092d2e20dce9114d082f`。
- 当前代码、资源与本机安装包回退点保存在 `.cache/quota-board-20261014/before/`。
- 源码回退恢复备份中的 `renderer/main.ts`、`renderer/three-rig.ts`、`renderer/v41-review.ts`、`electron/main.ts`、`electron/preload.ts` 和 `shared/types.ts` 后重新构建。新增的木框和额度模块可保留为素材。
- 本机安装回退使用任务目录下 `deploy-live.py --rollback` 的独立隐藏桌面启动方式，恢复上一版安装包并重启。

详细隔离运行、帧率与部署记录在 `.cache/quota-board-20261014/`。本次仅更新本机，不上传 GitHub。

初版预览输出目录：`deliverables/deskfolk-quota-board-20261014/`，提供 6.8 秒 GIF、MP4 和保持姿态截图。百分比来自已验证的真实额度采样，本机显示会继续刷新。

后续点击闪现修复与 3.8 秒动作验证见 `docs/click-display-and-board-motion-20261014.md`；其回退点为 `.cache/click-flicker-20261014/before/`。
