# miniclaw 首次启动 Onboarding：Profile Setup Journey

> 版本：v0.1
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) F9（Onboarding）· F5（Profile）· F11（engine 探测 / `/doctor`）· F1（TUI）· PRD §9 验收用例（新用户 onboarding、多用户隔离）
> 状态：草案。版本划分按 2026-09-10 重新划定的范围（v0.1 只含 chat，Profile 与记忆在 v0.3），以 [ROADMAP](./ROADMAP.md) 为准

---

## 0. 术语：两个 "profile"

本文同时涉及两种 profile，按 docs 约定区分：

| 本文写法 | 指什么 | 存在哪 | TUI 里怎么叫 |
|---|---|---|---|
| **Profile**（大写，= model Profile） | runtime + provider + 模型 + 参数（PRD F5） | `~/.miniclaw/users/<user_id>/model-profiles/` | `Profile`，命令 `/model` |
| **个人档案**（记忆 `profile/` 领域） | 用户本人的身份、偏好、目标（MEMORY §4） | `memory/long-term/profile/` | **`About you`**，命令 **`/me`** |

TUI 文案里**不把个人档案叫 profile**，避免和 `/model` 里的 Profile 混在一起（§15 D5，已决定）。

## 1. 背景与问题

miniclaw 的价值依赖两件事在第一次使用时就位：

1. **能跑**：找到 engine、登录可用、有一个默认 Profile。GATEWAY §14 列出的"终端里能用、miniclaw 找不到 claude"是最常见的首日故障
2. **认识你**：记忆里有 profile / 公司 / 项目 / CORE。没有这些，agent 每次都在"为陌生人工作"，简报类任务（MVP 验收用例 2）没有 agenda 和项目可用

PRD F9 只有一句"首次登录用 TUI 访谈填好 profile / 公司 / 项目，生成第一版 Core"；MEMORY §5、MEMORY-PROMOTION §4.1 各写了一部分；ROADMAP M0 把"onboarding 交互规格"和"`login` 的含义、新建用户、`doctor` 检查项"列为待补设计。本文把它们合成一条完整旅程，定义每一步的行为、数据落点、异常路径和验收标准。

## 2. 目标与非目标

### 目标

- **O1 首日可用**：第一次启动后 ≤ 10 分钟（中位数）完成第一次成功的 Run
- **O2 够用的个人档案**：核心路径 ≤ 6 分钟（中位数），产出身份、工作、1–3 个进行中项目、偏好、记忆规则和第一版 CORE
- **O3 永不挡路**：每一步都能跳过；老手可以直接输入任务开跑；中断后能从断点继续
- **O4 写对**：写进长期记忆的每个值都来自用户原话或经用户确认，不出现模型编造的事实
- **O5 隐私透明**：用户明确知道哪些回答会发给模型 provider，并且可以选择完全不外发

### 非目标（本文范围外）

- 日历 / 会议 / 邮件导入（MEMORY §5 第 4 步，v0.3）
- 在 onboarding 里配置权限或给任务授权：偏好里的"自主程度"**只进记忆，不产生任何 grant**（§11）
- 多 Profile 路由配置（F5 P1 规则路由）：onboarding 只建一个默认 Profile
- 云端账号、密码登录、绑定系统账户："用户"只是本地用户切换（§15 D1，已决定）
- miniclaw 自己的 engine 登录：直接复用 Claude Code 已有的登录态（§15 D2，已决定）
- 任何遥测：所有指标只在本地计算（§12）

## 3. 用户与场景

| # | 场景 | 期望 |
|---|------|------|
| U1 | 已经在用 Claude Code 的开发者，第一次打开 miniclaw | engine 自动识别为 `ready`，一路回车 5 分钟内完成，最后建好"每天早上的简报" |
| U2 | 装了 Claude Code 但 miniclaw 找不到（nvm / IDE 启动） | 在 onboarding 里看到"在哪找过、在哪找到、怎么写死路径"，不用离开 TUI 查文档 |
| U3 | 没装任何 engine | 不被卡死：可以先用 form 模式填完个人档案（全程不联网），engine 装好后回来继续 |
| U4 | 只想赶紧跑任务的老手 | 在欢迎页直接输入任务，onboarding 自动推迟；之后 `/onboarding` 随时补 |
| U5 | 在意隐私，不想把个人信息发给第三方模型（如 DeepSeek） | 选 form 模式，所有回答只写本地 |
| U6 | 同一台机器上的第二个用户 | `miniclaw user new` 走一遍同样的旅程，得到结构相同、内容独立的记忆（验收用例 3） |
| U7 | 一个月后换了工作 / 项目 | `/me` 查看、`/onboarding work` 重跑单个章节，旧值进 `## History`，不丢 |

## 4. 设计原则

