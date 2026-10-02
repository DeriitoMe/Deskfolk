# Deskfolk 庆祝、触摸与提醒更新

日期：2026-10-02。应用版本仍为 0.1.0。本次为本机更新，未提交或上传 GitHub，也未替换线上 Release。

## 已实现的规则

### 成功庆祝

- A：双手举起小礼花筒，向上喷出轻量纸屑，随后放下双手。时长 2.5 秒。
- D：轻轻鼓掌两次，伴随少量金色星光，随后恢复站姿。时长 2.4 秒。
- 每次应用启动后的首次庆祝随机选择 A 或 D；之后按 A/D 严格交替。重启后重新随机。
- 每个项目的成功完成分别排队庆祝。同一次完成的 Hook、原生日志和 MCP 通知按目录、会话、轮次去重。
- 仅接受已确认的成功完成；停止、失败、额度耗尽、子代理和启动时重放的旧记录不庆祝。
- 自己仍在等待用户回答的轮次，即使收到正常结束事件，也不视为成功庆祝。其他项目完成仍可排队庆祝。
- 用户正在触摸、拖拽或查看询问提醒时，新庆祝等待。已开始的庆祝被触摸或拖拽打断时保留完成消息；被新询问打断时延后显示完成消息。
- 动作结束后恢复实际状态：仍有项目运行则回到正常或超级工作；没有运行项目则回到待机。

### 触摸

- 总时长 1.6 秒：连续抬手、双手甩两下、连续放下。
- 原有 `><` 眼睛图稿、颜色和线条保持不变。
- 额角出现一大一小两个汗滴，轻微下落并渐隐。
- 双臂通过现有肩部控制节点旋转，不再用肩部平移制造抬手，保持连接。
- 原有拖拽、挣扎、工作流光及鼠标跟随逻辑继续复用。

### 消息与询问

- 移除右上角关闭叉号。
- 完成气泡主文案为“结束了……”，不显示“这一轮结束了”标题。
- 气泡和思考圆点为纯白底；完成气泡默认宽度 250 px，主字体 20.4 px，随 DPI 适配。
- 使用本地打包的寒蝉全圆体 ChillRoundF Regular 3.200；OFL 许可证和来源记录随运行资源保存，无需安装系统字体。
- 询问气泡保留“打开 Codex”入口；问题交由原生 Codex 面板处理。
- 每个真实询问提醒展示 8 秒，随后气泡及疑惑动作退出。原生问题不会被回答、取消或清除。
- 同一工具调用的重复通知不重新开始计时；新的询问可再次提醒。
- 长问题的气泡高度会参与窗口布局，给头部和思考圆点留出空间。

## 状态衔接修改

- 原生日志将正常完成、用户中断、失败和额度耗尽分开标记。
- 修复“另一个项目仍在工作时，已完成项目的成功事件被丢弃”。
- 修复“Stop 已结束工作状态后，随后到达的正常完成事件因聚合状态没变化而被丢弃”。
- 渲染器先注册事件监听，再通过就绪握手接收启动阶段积压的通知。
- 启动阶段已被回答或替换的询问不会被重新展示。
- 旧安装版 Hook 的工具调用 ID 可从原有事件 ID 恢复，与原生日志共用询问身份。
- 工作退出依据实际事件；8 秒只控制提醒显示，没有增加工作状态固定超时。

## 可编辑源稿与运行资源

素材目录：`assets/characters/wakaba-mutsumi/celebration-20261002/`。

| 内容 | 文件 | 验证 |
| --- | --- | --- |
| 双礼花筒模型 | `source/mini-confetti-poppers.blend` | Blender 保存并重开；两只握持原点独立，GLB 为 unlit 材质 |
| 分层效果稿 | `source/celebration-effects.kra` | Krita 保存并重开；15 个绘画层、4 组 |
| 汗滴、星星、纸屑 | `source/*.aseprite` | Aseprite 分层稿保存并重开 |
| 触摸时间轴 | `source/touch-30fps.aseprite` | 48 帧，1600 ms |
| A 时间轴 | `source/celebrate-poppers-30fps.aseprite` | 75 帧，2500 ms |
| D 时间轴 | `source/celebrate-clap-30fps.aseprite` | 72 帧，2400 ms |

Aseprite 时间轴为每帧独立的完整渲染图，使用 33/33/34 ms 节奏保持平均 30 FPS 和准确总时长；道具和效果另有可编辑分层源稿。实际桌宠继续使用现有独立部件的实时 3D 模型，由运行时控制节点连续驱动，默认上限 60 FPS。原角色 GLB 的几何和绘画字节与修改前完全一致。

可重现美术工作使用 `scripts/build-celebration-poppers.py`、`build-celebration-effects.lua`、`assemble-celebration-effects-krita.py`、`export-celebration-effects-krita.py`、`assemble-celebration-timelines.lua`、`verify-celebration-art.py`。实际工具为 Blender 5.2.2 LTS、Aseprite 1.3.16.1 和已安装的 Krita。

## 验证

详细结果见 `companion-feedback-20261002-verification.json`。

- 40 项状态、队列、去重及提醒计时单元测试通过；TypeScript 和生产构建通过。
- 使用隔离的原生 Codex JSONL 样本，通过真实观察器、主进程、IPC、preload 和生产 3D 渲染器验证。
- 覆盖两个不同项目、成功交替、重复完成、停止、失败、额度耗尽、8 秒提醒、原生回答、自己的待回答轮次结束、实际点击、触摸期间完成及托盘设置。
- 帧率通过实际宠物画布绘制时间测量，工作场景取样 4 秒，约 60 FPS；详细 FPS 和 P95 帧间隔在验证记录中。
- 检查 A、D、触摸逐帧预览，礼花位于手前、双臂连接完整，汗滴和星光淡入淡出。
- 检查原生源稿重开、帧数、每帧图像、标签和精确时长。
- 打包文件逐一匹配生产输出；包含字体许可证，不将可编辑源稿加入运行包。
- 本机更新前核对 Electron 引擎文件一致，备份程序、ASAR 和启动助手；更新后核对哈希及本地桥接健康状态。

## 主要修改文件

`renderer/main.ts`、`renderer/three-rig.ts`、`renderer/style.css`、`renderer/index.html`、`renderer/v41-review.ts`、`electron/main.ts`、`electron/preload.ts`、`electron/codex-lifecycle.ts`、`electron/renderer-events.ts`、`shared/activity.ts`、`shared/types.ts`、`shared/companion-feedback.ts`、相应测试及 Hook 调用 ID 转发。

## 回退

修改前回退点保存在 `.cache/celebration-20261002/before/`：

1. `head.txt` 与 `working-tree.patch` 记录起始版本及当时已有的未提交修改。
2. `electron/`、`renderer/`、`shared/` 等副本可恢复本次修改前的代码；`.gitignore` 另有原副本。请先保留此后新增的修改再恢复，勿直接执行会丢弃工作区内容的重置。
3. `installed/` 保存原 `Deskfolk.exe`、`resources/app.asar` 和启动助手。退出桌宠后，将这三个文件恢复到原安装目录，再启动 `Deskfolk.exe`。必须将程序和 ASAR 成对恢复，以匹配打包完整性信息。
4. 新增素材可保留在素材目录。旧模型、旧图稿、变身素材和此前源稿均未删除或覆盖。

可重跑的集成检查入口：`scripts/qa-v42-companion-feedback.cjs`，通过 Electron 运行并使用隔离用户资料；可通过 `QA_APP_MAIN` 指向打包 ASAR 的主进程入口。
