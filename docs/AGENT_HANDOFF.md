# Deskfolk：新 Agent 接手入口

更新日期：2026-10-15，Asia/Tokyo。本文面向维护者，随 v1.0.0 发布源码维护；历史本机验证与发布产物必须分别核对。

## 1. 先读结论

**推荐「本交接入口 + 对应版本的完整源码」，用 Git 标签确定发布基线。**

v1.0.0 将本机近期互动、声音、气泡、侧发和举牌实现纳入同一发布范围。接手时检出 `v1.0.0` 或更新的明确提交，并检查工作区差异。历史文档中的 0.1.0、本机部署 SHA256 和远程缺文件记录只说明当时状态，不能作为当前仓库结论。

| 层次 | 核对方式 |
| --- | --- |
| 产品版本 | `package.json` 的 `1.0.0` 与 `v1.0.0` 标签 |
| 源码提交 | `git rev-parse HEAD`、`git show v1.0.0 --no-patch`、`git status --short` |
| 公开发布 | GitHub `v1.0.0` Release 及其资产校验值；发布事务是否完成以远程实际结果为准 |
| 本机已安装版本 | 单独读取安装归档哈希；上传发布不会自动将本机旧安装升级到 1.0.0 |
| 发布前本机参考 | 2026-10-14 部署归档 SHA256：`b89151f933cc89d2418bfa37134d470fff1906af5897222b8d739750cfca787c`，内部版本仍为 `0.1.0` |

V41/V42/v05 是历史文件或模型命名，不能单独证明产品版本新旧。公开源稿采用检查后的可移植副本；本机原始源稿和私有回退目录独立保留。

