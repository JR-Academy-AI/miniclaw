# miniclaw

> 轻量级的 OpenClaw —— 一个本地运行、用来执行各种 AI 自动化任务的 agent 环境。

miniclaw 不自己造 agent 引擎，而是把 **Claude Code** 和 **Codex** 的 agent runtime 包在一个轻量的编排层里：你在终端 TUI 里用一句话发起任务，或者把任务设成定时执行；miniclaw 负责选模型、加载 skills、控制权限、记录每一次执行。

> **状态**：第一阶段 TUI 与 Claude runtime 已实现，可运行无额度演示；本次真实请求被 session 额度限制阻挡。运行方法见[根 README](../README.md)，证据与边界见[展示验收](../fixtures/v0.1/README.md)。尚未发布完整 v0.1。

## 特性（规划中）

- **TUI 主入口**：对话、任务、定时、skills、模型，全在终端里完成；彩色的 [Reef 设计系统](./DESIGN.md)，深浅终端、16 色、无色、ASCII 都能正常显示
- **复用成熟 runtime**：底层是 Claude Code（Claude Agent SDK）/ Codex，不重复造轮子
- **多种 AI 自动化任务**：一次性任务、定时任务、网页 / 桌面操作、代码巡检、内容生成……
- **Schedule**：cron 或自然语言设置定时 / 周期任务，无人值守执行，结果可追溯
- **多模型路由**：按任务选 profile（写代码、computer use、深度推理、低成本批量），用合适的模型获得合适的能力
- **Computer use**：本机截屏、键鼠、应用、浏览器操作（macOS 优先）
- **Skills marketplace**（v0.5）：搜索、安装、更新第三方 skills，安装前展示来源和权限申请；兼容 `SKILL.md` 开放规范，也能导入已有的 `~/.claude/skills` 等目录
- **User OS 记忆**：为每个用户建立多层记忆（核心 / 短期 / 长期 / 归档），覆盖个人 profile、agenda、会议记录、公司、项目、人脉；能从日常使用中自我更新：按你自己的规则和 profile 判断哪些短期记忆值得长期保存，每次写入前都经过评估闸门，每周体检更新质量；所有用户共用同一套[记忆模板](../templates/memory/)
- **按任务类型的执行环境**（v0.3 起）：在 Claude Code / Codex 之上再包一层 [miniclaw harness](./HARNESS.md)——`research`（带引用的调研报告）、`document`（改前快照、可一键撤销）、`browser`（独立登录态、域名白名单）、`coding`（engine 直通）
- **安全可控**：按 capability 授权、deny 优先、硬底线不可配置、无人值守任务白名单、读过外部网页的任务自动收紧高危动作、完整审计日志
- **稳定不失控**：所有 Run 都经过 [Runtime Gateway](./GATEWAY.md)，统一处理限流、单次 Run 的 token / 费用 / 时长上限、错误分类与恢复；已经产生副作用的任务不会被自动从头重跑
- **干净的工作目录**：没指定目录的任务跑在 miniclaw 管理的[临时 workspace](./WORKSPACE.md) 里，按规则自动清理；交付物单独保存，想留的工作目录一条命令就能永久保存
- **本地优先**：配置、日志、记忆都存在本地

## 为什么不直接用 OpenClaw

OpenClaw 功能完整：多聊天渠道网关、插件系统、自带 LLM 层、记忆、skills、cron。miniclaw 只保留个人自动化最常用的部分，做到更轻：

| | OpenClaw | miniclaw |
|---|---|---|
| 入口 | 多聊天渠道 | TUI |
| Agent 引擎 | 自带 | 复用 Claude Code / Codex |
| Computer use | 浏览器为主 | 本机 computer use 是核心能力 |
| 复杂度 | 高 | 低 |

## 使用示例（设想）

```text
> 每个工作日早上 8 点，汇总我的日历和 GitHub 通知，生成一份简报
✓ Created schedule daily-brief  (cron: 0 8 * * 1-5, profile: thinker)

> /run organize-downloads --profile cheap
● Run #42 started …

> 打开 Numbers，把 ~/Desktop/sales.csv 做成柱状图并导出 PDF
◆ This task needs computer use. Allow for this session? [y/N]
```

