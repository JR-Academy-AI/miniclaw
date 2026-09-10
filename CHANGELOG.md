# Changelog

本文件记录 miniclaw 所有值得关注的变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
维护规则见 `rules/06-changelog.md`。

## [Unreleased]

## [0.1.0] - 2026-09-10

### Added
- adapter/codex: `miniclaw` 默认通过 Codex app-server 连接现有登录，支持流式、多轮、中断、usage 与中断后继续；M0 以无环境、无网络、无可执行工具的 chat-only 模式运行，意外审批请求一律拒绝。
- app: 新增 `--engine codex|claude`、`--codex-path` 和 `MINICLAW_CODEX_PATH`；`--doctor` 按选定引擎检查，默认检查 Codex。
- tui: 按 Reef design system 补齐 1.4 秒品牌欢迎动画、66–85 列大字标识、≥86 列螃蟹 Hero、聊天顶栏、输入占位、紧凑状态栏和可读的审批摘要；新增真实 50/80/120 列帧。
- app: 第一阶段可通过 `npm run dev` 连接 Claude 或 `npm run demo` 无额度演示；支持独立工作目录、启动探测、会话日志、流式对话、清屏和干净退出。
- adapter/claude: 复用已有登录，支持多轮、中断后继续及明确的认证 / 配额报错；按消息去重用量、按会话累计费用求增量，失败与中断保留不完整用量状态。
- tui: 提供 Reef 欢迎页、Markdown 流式输出、多行输入及审批卡片；Enter 默认拒绝，明确按键批准一次或本次会话，Esc 中断。
- docs/m0: 启动登录与配置隔离、Hook 审批、事件与用量三路验证；在 PRD 记录 v0.1 的最小决策，并保存可复核的 SDK 证据与未验证项。M0 验证不等同于完整 TUI 可用。
- skills: 新增 skills marketplace 设计（`docs/SKILLS-MARKETPLACE.md`，PRD F6，v0.5）：在 TUI 里搜索、安装、更新、固定、回滚、卸载第三方 skill，先支持 GitHub / git / 本地路径，之后加 Claude plugin `marketplace.json`、skills.sh、精选索引；miniclaw 只做客户端，不托管市场。每个 skill 按 commit SHA + 内容 hash 写进 lock 文件，更新从不自动、每次都重新审查；安装前静态扫描（21 条规则，对应真实攻击手法）、可疑的进隔离区，安装要显式批准，skill 声明的权限只是申请；skill 内容变了，定时任务要重新批准才能再用它；只装 skill，不装 plugin 附带的 hooks / MCP；默认装到你自己的目录，共享安装需要单独开启
- docs: 新增首次启动 onboarding 设计（`docs/ONBOARDING.md`，PRD F9）：第一次打开 miniclaw 先连上 Claude engine，找不到或没登录时直接在 TUI 里看到试过的位置和修复命令，修好自动继续（v0.1）；有了 Profile 和记忆之后，用约 5 分钟回答 8 组问题（任何语言都行），得到自己的 About you、公司、进行中的项目、近期日程、记忆规则和第一版 Core，最后一步直接建好第一个任务（v0.3）；每一题都能跳过，中断后能从断点继续，写入前逐文件确认；guided 模式只让模型把回答拆成字段，原话里没有依据的值默认不写，form 模式全程不联网；粘贴的密钥会被当场清掉，永不保存；"让 agent 自己做主"只是偏好，不会放宽任何权限；`/me` 查看、`/onboarding <section>` 重答单个章节，旧值保留在历史里
- skills: skills 成为不绑定 engine 的通用能力（`docs/SKILLS.md` §14–§15）：同一套 `list_skills` / `activate_skill` / `read_skill_resource` 工具，Claude Code 通过原生 `Skill` 工具使用，Codex 和其他 MCP client 通过 miniclaw 的 `mc-skills` 工具服务器使用，直连模型 API 时通过 function calling 使用；每次激活都记进执行记录，读取只限本次选中的 skills；需要执行脚本的 skill 只交给能执行命令的 engine。另提出 API engine（直接调用 Anthropic / OpenAI / OpenAI 兼容 API 的最小工具循环），与"不自研 agent loop"的非目标冲突，待确认
- gateway: 每个上游账号的并发上限改为从 RPM 保守推导（GATEWAY §4.4）：只用一半 RPM、按单个 Run 每分钟约 20 次请求估算，RPM 未知时固定为 1；配置的并发超过推导值时启动报错并给出算式；运行中实测每分钟请求数超过水位就暂停放行新 Run；全局默认并发 3 → 2
- gateway: 新增 engine 探测与 `/doctor`（GATEWAY §14）：按"配置路径 → 进程 PATH → 登录 shell PATH → 常见安装位置"查找 claude / codex，解决从 IDE / launchd 启动找不到、npm 版缺 `node`、nvm 换版本后路径失效、多份安装用错版本、alias 等问题；再检查登录状态并做一次端到端请求，核对实际打到的模型；失败时列出试过的每一处和修复建议，暂停中每 5 分钟自动复查，修好即恢复；engine 子进程只拿 PATH 和声明过的 provider 变量，shell 里残留的 provider 配置不会再让请求打错模型；接第三方 LLM 只需配置 provider
- gateway: 每个 Run 都返回统一口径的 usage（GATEWAY §15）：成功、失败、中止、取消都有，包括输入 / 缓存写 / 缓存读 / 输出 token、按模型拆分、请求数、费用及其来源、是否完整；拿不到就标"不可用"，不用 0 冒充；第三方 provider 按配置的价目表算费用；不返回 usage 的 provider 需要在 pool 上显式允许才能跑无人值守任务
- workspace: 新增默认工作目录与临时目录规则（`docs/WORKSPACE.md`，PRD F13）：没指定工作目录的任务跑在 miniclaw 管理的 `~/.miniclaw/users/<user_id>/workspace/tmp/<run_id>/` 里，不再落到 shell 当前目录；每个 Run 有工作目录、草稿区、`TMPDIR` 和交付物目录 `MINICLAW_OUT` 四个路径，交付物随执行记录永久保存；临时目录按规则自动清理（还能续跑的不清理，成功 72 小时、失败 7 天后删除，空目录立即删，总量超过 10 GB 时先删最早可清理的），删除只限临时区且不跟随软链；`/workspace save` 把临时目录一键保存为永久 workspace，定时任务可以直接在已保存的 workspace 里跑以跨次积累，删除已保存的 workspace 先进回收站 7 天；也可以登记自己的目录（如代码仓库）作为 workspace，miniclaw 不会往里写任何自己的文件，也永远不会清理它
- workspace: 新增注入给 agent 的 workspace 规则 `templates/workspace/PROTOCOL.md`：告诉 agent 每个路径能活多久、交付物必须写进 `MINICLAW_OUT`、不能碰其他 Run 和 miniclaw 自己的数据、不能自行永久化 workspace
- gateway: 同一个 workspace 目录同一时刻只允许一个 Run（与 computer use、浏览器 profile 一样固定为 1，不可配置），第二个 Run 排队等待
- policy: 硬底线新增 skills marketplace 目录（HARNESS §6.4）：agent 不能写 `~/.miniclaw/**/marketplace/`，不能读其中的 lock 文件、下载暂存区和隔离区，已安装的 skill 只能经本次运行的挂载目录只读访问；第三方 skill 只能通过 marketplace 的扫描 → 隔离 → 批准流程变更，agent 无法用文件工具偷偷安装、修改或放行 skill
- policy: 硬底线新增 workspace 注册表（`state/workspaces.json`）：agent 不能读写它，也就不能自己把某个 workspace 标成受信任来加载其中的 skills
- docs: 新增两层 harness 设计（`docs/HARNESS.md`，PRD F12，v0.3 起提供，`browser` v0.4）：在 Claude Code / Codex 之上按任务类型提供 Domain Runtime——`research`（检索、抓取、带引用的报告，自动检查每条引用都有出处）、`document`（改文件前自动快照、删除只进回收站、`/undo` 一键还原整次 Run）、`browser`（独立浏览器 profile 与登录态、域名白名单、提交表单需审批）、`coding`（engine 直通）；领域工具由 miniclaw 以 MCP 提供，两个 engine 共用；每个 Run 除了执行状态还有验收结论
- policy: 权限改为按 capability 授权（HARNESS §6，PRD F8 细化）：deny 优先；一组硬底线任何配置都放不开（凭证目录、miniclaw 自己的策略与任务授权、硬删除、无人值守支付 / 改安全设置、绕过验证码等），agent 不能给自己授权；读过外部网页的 Run 自动收紧外发、shell 等高危动作；审批卡片默认选中"拒绝"；创建定时任务时逐条确认权限清单，运行中越界就暂停等人
- docs: 新增 skills 子系统设计（`docs/SKILLS.md`，PRD F6）：同一个 `SKILL.md` skill 可以在 Claude Code、Codex 以及不同的模型 provider 上使用；可以直接导入已有的 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills`，按真实路径去重，不改动这些目录；每次运行只让模型看到这次任务选中的 skills，被依赖的兄弟 skill 会自动带上，所用版本记入执行记录
- tui: 新增 TUI design system「Reef」（`docs/DESIGN.md` + `design/tokens.json`）：8 色相语义色板（状态 / 模块 / profile 各有固定颜色，深浅终端双套色值 + 16 色回退）、只用于品牌时刻的彩虹渐变、glyph 与 ASCII 回退、布局断点、组件与动效规范；启动时显示彩色欢迎页，包含像素小螃蟹、渐变 MINICLAW 大字和启动检查卡片，动画不超过 1.4 秒且按任意键跳过；可以用 `node design/preview/index.mjs [welcome|palette|screen]` 在真实终端里预览
- rules: 新增项目代码原则规则（SOLID / DRY / KISS / YAGNI 等）及提交前自检清单，位于项目根目录 `rules/`，Codex、Claude Code 等所有 agent 通用
- rules: 新增 changelog 维护规则，要求每次做 feature 同步更新本文件
- gateway: 新增 Runtime Gateway 限流与错误控制规则设计（`docs/GATEWAY.md`，PRD F11）：按上游账号的并发 / 速率 / 日预算准入，单 Run 预算与死循环检测，统一错误分类，副作用闸门下的重试 / 续跑 / 冷却策略
- rules: 新增子目录 AGENTS.md 规则，要求大功能模块、component、多 provider 目录附带 `AGENTS.md`（及一行 `@AGENTS.md` 的 `CLAUDE.md`），并提供对应模板
- agents: 新增根目录 `AGENTS.md` 作为所有 AI agent 的唯一指令入口，强制加载 `rules/`；`CLAUDE.md` 改为只引用 `AGENTS.md`
- agents: `docs/`、`rules/`、`design/` 新增目录级 `AGENTS.md`（+ 一行 `@AGENTS.md` 的 `CLAUDE.md`），写明各文件的权威范围、改动时必须同步的地方和易错点；目录级规则扩展到规范 / 文档目录
- memory: 新增多层记忆模板 `templates/memory/`（L0 核心 / L1 工作 / L2 短期 / L3 长期 / L4 归档），长期层覆盖 profile、agenda、会议、公司、项目、人脉、知识，并附带自我更新协议；所有用户首次登录时从同一模板实例化
- memory: 新增记忆更新评估层（`docs/MEMORY-EVAL.md`，模板升到 0.2.0）：整理任务只把变更提案写到 `meta/staging/`，每条变更写入长期层前都要过 eval gate——凭证 / secret 泄漏直接丢弃并打码，缺来源、静默丢事实、擅改固定指令会被拦下，断链 / 疑似重复 / 来回改 / 超预算以及 LLM judge 判为无依据的变更送去审核；每条评估及用户的批准 / 拒绝 / 撤销记在 `meta/eval-log.md`；每周体检把撤销率、审核拒绝率、重复、陈旧、inbox 积压写进 `meta/health.md` 并给出调整建议；整理 prompt 或模型改动须通过离线回归用例
- memory: 新增短期 → 长期的晋升评估（`docs/MEMORY-PROMOTION.md`，模板升到 0.3.0）：整理之前先按每个用户自己的 rubric（`meta/rubric.md`）给短期候选打分，只有晋升的候选才会被整理进长期记忆。rubric 按优先级分四层——隐私底线（不可配置）、用户规则（`always` / `never` / `boost` / `lower`）、从 profile / 目标 / 当前重点生成的画像派生标准、7 个重要程度维度的加权分；结果分为晋升 / 问用户 / 暂留 / 丢弃，反复出现的事实会加分，打分失败一律暂留。onboarding 时会问"一定要记 / 不要记什么"；平时说"以后 Acme 相关的都记下来""别记我吃了什么"会变成规则并请你确认；你多次做出同样的判断时，miniclaw 会提出规则建议，但只有你同意才会生效。"值不值得记"不再由写入闸门的 judge 判断
- docs: 新增 `docs/README.md`、`docs/PRD.md`、`docs/MEMORY.md`，定义产品定位（轻量级 OpenClaw）、功能优先级、里程碑和记忆系统设计
- docs: README 新增"项目结构"目录树和"本地预览"说明；根 `AGENTS.md` 新增 Repository layout，并补上 Runtime Gateway 的架构约束

### Changed
- tui: 输入 `/` 时显示可操作的命令菜单；支持方向键选择、Enter 执行和 Esc 关闭。
- tui: 修复 macOS 终端 Backspace/DEL 无法删除、快速连续输入丢字以及 `/help` 等 slash command 无法提交；Ctrl+D 保留向前删除。
- app: 默认引擎从 Claude Code 改为 Codex；Reef TUI 的状态和文案按当前引擎显示。
- tui: 将终端直接发送的 CR/LF 正确识别为 Enter，避免命令或消息末尾出现异常换行、`/help` 留在输入框中不发送。
- docs: 定下三项待决策（PRD §10、MEMORY §12、ONBOARDING §15）：①"登录"只是切换本地用户，不设密码、不绑定系统账户；② 直接复用 Claude Code 已有的登录态，miniclaw 不另做 engine 登录，没登录时引导你在 Claude Code 里登录（配置是否继承仍待定）；③ TUI 里你的个人档案叫 About you（`/me`），"Profile" 在界面上只指模型 profile（`/model`），概念和目录都不改名
- **BREAKING** docs: 版本重排（PRD §9、`docs/ROADMAP.md`）：第一个 MVP（v0.1）只做"打开 TUI → 连上 Claude engine → 直接对话"——欢迎页 + engine 探测与修复提示、流式对话、`Esc` 中断、工具调用逐次审批（隔离用户 engine 配置、PreToolUse hook、硬底线、审计事件）、对话记录落盘。原 MVP 里的 Gateway、权限引擎、Workspace、多用户、定时移到 v0.2（可托付）；Profile / 多模型、记忆与 onboarding 访谈、Domain Runtime 移到 v0.3（懂你）；Codex、browser、computer use、记忆自动化到 v0.4；Skills + marketplace 到 v0.5。每个版本有自己的验收用例；优先级 P0 / P1 / P2 改为表示重要程度，不再等于版本号。迁移：各专题文档里旧的"MVP / v0.1 / v0.2"标注按 ROADMAP §5 换算；ROADMAP 的 M 编号保持不变，新增 M11（最小可用对话）、M12（Profile 与多模型）
- docs: PRD F2 增加 API engine 提案（待确认，与非目标"不自研 agent loop"冲突，列入 PRD §10）；F6 增加通用 skill 工具协议（`list_skills` / `activate_skill` / `read_skill_resource`）；F9 的 onboarding 改为"v0.1 只连 engine，v0.3 做完整访谈"，见 `docs/ONBOARDING.md`
- harness: Domain Runtime 层（`coding` / `research` / `document` 基础版和 harness 契约）移出 MVP，随版本重排到 v0.3，`browser`、办公格式、Codex、授权增强到 v0.4（HARNESS §11）。v0.1 只有权限最小版：隔离用户 engine 配置、PreToolUse hook 逐次审批、硬底线、审计事件。v0.2 在同一接口上换成完整 policy engine（capability、grant、taint、无人值守预授权），Run 仍以 engine 直通方式执行
- **BREAKING** skills: Skills 移出 MVP，改到 v0.2（PRD F6 改为 P1），方向转为 marketplace，可以搜索、安装、更新第三方 skills；MVP 期间 Run 不带任何 skill，engine 自己发现的 skills 也关闭。非目标由"不做 skill 市场"改为"不自建托管的市场服务，只做客户端"。MVP 验收用例 2 不再要求指定 skill。迁移：原计划在 v0.1 实现 skills 的工作移到 `docs/ROADMAP.md` M10
- docs: 新增 `docs/ROADMAP.md` 开发顺序：M0 决策 / 验证 / 补设计 → M1 地基 → M2 执行主链路（policy → Claude adapter → Gateway → harness）→ M3 TUI → M4 定时与常驻 → M5 research / document → M6 记忆 = v0.1；M7 Codex + 路由 → M8 browser + computer use → M9 记忆自动化等 → M10 Skills + Marketplace = v0.2；每个阶段写明依赖、退出标准和可并行的工作
- tui: 界面默认语言改为英文：tab（`Chat` / `Tasks` / `Schedules` …）、状态、权限弹窗（`Approval needed`）、电脑操控徽章（`Computer use`）、欢迎页问候与 tagline、启动检查、按键提示都用英文；用户输入、任务名、agent 回复等用户内容原样显示。新增文案规范 `docs/DESIGN.md` §3.1，是否提供中文界面列入 PRD §10 待决策
- docs: Profile 的定义从"runtime + 模型"改为"runtime + provider + 模型"（PRD F5 / §6、README）：同一个 runtime 可以换用官方或兼容端点的模型（DeepSeek、Kimi、GLM、火山 ARK、OpenRouter、Ollama……），各 provider 能走哪个 runtime 见 `docs/SKILLS.md` §9
- docs: PRD §9 里程碑和 README 路线图补上 Runtime Gateway，与 GATEWAY §13 保持一致：MVP 包含准入限流、RunGuard、错误分类、副作用闸门；v0.2 加入 Codex 错误分类和按额度遥测提前降速

### Fixed
- tui: `NO_COLOR` 模式不再由 bold、italic 或光标样式输出 ANSI 控制序列，管道和无色终端保持纯文本。
