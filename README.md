# Mise GUI

面向 [mise](https://mise.jdx.dev/) 的桌面图形界面。用配置文件组织开发工具版本、运行项目任务，并查看实际命令及输出。

项目使用 React、TypeScript、Vite 和 Electron。当前为 **0.1.0 开发版本**，主要在 Windows 上验证，尚未提供签名安装包或自动更新。

## 功能

- 管理全局、mise 已跟踪和手动引入的配置文件；编辑 TOML 并即时校验。
- 在画布中查看工具与配置的关系，拖拽节点、缩放、改接版本及删除连接。
- 将配置端拖到右侧停用，拖回左侧恢复；保留安装文件及其他配置的请求。
- 搜索、安装、卸载工具，或连接已有的本机安装目录。
- 运行所选项目的任务，查看实时输出；收起右侧命令面板后任务继续运行。
- 查看 mise 诊断、全局设置和环境目录，支持中文／英文、深色／浅色及侧栏收起。
- 未安装 mise 时仍可查看文档和设置，并由用户主动启动官方安装流程。

## 本地开发

需要 Node.js **22.18 或更新版本**、npm，以及可下载 npm 依赖和 Electron 的网络环境。`.nvmrc` 使用 Node 22。

```sh
npm ci
npm run dev
```

开发命令同时启动 Vite 和 Electron。浏览器打开 `http://localhost:5173/` 只会使用开发模拟数据；真实工具、配置和任务操作需要 Electron 窗口。模拟代码不进入生产构建。

构建后直接运行桌面端：

```sh
npm run build
npm start
```

mise 通常通过 PATH 或常见安装目录发现。可以在启动进程的环境中设置 `MISE_BIN`，指定已有的 mise 可执行文件。应用不会自动安装 mise；安装按钮会执行官方安装流程并显示输出。

## Windows 安装包

```sh
npm run dist:win       # 构建 Windows x64 NSIS 安装包
npm run test:package   # 校验打包内容，并运行打包后桌面回归
```

安装包输出到 `release/Mise-GUI-0.1.0-win-x64-setup.exe`，可选择安装目录，默认安装到当前用户，无需另装 Node.js 或 Electron。mise 由应用单独检测，安装包不包含或自动安装 mise。卸载保留应用偏好和已有工具。

当前安装包未签名；尚未配置代码签名或自动更新。打包依赖使用锁文件固定，第三方和 Electron／Chromium 许可随包保留。详情见 [打包说明](docs/packaging.md)。

仓库使用官方 npm 源。需要代理或镜像时请使用本机 npm 配置，不要提交凭据、个人代理或私有镜像地址。

## 质量检查

```sh
npm run check          # ESLint、TypeScript、单元回归和生产构建
npm run test:desktop   # 真实 Electron；模拟缺失/损坏的 mise，不安装 mise
npm run test:graph     # 真实 Electron + 受控 IPC 画布数据，不执行真实工具命令
npm audit
```

机器已经安装 mise、网络可用时，可运行独立的真实工具回归：

```sh
npm run test:installed
```

该套件在临时配置、数据、缓存、状态和用户目录中下载 jq、改写测试配置并清理。它不安装或替换 mise，不修改用户工具、配置或环境变量。更多说明见 [已安装回归](docs/installed-mise-testing.md) 与 [未安装回归](docs/missing-mise-testing.md)。

Windows CI 运行静态检查、构建、单元测试、未安装回归和画布回归。真实下载回归需要已有 mise，因此不在默认 CI 中自动安装它。

## 项目结构

| 目录 | 职责 |
| --- | --- |
| `src/` | React 界面、画布几何、共享类型、命令预览、内置文档与翻译 |
| `electron/` | 主进程、预加载桥、IPC 校验、子进程、配置与环境目录操作 |
| `scripts/` | 单元及 Electron 回归、图标生成脚本 |
| `docs/` | 命令映射、测试说明、架构和推送准备记录 |

架构与边界见 [architecture.md](docs/architecture.md)，贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 数据与信任

工具安装和配置操作调用本机 mise。任务和已信任的配置可以执行本机命令，请只信任自己了解的项目。没有命令执行用的 Web 服务，也没有遥测或云端账户。

应用用户目录中保存语言、主题、手动引入的配置路径和停用请求；画布位置、侧栏及输出面板偏好保存在 Electron 用户配置中。停用请求记录用于恢复原来的版本写法，实际停用仍由 `mise unuse --no-prune` 修改对应配置。

环境变量写入目前仅支持 Windows。macOS／Linux 分支尚未完成完整桌面回归，不视为已验收平台。推送前准备和已知边界见 [repository-readiness.md](docs/repository-readiness.md)。

## 许可

[MIT](LICENSE)，运行时依赖声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目是独立的图形界面项目，不代表 mise 官方。
