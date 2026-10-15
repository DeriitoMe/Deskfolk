# Deskfolk 接手操作手册

核对日期：2026-10-15。先读上级 `AGENT_HANDOFF.md`。

## 1. 建立基线

在项目根目录检查：

```powershell
git status --short
git log -1 --oneline
git remote -v
node --version
npm --version
```

本次本机环境：Node 24.19.0、npm 11.17.0、已安装 Electron 37.10.3、electron-vite 4.0.1、Three.js 0.183.2、TypeScript 5.9.3。以 `package-lock.json` 和实际依赖为准。

发布基线是 `v1.0.0`，产品版本见 `package.json`。先保留当前工作区差异；直接 pull、reset、clean 或用旧 checkout 覆盖，可能丢失后续修改。接手资料不授权丢弃改动。

## 2. 开发与构建

已有依赖时按需要构建；新检出目录安装依赖：

```powershell
npm ci
npm run dev
```

生产构建：

```powershell
npm run build
```

该命令先构建 C# Codex 启动观察器，再执行 electron-vite。需要 Windows .NET Framework 编译器。输出为 `out/main/index.js`、`out/preload/index.cjs`、`out/renderer/`。

检查命令按本次修改范围选择；不必为小型美术调整重跑全部历史 QA：

```powershell
npx tsc --noEmit
node --test shared/activity.test.ts electron/codex-lifecycle.test.ts electron/codex-projects.test.ts electron/current-questions.test.ts electron/event-presentation.test.ts electron/renderer-events.test.ts shared/reminders.test.ts shared/project-dashboard.test.ts shared/work-bubble.test.ts
node --test shared/quota.test.ts electron/codex-quota.test.ts shared/outcome-feedback.test.ts renderer/touch-voice.test.ts
```

以上是接手后的验证入口。发布前已执行的检查以该次发布记录为准，接手后的新环境仍需按任务范围验证。Node 原生 TS 支持、旧测试夹具及环境差异需按实际报错判断；构建成功不能代替生命周期验证。

## 3. 当前 3D 评审入口

用隔离 Electron BrowserWindow 打开生产 `out/renderer/index.html?review`，等待 `window.v41Review.ready`，使用：

```javascript
const rig = window.v41Review.rig;
rig.setPaused(true);
rig.renderAt('water', 2);
const pose = rig.exportPose();
// rig.renderTransitionAt(from, to, seconds) 可查看确定时刻的衔接。
```

不要把独立 `renderer/review-entry.ts` 的 v40 页面当作最新运行模型。真实运行入口动态加载的是 `v41-review.ts`，文件名是历史名称。

固定时刻截图可验证形状、颜色和连接；点击闪现、丢事件、气泡计时、原生窗口布局必须用实际 Electron 与输入/事件路径检查。

## 4. 隔离真实 QA

测试前将 `PET_USER_DATA` 指向独立临时目录，`CODEX_HOME` 指向合成 fixture 目录，额度测试设置 `PET_QUOTA_LOG_ONLY=1`。不要复用真实用户 profile 或实际 Codex 会话作为可写夹具。

- `PET_TEST_MODE=1` 会跳过真实生命周期监视和系统启动注册等操作，适合一部分渲染/IPC 测试。
- 验证原生 observer 时需让它读取合成 JSONL；不能同时开启会禁用 observer 的模式。
- `PET_QUOTA_LOG_ONLY=1` 可阻止测试访问真实账户额度 RPC。
- 测工作状态：覆盖真实 start/complete/abort、旧 turn 终态、同项目多会话、不同项目同目录、子 agent、启动追赶。
- 测提醒：覆盖异步 accepted、部分回答、完整回答、已结束历史问题、8 秒视觉退出与真实待办分离。
- 测交互：覆盖点按/连点、右键、拖拽释放、工作期间动作恢复；观察公开 Canvas 和原生窗口尺寸变化及透明空帧。

本机曾出现工具沙箱内 Electron GPU 子进程初始化失败。先确认是否是环境问题，不应据此立即改画质、关闭抗锯齿或将产品降帧。只有在授权允许且执行范围明确时，使用对应桌面进程环境重试。

## 5. 安装、用户数据与回退

兼容路径模板：

```text
安装程序：%LOCALAPPDATA%/Programs/Liquid Glass Pet/Deskfolk.exe
运行归档：%LOCALAPPDATA%/Programs/Liquid Glass Pet/resources/app.asar
用户数据：%APPDATA%/liquid-glass-pet/
Codex 数据：CODEX_HOME 指定位置，未指定时使用主进程默认 .codex 位置
```

