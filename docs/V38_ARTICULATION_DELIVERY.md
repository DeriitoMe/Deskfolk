# V38：若叶睦分层、动作衔接与桌面占用

## 已确认的交互

- 仅移除常驻省略号和底部状态说明；保留临时完成气泡和回答入口。
- 华丽形态转身停稳后展示约 2 秒，再自然回到 Q 版。
- 默认主体仍约 195 物理像素。Q 版大小保留 70%–160% 调节。
- 日常形态只有“简约若叶睦”和“高清柔光”；华丽转场稿不提供日常选择。

## 检查发现与修改

| 原因 | V38 处理 |
|---|---|
| 身体与脚在固定水平线切开，脚根和肩部缺少遮挡补画 | Krita 补画完整脚根、肩部、袖根、脸部与后发覆盖区；Aseprite 叠合原稿并拆成可动画部件 |
| 前后发分别旋转，原有水平切线会张开 | 前后发与脸共用头部坐标变换；保留前后遮挡顺序 |
| 动作直接跳姿势，或整张正侧面淡入淡出 | 记录当前姿势作为起点；对角度、位置、眼睛开合、道具出现程度连续插值 |
| 眨眼只有睁闭两种状态 | 胶囊眼睛连续缩短、停闭、张开；不同状态改变眼睛大小、视线和远近侧宽度 |
| 430×410 窗口空白参与屏幕边缘限制 | 紧凑画布、按可见主体限制移动；临时 UI 出现时才扩展空间 |
| Windows 隐形厚边框在缩放和边缘移动时改变窗口尺寸 | 关闭 thickFrame、允许程序调整紧凑尺寸，并保持原有分数坐标累计与整数原生坐标处理 |
| 设置及导入仍包含旧模型和玻璃材质 | 移除对应设置、类型和静态导入；旧文件保留在项目，构建不再包含它们 |

## 源稿与部件

根目录：`assets/characters/wakaba-mutsumi/v38-articulated/`。

- `source/seven-components.kra`：七个部件分组，分别为头、头发、身体、左手、右手、左脚、右脚。眼睛在头分组中独立，袖子与手掌也分别可编辑。
- `source/animation-depth-order.kra`：实际运行时前后遮挡顺序；前后发、袖子、手掌和眼睛分开，便于调整遮挡。
- `source/complete-parts.aseprite`：完整部件静态稿。
- `source/turn-q.kra`、`turn-grand.kra` 与相应 `*-views.aseprite`：正、背、左、右四向转场稿。侧面稿清除邻图残片，并校正发卡所在侧；Q 版正面直接复用最终批准的原稿。
- `source/*-30fps.aseprite`：8 种动作及 4 种衔接，共 12 条时间轴，1,038 帧。每条有 15 个独立绘制层，包含七个身体部件对应的前后遮挡子层，以及独立双眼、道具、问号和转场层。33/33/34 毫秒交替，平均约 30 FPS。
- `source/patches/`：Krita 栅格化的补画 SVG/PNG，保留具体遮挡补画位置。
- `GENERATION_PROMPTS.json`、`reference/`：四向参考稿生成记录。最终方向稿经 Aseprite 整理；未重绘日常模型的发型和配色。

实际使用 Krita 5.3.4 与 Aseprite 1.3.16.1 完成原生源稿导出和核验。七个部件分组用于编辑；运行时按更细的前后遮挡顺序绘制，避免头发或手掌被错误压在身后。

## 动作与状态逻辑

- 空闲沿用原有待机、小憩、浇水调度；进入浇水先约 0.38 秒回到自然姿势，再约 0.72 秒侧转、准备持壶。
- 小憩进入工作也先站稳，再分脚、轻轻用力，眼内保持向下流动的浅金色光带。
- 拖动先约 0.24 秒进入后背衣服受力姿势；头部反向倾斜、手脚不同节奏挣扎，并受拖动速度影响。释放约 0.65 秒落下恢复，返回当时真实 Codex 状态。
- `asking` 状态继续复用原有问题生命周期，问题经用户回答、代理确认接收后才结束；被拖动不会丢失等待状态。
- 普通点击护脸保留。眨眼有连续中间形态。
- 转场总长约 6.8 秒：Q 原地转身 → 白光 → 华丽形态转身 → 3.05–5.05 秒停稳展示 → 回转白光 → Q。
- 四向转场采用 2D 绘稿与连续插值合成，是二维转身动画；并非真正的三维模型。
- Codex MCP、Hook、会话隔离、问答表单及托盘右键入口沿用现有接口。没有改动插件或新增状态。

