# 未安装 mise 的桌面回归测试

执行 `npm run test:desktop`：先构建生产资源，再用 Playwright 启动真实 Electron。
不需要安装 Playwright 浏览器，也不需要安装 mise。

测试使用临时 APPDATA、XDG_CONFIG_HOME 和 Chromium 用户目录，退出时清理，
不复用用户的语言、主题或配置文件。通过 MISE_BIN 指向不存在的文件稳定重现缺失场景，
不依赖测试机器是否安装 mise。

覆盖冷启动、四个功能页、重复探测、诊断详情、离线文档、环境目录展示、设置内探测、
主题/语言、900×600 窗口、页面重载、损坏的可执行文件、8 秒探测超时、程序路径缓存刷新、
可用/缺失状态转换、环境设置读写异常和渲染进程未捕获异常。

恢复流程使用 Node 的 `--version` 作为无副作用的替身，其余查询返回空 JSON；
超时流程使用限时的 Node 子进程。环境写入异常通过测试实例的 IPC handler 注入，
不调用 setx 或修改注册表。不会执行安装命令。

截图保存在 `test-results/missing-dark.png` 和 `test-results/missing-light-small.png`。
悬浮检查保留真实命令的复制、Escape 和失焦关闭；文档入口、窗口按钮和控制台展开不弹简单提示。
目前在 Windows 上验证，其他操作系统仍需实际执行确认。
安全回归检查渲染器沙箱、Node 集成关闭、外部导航／新窗口被阻止，以及无效流式参数返回一次失败退出事件。

新增的一键安装流程使用 mise 官方安装脚本：Windows 调用 PowerShell，macOS/Linux 调用 shell。
主进程固定安装命令、限制同时只运行一次，并设置二十分钟总超时；成功后重新探测实际可执行文件。
测试在创建安装进程前拦截并替换成 Node 测试进程，确保绝不执行真实安装脚本。
覆盖下载失败与重试、实时输出、重复请求、安装退出零但仍未检测到程序、成功自动进入工具页、
启动异常、找不到安装器以及超时。检查退出事件只发送一次，且客户端不会提前移除事件监听器。
安装进度截图为 `test-results/mise-install-progress.png`。

Windows 官方安装脚本的 HTTP 请求由应用提供传输包装，版本选择、GitHub SHA256 校验、解压和安装仍使用官方逻辑。
优先使用系统 curl.exe，输出请求地址与下载进度：连接限时 15 秒，持续 30 秒低于 1 KiB/s 时退出，
每个安装包请求最多 8 分钟，元数据请求最多 60 秒；失败交由官方脚本继续尝试 GitHub 备用源。
无 curl.exe 时使用 PowerShell 原生 HTTP，并设置单次请求期限。
流式输出支持 curl 的回车进度；超时原因不会再被此前 stderr 中的进度消息遮住。

`scripts/test-installer.ts` 使用本地 HTTP 服务和真实 PowerShell/curl（不会访问安装源），覆盖 UTF-8 元数据、
重定向、进度输出、下载停滞、备用源覆盖残缺文件、HTTP 失败以及无 curl 的回退和超时。
另外使用无副作用的 Node 子进程检查回车进度实时显示、有历史 stderr 时仍报告超时且只发送一次退出事件。

环境变量页还检查：更改预览与取消不写入、应用后的就近反馈、来源标签、shims 跟随数据目录、
移除用户设置、完整路径复制、标题栏帮助、小窗口布局和读取失败重试。
这些保存测试拦截 setx/reg，在测试进程内模拟用户环境，不改实际注册表。
通过不带 force 的配置列表查询检查缓存失效；纯函数测试覆盖 XDG、macOS 缓存默认路径和实际探测路径。
截图为 `test-results/env-optimized-dark.png` 与 `test-results/env-optimized-small.png`。