1. **先能跑，再认识你**：engine 和默认 Profile 在访谈之前处理，因为 guided 访谈本身要用模型；engine 不可用时降级为 form 模式，不阻塞
2. **问题骨架确定，模型只做抽取**：问什么、写到哪个字段，由 miniclaw 固定定义（§7）；模型只把自由回答拆成字段，不决定问什么、不生成事实
3. **先 stage，后确认，再写入**：所有回答先落草稿，review 时用户看到将要写入的每一个文件，确认后才走 `by: onboarding` 写入路径（MEMORY-EVAL §3）
4. **每步可跳过、可返回、可中断**：必填项只有"怎么称呼你"和时区（自动检测，回车确认）
5. **不多问**：能自动检测的不问（时区、语言、OS、编辑器候选）；一个问题只填一组相关字段；核心路径 ≤ 12 次输入
6. **界面英文、内容原样**：miniclaw 输出的文案用英文（DESIGN §3.1）；用户可以用任何语言回答，记忆正文保留用户的语言
7. **偏好不是权限**：用户说"你可以自己做主"只写进 `preferences.md`，权限仍由 policy engine 按 HARNESS §6 决定，并在当步提示这一点

## 5. Journey 总览

```
 首次启动 miniclaw
      │
 S0 Welcome（首次版）──── 直接输入任务 ─────► 推迟 onboarding（U4），engine 可用就照常跑
      │ ⏎ start
 S1 Create user ─ 称呼 + user id → 建目录(0700) + 实例化记忆模板 + state: in_progress
      │
 S2 Engine & default Profile ─ L1–L3 探测 → 选 provider → 建默认 Profile → （可选）L4 试跑
      │ ready ─────────────────────────┐ not ready / skip
      ▼                                ▼
 S3 About you：guided 访谈        S3 About you：form 模式（不调用模型）
      │   3a Basics · 3b Work · 3c Projects · 3d Goals · 3e Upcoming
      │   3f Working style · 3g Agent behavior · 3h Memory rules
      ▼
 S4 Review ─ 按文件列出将写入的内容，逐项改 / 删 / 标敏感度
      │ ⏎ save
 S5 Apply ─ E1 确定性检查 → 写入 long-term + 生成 CORE + rubric（派生标准确认）
      │
 S6 First task ─ 3 个按档案定制的起步任务，默认推荐"工作日早间简报"
      │
 Done ─ state: completed · 进入正常欢迎页
```

| 步骤 | 目的 | 时间预算（中位数） | 可跳过 | 依赖 |
|------|------|-------------------|--------|------|
| S0 | 品牌 + 告诉用户接下来要做什么 | 5 s | ✅（推迟） | — |
| S1 | 建本地用户 | 15 s | ❌（没有用户就没有目录） | ROADMAP M1 用户管理 |
| S2 | 能跑 | 30–90 s | ✅ | M1 `doctor`、M2 Claude adapter + Gateway |
| S3 | 认识你 | 3–4 min | ✅（逐题 / 逐章节） | M6 记忆写入路径；guided 需 S2 ready |
| S4 | 确认 | 45 s | ❌（有待写内容时必经） | — |
| S5 | 落盘 | ≤ 5 s | — | M6 E1 gate |
| S6 | 首个价值时刻 | 30 s | ✅ | M4 scheduler（定时类）、M5 `research`（简报） |

**快速路径**（express）：S1 → S2 回车 → S3 只答 3a + 3b → S4 → S5，目标 ≤ 90 s。

**旅程按版本逐步拼起来**（详见 §14）：v0.1 只有 S0 + S2 的"连上 engine"部分，完成后直接进入 chat；v0.3 有了 Profile 和记忆之后，才补上 S1 的完整用户流程、S2 的 provider / 默认 Profile、S3–S6。每个版本的旅程都必须是完整可用的，不出现"下一步敬请期待"。

## 6. 各步骤需求

### S0 · Welcome（首次版）

在 DESIGN §8 欢迎页基础上，首次启动（`~/.miniclaw/config.toml` 不存在，或 `current_user` 为空）时替换状态卡片内容：

```
 ╭─────────────────────────────────────────────────────────────╮
 │ Welcome to miniclaw ✦                                v0.1.0 │
 │                                                             │
 │ ● runtime   Claude Code 2.1.4 · found via login shell       │
 │ ○ profile   none yet                                        │
 │ ○ about you not set up                                      │
 │                                                             │
 │ Let's get you set up. It takes about 5 minutes.             │
 ╰─────────────────────────────────────────────────────────────╯
   ⏎ start   s later   ? help   ⌃C quit
 ❯ Try "brief me every weekday at 8am"
```

- `runtime` 行显示**真实**的 L1–L2 结果（DESIGN §8.2：检查慢就一直转圈，不先显示 ✓）
- 输入框从第一帧起可用。用户直接输入任务：engine 与 Profile 可用 → 照常执行，onboarding 状态记为 `deferred`；不可用 → 回复 `Set up an engine first` 并进入 S2
- `s later`：状态记为 `deferred`。之后 3 次启动在欢迎卡片最后一行显示 `○ about you  not set up · /onboarding`，3 次后只在 `/me` 里提示，**不再打扰**
- 非 TTY / `CI`：永不进入 onboarding（§10）

