# Windows 打包

当前发布目标为 Windows x64，应用版本 0.1.0。安装包包含 Electron 和已编译的应用，无需目标机器预装 Node.js、npm 或 Electron；mise 独立检测，不随包安装。

## 生成与校验

使用 Node.js 22.18+ 和锁文件中的依赖：

```sh
npm ci
npm run check
npm run dist:win
npm run test:package
```

`electron-builder.json` 定义 NSIS 安装包、应用标识、图标与文件白名单。`dist:win` 先生产构建，再打包；显式禁用自动发布。首次构建需要联网获取 Electron、NSIS 及打包工具。

输出位于被 Git 忽略的 `release/`：

- `Mise-GUI-0.1.0-win-x64-setup.exe`：提供给用户的安装程序。
- `win-unpacked/`：用于本地验证的完整应用目录。
- `.blockmap` 与构建元数据：打包工具生成的辅助文件；本项目没有配置自动更新服务。

安装向导默认安装到当前用户，可选择目录，完成后由用户主动启动。卸载删除应用程序及快捷方式，保留应用偏好、mise 本身、开发工具和项目配置。

`test:package` 检查 ASAR 中的入口、预加载脚本、图标、许可和开发文件排除，然后直接启动 `win-unpacked/Mise GUI.exe` 运行 34 项桌面回归。所有测试使用临时配置和不存在的 `MISE_BIN`，不会安装 mise 或改写用户环境变量。

## 交付记录

2026-10-27 在 Windows 上生成 x64 安装包。打包内容校验和打包后 34 项桌面回归通过。实际安装／卸载测试使用临时目录及隔离应用配置，带空格的安装路径、安装登记、安装后的 34 项桌面回归和卸载清理均通过。测试后已移除临时应用、快捷方式及卸载登记，未安装 mise 或写入用户环境变量。

首个安装包大小为 121,317,174 字节；SHA-256 校验值随 `release/SHA256SUMS.txt` 提供。`npm run check` 及依赖审计通过，审计为 0 个已知漏洞。

应用及依赖的许可随 ASAR 保留，Electron 的 `LICENSE.electron.txt` 和 Chromium 的 `LICENSES.chromium.html` 保留在应用目录。

当前为未签名开发版本，没有配置代码签名证书、自动更新、macOS 或 Linux 安装包。Windows 可能显示发布者未知提示；正式对外发布前应配置发布者的签名证书。打包配置参考 [electron-builder NSIS 文档](https://www.electron.build/nsis/)。
