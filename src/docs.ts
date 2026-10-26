import type { Lang } from './i18n'

export type DocBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; lines: string[] }

export interface DocSection {
  id: string
  title: string
  blocks: DocBlock[]
}

const zh: DocSection[] = [
  {
    id: 'what',
    title: 'mise 是什么',
    blocks: [
      {
        kind: 'p',
        text: 'mise（读作 “machine” 的谐音，早期叫 rtx）是一个用 Rust 编写、由 jdx（Justin Searls）维护的命令行开发工具。它把单个静态二进制装进你的机器，一个命令就能管理多语言开发工具的版本、跑任务、设置项目环境变量。',
      },
      {
        kind: 'p',
        text: '可以把 mise 理解为“版本管理器 + 任务运行器 + 环境变量管理器”的合体，对标 asdf、direnv、Makefile、npm scripts 等工具，但更快、配置更统一，并且能读懂很多工具已有的配置文件。',
      },
      {
        kind: 'ul',
        items: [
          '用同一份 mise.toml 管理 Node、Python、Go、Rust、Java、Terraform 等各种工具版本。',
          '兼容 asdf 插件，还能直接复用 .tool-versions、package.json engines、pyproject.toml 等既有配置。',
          '单一静态二进制、无运行时依赖，启动和解析都很快。',
        ],
      },
    ],
  },
  {
    id: 'cando',
    title: '能做什么',
    blocks: [
      {
        kind: 'p',
        text: '下面四类是 mise 的核心能力，本图形工具也围绕它们分别做了对应视图。',
      },
      {
        kind: 'ul',
        items: [
          '工具管理：安装/切换/卸载某工具的具体版本，例如 node@22、python@3.12。',
          '任务运行：在 mise.toml 的 [tasks] 段或 tasks/ 目录里定义任务，用 mise run 执行，充当项目脚本入口。',
          '环境变量：用 [env] 段或 .env 文件为某个目录/项目设置环境变量，进入目录自动生效。',
          'Shell 集成：通过 mise activate 让当前终端自动加载对应版本，无需每次手动 exec。',
        ],
      },
      {
        kind: 'code',
        lines: [
          'mise use node@22        # 安装并锁定当前目录用 node 22',
          'mise install             # 安装当前配置里声明的所有工具',
          'mise run build          # 运行名为 build 的任务',
          'mise ls                 # 列出已安装的工具与版本',
        ],
      },
    ],
  },
  {
    id: 'control',
    title: '哪些方式可以控制 mise',
    blocks: [
      {
        kind: 'p',
        text: 'mise 有三层控制面，优先级从高到低大致是：命令行临时指定 > 项目配置 > 全局配置。',
      },
      {
        kind: 'ol',
        items: [
          '命令行（CLI）：一切操作的原始入口，mise use / install / run / ls / doctor / trust 等命令直接读写它管理的状态。',
          '配置文件：项目目录下的 mise.toml（或 .mise.toml）负责本项目的工具与任务；全局 ~/.config/mise/config.toml 负责默认值；还支持 .tool-versions 等传统格式。',
          '环境变量与 settings：以 MISE_ 开头的环境变量（如 MISE_DATA_DIR）和 mise settings 子命令用来调整 mise 自身的行为。',
        ],
      },
      {
        kind: 'p',
        text: '出于安全，mise 默认不会执行来源不明的项目配置，需要先 trust；本工具的“配置”视图里有对应的信任按钮。',
      },
      {
        kind: 'code',
        lines: [
          '~/.config/mise/config.toml   # 全局配置（所有项目共享）',
          './mise.toml                  # 项目配置（覆盖全局的同名项）',
          './.tool-versions             # asdf 兼容格式，mise 也能读',
        ],
      },
    ],
  },
  {
    id: 'switch',
    title: '版本是怎么切换的',
    blocks: [
      {
        kind: 'p',
        text: 'mise 用「配置指向 + 加载器」两层来实现切换。mise use node@22 只是把当前配置(项目 mise.toml 的 [tools] 段,或加 -g 写全局)里 node 的目标版本改成 22,并不会删除其它版本;之前装的 20 仍然保留,随时能切回去。',
      },
      {
        kind: 'p',
        text: '真正决定“命令行敲 node 时跑哪个版本”的,是 mise 的两种加载机制之一:',
      },
      {
        kind: 'ul',
        items: [
          'Shims(垫片):mise 在数据目录的 shims/ 下为每个工具生成一个转发脚本并放进 PATH;运行时 shim 读取当前配置,再 exec 对应版本。切换版本只是改变 shim 解析到的目标。',
          '激活(activate):在 shell 里执行 eval "$(mise activate bash)"(zsh/fish/PowerShell 同理)后,mise 会在你 cd 进目录时重读配置,把对应版本的 bin 目录排到 PATH 最前,离开时还原,不依赖 shim。',
        ],
      },
      {
        kind: 'p',
        text: '版本按配置文件生效，不同项目可以使用各自的版本。工具页支持画布操作：拖动节点标题/把手移动，空白处拖动平移，Ctrl + 滚轮缩放；“适应画布”和“整理布局”帮助找回节点，本机会记住布局。版本左侧圆点拖到配置节点可建立连接，工具底部圆点先选择版本。点选已有连线可拖动两端改接，或按 Delete 解除请求，已安装文件会保留。',
      },
      {
        kind: 'code',
        lines: [
          'mise use node@22        # 当前项目切到 22（写入 ./mise.toml）',
          'mise use -g node@20     # 全局默认切到 20',
          'mise which node         # 查看当前会命中哪个版本 / 路径',
        ],
      },
    ],
  },
  {
    id: 'env',
    title: '会不会改变环境变量',
    blocks: [
      {
        kind: 'p',
        text: '会,但通常是“局部、随目录生效”,而不是永久改写系统环境变量。',
      },
      {
        kind: 'ul',
        items: [
          '切换版本本身是通过调整 PATH(激活模式)或走 shim 实现的,只影响当前已激活的那个 shell,不会写进系统级永久环境变量。',
          'mise 还能主动帮你设变量:在 mise.toml 的 [env] 段声明,或用顶层 env_file 指向 .env;激活后进入该目录自动导出,离开可还原。',
          '全局默认变量可写在 ~/.config/mise/config.toml 的 [env]。',
          '部分工具自带 export(例如设置某个库路径),mise 加载该工具时会一并应用。',
        ],
      },
      {
        kind: 'p',
        text: '一句话:PATH 的改动是作用域内的;[env] 是你显式要求才设的。关掉终端或取消激活即恢复,不会残留污染系统环境。',
      },
      {
        kind: 'p',
        text: '另一类变量是例外：MISE_DATA_DIR 那五个目录变量一旦写入系统就是永久的，不属于上面这种“随目录生效”。怎么查看和核对它们，见下一节「mise 的目录变量怎么查看」。',
      },
      {
        kind: 'code',
        lines: [
          '# 在 mise.toml 中：',
          '[env]',
          'DATABASE_URL = "postgres://…"   # 进入该目录自动导出',
          'env_file = ".env"               # 顶层键：额外加载 .env 文件',
        ],
      },
    ],
  },
  {
    id: 'wheredirs',
    title: 'mise 的目录变量怎么查看',
    blocks: [
      {
        kind: 'p',
        text: '这里说的是决定 mise 把自己那些文件夹放哪儿的五个变量：MISE_DATA_DIR（工具安装目录）、MISE_CONFIG_DIR（配置目录）、MISE_CACHE_DIR（缓存目录）、MISE_SHIMS_DIR（shims 目录）、MISE_STATE_DIR（状态目录，放已信任配置清单和版本历史）。mise 另有更细的几个（MISE_INSTALLS_DIR、MISE_DOWNLOADS_DIR、MISE_TMP_DIR），本工具不管它们。这五个都不在 mise.toml 里，也不是 mise settings 的键，只能从环境变量读到，所以查看要分两个层面：mise 最终用了哪个目录，以及这个目录有没有被真正写进系统。',
      },
      {
        kind: 'p',
        text: '方式一：在本图形工具里看（最直观）。设置 → 环境变量，每个目录一张卡：',
      },
      {
        kind: 'ul',
        items: [
          '「当前生效」= 这个进程此刻真正在用的路径；没有设置过变量时，它显示的是 mise 的默认回退位置。',
          '「已写入系统」= HKCU\\Environment 里的持久值，右边的「自定义 / 使用默认」徽章说的就是它存不存在。',
          '右下角的圆形按钮会弹出速查表，列出五个变量各自的作用和本机默认位置。',
        ],
      },
      {
        kind: 'p',
        text: '方式二：问 mise 本人（推荐用来核对结果）。重开一个终端后运行 mise doctor，输出里的 dirs: 段就是 mise 算出来的最终路径（system_shims 是固定路径，没有对应的环境变量）：',
      },
      {
        kind: 'code',
        lines: [
          'mise doctor',
          '',
          'dirs:',
          '  cache: ~\\AppData\\Local\\Temp\\mise',
          '  config: ~\\.config\\mise',
          '  data: ~\\AppData\\Local\\mise',
          '  shims: ~\\AppData\\Local\\mise\\shims',
          '  system_shims: \\usr\\local\\share\\mise\\shims',
          '  state: ~\\.local\\state\\mise',
        ],
      },
      {
        kind: 'p',
        text: '方式三：直接读注册表里的持久值。',
      },
      {
        kind: 'code',
        lines: [
          'reg query HKCU\\Environment                   # 看用户级全部变量',
          'reg query HKCU\\Environment /v MISE_DATA_DIR   # 只看某一项',
          '',
          '# 没设置过时第二条会报错，报错文案跟随系统语言；本机（中文系统）打印：',
          '# 错误: 系统找不到指定的注册表项或值。',
          '# 这就代表未设置、mise 正在用默认目录，属于正常状态。',
        ],
      },
      {
        kind: 'p',
        text: '方式四：用 PowerShell 分作用域看，三份值含义不同，最容易看清差别。开一个 PowerShell 窗口执行：',
      },
      {
        kind: 'code',
        lines: [
          "'Process','User','Machine' | ForEach-Object {",
          "  $v = [Environment]::GetEnvironmentVariable('MISE_DATA_DIR', $_)",
          '  if ($null -eq $v) { "$_ = <未设置>" } else { "$_ = $v" }',
          '}',
          '',
          '# 实测输出（本机还没设置过）：',
          '# Process = <未设置>',
          '# User = <未设置>',
          '# Machine = <未设置>',
          '',
          '# Process = 当前窗口正在用的值（为空则 mise 回退到默认目录）',
          '# User    = setx 写进去的那一份，对应界面里的「已写入系统」',
          '# Machine = 系统级，需要管理员权限，本工具不会写它',
        ],
      },
      {
        kind: 'p',
        text: '方式五：图形界面。按 Win + R 输入 sysdm.cpl，进「高级」→「环境变量」，上半区「用户变量」就是 HKCU\\Environment。',
      },
      {
        kind: 'p',
        text: '两个容易踩的点：',
      },
      {
        kind: 'ol',
        items: [
          '改完变量必须重开终端再看。已经在跑的 shell 还带着旧的环境块，mise doctor 会照旧输出老目录；本图形工具是即时采用新值的，因为它在主进程里直接更新了环境。',
          '别去 mise.toml 或 mise settings 里找这些键。mise settings get data_directory 会直接报错，目录只能由这些环境变量决定。',
        ],
      },
    ],
  },
  {
    id: 'installed',
    title: '已安装的版本会怎样',
    blocks: [
      {
        kind: 'p',
        text: '要分两种情况:“mise 自己装的”和“你在 mise 之外装的”。',
      },
      {
        kind: 'ul',
        items: [
          'mise 安装过的版本(在 mise 数据目录里)不会被舍弃:切换版本、或安装别的版本时它们都保留,mise ls 会自动列出并纳入管理,随时可切回;mise install 会按配置补齐缺失的版本。',
          '你在系统里/别处已经装好的工具(例如用安装包装的 Node),mise 默认不会自动“认领”。要么让 mise 自己装一份,要么用 mise link 手动把已有安装注册进 mise 管理(建一个软链)。',
        ],
      },
      {
        kind: 'p',
        text: '清理是显式的,不会自动删除:',
      },
      {
        kind: 'ul',
        items: [
          'mise uninstall node@20:删除某个由 mise 管理的版本。',
          'mise prune:清理配置里已不再引用的旧版本。',
          'mise implode:移除 mise 管理的全部工具(危险操作,会清空)。',
        ],
      },
      {
        kind: 'code',
        lines: [
          'mise link node@20 <path>   # 把外部已装版本纳入 mise 管理',
          'mise ls                    # 查看 mise 管理的所有版本',
          'mise prune                 # 清理不再使用的版本',
        ],
      },
    ],
  },
  {
    id: 'gui',
    title: '这个图形工具如何配合 mise',
    blocks: [
      {
        kind: 'p',
        text: 'Mise GUI 本身不重新实现任何逻辑，它只是本机 mise 命令行的一个图形前端：所有动作都在后台调用你已安装的真实 mise 二进制，把它的输出原样呈现出来，因此你永远看到的、操作的都是本机 mise 的实际状态。',
      },
      {
        kind: 'ul',
        items: [
          '工具管理：读取 mise ls / registry，安装与切换通过 mise use、mise install、mise uninstall 完成，真实输出流式显示在右侧「命令输出」面板。面板可以独立收起，命令会继续运行，展开后仍可查看输出。',
          '任务：列出 mise tasks ls 发现的任务，点击运行即执行 mise run。',
          '配置：读取并编辑 mise.toml（保存前做 TOML 校验），并提供 mise trust 按钮。',
          '诊断：展示 mise doctor 的结果，帮你确认 shell 是否激活、shims 是否在 PATH 上等。',
        ],
      },
      {
        kind: 'p',
        text: '几点重要说明：',
      },
      {
        kind: 'ul',
        items: [
          '需要先在本机安装好 mise，本工具才能工作；它不会替你安装 mise 本体。',
          '所有操作都针对当前“工作目录”（顶部可切换），因为项目配置和任务都来自那个目录。',
          '它不替代命令行，熟练用户仍可直接用终端；GUI 适合浏览、发现和做少量点击式操作。',
          '工具与版本名称、以及「命令输出」面板里的命令都是 mise 的真实输出，不做翻译。',
        ],
      },
      {
        kind: 'p',
        text: '想看更完整的用法，请参考 mise 官方文档 mise.jdx.dev。',
      },
    ],
  },
]

