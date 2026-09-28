# V42 内存与渲染预检

2026-09-28，在 Windows x64、Electron 37.10.3、DPR 1.5 环境下，以相同状态序列对比优化前后运行时。

## 修改

运行时绘制双眼时，移除已由动态眼睛替换的两个原始眼球网格，并释放没有剩余场景引用的几何、材质、纹理及 ImageBitmap。保留眼睛控制器、当前动态眼睛和可编辑源稿。

两个原始眼球贴图各为 1254 × 1254。按 RGBA 四字节像素计算，移除的解码图像存储约为 11.997 MiB。场景持有的几何属性及索引数组减少 282,752 字节。

## 测量方法

- 使用实际生产构建的 main、preload 和 renderer；独立 `PET_USER_DATA` 位于 `.cache`，启用 `PET_TEST_MODE=1`。
- 测试窗口透明度为零并保持显示，使 requestAnimationFrame 正常运行。光标读取仅在测试进程内替换为固定坐标。
- 依次测量待机、单项目工作、两个不同项目全力工作、恢复单项目工作、恢复待机。每个状态先稳定 1.5 秒，再每 0.5 秒采样一次，共六次；内存表取六次采样的中位数。
- 记录 `app.getAppMetrics()` 的 Browser、GPU、Network Service、Tab，以及主进程 RSS 和 renderer 的 JS 堆。实际 FPS 取输出画布每次 `drawImage` 的时间间隔。
- 完成原生状态测量后，将同一窗口切换到评审模式，读取实际 rig 的 `frameIntervals`、`renderer.info` 和场景资源。评审数据单独保存。
- 另一独立评审进程以固定时间采样 89 张 PNG：全部九种动作、待机与工作七种视线、十六种进入或恢复过渡。对比每张 PNG 的 SHA-256。

Electron 的上述内存字段以 Kilobytes 返回；表中按 1024 换算为 MiB。主进程交叉核对：106,328 KiB 的工作集对应 Node RSS 108,879,872 字节。[Electron MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info)

工作集是各进程的当前驻留内存，求和会重复包含共享页；`privateBytes` 记录进程私有内存。这里分别列出两者，JS 堆数据保留在原始报告中。

## 实测结果

| 状态 | 私有内存前 / 后（MiB） | 私有内存变化 | 工作集前 / 后（MiB） | FPS 前 / 后 |
|---|---:|---:|---:|---:|
| 启动：模型就绪采样 | 659.68 / 649.70 | −9.98 | 833.15 / 812.66 | 尚未稳定采样 |
| 待机 | 654.21 / 643.67 | −10.54 | 835.32 / 816.68 | 54.894 / 54.895 |
| 单项目工作 | 653.46 / 639.57 | −13.89 | 836.74 / 815.24 | 54.673 / 54.674 |
| 全力工作 | 660.66 / 645.16 | −15.51 | 845.53 / 821.68 | 54.894 / 54.894 |
| 恢复单项目工作 | 661.74 / 647.50 | −14.24 | 847.76 / 824.63 | 54.894 / 54.894 |
| 恢复待机 | 666.50 / 650.13 | −16.37 | 854.03 / 829.88 | 54.898 / 54.896 |

这组运行样本中，renderer 私有内存减少 9.23–10.45 MiB，整个测试应用的进程私有内存合计减少 10.54–16.37 MiB。操作系统分配与回收会造成进程总量波动；资源清单确定移除了两个解码图像及其无用引用。

启动就绪时间本次分别为 1,808 和 1,173 毫秒。启动行是同一就绪时点的一次采样，其他行是六次采样中位数；文件、系统和驱动缓存可能影响启动耗时，因此不把这两个时间差归因于本次内存修补。

渲染上限保持 60 FPS；本次桌面实测节拍约 54.7–54.9 FPS。对应状态的前后差值最大约 0.002 FPS。预热后的 P95 间隔为 18.5–18.8 毫秒，两次测量均没有超过 50 毫秒的样本。

## 画面与资源核对

- 89 / 89 张固定时间 PNG 的全部字节一致，覆盖动作、视线和过渡。
- 场景持有的贴图从 20 张降到 18 张，RGBA 存储估计从 111.356 MiB 降到 99.359 MiB。
- GPU 统计保持 18 张纹理、117 个几何资源、7 个 shader program；待机渲染保持 27 次 draw call、235,886 个三角形。
- 动态眼睛的范围、角色比例、工作代码流光和现有动作画面保持一致。

## 复现

工具位于 `scripts/qa-v42-preflight-perf.cjs`、`scripts/qa-v42-preflight-art.cjs` 和 `scripts/qa-v42-preflight-compare.mjs`。前两个脚本使用本项目的 Electron；所有输出及测试配置写入 `.cache`。

对两个构建分别运行以下 PowerShell 命令，把 `QA_PERF_LABEL` 分别设为 `before` 和 `after`。依次执行两个 Electron 脚本，使 GPU 测量互不重叠。

```powershell
$env:ELECTRON_RUN_AS_NODE=$null
$env:QA_PERF_LABEL='after'
Start-Process -FilePath '.\node_modules\electron\dist\electron.exe' -ArgumentList @('.\scripts\qa-v42-preflight-perf.cjs') -WindowStyle Hidden -Wait
Start-Process -FilePath '.\node_modules\electron\dist\electron.exe' -ArgumentList @('.\scripts\qa-v42-preflight-art.cjs') -WindowStyle Hidden -Wait
node scripts/qa-v42-preflight-compare.mjs
```

`QA_APP_MAIN` 可以指定另一份已构建 main；`QA_REVIEW_HTML` 可以指定对应的评审 HTML。

报告为 `.cache/preflight-memory-before.json`、`.cache/preflight-memory-after.json`、`.cache/preflight-art-before.json`、`.cache/preflight-art-after.json` 和 `.cache/preflight-perf-comparison.json`。每次生成的 PNG 位于报告记载的独立输出目录。