### S1 · Create user

```
 What should I call you?
 ❯ Lightman
   user id  lightman   (used for your folder; letters, digits, -)
   ⏎ continue   tab edit user id
```

| 规则 | 值 |
|------|----|
| 默认 user id | 机器上还没有 miniclaw 用户时用 `$USER` 的 slug；否则用称呼的 slug |
| user id 校验 | `^[a-z0-9][a-z0-9-]{1,31}$`，不能与已有用户重复；非法时就地报错并说明规则 |
| 称呼 | 任意语言（按显示宽度对齐）；同时写入 `identity.md > Preferred name`，S3 不再问 |
| 执行 | 建 `~/.miniclaw/users/<user_id>/`（0700）→ 复制 `templates/memory/` 并填占位符（MEMORY §5）→ 写 `config.toml > current_user` → `state.yaml` 进入 `in_progress` |
| 失败 | 目录已存在但不是 miniclaw 用户目录 / 权限不足 → Fail Fast，显示路径、原因、修复命令，不覆盖任何文件 |

### S2 · Engine & default Profile

目的：得到一个 `ready`（或用户明确接受 `unverified`）的默认 Profile。MVP 只支持 Claude Code（PRD F2）；Codex 在 v0.2 加进本步。

**① 探测**：并行跑 GATEWAY §14.2 的 L1–L3，结果按 `ProbeResult` 原样展示：

```
 Set up your agent engine
 ✓ Claude Code 2.1.4   ~/.nvm/versions/node/v22.3.0/bin/claude
   found via login shell · also found 1.0.8 at /usr/local/bin/claude
 ? login               credentials found · not verified yet
   ⏎ continue   d details   p pin this path
```

| 探测结果 | 界面 | 用户可做 |
|---|---|---|
| `ready` / auth `unknown` | ✓ + 路径 + 来源；多份安装时列出其他版本（GATEWAY §14.1 #4） | ⏎ 继续；`p` 把路径写进 `runtimes.claude-code.path` |
| `not_found` | ✗ + 试过的每一处（`attempts`）+ 安装命令 | `r` 重新检查；`s` 跳过（S3 走 form 模式） |
| `not_runnable` | ✗ + stderr 摘要（如缺 `node`）+ 修复建议 | `r` / `s` |
| `unauthenticated` | ◆ + 该 engine 的登录命令，提示在另一个终端执行 | `r` / `s` |

- 等待用户修复时，每 5 s 自动重跑 L1–L3（与 GATEWAY §14.5 暂停期复查同一实现），通过即自动进入下一步

**② 选 provider**：

```
 Which model provider?
 ▸ Claude subscription (use my Claude Code login)      recommended
   Anthropic API key
   Anthropic-compatible: DeepSeek · Kimi · GLM · Volcengine ARK · custom
```

| 选项 | 需要用户提供 | 写入 |
|---|---|---|
| Claude subscription | 无（复用 Claude Code 的登录态，§15 D2 已决定；没登录时引导用户在 Claude Code 里登录，miniclaw 自己不做登录） | pool `claude-code/subscription` |
| Anthropic API key | **环境变量名**（默认 `ANTHROPIC_API_KEY`），不是 key 本身 | `[providers.anthropic-api]` + pool |
| Anthropic-compatible | 选预设（`base_url` 预填）或 custom 填 `base_url`；环境变量名；模型名 | `[providers.<id>]`（SKILLS §9 格式）+ pool |

- **凭证不经过 miniclaw 输入框**（PRD F8）：只填变量名，miniclaw 按 GATEWAY §14.4 在登录 shell 里检查它有没有值；没值 → 显示 `export DEEPSEEK_API_KEY=… in ~/.zshrc, then press r`
- 用户把 key 本身粘进任何输入框（匹配 `never_store` 的 key 模式）→ 立即清空该输入，提示 `That looks like a secret key. miniclaw never stores keys — set it as an environment variable instead.`，不写草稿、不写日志
- RPM、日预算等高级项**不在 onboarding 里问**，按 GATEWAY 默认值（RPM 未知 → 并发 1），可在 `/model` 里改

**③ 建默认 Profile**：

- 只建一个 Profile，默认名 `thinker`（使用 tokens 里已有的 profile 色），标 ★ 为全局默认；用户可改名
- 同时把记忆整理用的 `memory`、`memory-judge` Profile（`manifest.yaml > consolidation / eval`）**指向这个默认 Profile**，保证整理开箱可用；以后可在 `/model` 单独改
- 写 `model-profiles/<name>.toml` 与 pool 配置，经配置校验（Fail Fast），失败显示具体字段

