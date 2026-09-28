# V42 上传前隐私检查

检查日期：2026-09-28。本次未创建远程仓库、上传、推送或发布。

## 上传边界

开发目录包含本机 Electron 测试配置和回退文件，不能直接整目录压缩上传。使用 `.cache/github-upload-source-ready` 中的公开源码快照；其文件清单为 `PUBLIC_SOURCE_MANIFEST.json`。运行时安装包仍由项目的 V42 构建流程生成。

项目当前不是 Git 仓库，因此没有可检查的提交历史或远程历史。`.gitignore` 已改为明确放行项目源码目录与根文件，默认排除陌生根目录、本机配置、构建产物、缓存和回退副本。历史绘画源稿与现场验证记录仍留在本机；公开快照包含经检查的可编辑副本。

## 发现与处理

| 内容 | 结果与处理 |
| --- | --- |
| 外部 API Key、访问令牌、密码、私钥、JWT | 公开源码候选与应用 ASAR 中未发现真实匹配项；无需依据本次结果轮换外部凭据。 |
| 本机桥接令牌 | 本机缓存／测试配置中找到 71 份含令牌的 `bridge.json`。它们是本地桥接认证数据，已被仓库候选和公开快照排除；未展示令牌。 |
| 会话与浏览器配置 | 本机目录中有 34 份活动／历史记录，另有 Cookies、Login Data、Local State。全部留在本机并排除；未读取或导出其内容。 |
| 文档与历史验证中的绝对路径、会话标识 | 公开文档使用项目相对位置；历史现场 JSON 被忽略。公开快照中的必要记录移除本机标识。 |
| 运行时 GLB／头发 PNG 的绘画来源路径 | 清理 GLB JSON 元数据及 PNG 文字元数据。GLB BIN 数据、PNG IDAT 压缩数据和解码 RGBA 均完全相同。精确旧文件已复制到本轮回退点。 |
| Blender 源稿元数据 | 原稿不变。公开副本中的图片与 PackedFile 路径改为相对位置，清理嵌入 PNG 文字元数据，图片全部保持内嵌；4 份副本经 Blender 重新打开及解压字符串复核。 |
| Krita 作者／联系方式 | 检查所有 KRA 的 `documentinfo.xml`；未发现非空身份字段。公开副本保留像素与图层数据，仅处理文字元数据。 |
| Aseprite 源稿 | 按官方格式解析图层、标签、外部文件及 User Data 元数据；未把压缩像素字节当成个人信息。未发现身份／凭据字段。 |
| 扫描误报 | 两处可公开匹配分别为矩阵乘法语法和第三方依赖的维护者联系方式；不属于用户凭据。Electron 自带路径／联系方式与原厂 Electron 二进制对照一致，未作为用户数据处理。 |
| 最终安装器 | 解出内嵌应用归档的 75 个文件，逐个 SHA-256 与已验证的 `win-unpacked` 比较，全部相同。额外检查 PE／NSIS 包装数据；一处 Token 匹配为原厂 NSIS 同样包含的 Windows 程序集标识，非本机凭据。没有运行安装器。 |

对 Aseprite 元数据的解析依据其[官方文件格式说明](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md)。

## 检查方法与证据

- `scripts/privacy-preflight.py`：只输出文件、行号、类型、数量和分类，永不输出匹配值。覆盖文本、PNG 等图片文字元数据、GLB JSON、Krita／ORA XML、Aseprite 元数据及可解压的 Blender 数据。
- `scripts/privacy-blender.py`：使用 Blender 检查并生成新的内嵌、相对路径源稿副本。
- `scripts/privacy-runtime-assets.py`：先复制精确旧资产，再处理运行时文字元数据；断言几何与像素完全相同。
- `scripts/prepare-public-source.py`：按白名单生成公开源码，保留当前静态导入所需的华丽转场存档图集及当前可编辑源稿。没有执行上传。
- `.cache/privacy-git-candidate-audit.json`：用独立临时 Git 目录模拟 `git add .` 的候选清单；项目本身未初始化仓库。候选中没有本机身份路径、会话记录或真实凭据匹配。
- `.cache/privacy-runtime-metadata.json`：运行时元数据处理的 BIN／IDAT／RGBA 一致性证据。
- `.cache/privacy-public-source-audit.json`、`.cache/privacy-blender-public.json`：公开副本检查结果。
- `.cache/preflight-final-asar-privacy.json`：最终 ASAR 的 18 个文件未发现匹配项。
- `.cache/privacy-installer-payload-verification.json`、`.cache/privacy-installer-wrapper-audit.json`：安装器内嵌文件一致性与包装数据检查。
- `.cache/public-source-build-equivalence.json`：公开源码构建出的 17 个文件与本机生产输出逐字节相同。

公开源码完整扫描仅有上述两处已核对的误报，无疑似凭据或个人路径匹配；压缩 Blender 文件均完成解压检查及原生重新打开检查。扫描工具不再把仅由字母组成的密码字面量自动视为示例。

## 重建公开快照

从项目根目录执行。要求 Python（Pillow；Blender 原始字符串解压需要 Python 3.14 的 `compression.zstd`）、Blender 和已安装的锁定 Node 依赖；可通过环境中的 Blender 命令路径运行。

```powershell
blender --background --python scripts/privacy-blender.py -- --root . --report .cache/privacy-blender-before.json --portable-dir .cache/github-upload-source-ready
python scripts/prepare-public-source.py --destination .cache/github-upload-source-ready
python scripts/privacy-preflight.py --root .cache/github-upload-source-ready --output .cache/privacy-public-source-audit.json
```

复核公开快照后再自行上传。快照不包含旧设计的全部归档源稿；这些原稿仍保存在开发目录，需要单独检查后再公开。

## 回退与限制

本轮回退点记录在 `.cache/preflight-backup-path.txt`。如要回退运行时元数据修改，将该目录 `assets/characters/wakaba-mutsumi/v41-3d/runtime/` 下的两个原文件复制回同一相对位置，并重新构建成套安装包。文档与 `.gitignore` 原文件也已备份。不要公开回退目录。

模式扫描与元数据检查不能证明不存在任何形式的隐藏敏感信息；已说明实际检查范围。本次没有检查 Codex 本机配置里的外部凭据，也没有进行外部凭据撤销或轮换。未来新增资源、日志、第三方插件或 `.env` 文件后，应重新检查实际上传清单。图像内容本身未逐张做文字识别，已有模型预览与动画验证由本轮画面复核记录覆盖。
