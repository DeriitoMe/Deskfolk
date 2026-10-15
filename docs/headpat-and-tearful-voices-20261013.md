# 摸头与委屈音效接入（2026-10-13）

## 播放规则

- 使用用户确认的单次 `clean.wav`，保留原始音色、音量和速度；试听文件中的三次重复不带入桌宠。
- 每次有效摸头播放一声短音效。快速连点时重新播放同一个音源，避免声音叠加。
- 第十次有效点按触发委屈表情时，只播放委屈音效；每次启动后从第一种开始，之后严格按第一种、第二种交替。
- 委屈反应持续期间，继续点按仍保留按压动作，但不叠加摸头声、不打断委屈声，也不改变交替顺序。
- 免打扰时静音；真实触发的委屈反应仍推进交替顺序。

## 修改文件与资源

- `renderer/touch-voice.ts`：缓存三份音源，控制播放互斥和交替顺序。
- `renderer/touch-voice.test.ts`：验证快速连点、交替、打断及免打扰行为。
- `renderer/main.ts`：将音效接入现有有效点按和第十次委屈触发路径，处理通知音效及页面退出时的清理。
- `renderer/assets/audio/mutsumi-headpat.wav`：0.18 秒。
- `renderer/assets/audio/mutsumi-tearful-first.wav`：0.50 秒。
- `renderer/assets/audio/mutsumi-tearful-second.wav`：1.19 秒。

三份资源均为 48 kHz、双声道、PCM 24 位；复制后与获准使用的单次源文件逐字节一致。原始素材保留。

## 验证结果

- `npm run build` 成功。
- `node --test renderer/touch-voice.test.ts shared/touch-response.test.ts`：8 项通过。
- 隔离 Electron 中使用真实鼠标按下和释放事件验证：23 项通过，包括四轮十次点按的第一种、第二种、第一种、第二种交替，以及委屈期间继续点按、拖拽和恢复。
- 实际音频解码时长为 0.18、0.50、1.19 秒，未出现播放错误。
- 本机安装包已更新并重启，桥接健康检查通过。
- 打包保留原有 26 份美术、样式、字体和音频资源；主进程与 preload 保持原安装版本。

验证明细保存在本机忽略目录 `.cache/touch-audio-20261013/`，包括 `assets-verification.json`、`package-verification.json`、`packaged-audio-verification.json`、`deployment-verification.json` 和 `qa-input-1791890625624/verification.json`。

## 回退

- 修改前源码：`.cache/touch-audio-20261013/before/renderer/main.ts`。
- 修改前编译产物：`.cache/touch-audio-20261013/before/compiled-renderer/`。
- 修改前本机安装包：`.cache/touch-audio-20261013/before/installed/app.asar`。
- 本机独立部署脚本 `deploy-live.py --rollback` 可停止准确匹配的 Deskfolk 安装进程、恢复旧安装包并重启；源代码回退时恢复备份的 `renderer/main.ts`，移除本次新增引用即可。

本次仅更新本机，未推送 GitHub 或替换 Release。
