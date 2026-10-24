# 看晨报动作与庆祝重设计（2026-10-21）

本轮只在隔离构建中离屏渲染预览，未更新本机安装，未接入晨报数据。

## 看晨报 `read-paper`

身体向画面左侧转约 11°，头微低，两手捏住一份展开的 Morning Brief。报纸向后仰约 30°，阅读面朝向她的脸；正交相机下的透视靠形体表达：左右两页围绕中缝折成 V 形，配合后仰，上下边在正面呈浅 V，外角轻垂，两层内页从下沿错开露出。

- 模型：`scripts/build-morning-paper.py` 在 Blender 中生成并烘焙明暗到顶点色，输出 `assets/characters/wakaba-mutsumi/newspaper-20261021/`：`runtime/morning-paper.glb`（含 `Grip.L/R` 握点）、`source/Morning_Paper.blend`、`source/paper-params.json` 与 `preview/` 四视图。
- 印刷：`renderer/newspaper-prop.ts` 在运行时绘制版面（左半头版报头、右半背页趋势图），与烘焙明暗相乘。握点中点对齐两只手套的实际中心（手掌骨骼点在腕部，手套中心偏上偏前约 0.28/0.37）。
- 眼动：`shared/reading-motion.ts` 每行四次注视、快速回扫并下移一行；三行一页，约 6.2 秒。
- 甩报纸：每页结束先收一下，再双手猛地外拉；报纸随手距横向拉宽、中缝 V 形被拉平（只让两侧边缘前移，中缝不后退），随后阻尼余震归零。
- 报纸在姿势过渡过半、浇水壶淡出后才出现，避免半透明道具互相透出。

防穿模检查：`npx electron scripts/qa-read-paper.cjs <out>`。每个采样渲染两次（正常／报纸强制置顶），只隐藏手套（允许指尖捏在纸边），袖口、脸、头发、衣服、道具出现在纸面前即失败。覆盖整页 50 Hz 共 312 帧，以及待机、工作、浇水切入各 10 帧，共 346 帧，结果为 0。

## 庆祝 A · 双手礼花（重设计）

`shared/celebrate-motion.ts`：举到胸前 → 下蹲蓄力 → 起跳（整体离地 0.2）并在最高点附近先后开火（0.68 s / 0.77 s，带后坐力）→ 落地缓冲 → 左右摇摆、交替挥礼花、头发跟随甩动 → 收势。时长仍为 2.5 s，结束时各通道回到静止。

`shared/confetti-motion.ts`：40 片纸屑沿各自筒口方向成锥形喷出，线性空气阻力使其先快后慢，再以纸片般的末速度飘落，带左右摆动和 3D 翻滚（双面绘制），出发时间、大小、颜色各不相同，结束前自然淡出。起点按开火时刻的筒口固定在场景中，不随手臂移动。峰值控制在头顶附近并留在 512 渲染范围内。

新增 `rig` 姿势通道：`jump`（整体抬升含双脚）、`swish`（头发控制器摆动）、`popL/popR`（礼花筒后坐）、`snap`、`scanX/scanY`。

## 与 Skills Morning Brief 联动（已实现）

- 时机：桌宠启动约 15 秒后，空闲（无工作、提问、庆祝、拖拽、触碰、举牌）时自动看一页；忙则每 5 秒重试，30 分钟内有效。托盘菜单「看晨报」随时触发；手动看报会暂停工作动作一页，提问、结果反馈和庆祝仍优先。
- 气泡：开始看报约 2.2 秒后弹出，至少停留 10 秒，带「看看晨报」按钮；已有其他气泡时不覆盖，勿扰模式下只看报不弹气泡。气泡单独显示一行小字（标题／来源／日期）。
- 内容：`shared/morning-brief.ts` 按优先级挑一条——三天内已宣布或进行中的 Tibo 重置（「Codex 又要重置了......」，已完成两天内）→ 七天内未讲过的 Agent 动态（「Claude Code 有新动态......」+ 标题）→ 七日星数增长前五的 Skills 轮换。讲过的 id 记在用户数据 `morning-brief.json`，下次往下讲；不推断任何重置时刻。
- 读取与入口：`electron/morning-brief.ts`。安装目录取 `DESKFOLK_MORNING_BRIEF_DIR`，否则读取 `Skills Morning Brief - Daily` 计划任务的工作目录；只读 `data/public/` 中三个快照的必要字段。「看看晨报」先读晨报用户数据目录 `reader-session.json` 的端口与实例号，`/api/instance` 身份一致才直接打开公开首页；否则在安装目录运行其启动器 `python -m morningpaper open`（`MORNINGPAPER_PYTHON` 可指定解释器）。私人启动令牌不进入任何请求或网址。
- 隔离验证：`npx electron scripts/qa-morning-brief.cjs`（`QA_APP_MAIN` 指向构建产物）。临时 profile、空 Codex 目录，拦截浏览器与启动器：自动看报约 16 s 开始、2.2 s 后出气泡、6.5 s 回到待机；托盘触发换下一条；无服务时调用启动器、服务身份一致时直接打开首页且网址不含令牌。另用含新 Tibo 消息的示例数据验证了 Tibo → 动态 → Skills 的顺序。

注意：`scripts/*` 在 `.gitignore` 中默认忽略，`build-morning-paper.py`、`qa-read-paper.cjs`、`qa-morning-brief.cjs` 需加例外才会进入仓库。

### 可行性调研记录

结论：可行，且不需要修改晨报项目。

- 数据：晨报定时任务（08:30 / 20:30，上海时间）更新安装目录下 `data/public/` 的公开 JSON：`tibo.json`（重置消息：`id`、`mechanism`、`event_status`、`reset_at`、`title`、`summary`）、`news.json`、`catalog.json`。Deskfolk 主进程可直接读取（服务未启动也可用），按修改时间判断更新并记录已播报的 `id`。安装目录可从其计划任务的工作目录发现，或在设置中指定。
- 入口：本机服务运行时打开其公开首页；端口取自用户数据目录 `reader-session.json` 的 `port` 字段，只读该字段，不读取、不传递其中的私人会话令牌。服务未运行时调用晨报自带启动器。公开接口 `/api/public/home`、`/api/public/tibo` 只接受 `127.0.0.1:端口` 的 Host，渲染进程跨域不可读，应在主进程读取。
- 边界：tibo 消息多数没有确切重置时刻，气泡只能表述"要重置了／正在补发"，不能推断时间；晨报只在电脑开机时更新。

## 验证

- `npx tsc --noEmit -p .` 通过；`node --test shared/*.test.ts electron/*.test.ts renderer/*.test.ts` 261 项通过，其中新增 `reading-motion`、`confetti-motion`、`celebrate-motion`、`morning-brief`（共享与主进程）测试。
- `scripts/privacy-blender.py` 检查 `Morning_Paper.blend`：无发现项。
