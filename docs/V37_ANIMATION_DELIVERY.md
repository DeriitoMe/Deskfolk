# V37：若叶睦表情、动作与 Codex 问答

## 查看成品

- [离线动作评审页](assets/characters/wakaba-mutsumi/v37-actions/preview/index.html)：双击 HTML 即可播放；提供背景、尺寸、30/60 FPS 与暂停控制。
- [动作总览视频](assets/characters/wakaba-mutsumi/v37-actions/preview/actions-60fps.webm)。
- [浅色总览](assets/characters/wakaba-mutsumi/v37-actions/preview/overview-light.png)、[深色总览](assets/characters/wakaba-mutsumi/v37-actions/preview/overview-dark.png)。
- [新版桌宠程序](<release/v37/win-unpacked/Liquid Glass Pet.exe>)。可直接运行；保留整个 win-unpacked 文件夹。旧版作品和发布目录保留。

本次以用户最终确认的 V36 Q 版为正面基准。侧身、背面关键视角由参考图生成后，在 Aseprite 中拆分、修补和组织；眼睛、问号、花盆、水壶通过 Krita 渲染，所有角色层经 Krita 导入保存原生 KRA。实际使用了 Aseprite 1.3.16.1 与 Krita 5.3.4。

## 动作与源稿

| 动作 | 行为 | Aseprite 帧数 / 时长 |
| --- | --- | --- |
| idle | 呼吸、轻微眼神、眨眼、发梢延迟 | 111 / 3.7 秒 |
| nap | 闭眼休息 | 111 / 3.7 秒 |
| water | 微侧身、并脚、双手持壶、长方体花盆与 3 根黄瓜 | 90 / 3 秒 |
| work | 分脚、双手轻轻用力、两眼向下流金 | 84 / 2.8 秒 |
| ask | 左转脸、放大经典琥珀眼、圆润问号弹出 | 60 / 2 秒 |
| touch | `><` 眼睛、短手抬向脸颊后归位 | 32 / 约 1.067 秒 |
| drag | 后背衣物受力、悬起、轻微挣扎与摆动 | 60 / 2 秒 |
| transform | 正面 → 侧面 → 背面 → 华丽正常版 → Q 版 | 78 / 2.6 秒 |

运行时通过连续时间插值在 `requestAnimationFrame` 下播放，默认目标为 60 FPS。Aseprite 使用 33、33、34 毫秒交替时长，平均 30 FPS；导出的每帧实际改变可动部件，不靠重复旧帧提高帧率标签。

角色正面与侧面各有 13 个源图层：前发、左右后发、无眼脸底、左右眼、身体、左右袖、左右手、左右腿脚。原生动画每个动作有 7 层：身体合成、左眼、右眼、道具、左手、右手、问号；手、眼始终可单独编辑。身体中更细的部件可回到 13 层角色源稿调整后重新导出。

| 可编辑文件 | 用途 |
| --- | --- |
| [front-rig.kra](assets/characters/wakaba-mutsumi/v37-actions/source/front-rig.kra) | 正面 13 层 Krita 源稿 |
| [left-rig.kra](assets/characters/wakaba-mutsumi/v37-actions/source/left-rig.kra) | 侧面 13 层 Krita 源稿 |
| [accessories.kra](assets/characters/wakaba-mutsumi/v37-actions/source/accessories.kra) | 经典眼睛、水壶、花盆、问号 |
| [front-rig.aseprite](assets/characters/wakaba-mutsumi/v37-actions/source/front-rig.aseprite) | 正面对应 Aseprite 图层 |
| [动作源稿目录](assets/characters/wakaba-mutsumi/v37-actions/source) | 八个 `*-30fps.aseprite` 文件、ORA 交换稿和配件 SVG |

华丽正常版仅在一次性转场中短暂出现，结束即恢复 Q 版；未增加其待机或工作动画。转场入口位于托盘右键菜单。询问状态优先于转场。拖动和护脸属于临时动作，结束后恢复当时真实状态。