用户数据包含偏好、通知、活动、位置以及带随机鉴权值的 `bridge.json`。检查时不要输出鉴权原文、会话正文或个人路径。桥接是仅回环监听的本机服务；`GET /health` 用于健康检查，`POST /notify` 需要鉴权。

发布前本机 0.1.0 安装归档 SHA256（历史参考，不是 v1.0.0 下载校验值）：

```text
b89151f933cc89d2418bfa37134d470fff1906af5897222b8d739750cfca787c
```

上传发布不等于本机安装升级。先比较实际安装版本、归档哈希与目标构建清单；下载校验值以相应 Release 的校验文件为准。用户数据及脚底锚点需保留。

现有任务级 `.cache/*/deploy-live.py` 是带前/后包哈希门控的本机工具，绑定该任务归档；旧脚本不能无条件部署最新包，也不要移除哈希检查。最近工具是 `.cache/board-arm-timing-20261014/`。新改动应新建任务回退目录，再按当前基线准备包。

本机更新的一般顺序：备份源码与现安装归档 → 构建 → 验证 → 比较 main/preload/美术/声音修改范围 → 精确停止该安装的 Deskfolk → 替换已核验归档 → 真实桌面用户环境独立重启 → 核对哈希、进程与 `/health`。

工具宿主可能重定向 APPDATA。此前本机采用独立隐藏桌面助手执行安装/重启，避免启动到临时 profile。若复用该方式，检查 helper、目标路径和环境，再执行；不要把诊断夹具的 `PET_USER_DATA` 带入真实应用。

## 6. 安装包与 GitHub 发布

标准生产打包入口：

```powershell
npm run dist:win
```

历史 V42 staging 流程仍保留供维护核对：

```powershell
npm run build
node scripts/stage-v42-package.mjs
npx electron-builder --projectDir .cache/v42-package --win nsis
node scripts/verify-v42-package.mjs
```

历史 staging 脚本会从现有 `out`、图标及启动 helper 重新准备目录，并写到 `release/v42`。标准 `dist:win` 输出为 `release/`。**已有 staging、release 文件和旧 app.asar 不能代替本次构建，先重建核对再使用。** v1.0.0 的实际发布产物、源码与校验文件见对应 Release。

发布前检查源码候选清单、凭据、个人元数据、资源路径、包内容和下载校验值。公开导出以当前 `scripts/prepare-public-source.py` 和 `PUBLIC_SOURCE_MANIFEST.json` 为核对入口；新增资源后应按实际 import 和动态载入路径更新清单，不能假定历史白名单永久完整。

隐私工具会只输出位置与分类：

```powershell
python scripts/privacy-preflight.py --root <待分享目录> --output <本机报告路径>
```

模式扫描不是无敏感信息的证明。原生 Blender、Krita、Aseprite 的作者/路径/嵌入元数据需要对应应用或专用检查。`.gitignore` 也不能清除已经被跟踪的内容。

GitHub 推送、Release 替换、外部通知均需对应用户授权。2026-10-15 的任务已授权同步最新更新并创建 v1.0.0；以后仍按新任务范围判断。创建提交时沿用用户要求的 GitHub no-reply 身份，不使用机器默认个人邮箱。

## 7. 本资料包的分享边界

本资料包包含交接文档、状态与文件指纹；**不包含工作区源码副本、二进制源稿、安装包、会话或 profile**。

- 同一台机器的 Agent：让它从入口文档读取当前工作区即可。
- 另一台机器或无法访问文件的 AI：提供本资料包用于理解，再检出对应 Git 标签源码或使用经核对的公开源稿包。只有文件哈希不能还原源码；发布后产生的本机新差异仍需单独提供经检查快照。
- 不要把整个 `.cache`、用户数据、Codex 目录、语音来源素材目录或聊天附件直接打包外发。

## 8. 已有验证的适用范围

最新安装的相邻任务记录包括：固定画布点击检查、气泡定位/音量 17 项、气泡淡出 18 项、浇水补发与最后收手时机采样。它们是相应构建和环境的历史证据。

过去约 55 FPS 的同条件对照和 9 月内存报告不能证明当前所有环境指标。若任务涉及性能，重新记录场景、DPR、显示器、进程测量方式与前后结果；保持现有画质、帧率设置和动作质量。
