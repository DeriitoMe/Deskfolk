# Deskfolk × DeepSeek Harness

这是 Harness 的原生 Cordis 插件组合包。插件监听真实生命周期，通过带认证的本机桥接把状态交给 Deskfolk；Deskfolk 将来源识别为独立的 `DeepSeek Harness`。

需要包含 DeepSeek Harness 适配器的 Deskfolk、Node.js 22 或更高版本，以及支持外部组合包的 Harness。此实现按官方源码提交 [`687f282e8625c6b8d11ff58211a90524be2e4317`](https://github.com/deepseek-ai/deepseek-harness/tree/687f282e8625c6b8d11ff58211a90524be2e4317) 核对，源码版本为 `0.2.1-rc.2`；安装包声明兼容范围为 `>=0.2.1-rc.2 <0.3.0`。更早版本需要先升级 Harness。

## 安装到实际使用的 profile

在 Deskfolk 项目根目录执行。脚本必须明确选择已有的 profile；桌面版通常使用 `desktop`，浏览器版使用 `web`，SDK/ACP 则使用启动时选定的 profile。

Windows 安装包也会把完整插件放在 Deskfolk 安装目录的 `resources/plugins/deskfolk-deepseek-harness/`。使用安装包时，在该插件目录执行 `node setup.mjs --profile <实际使用的名称>`，或给 `setup.mjs` 指定完整路径。

先预览命令：

```powershell
node plugins/deskfolk-deepseek-harness/setup.mjs --profile web --dry-run
```

安装到浏览器版：

```powershell
node plugins/deskfolk-deepseek-harness/setup.mjs --profile web
```

先运行 `dsh --version` 确认网页版实际使用的 CLI 满足上面的兼容范围。旧版 CLI 可能允许安装插件，但安装成功不代表旧运行时兼容；`0.1.x` 需要先升级，再用所选 CLI 安装插件并启动 `dsh web`。

Harness Web 的插件运行在提供网页服务的主机上。当前桥接只使用本机回环地址，因此该主机必须与 Deskfolk 在同一台电脑；仅在另一台电脑上打开网页不会把远程服务接到本机桌宠。

安装到桌面版前，先启动 Harness Desktop 一次来初始化 profile，然后完全退出应用。在应用菜单的 **Manage dsh Command…** 中安装其随附的 `dsh` 命令，打开新终端，再执行：

```powershell
node plugins/deskfolk-deepseek-harness/setup.mjs --profile desktop
```

如果 PATH 中还有 npm 安装的 `dsh`，请显式指定桌面版自带的启动器，避免使用不同版本的 CLI：

```powershell
node plugins/deskfolk-deepseek-harness/setup.mjs --profile desktop --dsh-command "<Harness 安装目录>/resources/runtime/cli/bin/dsh.cmd"
```

重新启动所选 Harness 应用和 Deskfolk。Deskfolk 的跟随设置可选“全部”或“DeepSeek”。具体桌面版要求见[官方 Desktop 文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.md#bundled-command-runtime)。

脚本读取所选 profile 的 `package.json` 来确认目标，然后调用 Harness 官方的 `dsh plugin --profile <name> add file:<插件目录>`。由 Harness 管理依赖、写锁、兼容检查及组合包列表；用户现有的 `cordis.patch.yml` 保留。没有执行安装脚本时，项目代码不会修改任何 Harness 配置。

可通过 `--dsh-home` 指定 Harness home，通过 `--profile-dir` 直接指定已有的 `<DSH_HOME>/profiles/<name>`，或通过 `--dsh-command` 指定 `dsh` 启动器。未指定 home 时使用环境变量 `DSH_HOME`，否则使用 `~/.dsh`。例如：

```powershell
node plugins/deskfolk-deepseek-harness/setup.mjs --profile-dir "D:/HarnessHome/profiles/web" --dry-run
node plugins/deskfolk-deepseek-harness/setup.mjs --profile web --dsh-home "D:/HarnessHome" --dsh-command "D:/Harness/dsh.cmd"
```

Windows 的 `.cmd`/`.bat` 启动器支持空格、中文及常见路径符号；包含 `%`、双引号或控制字符的参数会被拒绝，以免被命令解释器展开。可换用不含这些字符的插件目录或可执行启动器。

## 桌宠表现

| Harness 原生信息 | Deskfolk 行为 |
| --- | --- |
| `turn/start`、`agent/status` | 开始或更新工作状态 |
| 主会话 `turn/end` 且 `reason.kind = completed` | 完成庆祝 |
| `approval/asked`、`approval/decided` | 权限提醒与解除 |
| `user-questions/request` 与 `userQuestions` 原生投影 | 提问提醒；已继续执行、仍可回答的问题保持待答 |
| `tools/execute` 中的命令与文件写入工具 | 敲键盘或写字；工具真正进入执行阶段后开始 |
| `turn/end` 的中止、错误或其他结束原因 | 按真实原因结束工作状态 |
| `turn/end` 错误代码 `QUOTA` / `ACCOUNT_QUOTA` | 额度耗尽反馈；`RATE_LIMIT` 作为请求失败处理 |
| `agent/disposed`、插件卸载或连接失效 | 清理工作与工具动作 |
| 每 5 秒一次的当前状态快照 | Deskfolk 重启后恢复正在工作的会话和待答提醒 |

子 Agent 使用 Harness 的 `origin: subagent` 标记，完成时不会替主会话报完成。普通 fork 的 `parentSession` 表示历史继承，不会被误判成运行中的子 Agent。多项目工作可与 Codex、Claude Code 一起聚合。

插件使用原生 `userQuestions` 投影恢复定时提问，不从工具参数中重建提问。流水线观察器把工具结果、用户回答和错误原样交还 Harness。桥接通信异步发送；Deskfolk 关闭或暂时无法连接时，不阻塞模型和工具执行。连续 20 秒未收到有效快照时，Deskfolk 清理该会话的工作和提醒；连接恢复后由新快照同步当前状态。

Harness 没有在这些事件中提供统一的订阅额度百分比或固定重置窗口，因此当前接入不显示估算额度。事件中的 token 用量也不会被当作剩余额度。

## 移除

完全退出对应 Harness 应用后执行：

```powershell
node plugins/deskfolk-deepseek-harness/setup.mjs --profile web --uninstall
```

桌面版把 `web` 换成 `desktop`。之后重新启动 Harness。脚本通过官方 `dsh plugin ... remove deskfolk-deepseek-harness` 卸载本组合包。

安装是本地 `file:` 依赖；更新或移动 Deskfolk 目录后，在实际使用的 profile 重新运行安装命令。

## 本机数据范围

- 只发送来源、进程内流标识、会话 ID、工作目录、turn 编号、顺序号、时间、状态、工具名/调用 ID、待答类型及结束/错误代码。
- 不发送提示词、模型回复、提问内容、用户答案、工具参数、工具结果或 API 凭据。
- 桥接只请求 `127.0.0.1`，使用 Deskfolk 的 `%APPDATA%/liquid-glass-pet/bridge.json` 中的临时端口和令牌；自定义 Deskfolk 数据目录时设置 `PET_USER_DATA`。
- 插件不读取 Harness 凭据，也不扫描用户的持久对话日志文件；恢复来自 Harness 提供的内存会话和原生投影。
- 权限和提问仍在 Harness 界面中处理，Deskfolk 只呈现提醒。

## 验证与上游契约

安装器验证：

```powershell
node --test plugins/deskfolk-deepseek-harness/setup.test.mjs
```

测试使用独立临时 profile，覆盖配置保留、明确选择目标、官方安装/卸载参数和 Windows 启动器参数转义，不安装到用户实际使用的 Harness。

还可使用已发布的官方运行时做独立验证。在项目根目录执行，依赖与 npm 缓存都放入 Git 忽略的 `.cache` 目录：

```powershell
npm --cache .cache/npm-harness-runtime install --prefix .cache/harness-runtime-smoke --ignore-scripts --no-audit --no-fund --package-lock=false --legacy-peer-deps @deepseek-ai/cordis@4.0.5 @deepseek-ai/dsh-session@0.2.1-rc.2 @deepseek-ai/dsh-session-projection@0.2.1-rc.2 @deepseek-ai/dsh-scope@0.2.1-rc.2
node plugins/deskfolk-deepseek-harness/runtime-smoke.mjs --runtime-dir .cache/harness-runtime-smoke
```

该验证把插件挂入真正的 Cordis、SessionStore 和 SessionProjectionRegistry，用测试 Agent 注册表和测试回答器触发生命周期、权限、提问、工具及完成事件，检查返回值和错误保持原样、私密正文未进入桥接、卸载后监听器已移除。它只创建临时本机测试接收端，结束后关闭连接与定时器并删除测试桥接文件；不启动真实 Harness 应用，不修改用户 profile，不调用模型。

上游依据：[组合包安装](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/develop/basic/publish.md)、[Agent 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/runtime-types.ts)、[会话事件](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts)、[权限事件](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/user-approval/src/types.ts)、[提问事件](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/interaction/user-questions/src/types.ts)、[工具执行管线](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/tools/src/index.ts)。