**④ 试跑（L4，可选）**：

```
 Send one tiny test request to verify?   ~1 request · < $0.01 · uses your plan quota
   ⏎ test   s skip (profile stays unverified)
```

- 通过：显示实际模型 id、是否返回 usage / 费用；模型 id 与配置不一致 → `misrouted`，指出冲突来源文件和键（GATEWAY §14.1 #7），必须修好或换 provider 才能继续用 guided 模式
- 跳过：Profile 标 `unverified`，guided 访谈的第一次抽取就是事实上的 L4，失败时自动降级 form 模式

### S3 · About you（访谈）

**开场与模式选择**（只在 S2 ready 时出现；否则直接进 form 模式并说明原因）：

```
 Now a few questions about you, so every task starts with context.
 Answers go to thinker (Claude · subscription) to be structured, then saved
 only on this machine in ~/.miniclaw/users/lightman/memory/.
   ⏎ guided   f form only — nothing leaves this machine
```

| 模式 | 用户怎么答 | 模型参与 | 适用 |
|---|---|---|---|
| **guided**（默认） | 每题一段自由文本，任何语言 | 每题一次抽取 Run（下文），把回答拆成字段，用户确认 | 快、自然 |
| **form** | 逐字段填写；枚举字段用选择器 | 无 | engine 不可用、在意隐私、抽取失败时的降级 |

两种模式的**题目、字段、写入落点完全相同**（§7），只是输入方式不同。任何一题都可以 `tab` 在两种输入方式间切换。

**guided 单题交互**：

```
 3b · Work                                                    2 of 8
 What do you do, and where?
 ❯ 我是匠人学院的创始人，做面向华人的 AI 培训，也在做 miniclaw 这个开源项目

   Got it:
   role      Founder                          ✓
   company   匠人学院 (JR Academy) · own        ✓   → companies/jr-academy
   industry  Education · AI training          ? inferred
   ⏎ looks right   e edit   tab type fields instead   esc back
```

- 抽取值分两类：**stated**（能在原话里找到依据）标 ✓；**inferred**（原话里没有，如由"创始人"推出 relation=own 以外的字段）标 `? inferred`，默认**不选中**，用户按 `e` 勾选才写入
- 某题的关键字段没抽到（如 3c 的项目名）→ 最多追问 1 次，追问文案来自 §7 的固定模板，不由模型生成
- 用户回答为空、`skip`、`pass` 或按 `tab` 跳过 → 该题记为 skipped，不追问

**抽取 Run 的约束**（每题一次）：

| 约束 | 值 |
|------|----|
| 执行路径 | 走 Runtime Gateway（与所有 Run 一致），使用 S2 的默认 Profile |
| 能力 | **零 capability、不给任何工具**，只有文本输入 → JSON 输出；不创建 workspace，不 capture 到短期记忆 |
| 输入 | 该题问题 + 用户原话 + 该题字段 schema（§7）+ 已确认的称呼 / 公司名（用于链接）；**不注入 CORE 和其他记忆** |
| 预算 | 单轮，`max_tokens` 4k，超时 30 s |
| 输出校验 | 按字段 schema 校验；每个值附 `evidence`（原话片段），miniclaw 用代码核对片段确实出现在原话里，核对不上一律降级为 inferred |
| 失败 | 超时 / 非法 JSON / Gateway 拒绝 → 本题切换为 form 输入，提示 `Couldn't structure that — please fill the fields.`，不重试；连续 2 题失败 → 本次访谈剩余题目全部改 form |

**Secret 就地拦截**：每次输入提交时先跑 `privacy.never_store` 与 secret 扫描（MEMORY-EVAL E1 `never_store` / `secret_leak` 同一实现），命中则清空该输入并提示，**不发给模型、不写草稿**。

### S4 · Review

按目标文件分组，列出所有将写入的内容；这是写入长期记忆前的唯一确认点：

```
 Review — 7 files will be created                          ⏎ save all
 ▾ profile/identity        private   Lightman · Founder @ JR Academy · Sydney (AEST)
 ▸ profile/preferences     normal    English replies · concise · bullets · 9–18 Mon–Fri
 ▸ profile/goals           private   2 goals
 ▸ companies/jr-academy    normal    own · Education
 ▸ projects/miniclaw       normal    active · next: finish onboarding PRD
 ▸ agenda/agenda           normal    2 items in the next 14 days
 ▸ meta/rubric             —         2 user rules
   ↑↓ move   ⏎ expand   e edit   x drop   v sensitivity   b back to questions
```

- 每个文件可展开看**实际要写入的 Markdown**（按模板渲染后的结果），可逐字段编辑、整文件丢弃、改 `sensitivity`
- 敏感度默认值跟模板一致（`identity` / `goals` 为 `private`），用户只能在 `normal` / `private` 之间调；`secret` 不允许经 onboarding 写入
- 按 `b` 回到任意题目修改，review 列表随之刷新