## 验证记录

机器可读结果在 `preview/`：

- `source-verification.json`：Aseprite 重新打开 12 份原生时间轴，验证帧数、15 层结构及帧时长。
- `transition-verification.json`：连续眨眼有多档实际像素面积；华丽形态在约两秒展示区间图像保持稳定，随后进入返回动作。
- `performance.json`：八种动作同屏实测约 59.7 FPS，95% 帧间隔约 16.7 毫秒。运行时允许选择 30/60 FPS；实测与硬件和前后台状态有关。
- `integration.json`：真实 Electron 主进程、preload、MCP、问答表单；覆盖状态触发、保持、拖动后恢复等待、点击后恢复工作、回答确认、会话隔离及“结束了......”气泡。
- `settings-verification.json`：两个形态、无材质选项、旧模型设置自动迁移、70%/100%/160% 主体尺寸及右边缘。
- `package-verification.json`：最终 app.asar 的文件清单、资源排除检查和 SHA-256。
- `.cache/v38-desktop-qa-125.json`、`.cache/v38-desktop-qa-packaged-150.json`：分数坐标拖动 240 次无错误、原位往返、边缘反向移动、屏幕最右侧、整数原生坐标及设置入口。125% 测试实际弹出 Windows 原生菜单并选择设置。
- 原有状态与问题单元测试 6 项通过；TypeScript 检查通过；生产构建及 NSIS 安装包生成成功。

`preview/index.html` 可离线评审浅/深/桌面背景、不同大小和播放速度，并重播动作衔接。`preview/transitions.png` 是过渡过程对比。`preview/actions-60fps.webm` 为录屏预览；文件名表示录制目标，录制时八个动画合成实测约 52 帧/秒，以 `video-metrics.json` 为准，不作为运行时帧率承诺。

## 安装包与回退

- 安装包：`release/v38/Liquid Glass Pet Setup 0.1.0.exe`。
- 可直接运行：`release/v38/win-unpacked/Liquid Glass Pet.exe`。
- 已于 2026-09-26 20:40 将本机正在运行的 V37 切换为上述 V38 可运行版；切换记录为 `preview/live-switch.json`。切换前个人大小、形态与位置设置的内容备份在 `.cache/v38-settings-snapshot`。
- 构建资源只有 Q 版独立部件/道具/四向转场稿、高清柔光及运行代码。四种移除的旧模型不进入包内，项目原文件保留。
- 完整修改前备份：`.cache/v38-rollback-20260926194443`，包括旧源码、配置、脚本和 `v37-fixed-app.asar`。旧 `release/v37` 与 V37 源稿保留。
- 回退应用可退出 V38 后启动旧 V37；回退开发代码可从上述快照恢复对应目录。新的 V38 美术写在独立目录。
- 安装器首次构建遇到系统旧缓存跨盘错误，改用项目内 `.cache/builder-tools` 后成功，没有要求删除旧项目源文件。

## 复现入口

美术：`build-v38-underpaint.mjs` → `export-v38-krita.ps1` → `build-v38-layers.lua` → `package-v38-ora.py` → `export-v38-krita.ps1 -Sources`。

动作：构建离线评审页 → `export-v38-frames.cjs` → Aseprite 组装脚本 → `verify-v38-sources.lua`。运行时动画逻辑在 `renderer/articulated-rig.ts`；实时帧与导出的源稿帧使用同一确定性采样函数。

发布：`npm run build` → `stage-v38-package.mjs` → `electron-builder --projectDir .cache/v38-package --win nsis --x64`，设置 `ELECTRON_BUILDER_CACHE` 为项目内 `.cache/builder-tools`。

`update-v38-ui.mjs`、`prepare-v38-delivery.mjs`、`prepare-v38-qa.mjs` 是此次一次性迁移记录，不作为日常构建入口。