const en: DocSection[] = [
  {
    id: 'what',
    title: 'What is mise',
    blocks: [
      {
        kind: 'p',
        text: 'mise (pronounced like the word “machine”, formerly called rtx) is a command-line dev tool written in Rust and maintained by jdx (Justin Searls). You install a single static binary, and one tool lets you manage dev-tool versions across languages, run tasks, and set per-project environment variables.',
      },
      {
        kind: 'p',
        text: 'Think of mise as a “version manager + task runner + env manager” combined — comparable to asdf, direnv, Makefile and npm scripts, but faster, with more unified configuration, and able to read many tools’ existing config files.',
      },
      {
        kind: 'ul',
        items: [
          'Manage Node, Python, Go, Rust, Java, Terraform and more versions from one mise.toml.',
          'Compatible with asdf plugins, and can reuse existing .tool-versions, package.json engines, pyproject.toml, etc.',
          'A single static binary with no runtime dependencies — startup and parsing are fast.',
        ],
      },
    ],
  },
  {
    id: 'cando',
    title: 'What it can do',
    blocks: [
      {
        kind: 'p',
        text: 'These four areas are mise’s core capabilities, and this GUI builds a view around each of them.',
      },
      {
        kind: 'ul',
        items: [
          'Tool management: install / switch / uninstall a specific version of a tool, e.g. node@22, python@3.12.',
          'Tasks: define tasks in the [tasks] section of mise.toml or under a tasks/ directory, then run them with mise run as your project’s script entry point.',
          'Environment variables: set env vars per directory/project via the [env] section or .env files, applied automatically when you enter the directory.',
          'Shell integration: mise activate lets your current terminal load the right versions automatically, without exec-ing each time.',
        ],
      },
      {
        kind: 'code',
        lines: [
          'mise use node@22        # install and pin node 22 for the current dir',
          'mise install             # install every tool declared in the config',
          'mise run build          # run a task named build',
          'mise ls                 # list installed tools and versions',
        ],
      },
    ],
  },
  {
    id: 'control',
    title: 'Ways to control mise',
    blocks: [
      {
        kind: 'p',
        text: 'mise has three control surfaces, with rough precedence from highest to lowest: an ad-hoc CLI argument > project config > global config.',
      },
      {
        kind: 'ol',
        items: [
          'Command line (CLI): the raw entry point for everything — mise use / install / run / ls / doctor / trust directly read and write the state mise manages.',
          'Config files: mise.toml (or .mise.toml) in a project directory defines that project’s tools and tasks; the global ~/.config/mise/config.toml provides defaults; legacy formats like .tool-versions are also read.',
          'Env vars & settings: environment variables prefixed with MISE_ (e.g. MISE_DATA_DIR) and the mise settings subcommand tune mise’s own behavior.',
        ],
      },
      {
        kind: 'p',
        text: 'For safety, mise refuses to execute untrusted project configs by default; you must trust them first. The Config view in this tool has a matching trust button.',
      },
      {
        kind: 'code',
        lines: [
          '~/.config/mise/config.toml   # global config (shared by all projects)',
          './mise.toml                  # project config (overrides the same keys in global)',
          './.tool-versions             # asdf-compatible format that mise also reads',
        ],
      },
    ],
  },
  {
    id: 'switch',
    title: 'How version switching works',
    blocks: [
      {
        kind: 'p',
        text: 'mise switches via two layers: a config pointer plus a loader. mise use node@22 only changes node’s target version to 22 in the current config (the [tools] section of the project mise.toml, or the global config with -g); it does not delete other versions — the previously installed 20 stays put and you can switch back anytime.',
      },
      {
        kind: 'p',
        text: 'What actually decides “which version runs when you type node” is one of mise’s two loading mechanisms:',
      },
      {
        kind: 'ul',
        items: [
          'Shims: mise generates a small forwarding script per tool into the shims/ directory in its data dir and puts that on PATH; at run time the shim reads the current config and execs the matching version. Switching just changes what the shim resolves to.',
          'Activation: after eval "$(mise activate bash)" (also zsh/fish/PowerShell), mise re-reads the config whenever you cd into a directory and moves that version’s bin directory to the front of PATH, restoring it on exit — no shims needed.',
        ],
      },
      {
        kind: 'p',
        text: 'Versions are scoped by config file. Drag node headers/handles to move, empty space to pan, and Ctrl + wheel to zoom. Fit view and Arrange nodes recover the overview; the layout is remembered locally. Drag a version port onto a config to connect, or the bottom tool port to choose a version first. Select existing cables to reconnect either endpoint or press Delete to remove the request while keeping installed files.',
      },
      {
        kind: 'code',
        lines: [
          'mise use node@22        # switch this project to 22 (writes ./mise.toml)',
          'mise use -g node@20     # switch the global default to 20',
          'mise which node         # show which version / path is hit right now',
        ],
      },
    ],
  },
  {
    id: 'env',
    title: 'Does it change environment variables',
    blocks: [
      {
        kind: 'p',
        text: 'Yes, but usually in a “local, per-directory” way rather than permanently rewriting your system environment.',
      },
      {
        kind: 'ul',
        items: [
          'Version switching itself works by adjusting PATH (activation) or going through shims; it only affects the currently activated shell and never writes permanent system-level env vars.',
          'mise can also set variables for you: declare them in the [env] section of mise.toml, or point the top-level env_file at a .env; once activated, entering the directory exports them and leaving restores them.',
          'Global defaults can go in the [env] section of ~/.config/mise/config.toml.',
          'Some tools ship their own exports (e.g. a library path); mise applies them when loading that tool.',
        ],
      },
      {
        kind: 'p',
        text: 'In short: PATH changes are scoped; [env] only sets what you explicitly ask for. Closing the terminal or deactivating restores everything, leaving no pollution in your system environment.',
      },
      {
        kind: 'p',
        text: 'One kind of variable is the exception: the five directory variables such as MISE_DATA_DIR become permanent once written to the system, unlike the per-directory behaviour above. See the next section, “How to check the mise directory variables”, for how to look at them.',
      },
      {
        kind: 'code',
        lines: [
          '# in mise.toml:',
          '[env]',
          'DATABASE_URL = "postgres://…"   # auto-exported when you enter the dir',
          'env_file = ".env"               # top-level key: also load a .env file',
        ],
      },
    ],
  },
  {
    id: 'wheredirs',
    title: 'How to check the mise directory variables',
    blocks: [
      {
        kind: 'p',
        text: 'This is about the five variables that decide where mise keeps its own folders: MISE_DATA_DIR (tool install directory), MISE_CONFIG_DIR (config directory), MISE_CACHE_DIR (cache directory), MISE_SHIMS_DIR (shims directory) and MISE_STATE_DIR (state directory, holding the trusted-config list and the version history). mise has finer switches too (MISE_INSTALLS_DIR, MISE_DOWNLOADS_DIR, MISE_TMP_DIR) that this app leaves alone. None of the five appear in mise.toml and none are mise settings keys — only the environment can set them, so checking has two sides: which directory mise ends up using, and whether that directory was actually written into the system.',
      },
      {
        kind: 'p',
        text: 'Method 1: inside this app (the clearest). Settings → Environment variables, one card per directory:',
      },
      {
        kind: 'ul',
        items: [
          '“In use now” = the path this process is really using; when nothing was ever set it shows mise’s default fallback location.',
          '“Saved in the system” = the durable value in HKCU\\Environment, and the Custom / Using default badge next to it says whether that value exists at all.',
          'The round button in the bottom-right corner opens a table listing what each variable controls and its default location on this machine.',
        ],
      },
      {
        kind: 'p',
        text: 'Method 2: ask mise itself (best for verifying a change). Open a fresh terminal and run mise doctor; the dirs: block is the final path mise computed (system_shims is a fixed path with no variable of its own):',
      },
      {
        kind: 'code',
        lines: [
          'mise doctor',
          '',
          'dirs:',
          '  cache: ~\\AppData\\Local\\Temp\\mise',
          '  config: ~\\.config\\mise',
          '  data: ~\\AppData\\Local\\mise',
          '  shims: ~\\AppData\\Local\\mise\\shims',
          '  system_shims: \\usr\\local\\share\\mise\\shims',
          '  state: ~\\.local\\state\\mise',
        ],
      },
      {
        kind: 'p',
        text: 'Method 3: read the durable value straight from the registry.',
      },
      {
        kind: 'code',
        lines: [
          'reg query HKCU\\Environment                   # every user-level variable',
          'reg query HKCU\\Environment /v MISE_DATA_DIR   # just one of them',
          '',
          '# When nothing was set, the second command fails. The wording follows your',
          '# Windows language; on this Chinese system it prints',
          '# 错误: 系统找不到指定的注册表项或值。',
          '# (“the system cannot find the specified registry key or value”) — that just',
          '# means “not set”, so mise is using its default directory. A normal state.',
        ],
      },
      {
        kind: 'p',
        text: 'Method 4: ask PowerShell scope by scope. The three values mean different things, which makes the difference obvious. Run this in a PowerShell window:',
      },
      {
        kind: 'code',
        lines: [
          "'Process','User','Machine' | ForEach-Object {",
          "  $v = [Environment]::GetEnvironmentVariable('MISE_DATA_DIR', $_)",
          '  if ($null -eq $v) { "$_ = <not set>" } else { "$_ = $v" }',
          '}',
          '',
          '# Measured output (nothing set on this machine yet):',
          '# Process = <not set>',
          '# User = <not set>',
          '# Machine = <not set>',
          '',
          '# Process = the value this window uses (empty means mise falls back to the default)',
          '# User    = the copy setx wrote — this is “Saved in the system” in the interface',
          '# Machine = the system-wide value, needs admin rights; this app never writes it',
        ],
      },
      {
        kind: 'p',
        text: 'Method 5: the graphical route. Press Win + R, type sysdm.cpl, go to Advanced → Environment Variables; the upper “User variables” list is HKCU\\Environment.',
      },
      {
        kind: 'p',
        text: 'Two things that catch people out:',
      },
      {
        kind: 'ol',
        items: [
          'After changing a variable you must open a new terminal before looking again. A shell that is already running carries the old environment block, so mise doctor keeps printing the old directory. This app picks up the new value immediately because its main process updates the environment directly.',
          'Do not go hunting for these keys in mise.toml or mise settings. mise settings get data_directory errors out — the directories can only be moved by those environment variables.',
        ],
      },
    ],
  },
  {
    id: 'installed',
    title: 'What happens to installed versions',
    blocks: [
      {
        kind: 'p',
        text: 'Two cases to separate: “installed by mise” vs “installed outside mise”.',
      },
      {
        kind: 'ul',
        items: [
          'Versions mise installed (inside its data dir) are never discarded: switching versions or installing others keeps them all; mise ls lists and manages them, and you can switch back anytime. mise install fetches any versions the config requires but that are missing.',
          'Tools you already installed elsewhere (e.g. a Node from an installer) are not adopted by mise automatically. Either let mise install its own copy, or use mise link to register the existing install under mise’s management (it creates a symlink).',
        ],
      },
      {
        kind: 'p',
        text: 'Cleanup is explicit and never automatic:',
      },
      {
        kind: 'ul',
        items: [
          'mise uninstall node@20: remove a specific mise-managed version.',
          'mise prune: remove old versions no longer referenced by any config.',
          'mise implode: remove every tool mise manages (a destructive, wipe-everything action).',
        ],
      },
      {
        kind: 'code',
        lines: [
          'mise link node@20 <path>   # bring an external install under mise management',
          'mise ls                    # list every version mise manages',
          'mise prune                 # clean up unused versions',
        ],
      },
    ],
  },
  {
    id: 'gui',
    title: 'How this GUI works with mise',
    blocks: [
      {
        kind: 'p',
        text: 'Mise GUI re-implements no logic itself — it is just a graphical front-end for the mise CLI on your machine. Every action shells out to the real mise binary you installed and shows its output verbatim, so what you see and operate is always your machine’s actual mise state.',
      },
      {
        kind: 'ul',
        items: [
          'Tools: reads mise ls / registry; install & switch go through mise use, mise install, mise uninstall, with output streamed to the right-hand Command output panel. Collapse it independently; commands keep running and output remains available when reopened.',
          'Tasks: lists tasks discovered by mise tasks ls; clicking run executes mise run.',
          'Config: reads and edits mise.toml (TOML-validated before saving) and provides a mise trust button.',
          'Doctor: shows the result of mise doctor, helping you confirm whether the shell is activated and shims are on PATH.',
        ],
      },
      {
        kind: 'p',
        text: 'A few important notes:',
      },
      {
        kind: 'ul',
        items: [
          'mise must already be installed on this machine for the tool to work; it does not install mise itself.',
          'Every operation targets the current working directory (switchable at the top), because project config and tasks come from that directory.',
          'It does not replace the CLI — power users can still use the terminal; the GUI is best for browsing, discovery and a few click-based operations.',
          'Tool and version names, plus the commands in the Command output panel, are real mise output and are deliberately not translated.',
        ],
      },
      {
        kind: 'p',
        text: 'For full usage, see the official mise docs at mise.jdx.dev.',
      },
    ],
  },
]

export const DOCS: Record<Lang, DocSection[]> = { zh, en }