## 大小与播放

默认主体高度按 195 个物理像素换算，设置保留 70%–160% 缩放。实际 Windows 150% 缩放环境中测得主体高度约 194.999 物理像素。浇水道具增加横向占用，人物主体保持原大小。脚底为固定落点，抓取时才提起；两个形态的透明留边分别换算。

默认待机先呼吸 14 秒，再小憩 8 秒、浇水 7 秒，循环。工作和询问会中断待机。频繁工具事件不重新启动动作时钟。减少动态效果设置提供静态关键姿势。

## 用户选择的 1A 问答链

1. Codex 调用 `pet_ask` 创建一个问题，可带选项，也可自由输入。
2. 桌宠保持询问，出现“回答问题”按钮；点击后打开可聚焦的回答窗口。
3. 用户提交后，问题保持“已提交、等待接收”；Codex 用 `pet_wait_answer` 取回这个问题 ID 的回答。
4. Codex 读到回答后调用 `pet_resolve_question(action: received)`，才退出等待。
5. Codex 正常回复结束且没有其他活跃工作或有效问题时，显示“结束了......”，回到普通待机。

问题由唯一编号关联，并支持真实 session/turn 标识校验。等待期间无关工具事件和普通 Stop 不丢失问题；中断对应任务或明确取消会结束问题。提问方需在 120 秒内继续轮询；断连、失效或重启后的旧请求不能提交，也不会视为已获同意。客户端可重复取回已经提交的回答，避免丢失。

本地桥只监听 127.0.0.1，写入与读取问题均需要本机访问令牌。回答只能通过专用回答窗口提交。窗口关闭不等于回答或取消。

已更新安装在本机的插件 Hook、技能和 MCP 文件，并保存旧文件备份。**运行新版桌宠，重启 Codex，再在新任务中使用新增工具。** 本次执行中的 Codex 工具列表不会自动刷新。

原生 Codex 提问、系统审批仍在 Codex 原界面。部分原生路径不会触发完整 Hook；桌宠不会自动读取所有对话，也不会接管原生审批。官方参考：[Hooks](https://learn.chatgpt.com/docs/hooks)、[App Server](https://learn.chatgpt.com/docs/app-server)。

## 验收记录

- TypeScript 检查与 Electron 构建通过。
- 状态和问题生命周期测试：6 项通过。
- 使用真实 Electron 主进程、preload、回答表单、MCP stdio 通道验证创建、轮询、提交、接收、取消；验证跨会话隔离、重复接收、Stop 保持问题、结束气泡、触碰恢复工作与拖动恢复询问。
- 八张动作同时播放的本机离屏采样约 60 FPS，95% 帧间隔约 16.8 毫秒。此结果对应本次机器与测试负载；不同桌面负载会改变实测值。
- 原生 KRA 已核对角色各 13 层、配件 4 层；原生 Aseprite 动画通过重新打开检查帧数、时长及独立左右手、左右眼图层。
- 详细结果：`preview/performance.json`、`integration.json`、`source-verification.json`、`video-metrics.json`。

## 后续范围

当前完成的是用户确认的模型动作与宠物问答通道。完整“AI 宠物兼编码代理”还需要独立会话启动/恢复、发送指令、流式输出、工具反馈、取消恢复等客户端模块；本次没有启动这项扩展。

## 复现入口

美术：`scripts/build-v37-layers.lua`、`build-v37-props.mjs`、`export-v37-krita.ps1`、`package-v37-ora.py`。动画：`export-v37-frames.cjs`、`assemble-v37-animations.lua`。运行时与接口：`renderer/mutsumi-rig.ts`、`shared/questions.ts`、`electron/main.ts`、`bridge/pet-mcp.mjs`。

构建：`npm run build`。独立评审页：`npx vite build --config review.vite.config.ts` 后执行 `node scripts/package-v37-review.mjs`。发布时使用 `scripts/stage-v37-package.mjs` 建立干净的打包目录，避开项目根目录中原有异常文件名，不删除旧文件。