### S5 · Apply

1. 每个文件拆成一条变更，`by: onboarding`、`src: user`，写入 `meta/staging/`
2. memory manager 逐条跑 E1 **确定性检查**（MEMORY-EVAL §4.1），通过即应用（onboarding 与用户明确指令同一路径，不进审核队列）；`block` 的变更就地展示原因并回到 S4 修改，不静默丢弃
3. 按 §8.3 规则**用代码生成** `core/CORE.md`，校验不超过 `budget_tokens`（1500）
4. 刷新 `long-term/INDEX.md`
5. 写 rubric 用户规则（3h 的回答，`src: onboarding`）；engine 可用时运行 rubric builder 生成画像派生标准，列出来让用户逐条取消（MEMORY-PROMOTION §4.1 第 3 步）；engine 不可用则标 `derived: pending`，engine 首次 ready 后在欢迎卡片提示补做
6. `meta/changelog.md` / `meta/eval-log.md` 各记一条；`state.yaml` 标记完成（§8.4）
7. 结果页：`✓ Saved 7 files · Core ready (612 / 1500 tokens)`，`/me` 可随时查看

### S6 · First task

给出 3 个按档案定制的起步任务，默认焦点在第一个：

```
 You're set. Want to try one of these?
 ▸ ◷ Weekday morning brief — agenda + miniclaw progress, Mon–Fri 08:00
   ● Summarize what changed in ~/Documents/sites/miniclaw this week
   ● Draft next week's plan from your goals
   ⏎ create   ↑↓ choose   s skip — I'll type my own
```

- 候选由**固定规则**生成，不调用模型：简报（有工作时间 → 取上班前 1 小时，否则 08:00；内容取 agenda + active 项目）· 项目相关的一次性任务（有带本地路径的项目时）· 基于 goals 的计划任务
- 选中后进入正常的"新建任务"流程，包括 HARNESS §6.6 的**权限清单逐条确认**；onboarding 不预授权任何东西
- 定时类候选依赖 M4 scheduler；尚未就绪的版本不显示该候选

## 7. 访谈题目与字段映射

guided 与 form 共用。★ = 核心路径（express 只问 3a、3b）。

| 章节 | 问题（界面英文原文） | 写入 | 字段 | 自动检测 / 默认 | 追问模板（缺关键字段时） |
|------|----------------------|------|------|-----------------|------------------------|
| ★ 3a Basics | `Where are you based? (timezone detected: Australia/Sydney)` | `profile/identity` | Location · Timezone · Languages | 时区取系统设置；语言取 locale + 回答所用语言 | — |
| ★ 3b Work | `What do you do, and where?` | `profile/identity`、`companies/<slug>` | Current role · Company（链接）· Industry · Responsibilities；公司 `name` · `relation` · `industry` | — | `Which company or organization is that?` |
| ★ 3c Projects | `What are you working on right now? Up to 3 things.` | `projects/<slug>` × 1–3 | `name` · `status: active` · Goal · `my_role` · `company` · Next actions · `target_date` · `links`（本地路径 / repo） | — | `What's the name of that project?` |
| 3d Goals | `What are you aiming for this quarter, and this year?` | `profile/goals` | This quarter · This year | — | — |
| 3e Upcoming | `Anything coming up in the next two weeks? Deadlines, trips, big meetings.` | `agenda/agenda` | 日期 + 事项 | 相对日期按 3a 时区换算成 ISO | `When is that?` |
| 3f Working style | `How should I talk to you and when do you work?` | `profile/preferences` | language · Tone · Verbosity · Output format · Working hours | language 默认 = 回答所用语言；OS / 编辑器由探测填入候选，用户确认 | — |
| 3g Agent behavior | `How much should I do on my own? Anything I should always check with you first?` | `profile/preferences` > Agent behavior；可选升为 CORE Standing instructions | Autonomy level（ask-first / act-then-report / autonomous within whitelist）· Always confirm before · Things I don't want the agent to do | — | — |
| 3h Memory rules | `Anything I should always remember, or never keep?` | `meta/rubric` > User rules | `always` / `never` + match，`src: onboarding` | — | — |

- 3g 答完固定显示一行：`This shapes how I work with you. What I'm allowed to do is still decided per task — you'll approve permissions when you create one.`（原则 7）
- 3g 里明确的 always / never 句子，在 S4 中默认勾选"加入 Standing instructions"，用户可取消
- 3c 的 `links` 如果是本地目录，只记录路径，**不读取目录内容**，也**不登记为 external workspace**（登记需用户另行 `/workspace` 操作，WORKSPACE §2）
- people 领域（关键联系人）不在 v0.1 访谈中（P1，§13）

## 8. 数据与写入

### 8.1 草稿