项目：[GitHub](https://github.com/DeriitoMe/Deskfolk) · [Releases](https://github.com/DeriitoMe/Deskfolk/releases)

配套资料：

- [操作与验证](handoff/OPERATIONS.md)：构建、隔离 QA、更新本机、回退和隐私边界。
- [当前状态快照](handoff/CURRENT_STATE.json)：可机器读取的版本、安装指纹及已知限制。
- [文件指纹](handoff/FILE_INDEX.json)：交接时关键代码和运行资源的路径、大小与 SHA256。
- [可直接发给 Agent 的提示词](handoff/START_PROMPT.md)。

## 2. 项目是什么

Windows 桌面陪伴程序：透明原生窗口 + 实时 Three.js Q 版若叶睦，支持鼠标互动、Codex 工作状态展示和本机提醒。技术栈是 Electron、TypeScript、electron-vite、Three.js。

当前实际接入的角色只有若叶睦。小鲸鱼曾做形象探索，尚未成为可切换运行角色。当前只启用 Q 版，旋转变身停用；华丽形态的代码和素材作为存档保留。

品牌是 **Deskfolk**，兼容 appId、用户数据目录及部分插件名称仍保留 `liquid-glass-pet`。这些内部名称承担兼容作用，改名可能造成设置丢失或接入断开。

## 3. 代码阅读地图

```text
原生 Codex JSONL / 已确认的辅助 Hook / 本机桥接事件
  → electron/main.ts::acceptEvent
  → shared/activity.ts：按 session/turn 更新，按项目聚合
  → pet:activity（先发送） + pet:event（按规则发送）
  → electron/preload.ts::window.petBridge
  → renderer/main.ts：动作优先级、气泡、输入、状态恢复
  → renderer/three-rig.ts::MutsumiRig：真实 3D 模型与表情
```

| 模块 | 主要文件与职责 |
| --- | --- |
| 主进程与窗口 | `electron/main.ts`：桥接、设置、托盘、IPC、脚底锚点、透明窗口、光标采样 |
| 接口契约 | `shared/types.ts`，`electron/preload.ts` |
| 原生事件 | `electron/codex-lifecycle.ts`：读原生 JSONL，解析开始、终态、问题与回答 |
| 项目身份 | `electron/codex-projects.ts`：Codex sidebar 项目身份与目录映射 |
| 工作聚合 | `shared/activity.ts`：会话、turn、项目去重及乱序保护 |
| 原生待答问题 | `shared/reminders.ts`、`electron/current-questions.ts`、`electron/event-presentation.ts` |
| 启动时事件缓冲 | `electron/renderer-events.ts`：等待 rendererReady，避免漏事件 |
| 5 小时额度 | `shared/quota.ts`、`electron/codex-quota.ts` |
| 渲染调度 | `renderer/main.ts`：`syncFlatActivity`、`applyActivity`、`showEvent`、`displayBubble`、`hideBubble` |
| 运行模型 | `renderer/three-rig.ts`：`MutsumiRig`，动作插值、眼睛、材质、道具、画布 |
| 视线/拖拽/头发 | `shared/gaze.ts`、`drag-physics.ts`、`drag-motion.ts`、`hair-physics.ts` |
| 点击/委屈/绕晕 | `shared/touch-motion.ts`、`touch-response.ts`、`tearful-motion.ts`、`orbit-gesture.ts` |
| 庆祝/退出反馈 | `shared/companion-feedback.ts`、`outcome-feedback.ts` |
| 工作气泡 | `shared/work-bubble.ts`：普通/超级工作文案及跨入多项目提醒门控 |
| 音效 | `renderer/bubble-voice.ts`、`touch-voice.ts`、`renderer/assets/audio/` |
| 设置/项目面板 | `renderer/settings-view.css`、`projects-view.ts`、`projects-view.css` |
| 随 Codex 启动 | `electron/codex-startup.ts`、`scripts/CodexLauncher.cs`、`build-codex-launcher.cjs` |

`renderer/mutsumi-rig.ts`、`articulated-rig.ts` 及旧 review 文件是历史实现。当前真实入口是 `renderer/main.ts` → `three-rig.ts`。

## 4. 当前用户已经确认的表现

| 功能 | 当前约定 |
| --- | --- |
| 待机与跟随 | 眼睛、头、身体轻微跟随鼠标；普通工作时也保留跟随 |
| 待机序列 | 30 秒待机 → 15 秒小憩 → 30 秒待机 → 15 秒浇水 → 3.6 秒开心；互动会重置序列 |
| 普通工作 | `work`；双眼同步代码式流光，当前流光时间倍率 1.5 |
| 超级工作 | `power-work`；至少两个不同项目真实工作，含轻微头发摆动与气场 |
| 左键摸头 | 约 0.38 秒的快速下压/回弹，按压时 `><`，可连续点按 |
| 十次委屈 | 相邻点击不超过 3 秒累计十次，持续约 4 秒；期间不重计或延长 |
| 委屈眼 | 正面微低头，水光持续存在并移动；当前普通眼睛未增加额外点状高光 |
| 委屈声音 | 首次声音一，之后声音二、一、二严格交替；期间不叠加摸头声 |
| 触摸音量 | 摸头、委屈一、委屈二的播放音量均为 0.75，原 WAV 不变 |
| 绕晕 | 正常待机同方向三圈触发，容许小抖动，停顿 900ms 重计，冷却约 6 秒 |
| 拖拽 | 头顶为枢轴，最大约 70°，有阻尼与发尾惯性；保留放松—两次挣扎—放松循环 |
| 成功庆祝 | 每个已验证的成功项目/turn 去重排队；首次随机 A/D，此后交替；失败/暂停/额度耗尽不庆祝 |
| 右键举牌 | 交互触发 5 小时额度木牌，完整 3.8 秒；目前没有 75%/50%/25% 自动举牌提醒 |
| 举牌收手 | 约 2.727 秒开始，3.340 秒完全落回，回收约 0.613 秒；牌子约 2.832–3.285 秒淡出 |
| 气泡样式 | 白色椭圆，深绿色粗体圆润文字，无右上角关闭叉；小泡依次出现，文字最后出现 |
| 气泡定位/退出 | 相对头顶定位，大泡底端距头顶约 50 显示像素；整个气泡约 220ms 淡出 |
| 提问提醒 | 约 8 秒后退出提示表情；真实待答问题仍由原生事件决定，显示超时不等于已回答 |
| 图标/设置 | 大头像素图标；托盘提供设置与退出入口；随 Codex 启动默认开启 |

气泡主文案：`祥，工作`、`唔，出现问题了`、`可以休息了......`，超级工作独立为 `！！！！！！！！！`。涉及精确省略号数量或音频匹配时，以 `renderer/main.ts` 和 `shared/work-bubble.ts` 中的真实字符串为准；音效按精确文案映射。

动作优先级在 `syncFlatActivity()` 中：正在触摸/拖动、举牌、问题提示、退出反馈、庆祝队列、委屈、绕晕、工作/待机等相互协调。修改某条动作时必须检查退出后恢复到仍然真实存在的状态。

## 5. Codex 接入：必须按当前实现理解

### 工作与多项目

- `task_started` 才确立真实工作；成功 `task_complete`、错误完成及 `turn_aborted` 形成终态。
- `turn_context` 只补项目/目录元数据。打开浏览器、保留开发服务器、进程存在、文件 mtime 或日志安静都不能单独代表工作或完成。
- Hook 是辅助来源，无匹配原生 turn 的工作 Hook 会被过滤，不能让它单独复活任务。
- 按 `sessionId` 存储，按 `turnId` 防止旧结束事件停止新任务；历史 start、延迟 Hook 有重放保护。
- 项目优先使用 Codex 稳定项目 ID，缺失时回退规范化目录。同项目多个会话合并；不同项目 ID 即使目录相同，也可算两个项目。子 agent 与 demo 不计入真实工作项目数。
- 至少两个不同正在工作的项目触发超级工作。追赶历史记录不重复播放工作提示或庆祝。

### 提问、授权与接口限制

**当前真实提醒仅支持经过确认的原生问题。** 旧文档里的权限提醒方案不能当作当前功能。

- 原生 `request_user_input` / `request_user_input_async` 必须有可靠 session、turn、native call 身份；异步请求先看到 `accepted:true` 才提醒。
- `send_user_message_question_reply` 按 call 与题目索引匹配回答；多题全部回答后才解除该 call。
- 真实 `approval_needed/approval_resolved` 当前不驱动工作或真实提醒；枚举和 demo 保留用于兼容/预览。面板支持标记为 `native-questions-only`。
- 已结束会话的重启前历史问题不恢复为当前待办；本次实际观察到的新问题正常进入待办。
- 桌宠只提醒并打开 Codex，不收集答案。旧 `/questions` 桥接路由返回 410。
- 暂停与手动停止通常都落在 `turn_aborted`，现有事件不能可靠细分。Codex 异常退出且日志没有终态时，不能凭固定超时杜撰任务完成。
- 启动时隔离缓存的活跃状态，等待原生追赶；`RendererEventQueue` 在监听安装后交付事件，发送前再检查问题是否仍待答。

### 额度

只采纳明确 300 分钟的账户额度；后台读原生日志的 `token_count.rate_limits`，右键可用官方 `account/rateLimits/read` 只读刷新。无数据为“暂不可用”，真实重置时间已过而未更新为“待刷新”；周额度或特定模型 bucket 不能冒充 5 小时额度。该 RPC 不创建或恢复任务。

## 6. 模型资源与美术源稿

以下路径均相对 `assets/characters/wakaba-mutsumi/`：

| 用途 | 当前位置 |
| --- | --- |
| 原运行模型 | `v41-3d/runtime/mutsumi-v05.glb` |
| 基础 Blender | `v41-3d/source/Mutsumi_V41.blend`、`Mutsumi_V41_Motion.blend` |
| 动作/提领源稿 | `v42-motion/source/` 与其 `collar-lift/` |
| 当前侧发线条 | `side-hair-lines-20261012/runtime/side-hair-lines.png`；同目录 `source/*.blend` |
| 浇水左侧补发 | `water-hair-gap-20261014/runtime/hair-gap-fill-v2.glb`；同目录 `source/Mutsumi_Water_Hair_Gap_v2.blend` 和 `repair-geometry.json` |
| 泪眼底稿 | `tearful-20261009/source/tearful-eye-base.kra` 与 runtime 底图 |
| 庆祝源稿 | `celebration-20261002/portable-source/` |
| 木牌源稿 | `quota-board-20261014/runtime/quota-board-frame.svg` |

图标编辑源稿是 `assets/icons/mutsumi-icon.aseprite`。Blender/Krita/Aseprite 可用于需要的资源修改，另存源稿并保留运行前回退点。程序动作已持续演进，旧 Aseprite 时间线未必等于现运行效果。

`.gitignore` 和公开导出规则共同决定可分享范围。**本机存在、被 Git 跟踪、已上传三者不是同一件事。** 发布使用经检查的可移植源稿，并通过 `PUBLIC_SOURCE_MANIFEST.json` 核对运行依赖与源稿。以后外发原生源稿仍需检查作者、路径和嵌入元数据。

## 7. 最近修复的技术约束

- Q 版公开 Canvas 固定 **1024×768**。WebGL 离屏分别用普通 512²、举牌 768²、拖拽 1024×768，完整绘制后再合成。不能在动作切换时重置公开画布，否则会重新出现空帧、偏移或裁切。
- 保留脚底世界锚点、原模型像素密度；视线和绕圈仍按原 512 范围归一化。拖拽距离取真实 screen 坐标，避免布局变化被算成拖动。
- 气泡按头顶定位，不能重新钉在扩大后的窗口顶端。可见边界需包含气泡；屏幕边缘夹紧不依赖透明留白。
- 新气泡会取消旧淡出计时器。不能让旧计时器隐藏新提醒，重复 hide 不应延长淡出。
- 浇水补片是真实小型闭合网格，挂在原头发下，共享材质和发尾摆动；原 GLB 保留。不要把素材替回修补前的版本。

## 8. 最新证据与阅读顺序

先读本入口，再按需求阅读代码。近期专题：

1. `docs/board-arm-timing-20261014.md`：当前收手时机与本机安装指纹。
2. `docs/water-hair-and-bubble-fade-20261014.md`：补发、220ms 淡出及 18 项生命周期验证。
3. `docs/bubble-anchor-and-touch-volume-20261014.md`：气泡定位、0.75 音量及 17 项验证。
4. `docs/click-display-and-board-motion-20261014.md`：闪现根因、固定画布及帧率对照。
5. `docs/work-state-hook-confirmation-20261010.md` 与当前提醒源码：解决幽灵工作/提醒的背景。

原开发机的 `.cache/board-arm-timing-20261014/` 中，`timing-verification.json`、`package-verification.json`、`deployment-verification.json` 是发布前对应构建的本机记录；其 `before/` 是相邻回退点。这些私有回退文件不随公开源码提供。v1.0.0 发布验证应以该次发布记录和下载校验值为准；历史测试通过不等于所有环境仍通过。

旧内存报告对应旧功能集，不能作为今天的内存保证。性能优化需同场景前后实测，不降低帧率、抗锯齿、动作连续性或表情质量。

## 9. 接手时的交付要求

先提交一份理解摘要：当前基线、事件流、当前支持与未支持功能、已确认用户偏好、需要复核的风险。当前没有尚未执行的产品修改要求；不要把历史设想自动变成开发任务。

用户习惯先本机体验再决定发布；2026-10-15 已明确授权同步最新更新并发布 v1.0.0。后续发布仍需相应任务授权。涉及状态或美术变更，应给出对应真实场景验证、回退点及必要预览。