## 核心概念

| 概念 | 说明 |
|------|------|
| **Runtime** | 底层 agent 引擎（Claude Code / Codex） |
| **Domain Runtime** | miniclaw 在 engine 之上为一类任务搭的执行环境（research / browser / document / coding） |
| **Profile** | runtime + provider + 模型 + 参数 + 能力标签 |
| **Skill** | 可动态加载的能力包 |
| **Task** | 一个可执行的任务定义 |
| **Schedule** | 任务的触发规则 |
| **Run** | 任务的一次执行记录 |
| **Memory** | 用户的 User OS，从统一模板实例化，按用户隔离 |

## 路线图

- [ ] **v0.1 MVP · 能用**：打开 TUI → 连上 Claude engine → 直接对话 · 流式输出、可中断 · 工具调用逐次审批 · engine 探测与修复提示
- [ ] **v0.2 · 可托付**：任务与执行记录 · Runtime Gateway · 权限引擎 · Workspace（临时目录 + 自动清理 + 保存）· 多用户 · 定时任务 + 常驻
- [ ] **v0.3 · 懂你**：Profile 与多模型 · 记忆模板 + onboarding 访谈 · 记忆写入评估闸门 · 记忆晋升 rubric · Domain Runtime：`coding` / `research` / `document`
- [ ] **v0.4 · 多引擎**：Codex adapter · 规则路由 · `browser` · computer use · 办公文档格式 · 系统通知 · 会话恢复 · 按额度提前降速 · 记忆自动整理 + 记忆体检 + 晋升问答 / 规则建议
- [ ] **v0.5 · 生态**：Skills + 第三方 marketplace 安装
- [ ] **之后**：自动分派路由 · 任务链 · launchd 集成 · 更多 marketplace 来源 · 可选通知渠道 · 日历 / 会议导入

## 项目结构

```
miniclaw/
├── AGENTS.md                  # 所有 AI agent（Codex、Claude Code……）的指令入口
├── CLAUDE.md                  # 只有一行 @AGENTS.md
├── CHANGELOG.md               # 变更记录（Keep a Changelog）
├── README.md                  # 第一阶段运行与演示说明
├── src/                       # v0.1 实现：core / adapters / infra / tui / app，按进度创建
├── fixtures/                  # 真实 SDK 样本及 M0 并行验证报告
├── package.json               # TypeScript / Ink / SDK 开发命令
├── rules/                     # 强制代码原则：SOLID · DRY · KISS/YAGNI · 补充原则 · 自检清单 · changelog · 子目录 AGENTS.md（维护规则见 rules/AGENTS.md）
├── docs/                      # 产品与设计文档（维护规则见 docs/AGENTS.md）
│   ├── README.md              #   本文件
│   ├── PRD.md                 #   产品需求总纲
│   ├── ROADMAP.md             #   开发顺序：阶段、依赖、退出标准
│   ├── ONBOARDING.md          #   首次启动 onboarding：engine 连接 + 个人档案访谈
│   ├── GATEWAY.md             #   Runtime Gateway：限流与错误控制
│   ├── HARNESS.md             #   两层 harness：Domain Runtime（research / browser / document / coding）+ 权限管理
│   ├── SKILLS.md              #   Skills：加载、挂载与多 runtime 投递、通用 skill 工具
│   ├── SKILLS-MARKETPLACE.md  #   Skills marketplace：第三方安装、lockfile、供应链安全
│   ├── WORKSPACE.md           #   Workspace：默认工作目录、临时目录清理、永久化
│   ├── MEMORY.md              #   记忆系统设计
│   ├── MEMORY-EVAL.md         #   记忆更新评估：写入闸门、体检、回归
│   ├── MEMORY-PROMOTION.md    #   记忆晋升评估：按用户 rubric 判断短期 → 长期
│   └── DESIGN.md              #   TUI 设计系统 Reef
├── design/                    # 设计系统（维护规则见 design/AGENTS.md）
│   ├── tokens.json            #   颜色 / glyph / 边框 / 动效 / 断点的唯一来源
│   └── preview/               #   零依赖终端预览原型（不是 TUI 实现）
└── templates/
    ├── workspace/
    │   └── PROTOCOL.md        # agent 使用 workspace 的规则（每个 Run 填好路径后注入）
    └── memory/                # 记忆模板：每个用户首次登录时实例化
        ├── manifest.yaml      #   分层、领域、保留期、自我更新、隐私规则
        ├── PROTOCOL.md        #   agent 读写记忆的规则
        ├── core/              #   L0 核心（每次都注入）
        ├── short-term/        #   L2 短期：inbox、每日 / 每周日志
        ├── long-term/         #   L3 长期 User OS：profile · agenda · meetings · companies · projects · people · knowledge
        ├── archive/           #   L4 归档（只检索）
        └── meta/              #   实例状态、变更日志、审核队列、晋升 rubric、eval 日志、体检报告
```