- 位置：`memory/meta/staging/onboarding/draft.yaml`（用户目录内，0700），记录当前步骤、每题原话、抽取结果与确认状态、模式
- 每题确认后立即落盘，保证中断可恢复
- S5 成功后删除草稿；用户在恢复提示里选 `discard` 也删除
- 草稿里的原话同样先过 secret 扫描（S3），命中的输入不落盘

### 8.2 写入规则

| 规则 | 说明 |
|------|------|
| 写入路径唯一 | onboarding 代码只能写 `meta/staging/`，落盘由 memory manager 完成（MEMORY-EVAL §3），与整理任务同一条路径 |
| 一文件一变更 | 每个目标文件一条变更，单独过 E1、单独可撤销 |
| 来源 | frontmatter `sources: [user]`；用户确认过的值 `confidence: high`；changelog 记 `by: onboarding` |
| 不删除 | onboarding 只做 `add` / `update`；重跑时旧值移入条目的 `## History`（MEMORY §6），项目"不再做了"改 `status`，不删文件 |
| Profile 配置 | S2 写入的 `model-profiles/`、`[providers.*]`、pool 配置属于 miniclaw 配置，由 onboarding 代码直接写并过配置校验；agent 永远不可见（HARNESS §6.4 硬底线） |

### 8.3 CORE 生成（确定性，不调用模型）

| CORE 章节 | 来源 | 规则 |
|---|---|---|
| Who | identity + preferences | `Name` = Preferred name（Full name）；`Role / Company` 链接 `[[companies/slug]]`；时区；偏好语言 |
| Current focus | active projects | 按 3c 的回答顺序，最多 3 条，每条 `[[projects/slug]]` + 一句 Goal |
| Next 7 days | agenda | 3e 中落在 7 天内的事项；没有则留空 |
| Working style | preferences | 最多 5 条：语言、语气、详略、输出格式、工作时间 |
| Standing instructions | 3g 中用户勾选的 always / never | 原话照录，标注只有用户能删除 |

超过 `budget_tokens` 时按 Working style → Next 7 days → Current focus 的顺序截断，并在被截断处留 `[[profile/preferences]]` 等链接。

### 8.4 状态字段

`meta/state.yaml` 需要新增（模板增量改动，升 `template_version`，见 §14）：

```yaml
onboarding_completed: false        # 保留，兼容已有读取方
onboarding_status: not_started     # not_started / in_progress / deferred / completed
onboarding_version: 1              # 题库版本；题库变化后可提示"有新问题"
onboarding_completed_at: null
onboarding_skipped: []             # 跳过的章节，如 [3d, 3e]；/me 据此提示补填
```

## 9. 中断、恢复、跳过、重跑

| 情况 | 行为 |
|------|------|
| `⌃C` / 关闭终端 / 崩溃 | 草稿已按题落盘；下次启动显示 `Pick up where you left off? (3c · Projects)  ⏎ resume  n start over  x discard` |
| 跳过整个 S3 | S4 只剩 S1 写入的称呼；`onboarding_status: completed`、`onboarding_skipped` 列出全部章节；CORE 只有 Who |
| 推迟（S0 `s later`） | `deferred`；提醒规则见 S0 |
| `/onboarding` | 未完成 → 恢复；已完成 → 以当前档案预填全部答案，只对改动产生 `update` |
| `/onboarding <section>` | 只重跑一个章节（如 `/onboarding work`），同样经过 S4 review |
| `/me` | 只读展示 About you 摘要（称呼、工作、当前重点、偏好、记忆规则数）和被跳过的章节；每块旁边给出对应的 `/onboarding <section>` |
| 题库升级（`onboarding_version` 变化） | 欢迎卡片提示一次 `2 new questions · /onboarding`，只问新增题目 |

## 10. 异常与降级

| 场景 | 行为 |
|------|------|
| engine 未安装 / 不可运行 / 未登录 | S2 展示原因和修复命令，可自动复查；跳过则 S3 走 form 模式，S5 的派生标准标 `pending` |
| Profile `misrouted` | 必须修好或换 provider 才能用 guided；可选择继续 form 模式 |
| 抽取 Run 失败 | 单题降级 form；连续 2 次失败整场降级（S3） |
| 额度用尽 / 限流（`QUOTA_EXHAUSTED` / `RATE_LIMITED`） | 不等待，直接降级 form，提示原因与恢复时间 |
| E1 `block` | 回到 S4，定位到出问题的文件与字段，显示检查名和原因 |
| 非 TTY / `CI` / 管道输出 | 不进入 onboarding；`miniclaw run` 照常执行（空 CORE），每天第一次在 stderr 打印一行 `hint: run miniclaw in a terminal to finish setup` |
| 终端 < 66 列 | 单栏；review 列表只显示文件名 + 敏感度；按键提示用短词 |
| `NO_COLOR` / ASCII | 抽取结果的 ✓ / `?` 用 `v` / `?`，状态不只靠颜色（DESIGN §9） |
| 两个 miniclaw 实例同时 onboarding 同一用户 | 草稿文件加锁；第二个实例提示 `Setup is running in another window` 并只读 |

