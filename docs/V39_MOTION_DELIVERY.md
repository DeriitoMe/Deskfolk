# V39 动作与视线优化

基线：V38。日常造型、七部件母稿、Codex 接口、问答通道、拖拽与托盘入口均沿用。

## 第一阶段

- 侧身朝左时，画面右侧眼睛较大。采样尺寸：左眼约 14 × 40，右眼约 18 × 46（512 工作画布）。
- 用户通过桌宠确认节奏：正常待机 30 秒 → 小憩 18 秒 → 正常待机 30 秒 → 浇水 18 秒 → 开心收尾 3.6 秒。
- 真正 Codex 工作或询问优先打断；触碰、拖拽、手动转场暂停待机时钟，结束后续接。普通通知或重复状态不会重置动作。
- 浇水准备约 1.6 秒；小憩先回正约 0.38 秒再准备。增加 4 条细流、27 颗水滴和 5 组落点水花。
- 浇水后收壶、开心弯眼、5 朵旋转花朵与透明背景内的暖色染光，渐退回待机。
- 工作流光由单条 1.4 秒周期，改为 3 条 0.42 秒周期光带和 3 路细小亮点，始终裁切在眼睛轮廓内。
- 转场重新使用每种形态 8 张抬手姿态角度稿，每圈 96 张空间对位及遮挡处理后的绘画补间。四视图保留为参考；运行时不再交叉淡化四视图。
- 新补间属于辅助绘画关键稿和程序对位补间，**不是逐帧手绘**。初版产生重影的补间已重新处理，采用单一可见表面选择处理消失的眼睛、发夹与手部。
- 转场 9.6 秒：Q 抬手抬一脚 → 旋转白光 → 华丽形态继续转并减速 → 停住约 2 秒 → 自然回到 Q。华丽形态宽约 379，Q 宽约 361；高度分别约 739、449。默认物理显示约 165 × 321 与 157 × 195 像素。
- 临时扩大画布到 512 × 1024，脚底固定，完成后恢复 512 × 512。华丽形态依旧仅在转场出现。

### 第一阶段验证

- `preview/stage1-verification.json`：侧身透视、连续眨眼、工作流光、转场不同帧与两秒稳定展示。
- `preview/real-cadence-verification.json`：实际运行完整 99.6 秒循环，小憩与浇水均约 18 秒，间隔约 30 秒。
- `preview/turn-window-verification.json`：原生窗口扩展、固定落点及恢复。
- `preview/source-verification.json`：Aseprite 实际重新打开每份动画检查帧数、16 个绘制顺序图层、33/33/34 ms 帧时长。转场的绘画补间在 `turn` 层；日常动作的手和眼睛仍独立。
- `preview/krita-source-verification.json`：KRA 结构检查。

## 第二阶段

第一阶段 14 份动画通过原生 Aseprite 检查后开始实施。

- Electron 每 16 ms 读取全桌面鼠标坐标，只向宠物窗口发送相对坐标；位置不变时降低事件数量，隐藏宠物后停止采样。没有记录或持久化鼠标轨迹。
- 眼睛在 60 FPS 渲染循环中使用临界阻尼平滑，普通眼睛左右位移上限约 7、上下约 3.2 个工作画布像素；透视缩放约 ±4%。身体、头发与脸部不会随鼠标拉伸。
- 闭眼、护脸、开心表情及绘画转场优先保持动作；浇水、询问时保留较轻的视线变化，避免破坏侧身视线和经典眼睛。
- 实际原生窗口测试覆盖窗口外左/右/上/下坐标、快速换向和连续中间位置。九方向身体图层逐像素一致。
- 另交付 `gaze-compass.kra`（9 组分层姿态）与 `gaze-30fps.aseprite`（120 帧 / 4 秒 / 16 图层）。实时跟随不是播放固定眼神影片，而是根据当下鼠标位置计算。
- 记录：`preview/stage2-verification.json`、`gaze-paint-verification.json`、`stage2-source-verification.json`。

## 最终验证与运行

- TypeScript 检查通过；10 项状态、问答、节奏、阻尼测试通过。
- 完整周期实测：小憩约 17.995 秒，浇水约 17.999 秒；两次正常待机间隔约 30 秒。
- 第一阶段录得约 50.6 FPS（同时导出资源时），源稿均为 30 FPS；合成评审视频采样约 42 FPS，见 `video-metrics.json`。实时目标 60 FPS，实际帧率随机器负载变化。
- 原生窗口转场脚底误差约 0.24 DIP，转场前后窗口位置与尺寸恢复一致。
- Windows 150% 缩放下 240 次小数拖动、右边缘反向拖动、真实托盘右键打开一次菜单并进入设置均通过。
- 问答继续等待直到回答被接收；其他会话结束不会抹掉等待状态。已通过现有 MCP 通道回归。
- 安装包只包含两种保留形态和此次运行必需动画，不含历史四视图运行素材或其他已移除角色。可编辑美术源稿保留在项目目录，不塞进安装包。
- 新版本：`release/v39/win-unpacked/Liquid Glass Pet.exe`；安装包：`release/v39/Liquid Glass Pet Setup 0.1.0.exe`。
- 预览：`assets/characters/wakaba-mutsumi/v39-motion/preview/index.html` 支持背景/尺寸/30–60 FPS/动作切换以及鼠标视线；`actions-60fps.webm` 是录制预览，文件名表示目标帧率，实测值以上述 JSON 为准。

## 源稿与回退

- `assets/characters/wakaba-mutsumi/v39-motion/source/`：Krita 与 Aseprite 源稿。
- `seven-components.kra`、`animation-depth-order.kra`：保留 V38 已确认造型与完整遮挡补画。
- `q-spin-angles.kra`、`grand-spin-angles.kra`：八方向绘画稿；对应 `*-spin-keys.aseprite` 与 `*-spin-inbetweens-30fps.aseprite`。
- `water-layered.kra`、`water-happy-layered.kra`、`ask-layered.kra`、`work-layered.kra`：新动作分层绘画稿。
- 使用已安装 Krita 5.3.4 与 Aseprite 1.3.16.1；角度稿辅助生成采用内置 imagegen，提示词见 `GENERATION_PROMPTS.json`。
- 旧作品及 V38 安装目录保留。修改前快照：`.cache/v39-rollback-20260926211045`，包含 V38 源码与 `app.asar`。
- 安装包使用编译输出的白名单资源；旧四视图与其他历史源稿不作为运行模型载入。


### 本机切换

已于 2026-09-26 22:04（本机时间）从 V38 切换到 V39；保留 `flat-chibi`、缩放 1 和原位置，本地桥接 `/health` 正常，启动错误日志为空。设置与位置回退副本在 `.cache/v39-settings-snapshot`。完整交付索引见 `preview/delivery-verification.json`。
