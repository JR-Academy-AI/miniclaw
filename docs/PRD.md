# miniclaw PRD

> 版本：v0.1（草案）
> 日期：2026-09-10
> 状态：构想阶段，技术选型未定

---

## 1. 背景与定位

[OpenClaw](https://openclaw.ai/) 是一个自托管的个人 AI 助手：一个常驻 Gateway 进程把 WhatsApp / Telegram / Slack 等聊天渠道接到 agent，配套插件系统、LLM 层、记忆系统、skills、cron、浏览器自动化。它功能完整，但也重：渠道多、配置多、自带一整套 agent 栈。

**miniclaw 是一个轻量级的 OpenClaw**：一个本地运行的 AI 自动化环境，用来执行各种 AI 自动化任务——一次性的、定时的、需要操作电脑的都可以。

轻量体现在三点：

1. **不自己造 agent 引擎**：直接复用 Claude Code（Claude Agent SDK）和 Codex 的 agent runtime，miniclaw 只做编排层
2. **不做多渠道网关**：TUI 是唯一主入口，不维护一堆聊天平台集成
3. **本地优先**：单机运行、数据留在本地、开箱即用，配置尽量少

## 2. 目标与非目标

### 目标

- G1：在终端里用自然语言发起 AI 自动化任务，并看到执行过程和结果
- G2：任务可以定时 / 周期执行，无人值守，结果可追溯
- G3：按任务类型切换模型 / runtime，用合适的模型获得合适的能力（强推理、写代码、computer use、低成本批量）
- G4：能直接操作本机（computer use：截屏、键鼠、应用、浏览器）
- G5：skills 可动态发现、加载、卸载，扩展能力不需要改 miniclaw 本身
- G6：足够轻——安装简单、常驻资源占用低、上手快
- G7：为每个用户构建 **User OS** 记忆（profile、agenda、会议、公司、项目……），分长期 / 短期层，能自我更新；所有用户共用同一套记忆模板
- G8：按任务类型（调研、网页操作、文档、写代码）提供专门的执行环境（Domain Runtime），权限统一、可预授权、可审计；同一任务换 engine 跑，权限行为不变

### 非目标（至少 v1 不做）

- 多聊天渠道网关（WhatsApp / Slack / Discord 等）——可能以 skill / 通知插件形式后补
- 自研 LLM 调用层或 agent loop
- 团队协作 / 共享记忆 / 云端托管（支持同一台机器上有多个本地用户，但彼此隔离、不共享）
- GUI 桌面应用或 Web 控制台
- 托管 skill 市场：miniclaw 只做 marketplace **客户端**，聚合 GitHub、Claude plugin marketplace、skills.sh 等已有来源；不运行服务器，不做发布、账号、评分；精选索引只是 git 仓库里的静态文件（F6，见 [SKILLS-MARKETPLACE.md](./SKILLS-MARKETPLACE.md)）

## 3. 目标用户与典型场景

**目标用户**：熟悉终端的个人开发者 / 技术型个人用户，已经在用 Claude Code 或 Codex，想要一个本地常驻、能跑定时自动化的个人 agent。miniclaw 是给别人用的产品，不只是作者自用，所以用户相关的一切（尤其是记忆）都要模板化、可复制。

**典型 AI 自动化任务**：

| 类型 | 示例 |
|------|------|
| 定时简报 | 每天 8 点汇总日历、待办、关注的新闻 / GitHub 动态，生成简报 |
| 文件整理 | 每周整理下载目录，按类型归档，清理重复文件 |
| 网页自动化 | 定期打开某网站抓数据、填表、截图存档 |
| 代码巡检 | 每晚扫描指定仓库：依赖更新、失败的 CI、TODO 汇总 |
| 桌面操作 | "打开 X 应用，导出本月报表，存到 Y 目录"（computer use） |
| 内容生产 | 按模板定时生成周报 / 社媒草稿 |
| 一次性任务 | 在 TUI 里直接说一句话，让 agent 立刻执行 |

## 4. 与 OpenClaw 对比

| 维度 | OpenClaw | miniclaw |
|------|----------|----------|
| 主入口 | 多聊天渠道（Gateway） | TUI |
| Agent 引擎 | 自带 LLM 层 + agent runtime | 复用 Claude Code / Codex runtime |
| 多模型 | 支持 | 按任务路由到不同模型 / runtime，作为核心能力 |
| Computer use | 以浏览器自动化为主 | 本机 computer use 是核心能力 |
| 定时任务 | cron + heartbeat | 内置 scheduler |
| Skills | 社区 / 内置 / 工作区三类 | 兼容 `SKILL.md` 开放规范；marketplace 客户端安装第三方 skills，按提交固定 + 安装前扫描 + 显式批准 |
| 部署 | daemon，本机或 VPS | 本机单进程 |
| 复杂度 | 高（功能全） | 低（够用） |

## 5. 功能需求

优先级表示重要程度：**P0** = 核心能力（v0.1–v0.3 分阶段交付）· **P1** = 扩展能力（v0.4 起）· **P2** = 之后。每个版本具体交付什么以 §9 为准，开发顺序见 [ROADMAP.md](./ROADMAP.md)。

### F1. TUI（P0）

> v0.1 只含欢迎页、对话视图、审批卡片、状态栏；其余面板随各自功能交付（§9）

- 对话面板：输入自然语言任务，流式显示 agent 的思考、工具调用和输出
- 任务面板：列出运行中 / 已完成 / 失败的任务，可查看详情和日志，可中止
- 定时任务面板：查看、新建、编辑、暂停、删除定时任务
- Skills 面板：列出已加载 skills，启用 / 禁用 / 重新加载；浏览、安装第三方 skills（随 F6，v0.5）
- 模型面板：查看可用 runtime / 模型 profile，设置默认值
- 权限确认：高风险操作在 TUI 内弹出确认（见 F8）
- 快捷键优先，支持斜杠命令（如 `/schedule`、`/skills`、`/model`）
- 界面默认语言是**英文**：miniclaw 自己输出的文案（tab、状态、提示、错误、欢迎页）都用英文；用户输入、任务名、agent 回复、记忆等用户内容原样显示，不翻译。文案规范见 [DESIGN.md §3.1](./DESIGN.md#31-界面语言与文案)

### F2. Agent Runtime 适配层（P0：Claude；P1：Codex）

- 定义统一的 runtime adapter 接口：启动会话、发送消息、流式事件、工具回调、中止、恢复
- **Claude Code adapter**：基于 Claude Agent SDK（或以子进程驱动 `claude -p`）
- **Codex adapter**：基于 Codex SDK（或以子进程驱动 `codex exec`）
- 两种 runtime 的事件统一成 miniclaw 内部事件流，TUI 和日志只依赖内部格式
- 复用 runtime 已有能力（文件读写、shell、MCP、subagent），不重复实现
- **API engine**（提案，待确认）：miniclaw 直接调模型 API（Anthropic Messages / OpenAI Responses / OpenAI 兼容 Chat Completions），跑一个只调用 miniclaw 自有工具（skill 工具 + mc-* MCP）的最小 tool loop，不带文件 / shell；用于轻量任务和 engine 不支持的 provider。见 [SKILLS §15](./SKILLS.md#15-api-engine直连模型-api-调用-skills)

### F3. 任务模型（P0）

- **Task**：一次要完成的事——prompt + 使用的 profile + 可用 skills + 工作目录 + 权限策略
- **Run**：Task 的一次执行记录——开始 / 结束时间、状态、完整事件日志、最终输出、花费（token / 费用，如果 runtime 提供）
- 所有 Run 持久化到本地，可以回看、重跑、导出

### F4. Scheduler（P0：基础 cron；P1：高级策略）

- 用 cron 表达式或自然语言（"每个工作日早上 9 点"）创建定时任务
- miniclaw 常驻时由内置 scheduler 触发；错过的任务有补跑策略（跳过 / 补跑一次）
- 并发控制：同一任务不重叠执行，全局最大并发数可配
- 失败重试（次数、间隔可配；规则见 F11）
- P1：任务链（A 完成后触发 B）、条件触发（文件变化、时间窗口）
- P2：注册到 launchd，TUI 不开时也能跑

### F5. 多模型 / 多能力路由（P0：手动 profile；P1：规则路由；P2：自动分派）

- **Profile** = runtime + provider + 模型 + 默认参数 + 能力标签。provider 是模型的来源：官方（Anthropic / OpenAI / Bedrock / Vertex）或兼容端点（DeepSeek、Kimi、GLM、火山 ARK、OpenRouter、Ollama……），能走哪个 runtime 见 [SKILLS §9](./SKILLS.md#9-provider-维度)。例如：
  - `coder`：Codex 或 Claude，写代码 / 改仓库
  - `operator`：支持 computer use 的模型，桌面 / 浏览器操作
  - `thinker`：最强推理模型，复杂规划
  - `cheap`：小模型，批量 / 简单任务
- P0：每个任务 / 定时任务手动指定 profile，有全局默认值
- P1：按规则路由（任务标签、需要的 skill、是否需要 computer use → 选 profile）
- P2：由一个小模型做分派，自动选 profile，用户可覆盖

### F6. Skills 与 Marketplace（P1：v0.5；更多 marketplace 来源 P2；MVP 不含）

> 详细设计见 [SKILLS.md](./SKILLS.md)（加载、挂载、投递、通用 skill 工具）和 [SKILLS-MARKETPLACE.md](./SKILLS-MARKETPLACE.md)（第三方安装与供应链安全）；开发顺序见 [ROADMAP.md](./ROADMAP.md) M10。MVP 不含 skills：engine 自己发现的 skills 也关闭，保证 Run 可复现

- 兼容 Agent Skills 开放规范的 `SKILL.md`；miniclaw 扩展只放 `metadata.miniclaw`
- miniclaw 自己当唯一 registry：导入 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills`（只读、按真实路径去重）、用户私有、全局共享、工作区（需信任）、marketplace 已安装；启动时扫描，目录变化热重载
- 每个 Run 冻结 skill 集合并挂载，由各 engine adapter 投递（Claude Code 原生 plugin；Codex 走 `mc-skills` 工具）；按任务注入，只把相关 skills 交给 engine
- **Marketplace 客户端**：在 TUI 里搜索、安装、更新、固定、回滚、卸载第三方 skill；来源先支持 GitHub / git / 本地路径，再加 Claude plugin `marketplace.json`、skills.sh、精选索引；只安装 skill，不安装 plugin 的 hooks / MCP
- 版本按 commit SHA + 内容 hash 写进 lock 文件；更新从不自动，每次更新都要重新审查
- 供应链安全：安装前静态扫描 + 隔离区 + 信任层级 + 显式批准；skill 声明的权限只是申请，安装批准不产生授权；hash 变了的 skill 须重新批准，定时任务才能再用
- 默认装到用户私有目录；共享安装需要授权，且每个用户各自批准
- skills 是通用能力：同一套 skill 工具协议（`list_skills` / `activate_skill` / `read_skill_resource`）以三种方式提供——Claude Code 原生 plugin、`mc-skills` MCP 工具服务器（Codex 及任何 MCP client）、API function calling（API engine）。见 [SKILLS §14](./SKILLS.md#14-通用调用面谁都能调用同一套-skills)

### F7. Computer Use（P1）

- 能力：截屏、鼠标、键盘、打开 / 切换应用、读取可访问性树（macOS 优先）
- 实现方式待定：模型原生 computer-use 工具 + 本地执行器，或通过 MCP server 暴露
- 执行过程可视化：TUI 显示每一步动作和截图缩略（或落盘）
- 必须配合 F8 的权限策略；默认需要逐步或按会话确认

### F8. 安全与权限（P0）

> 详细规则（capability 词表、决策顺序、硬底线、三道执行点、审批、prompt injection 防护）见 [HARNESS.md §6](./HARNESS.md#6-权限管理)，以该文为准

- 权限策略分级：`ask`（每次确认）/ `session`（本次会话允许）/ `allow`（该任务白名单内自动允许）
- 高风险操作默认 `ask`：删除文件、执行任意 shell、computer use、对外发送（邮件、消息、提交表单）
- 无人值守的定时任务只能用创建时预先授权的操作；超出范围就暂停并通知
- 审计日志：每次工具调用、每步 computer use 动作都记录到 Run 日志
- 凭证不写进 prompt 和日志
- 权限按 **capability** 授予，policy engine 是唯一决策点，deny 优先；一组**硬底线**（凭证目录、miniclaw 自己的策略文件、硬删除、无人值守支付等）任何配置都放不开；agent 不能给自己授权
- 读过不可信内容（网页、外部文档）的 Run 自动收紧外发、shell 等高危动作

### F9. 用户记忆系统 / User OS（P0：模板 + 注入 + 记录；P1：自动整理）

> 详细设计见 [MEMORY.md](./MEMORY.md)，更新评估见 [MEMORY-EVAL.md](./MEMORY-EVAL.md)，短期 → 长期晋升评估见 [MEMORY-PROMOTION.md](./MEMORY-PROMOTION.md)，模板见 [`templates/memory/`](../templates/memory/)

- **工具级记忆**：属于 miniclaw、保存登录用户本人的信息，与 runtime 无关——Claude Code 和 Codex 读到的是同一份
- **模板化**：`templates/memory/` 是唯一 schema；每个用户首次登录时实例化到 `~/.miniclaw/users/<user_id>/memory/`，所有用户结构一致；模板带版本号，升级时自动迁移
- **多层记忆**：L0 Core（每次必注入）· L1 Working（上下文窗口）· L2 Short-term（每日日志、inbox，14 天滚出）· L3 Long-term（User OS）· L4 Archive（只检索）
- **User OS 领域**：profile（身份 / 偏好 / 目标）· agenda（日程 / 截止 / 待办）· meetings · companies · projects · people · knowledge
- **自我更新**：记录（agent 写短期层）→ 整理（会话结束 + 每晚，由 scheduler 触发，升级到长期层并刷新 Core）→ 滚出归档 → 高风险变更由用户在 TUI 审核；每次变更写 changelog，可撤销
- **更新评估（eval）**：整理任务只提交变更提案，每条变更写入前过 eval gate（P0：确定性检查——schema、来源、凭证、secret 泄漏、静默丢事实；P1：LLM judge 检查依据与目标 / 操作是否正确）；每周体检分析更新质量（撤销率、审核拒绝率、重复、陈旧）（P1）；整理 prompt / 模型改动须通过离线回归用例
- **晋升评估（promotion）**：整理之前的独立 pipeline，按每个用户自己的 rubric 判断短期候选值不值得进长期层。rubric = 隐私底线 > 用户规则（用户亲口说的"以后 X 都记 / 别记 Y"、onboarding 回答）> 画像派生标准（从 profile / 目标 / 当前重点生成）> 7 个重要程度维度加权打分；结果为 promote / ask / hold / discard（P0：rubric + onboarding 建规则 + 打分；P1：每日 ask、画像变化自动重建、从用户判断中提出规则建议）
- **Onboarding**：首次启动先连上 engine（v0.1 起），有了 Profile 与记忆后再用 TUI 访谈填好个人档案 / 公司 / 项目 / 近期日程 / 记忆规则，review 后经 E1 写入并由代码生成第一版 Core（v0.3）；每步可跳过、可中断恢复，guided 模式只让模型做字段抽取且不能编造，form 模式全程不外发。详细设计见 [ONBOARDING.md](./ONBOARDING.md)
- **会话可恢复**：TUI 重启后能继续之前的对话（P1）
- 定时任务可以读自己上一次的输出，也可以声明 `memory_scope` 预加载相关记忆（例如简报任务预加载 agenda 和进行中的项目）

### F10. 通知（P1）

- 定时任务完成 / 失败 / 等待确认时发 macOS 系统通知
- P2：可选通知渠道（Telegram / 邮件 / Webhook），以 skill 或插件形式提供，不做成核心网关

### F11. Runtime Gateway：限流与错误控制（P0）

> 详细规则见 [GATEWAY.md](./GATEWAY.md)。这里的 Gateway 是 core 到 runtime adapter 的唯一出口，不是聊天渠道网关

- **准入限流**：全局 / 上游账号（quota pool）/ 任务三级并发；**pool 并发由 RPM 保守推导（只用一半 RPM，RPM 未知时为 1），实测 RPM 超水位即停止准入**；启动速率令牌桶；无人值守日预算；给交互任务预留槽位；computer use 并发固定为 1
- **Engine 探测**：四级探测（定位 → 可执行 → 已登录 → 端到端），专治"终端里能用、miniclaw 找不到 claude / codex"、npm 版缺 `node`、多份安装、provider 变量没传进来打错模型；engine 子进程环境由 adapter 显式组装；`/doctor` 给出试过的每一处和修复建议；接第三方 LLM 只需配 provider，接新 engine 只需新 adapter
- **Usage 返回**：每个 Run（含失败 / 中止）都返回统一口径的 usage（token 分项、按模型拆分、请求数、费用及其来源、完整度）；拿不到就标 `unavailable`，不用 0 冒充；第三方 provider 按价目表算费用；不返回 usage 的 provider 需显式允许才能跑无人值守任务
- **单 Run 护栏**：轮数、token、费用、时长、空闲、工具调用次数上限，死循环检测；无人值守任务不允许无上限
- **统一错误分类**：各 adapter 把原始错误翻译成统一的 `ErrorKind`，恢复策略与具体 runtime 解耦
- **恢复策略**：只在 Run 层少量重试（runtime 内部已重试单次调用）；**有副作用的 Run 不自动从头重跑**，只续跑或交给人；额度用尽 / 未登录时暂停该账号并延期定时任务
- 所有决定写入 Run 事件日志，TUI 可见，状态重启不丢

### F12. Harness：Domain Runtime（P0：v0.3 起，MVP 不含）

> 详细设计见 [HARNESS.md](./HARNESS.md)
>
> **2026-09-10 决定**：Domain Runtime 层不进 MVP，v0.3 起提供（browser、办公格式 v0.4）。v0.1 只有权限最小版，v0.2 上完整 policy engine，这两版都以 engine 直通方式执行（HARNESS §11）

- **两层 harness**：L1 是 engine（Claude Code / Codex）自带的 agent loop、工具、原生权限与 sandbox；L2 是 miniclaw 按任务类型搭的领域 harness。miniclaw 不改 engine 的 loop，只通过 engine 公开的配置面（指令、工具白名单、MCP、权限规则、sandbox、回调）控制它
- **Domain Runtime**：每类任务一个，打包 playbook 指令、工具、capability 上限与默认授权、工作区、产物契约、verifier、预算默认值；新增一类 = 注册一个定义，不改 core。Domain Runtime 编译成 engine 无关的 `HarnessSpec`，再由各 engine adapter 翻译
- **首发**：`research`（检索 / 抓取 / 带引用的报告，天然无外发能力，v0.3）· `document`（改前快照、只进回收站、`/undo`，基础版 md / txt / csv / json 在 v0.3，办公格式 v0.4）· `coding`（engine 直通，未声明 domain 时的默认值，把之前版本的直通 Run 纳入契约，v0.3）· `browser`（独立浏览器 profile、域名白名单、提交需审批，v0.4）
- **领域工具由 miniclaw 以 MCP 提供**（`mc-research` / `mc-browser` / `mc-docs`），两个 engine 共用一份实现和同一处执法
- **验收**：Run 的执行状态和验收结论（`verdict`）分开；无人值守 Run 验收失败时标记待处理，不自动重跑

### F13. Workspace：默认工作目录、临时目录与永久化（P0；P1：导出 + 单 Run 磁盘上限 + 随 skills 的 workspace 信任）

> 详细规则见 [WORKSPACE.md](./WORKSPACE.md)，agent 看到的规则见 [`templates/workspace/PROTOCOL.md`](../templates/workspace/PROTOCOL.md)

- **默认 workspace 由 miniclaw 管理**：没指定工作目录的 Run 跑在 `~/.miniclaw/users/<user_id>/workspace/tmp/<run_id>/`，不继承启动 TUI 时的 shell cwd
- **三种 workspace**：`tmp`（临时，默认）· `saved`（用户保存的，永久）· `external`（用户自己的目录，登记后使用）；同一 workspace 同时只跑 1 个 Run
- **每个 Run 四个路径**：工作目录、草稿区、`TMPDIR`、交付物目录 `MINICLAW_OUT`（写进 Run 记录，永不清理）
- **自动清理只针对 `tmp/`**：还能续跑的永不清理；成功 72 小时、失败 7 天后删除；空目录立即删；总量超配额时提前删最早可清理的；删除不跟随软链、只删限定根目录下的一级目录
- **永久化只能由用户触发**：`/workspace save` 把 tmp 升级为 saved；定时任务可以直接在 `saved:<slug>` 里跑以跨次积累；删除 saved 先进回收站 7 天

## 6. 核心概念

```
Profile ──┐
Skills  ──┤
Policy  ──┼──► Task ──(手动 / Schedule 触发)──► Run ──► 事件日志 + 输出
Memory  ──┘                                      │
   ▲                                             │ capture
   └──────────── consolidate ◄───────────────────┘
```

| 概念 | 说明 |
|------|------|
| Runtime | 底层 agent 引擎（Claude Code / Codex），即 L1 engine harness；新文档里写作 **engine** |
| Domain Runtime | miniclaw 在 engine 之上为一类任务搭的 L2 harness（`research` / `browser` / `document` / `coding`），见 HARNESS.md |
| Profile | runtime + provider + 模型 + 参数 + 能力标签 |
| Skill | 可动态加载的能力包（`SKILL.md` + 资源） |
| Policy | 权限策略：capability + grant，由 policy engine 统一决策 |
| Capability | 一个可授权的动作类别 + 作用范围（如 `fs.write:~/Documents/**`），带 effect 风险分类 |
| Task | 一个可执行的任务定义 |
| Schedule | 触发规则（cron / 自然语言） |
| Run | Task 的一次执行记录 |
| Workspace | Run 的工作目录：`tmp`（临时，自动清理）/ `saved`（用户保存）/ `external`（用户目录），见 WORKSPACE.md |
| User | 登录 miniclaw 的本地用户，拥有独立的记忆、任务、执行记录 |
| Memory | 用户的多层记忆（User OS），从统一模板实例化 |

## 7. 架构（初步）

```
┌──────────────────────── TUI ────────────────────────┐
│  chat │ tasks │ schedules │ skills │ models │ logs   │
└───────────────────────┬─────────────────────────────┘
                        │ 内部事件流
              ┌─────────▼─────────┐
              │   miniclaw core   │
              │  - task runner    │
              │  - scheduler      │
              │  - router         │
              │  - skill registry │
              │  - policy engine  │
              │  - harness（Domain│
              │    Runtime）      │
              │  - memory manager │
              │  - runtime gateway│
              │  - store（本地）   │
              └───┬─────────┬─────┘
                  │         │  runtime adapter 接口（compile HarnessSpec）
        ┌─────────▼──┐  ┌───▼─────────┐
        │ Claude Code │  │   Codex     │
        │ (Agent SDK) │  │ (SDK / CLI) │
        └─────┬───────┘  └──────┬──────┘
              └──── tools ──────┘
      engine 内置工具 · miniclaw MCP 工具（mc-research / mc-browser / mc-docs）· computer use · skills
```

两层 harness 与权限执行点的详细结构见 [HARNESS §3](./HARNESS.md#3-两层架构)。

本地数据目录（示意）：

```
~/.miniclaw/
├── config.toml              # 全局配置、current_user
├── skills/                  # 所有用户共享的 skills
└── users/
    └── <user_id>/           # 每个用户独立、互相隔离（0700）
        ├── model-profiles/  # 模型 profile 定义
        ├── skills/          # 用户私有 skills
        ├── tasks/           # task + schedule 定义
        ├── runs/            # 执行记录与日志（含 artifacts/ 交付物）
        ├── workspace/       # tmp/（临时，自动清理）· saved/（永久）· .trash/，见 WORKSPACE §2
        ├── state/           # gateway.json · workspaces.json 等运行状态
        └── memory/          # 由 templates/memory/ 实例化的 User OS
```

仓库目录结构见 [README · 项目结构](./README.md#项目结构)。

## 8. 非功能需求

- **轻量**：单进程，常驻空闲时 CPU ≈ 0、内存占用低；冷启动到可交互 < 2s（目标）
- **本地优先**：所有配置、日志、记忆存本地，纯文本 / 可读格式，方便人工编辑和 git 管理
- **可观测**：每个 Run 的完整事件都能回放
- **可扩展**：新增 runtime / skill / 通知渠道不需要改 core
- **平台**：macOS 优先（computer use 依赖系统权限），Linux 其次

## 9. 里程碑

| 版本 | 范围 |
|------|------|
> **2026-09-10 重排**：第一个 MVP 只做"打开 TUI → 连上 Claude engine → 直接对话"的能用版本；原 MVP 里的 Gateway、权限、Workspace、定时移到 v0.2，profile、记忆、Domain Runtime 移到 v0.3。各专题文档里旧的版本标注按 [ROADMAP §5](./ROADMAP.md#5-专题文档里的版本标注对照) 换算。

| 版本 | 主题 | 范围 |
|------|------|------|
| **v0.1 MVP** | 能用 | **TUI**（欢迎页 + 对话 + 审批卡片 + 状态栏）· **Claude adapter 最小版**（多轮、流式、中止）· **engine 探测**（GATEWAY §14）· 错误分类子集（只用于展示）· **权限最小版**（隔离用户 engine 配置 + PreToolUse hook + 硬底线 + 其余逐次审批 + `policy.decided` 审计事件）· 每个对话一个临时工作目录 · 对话记录落盘 |
| **v0.2** | 可托付 | Task / Run 持久化 + 任务视图 · **Runtime Gateway**（准入限流 + RPM 推导并发 + RunGuard + 错误分类 + 副作用闸门 + usage 返回，见 GATEWAY §13）· **权限基线**：policy engine（capability / 硬底线 / 审批 / 审计 / taint / 无人值守预授权）+ Claude 执行点 ①②，Run 以 engine 直通方式执行（HARNESS §11）· **Workspace**：tmp 工作目录 + 自动清理 + 保存 / external 登记（WORKSPACE §13）· 多用户 · **基础 cron scheduler + 常驻** |
| **v0.3** | 懂你 | **Profile 与多模型**（手动选择，含 provider / Quota Pool）· **记忆**：模板实例化 + onboarding + Core / INDEX 注入 + capture + 手动整理 + 记忆写入 eval gate（确定性检查）+ 晋升评估（rubric + 打分）· **Harness**：Domain Runtime 契约 + `coding` / `research` / `document` 基础版 |
| **v0.4** | 多引擎 · 操作网页和电脑 | Codex adapter（含 Codex 错误分类、Codex `compile`）· 规则路由 · 会话恢复 · 按额度遥测提前降速 · `browser` Domain Runtime · computer use（macOS）· `document` 办公格式 · 彩排授权 / 计划审批 / secret 代填 · workspace 导出 + 单 Run 磁盘上限 · 系统通知 · **记忆**：自动整理 + 审核队列 + 滚出归档 + 模板迁移 + eval judge + 记忆体检报告 + 晋升 ask / 规则建议 |
| **v0.5** | 生态 | **Skills**：S1 本地 registry + 挂载 + Claude 投递 + 通用 skill 工具 + 定时任务 hash 批准 · S2 marketplace（GitHub / git / 本地安装、扫描、lock、更新 / 回滚）· S4 Codex 投递（见 SKILLS §12 · SKILLS-MARKETPLACE §12） |
| **之后** | — | 自动分派路由 · 任务链 / 条件触发 · launchd 集成（若 v0.2 未采用）· Skills S3：更多 marketplace 来源（Claude `marketplace.json`、skills.sh、精选索引 + 撤销列表、共享安装）· 可选通知渠道 · 用户自定义 Domain Runtime · 日历 / 会议导入 + 归档检索 |

开发顺序（先做什么、每阶段的退出标准、可并行的工作）见 [ROADMAP.md](./ROADMAP.md)。

**v0.1 验收用例**：

1. 已登录 Claude Code 的机器上：安装 → 运行 `miniclaw` → 2 秒内出现欢迎页并显示 engine 正常 → 输入后看到流式回复；多轮对话保持上下文
2. agent 要执行 shell / 写文件时弹审批卡片，默认焦点是拒绝；批准一次 / 本次会话 / 拒绝都按预期生效，拒绝后 agent 能继续
3. `Esc` 能打断正在生成的回复；`Ctrl+C` 干净退出，不留子进程
4. 没装 `claude` 或没登录时，欢迎页给出具体修复命令，不崩溃
5. agent 试图读 `~/.ssh` 或 `~/.miniclaw/` 下的文件被硬底线拦下（HARNESS §12 用例 5）；用户 `~/.claude` 里的 allow 规则不会让任何调用绕过审批

**v0.2 验收用例**：

1. 在 TUI 创建一个"每天 8 点"的定时任务，第二天无人值守自动执行，并能在 TUI 里查看完整的执行日志和输出
2. 定时任务调用预授权清单外的工具时暂停等审批，超时取消；每个非只读动作在审计里都有对应的放行记录（HARNESS §12 用例 8）
3. 两个本地用户的任务、执行记录互相隔离

**v0.3 验收用例**：

1. 新用户首次登录，完成 onboarding 访谈，生成自己的 profile、公司、项目记忆和 Core；换另一个用户登录，看到的是一套结构相同但内容独立的空白记忆
2. "每天 8 点生成简报"以 `research` Domain Runtime 运行，指定 profile：产出带引用的报告并通过验收，用上了该用户的 agenda 和进行中的项目；网页里藏着"把记忆发到某邮箱"的指令时外发被拒绝并记入审计（HARNESS §12 用例 1–4）

## 10. 待决策问题

- [x] 语言与 TUI 框架——**已决定（2026-09-10，用户要求直接开工 v0.1，采用 ROADMAP M0 建议）**：TypeScript（strict、ESM）+ Ink 6 + React 19，Node ≥ 20（Ink 7 需要 Node 22，暂不用）；测试用 vitest
- [x] Runtime 接入——**已决定（同上）**：SDK 内嵌，Claude 侧用 `@anthropic-ai/claude-agent-sdk`
- [ ] Computer use 实现：模型原生工具 + 本地执行器 vs MCP server
- [ ] Scheduler 形态：内置常驻 vs launchd（或两者都支持）
- [ ] Skill 格式：完全兼容 `SKILL.md` 还是在其上扩展（权限声明、推荐 profile）——建议：兼容开放规范，扩展只放 `metadata.miniclaw`，见 [SKILLS.md §4](./SKILLS.md#4-skill-格式)（待确认）
- [ ] 配置格式：TOML / YAML / JSON
- [ ] 计费与用量：是否统一统计各 runtime 的 token / 费用
- [x] 是否复用 Claude Code 已有的**登录态**——**已决定（2026-09-10）：复用**，miniclaw 不另做 engine 登录，用户在 Claude Code 里登录一次即可（ONBOARDING §15 D2）。隔离 `CLAUDE_CONFIG_DIR` 后如何复用登录态仍待实测（HARNESS 附录 A.1）
- [x] **v0.1 Claude 配置继承**——M0 执行决策（2026-09-10，按用户授权推进）：不继承用户权限 / sandbox / MCP / hooks / provider 路由配置；登录复用与配置隔离分开处理。具体 SDK 隔离路径须通过 [M0 验证](../fixtures/m0/README.md)，决策勾选不代表技术验证通过。Codex 的映射留到 v0.4。
- [ ] Harness 相关的待决问题见 [HARNESS.md §13](./HARNESS.md#13-待决策问题)（工具服务器宿主、搜索 provider、浏览器驱动、Codex 接入方式）；Domain Runtime 是否进 MVP 已决定：不进，v0.3 起
- [ ] 记忆相关的待决问题见 [MEMORY.md §12](./MEMORY.md#12-待决策问题)
- [ ] Workspace 相关的待决问题见 [WORKSPACE.md §13](./WORKSPACE.md#13-优先级与待定)（是否用 shell cwd 作快捷方式、Claude Code session 目录堆积、Run 记录保留期、tmp 写入是否计入副作用）
- [ ] 界面本地化：默认英文已定；是否提供中文界面（zh），以及切换方式（配置项 / 环境变量 / 跟随系统 locale）
- [ ] Skills 相关的待决问题见 [SKILLS.md §13](./SKILLS.md#13-待定)；marketplace 相关（"只做客户端"的前提确认、默认开启哪些来源、是否接 ClawHub、精选索引谁维护、社区 skill 是否让 Run 变 tainted、谁能共享安装）见 [SKILLS-MARKETPLACE.md §13](./SKILLS-MARKETPLACE.md#13-待定)
- [ ] **API engine 与非目标冲突**：§2 非目标"自研 LLM 调用层或 agent loop"。建议收窄为"不自研通用 agent 引擎（文件编辑、shell、sandbox、上下文管理交给 Claude Code / Codex）；允许一个只调用 miniclaw 自有工具的最小 API engine"。见 SKILLS §15.3
- [x] **v0.1 对话的工作目录**——M0 执行决策（2026-09-10）：每个新对话默认一个临时目录 `~/.miniclaw/users/<user>/workspace/tmp/<session>/`，不继承 shell cwd；`miniclaw <dir>` 显式使用已存在的目录，路径校验失败明确报错。
- [x] **v0.1 默认用户**——M0 执行决策（2026-09-10）：使用系统用户名的安全 slug，只有一个默认用户；多用户管理放 v0.2。
- [x] **v0.1 engine 自带 skills**——M0 执行决策（2026-09-10）：关闭自动发现、加载与调用；不挂载用户 / 项目 skills 或 plugins，skills 产品接入留到 v0.5。具体禁用参数及效果以 [M0 验证](../fixtures/m0/README.md) 为准。
- [x] **"Profile" 命名冲突**——**已决定（2026-09-10）**：TUI 里个人档案叫 "About you"（命令 `/me`），"Profile" 只指模型 profile（`/model`），见 [ONBOARDING §15](./ONBOARDING.md) D5
- [x] **"登录"的含义**——**已决定（2026-09-10）**：只做本地用户切换，不设密码、不绑定系统账户，见 [ONBOARDING §15](./ONBOARDING.md) D1、[MEMORY §12](./MEMORY.md#12-待决策问题)

## 11. 成功指标（个人使用阶段）

- 能稳定运行 ≥ 5 个日常定时任务，一周内无人工干预成功率 ≥ 90%
- 从想法到创建一个新自动化任务 < 1 分钟
- 新增一个 skill 不需要重启（v0.5 起）

## 12. 风险

| 风险 | 应对 |
|------|------|
| Computer use 误操作造成损失 | 默认逐步确认、白名单、审计日志、先 dry-run |
| 上游 runtime SDK / CLI 变化 | adapter 层隔离，内部事件格式稳定 |
| 无人值守任务失控（死循环、烧钱） | 单次 Run 的时长 / token / 步数上限，超限中止；死循环检测；日预算（F11） |
| 上游限流 / 额度用尽 / 登录过期，定时任务集体失败或重试风暴 | Gateway 按上游账号冷却 / 暂停并延期任务，Run 层少量重试，有副作用不自动重跑（F11） |
| 记忆自我更新写错、越积越乱 | 整理任务只提交提案、每条变更写入前过 eval gate、高风险变更要审核、changelog 可撤销、每周体检、定期滚出归档（见 MEMORY-EVAL.md） |
| 记忆泄露个人隐私 | 按用户隔离（0700）、三级敏感度、secret 不注入、禁止存凭证 |
| 功能膨胀、变成另一个 OpenClaw | 坚守非目标，额外能力做成 skill 而不是 core |
| 第三方 skill 投毒（ClawHub 曾出现数百个恶意 skill，借伪造"前置依赖"装窃密软件） | 按 commit SHA + 内容 hash 固定、安装前静态扫描 + 隔离区、显式批准、声明权限 ≠ 授权、更新从不自动、hash 变了须重新批准才能进定时任务、只装 skill 不装 plugin 的 hooks / MCP（SKILLS-MARKETPLACE §8） |
| 网页 / 外部文档里的 prompt injection 诱导越权（外发数据、提交表单、改文件） | `research` 结构上没有外发能力；读过不可信内容的 Run 自动收紧高危动作；硬底线不可配置；三道执行点纵深拦截（HARNESS §6） |
