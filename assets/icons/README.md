# Deskfolk 若叶睦图标

采用浅绿头发、金色长条眼睛与三角发卡的大头像像素图标。`mutsumi-icon.aseprite` 为五层、48×48 可编辑源稿，`icon-48.png` 为透明母图；原六层源稿保存在 `archive/mutsumi-icon-0.1.0.aseprite`。

托盘保持 16×16 DIP，提供 16、20、24、32、40、48 像素的独立 PNG 对应不同显示缩放。Windows 应用、桌面快捷方式与安装器使用 `deskfolk.ico`，包含 16、20、24、32、40、48、64、128、256 像素表示。PNG 通过 Aseprite 最近邻缩放导出，保持像素画边缘。

重新绘制大头像可使用 Aseprite 批处理运行 `scripts/prepare-head-icon.lua`，`root` 指向项目根目录。重新导出：先创建 `.cache/icon-sizes`，使用 Aseprite 批处理运行 `scripts/assemble-v42-icons.lua`，设置 `root` 为项目根目录、`output` 为该临时目录，再运行 `node scripts/export-v42-icons.cjs`。Windows 下等待 Aseprite 进程退出后再进行下一步。尺寸和校验记录见 `manifest.json`。

运行包仅包含托盘 PNG 与 ICO；可编辑源稿和绘画说明保留在仓库中。

尺寸依据：[Electron nativeImage](https://www.electronjs.org/docs/latest/api/native-image) 与 [Windows 图标设计指南](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design)。