## 11. 隐私与安全

- **外发告知**：guided 模式开始前明确显示回答会发给哪个 Profile / provider；provider 是第三方兼容端点时文案加上 provider 名（如 `Answers go to cheap (DeepSeek) …`）
- **只外发当前这一题**：抽取 Run 不带 CORE、其他记忆、文件内容
- **secret 不入口**：输入时拦截（S3），与 E1 `never_store` / `secret_leak` 同一实现，不另写一份（`rules/02-dry.md`：安全判断出现第 2 次就必须收敛）
- **偏好 ≠ 授权**：onboarding 不写 policy、不写 grant；`autonomous within whitelist` 只是记忆里的偏好。偏好能否**收紧**策略（如"发邮件前总要问我"自动变成 `ask`）见 §15 D6，**任何情况下都不能放宽**
- **目录权限**：用户目录 0700；草稿与记忆同权限
- **审计**：S2 的 L4 试跑与每次抽取都是正常 Run，事件、usage 记入 Run 日志，可在 Tasks 面板看到（标签 `onboarding`）

## 12. 成功指标

miniclaw 本地优先，**不采集遥测**。指标来自两处：本机的 onboarding 事件（写入 Run 日志与 `meta/changelog.md`，`/onboarding stats` 可查看）；发布前 5–8 人的可用性测试。

| 指标 | 目标 | 数据来源 |
|------|------|----------|
| 完成率（进入 S1 → S5 成功） | ≥ 80% | 可用性测试 |
| 核心路径完成时间（中位数） | ≤ 6 min；express ≤ 90 s | 本地事件时间戳 |
| 首次启动 → 首个成功 Run（中位数） | ≤ 10 min | 本地事件 |
| U1 / U2 用户在 TUI 内达到 engine `ready` 的比例（不查外部文档） | ≥ 90% | 可用性测试 |
| 核心字段填充率（完成者） | ≥ 80% | `onboarding_skipped` + 字段统计 |
| 抽取准确率 | 字段级 ≥ 95%；**未被标为 inferred 的编造值 = 0** | 离线回归集（§13 E3 用例） |
| onboarding 写入的条目 7 天内被撤销的比例 | ≤ 10% | `meta/changelog.md` 中 `by: onboarding` 的 undo |

## 13. 验收用例

1. **U1 快乐路径**：已登录 Claude Code 的新用户，一路回车 + 回答 8 题，≤ 6 分钟得到 identity / preferences / goals / 1 个 company / 2 个 project / agenda / rubric 规则 / CORE；随后在 S6 创建简报定时任务，并经过权限清单确认（对应 PRD §9 的新用户 onboarding 与简报验收用例）
2. **U2 找不到 engine**：`claude` 只在 nvm 下、miniclaw 从 IDE 启动 → S2 显示"经登录 shell 找到"及其他版本，`p` 写死路径后继续
3. **U3 无 engine**：S2 跳过 → S3 form 模式 → 完成；抓包 / 日志证明全程没有任何模型请求；之后装好 engine，欢迎卡片提示补做派生标准
4. **中断恢复**：在 3c 按 `⌃C`，重启后 `resume` 回到 3c，已答内容全部保留
5. **secret 拦截**：在 3a 粘贴一个 `sk-…` key → 输入被清空并提示；草稿、Run 日志、eval-log 中都不存在该字符串
6. **防编造**：回答"我在做 miniclaw"，抽取返回 `company: Anthropic`（无依据）→ 该值被标 inferred、默认不写入
7. **偏好不放权**：3g 选 `autonomous within whitelist`，之后运行一个需要 shell 的任务，仍弹出审批卡片
8. **U6 第二用户**：`miniclaw user new` 建 `alice` → 走完 onboarding → 两个用户的记忆结构一致、内容互不可见（PRD §9 多用户隔离验收用例）
9. **重跑不丢**：`/onboarding work` 把角色从 Founder 改为 CEO → `identity.md` 当前值更新，`## History` 多一行旧值，changelog 有一条 `by: onboarding` 的 `update`
10. **离线回归（E3）**：抽取器 prompt 或模型变更时，跑固定的 onboarding 回答样本集（中英混合、含无依据诱导、含 secret），满足 §12 抽取准确率门槛才能合入（与 MEMORY-EVAL §7 同一套机制）

## 14. 优先级、里程碑与需要同步的改动

版本按 2026-09-10 重新划定的范围：v0.1 chat · v0.2 任务 / policy / Gateway / scheduler · v0.3 Profile + 记忆 + Domain Runtime · v0.4 Codex / browser / computer use · v0.5 skills。优先级（P0/P1/P2）以 PRD §5 为准，阶段编号以 ROADMAP 为准。

