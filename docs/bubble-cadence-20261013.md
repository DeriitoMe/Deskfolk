# 气泡音效记录（2026-10-13）

## 当前本机状态

两句气泡音效已恢复原始素材：“祥，工作”约 0.809 秒，“唔，出现问题了”约 1.386 秒。源文件与最初提供的独立 WAV 逐字节一致，重新构建成功；本机已重启并通过健康检查。现行安装包 SHA256 为 `11a94f6b78b4ce56b28f0422082cbbe44ea9788520c47dc48060cc691260a651`。摸头和两种委屈音效仍保留。恢复结果记录于 `.cache/bubble-cadence-20261013/rollback-verification.json`。

以下保留此前编辑、验证和备份记录。

## 调整

现有生成器按整组音效分配文字。第一组带多个叠合起音，使短称呼在逗号前占用了较多声音，而“工作”只分到一个起音。本次改为按文字分别编排单个原有 voice 音节。

| 文案 | 逗号前 | 停顿 | 逗号后 | 新时长 |
|---|---:|---:|---:|---:|
| 祥，工作 | 1 声 | 200 ms | 2 声 | 0.802 秒 |
| 唔，出现问题了 | 1 声 | 200 ms | 5 声 | 1.275 秒 |

词内相邻音节间隔为 40–55 ms。沿用已经选定的小睦声音源稿和原有音高、增益、声音包络；每片边缘增加 0.75 ms 平滑并归零，避免拼接杂音。

本次修改文件为 `renderer/assets/audio/mutsumi-bubble-working.wav` 和 `renderer/assets/audio/mutsumi-bubble-question.wav`。“可以休息了......”、摸头和两种委屈音效逐字节保留。

气泡文字、显示动画、音频互斥与去重逻辑、状态事件和桌宠动作沿用当前实现。编译后的渲染器代码与原安装版本相比，仅两份音频资源地址变化。

## 验证

- 构建成功。
- 独立使用 PCM 活动包络检测音节：工作为 1＋2，问题为 1＋5。
- 两句逗号停顿均为 9600 帧、200 ms 全零静音。
- PCM24、48 kHz、单声道；无削波，音节边缘归零。单 voice 峰值约 −17.03 dBFS，保持原 voice 源的增益，不用旧叠合音效的峰值增大音量。
- 独立音频检查 15 项通过。其他四份音效的源文件与备份相同。
- 安装包保留所有原有资源及主进程、preload；渲染器逻辑只变化两份声音地址。
- 隔离实际 Electron 播放检查 8 项通过：两份新资源真实解码、播放及自然结束，重复事件不重播，回答时停音归零，单个气泡 Audio，无播放或渲染错误。
- 本机已安装并重启，桥接健康检查通过；安装包 SHA256 为 `2a822ad0fe3851212de429cd0f14049fea3d9124202e451c1b2037fa52fb0ac5`。

详细记录保存在本机忽略目录 `.cache/bubble-cadence-20261013/`：`cadence-audit.json`、`audio-verification.json`、`independent-audio-verification.json`、`package-verification.json`、隔离播放检查及部署报告。

## 源稿与回退

- 修改前音效：`.cache/bubble-cadence-20261013/before/audio/`。
- 修改前本机安装包：`.cache/bubble-cadence-20261013/before/installed/app.asar`。
- 可编辑声音源稿与原合成器：`.cache/bubble-cadence-20261013/source/`。
- 节奏生成脚本：`.cache/bubble-cadence-20261013/render-cadence.py`，其中有两句的音节顺序和停顿参数。
- 源码回退时恢复上述备份中的两份气泡 WAV 并重新构建；本机安装可使用该目录的 `deploy-live.py --rollback` 通过独立隐藏桌面进程恢复并重启。

本次只更新本机，不推送 GitHub 或更新 Release。