有自己 `AGENTS.md` 的目录（`rules/`、`docs/`、`design/`），旁边都会放一个只有一行 `@AGENTS.md` 的 `CLAUDE.md`。技术选型确定后，代码会按 `core/ · adapters/ · domains/ · infra/ · skills/ · tui/ · app/` 分层创建（见 `rules/04-other-principles.md`）。用户数据不在仓库里，而是在 `~/.miniclaw/users/<user_id>/`，结构见 [PRD §7](./PRD.md#7-架构初步)。

## 本地预览

可运行 TUI：`npm run demo` 使用无额度演示模式，`npm run dev` 连接真实 Claude；详见[运行说明](../README.md)。以下零依赖命令仅预览设计系统（Node ≥ 20）：

```bash
node design/preview/index.mjs welcome   # 彩色欢迎页（按任意键跳过动画）
node design/preview/index.mjs palette   # Reef 色板
node design/preview/index.mjs screen    # 工作界面示意
# 可选参数：--static --light|--dark --depth truecolor|256|16|none --width N --ascii
```

## 文档

- [PRD](./PRD.md) —— 产品需求、功能优先级、架构、里程碑、待决策问题
- [ROADMAP](./ROADMAP.md) —— 开发顺序：v0.1 能用 → v0.5 生态，各阶段内容、依赖、退出标准、可并行的工作
- [ONBOARDING](./ONBOARDING.md) —— 首次启动旅程：连上 engine、默认 Profile、About you 访谈、review 与写入、第一版 Core、起步任务
- [SKILLS](./SKILLS.md) —— Skills：第三方 marketplace（搜索 / 安装 / 更新）、统一 registry、按 Run 挂载、按 runtime 投递（Claude Code / Codex / …）；同一套 skills 也能通过 MCP 或直连模型 API 调用
- [SKILLS-MARKETPLACE](./SKILLS-MARKETPLACE.md) —— Skills marketplace 客户端：从 GitHub / Claude plugin marketplace / skills.sh 等来源安装第三方 skills，按提交固定 + 安装前扫描 + 显式批准（附第三方 skill 生态与安全事件调研）
- [Runtime Gateway](./GATEWAY.md) —— 限流、单 Run 预算、错误分类与恢复规则
- [HARNESS](./HARNESS.md) —— 两层 harness：engine 之上的 Domain Runtime（research / browser / document / coding）、capability 权限模型、三道执行点、审批与 prompt injection 防护
- [WORKSPACE](./WORKSPACE.md) —— 默认工作目录：临时目录、清理规则、保存为永久 workspace、external 目录登记
- [MEMORY](./MEMORY.md) —— 记忆系统设计：分层、User OS、模板与实例、自我更新
- [MEMORY-EVAL](./MEMORY-EVAL.md) —— 记忆更新评估：写入闸门、每周体检、离线回归
- [MEMORY-PROMOTION](./MEMORY-PROMOTION.md) —— 记忆晋升评估：短期候选是否进入长期记忆，按用户规则、profile 与重要程度打分
- [DESIGN](./DESIGN.md) —— TUI design system「Reef」：色板、glyph、组件、动效、彩色欢迎页
- [templates/memory/](../templates/memory/) —— 所有用户共用的记忆模板
- [templates/workspace/PROTOCOL.md](../templates/workspace/PROTOCOL.md) —— 每个 Run 注入给 agent 的 workspace 规则