| 版本 | 本文内容 | 依赖 |
|------|---------|------|
| **v0.1** | **S0** 首次欢迎卡片（`runtime` 行真实探测）· **S2 ①** Claude Code L1–L3 探测、找不到 / 没登录时的修复指引与自动复查、`p` 写死路径 · **S2 ④** L4 试跑（此时验证的是 engine 本身，不建 Profile）→ 完成后直接进入 chat | engine 探测（GATEWAY §14）· TUI 骨架 |
| **v0.2** | S0 在"直接输入任务"时的推迟逻辑接入任务流程；L4 试跑与抽取类 Run 统一走 Gateway | Gateway · Task / Run |
| **v0.3** | **S1** 建用户（若用户目录在更早版本已有，只补个人档案部分）· **S2 ②③** provider 预设 + 默认 Profile + `memory` / `memory-judge` 指向 · **S3** form + guided（抽取 Run、防编造核对、secret 就地拦截）· **S4** review · **S5** apply + CORE 生成 + rubric 规则与派生标准 · **S6** 起步任务（简报依赖 `research` Domain Runtime 与 scheduler）· 恢复 / 跳过 / 重跑 · `/me` · `/onboarding [section]` | 记忆模板 + 写入路径 + E1 · model Profile · rubric（MEMORY-PROMOTION）· scheduler |
| v0.4 | S2 加入 Codex engine 与 OpenAI 系 provider · computer use 的 macOS 权限引导（辅助功能、屏幕录制） | Codex adapter · computer use |
| v0.5 | 询问 skills 导入来源（SKILLS 中"建议 onboarding 时询问"一条） | Skills |
| 待排期 | 粘贴简介 / 简历一次性抽取多个字段 · people 章节 · 通知方式偏好 · `miniclaw onboard --from answers.toml` · 日历 / 会议导入填 agenda、meetings | 各自对应的功能 |

v0.1 的旅程只有两屏：欢迎卡片 → engine 连接 → chat。§6 S2 的 ②③ 在 v0.1 不出现，S2 ① ④ 的交互与本文一致。

**实现前需要同步的改动**（按 `docs/AGENTS.md` 的同步规则，定稿时一起做）：

- `templates/memory/meta/state.yaml`：新增 §8.4 的字段（增量改动，升 `template_version`）
- `docs/MEMORY.md` §5 实例化流程第 3 步：链接到本文，并写明 CORE 由代码按 §8.3 生成
- `docs/DESIGN.md` §8：补首次启动版状态卡片与 `○ about you` 检查行；§6 组件表补"抽取结果行"（✓ / `? inferred`）
- `docs/GATEWAY.md` §14.5：补"onboarding S2"作为一个探测时机（L1–L3 + 可选 L4）
- `docs/ROADMAP.md` M0"补设计"：onboarding 交互规格一项标记为已由本文覆盖

## 15. 待决策

| # | 问题 | 选项 | 建议 |
|---|------|------|------|
| D1 | "登录"的含义（MEMORY §12） | 本地用户切换 / 加密码 / 绑定系统账户 | ✅ **已决定（2026-09-10）：只做本地用户切换**，不设密码、不绑定系统账户；S1 按此设计 |
| D2 | 是否复用 Claude Code 的登录态（PRD §10） | 复用 / 隔离 | ✅ **已决定（2026-09-10）：复用**。miniclaw 不另做 engine 登录，S2 只检测并引导用户在 Claude Code 里登录；"Claude subscription" 是默认推荐选项。权限类配置是否继承是另一个问题，仍按 HARNESS §6.5 的建议（不继承）待定 |
| D3 | guided 与 form 哪个作默认 | guided / form / 按 provider 决定 | guided 为默认焦点，但开场一屏必须同时给出 form 选项和外发说明 |
| D4 | 凭证输入方式 | 只填环境变量名 / 存入 macOS 钥匙串（HARNESS §6.8 secret 引用） | v0.1 只填环境变量名；钥匙串随 secret 代填在 v0.2 评估 |
| D5 | TUI 里个人档案的叫法 | `About you` + `/me` / `Profile` + `/profile` | ✅ **已决定（2026-09-10）：`About you` + `/me`**，"Profile" 在界面上只指模型 profile（`/model`）；不改名任何概念或目录，记忆目录仍是 `long-term/profile/`（MEMORY §12 同步关闭） |
| D6 | 3g 的"总要先问我"是否可以自动收紧 policy | 只进记忆 / 经确认生成一条 `ask` 规则 | v0.1 只进记忆；v0.2 可在 S4 给出"也把它设为权限规则？"选项，只能收紧 |
| D7 | 抽取 Run 属于哪个 Domain Runtime | 复用整理任务的内部 Run 类型 / 新增 `onboarding` 定义 | 与整理任务共用内部 Run 类型（零 capability），不新增 Domain Runtime |
| D8 | 默认 Profile 名 | `thinker` / `default` / 按模型推断 | `thinker`，复用 tokens 里已有的 profile 色 |
