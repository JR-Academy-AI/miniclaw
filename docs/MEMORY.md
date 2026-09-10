# miniclaw 记忆系统设计

> 版本：v0.1（草案）
> 日期：2026-09-10
> 模板位置：[`templates/memory/`](../templates/memory/)
> 关联：[PRD](./PRD.md) F9 · 记忆更新评估见 [MEMORY-EVAL.md](./MEMORY-EVAL.md) · 短期 → 长期晋升评估见 [MEMORY-PROMOTION.md](./MEMORY-PROMOTION.md)

---

## 1. 目标

miniclaw 的记忆是**工具级别**的记忆：它属于 miniclaw，保存登录用户本人的信息，不跟某个项目或某个 runtime 绑定。它的作用是为每个用户构建一套 **User OS**，让 agent 无论执行什么任务、用哪个模型，都知道"我在为谁工作、他现在在忙什么"。

需求：

1. 同时支持**长期记忆**和**短期记忆**
2. 记忆能**自我更新**：从日常会话和任务执行中自动沉淀、整理、淘汰
3. 做成**模板**：miniclaw 给别人用时，每个用户都从同一套模板实例化，结构一致
4. User OS 至少包含：个人信息 profile、agenda、会议记录、公司、项目

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| 工具级、与 runtime 无关 | 记忆由 miniclaw 管理并注入，Claude Code 和 Codex 读到的是同一份；不依赖任何 runtime 自带的记忆（如 `CLAUDE.md` / auto-memory） |
| 一个模板，多个实例 | `templates/memory/` 是唯一 schema；每个用户在 `~/.miniclaw/users/<user_id>/memory/` 有自己的实例，互相隔离 |
| 纯文本、人可读可改 | Markdown + YAML frontmatter；用户可以直接编辑，也可以用 git 管理 |
| 分层加载、控制上下文 | 越热的层越小、越常加载；冷数据只在检索时读取 |
| 自我更新但可控 | 日常先写短期层，由整理任务升级到长期层；高风险变更要用户审核；每次变更都可审计、可撤销 |
| 来源可追溯 | 每条事实都记录来源（哪次会话、哪个 Run、用户亲口说的） |

## 3. 分层

```
             注入方式                      容量     生命周期
┌────────────────────────────────────────────────────────────────┐
│ L0 Core        每次必注入                  ~1.5k tok  持续改写    │  core/CORE.md
├────────────────────────────────────────────────────────────────┤
│ L1 Working     runtime 上下文窗口            会话内     会话结束即弃 │  （不落盘）
├────────────────────────────────────────────────────────────────┤
│ L2 Short-term  注入最近 3 天摘要            ~2k tok   14 天后滚出  │  short-term/
├────────────────────────────────────────────────────────────────┤
│ L3 Long-term   注入 INDEX，条目按需读取    不限       长期，有状态  │  long-term/
├────────────────────────────────────────────────────────────────┤
│ L4 Archive     不注入，只能检索            不限       永久         │  archive/
└────────────────────────────────────────────────────────────────┘
```

| 层 | 存什么 | 谁来写 |
|----|--------|--------|
| **L0 Core** | 用户是谁、当前重点（Top 3）、未来 7 天日程、关键工作偏好、固定指令（"永远…/不要…"） | 整理任务（从 L3 汇总生成）；用户明确说"记住"时直接写 |
| **L1 Working** | 当前会话 / Run 的上下文 | runtime |
| **L2 Short-term** | 每日日志、每周汇总、**inbox**（候选记忆队列） | 任意会话 / Run 中的 agent |
| **L3 Long-term** | User OS 的 7 个领域（见 §4）+ INDEX | 整理任务；用户 |
| **L4 Archive** | 过期的短期日志、已结束的项目、旧会议、过去的 agenda | 滚出流程 |

各层的预算、保留期、加载方式都在 `manifest.yaml` 里配置，不写死在代码里。

## 4. User OS：长期记忆领域

| 领域 | 路径 | 形态 | 内容 |
|------|------|------|------|
| **profile** | `long-term/profile/` | 固定文件 | `identity.md` 身份与背景 · `preferences.md` 沟通、工作节奏、工具、对 agent 的行为偏好 · `goals.md` 长期、年度、季度目标 |
| **agenda** | `long-term/agenda/` | 滚动文档 | `agenda.md` 即将到来的日程、截止日期、周期性事项 · `todos.md` Now / Next / Waiting / Someday |
| **meetings** | `long-term/meetings/` | 一次会议一个文件 | 参会人、目的、笔记、决策、行动项（同步到 todos）、跟进 |
| **companies** | `long-term/companies/` | 一家公司一个文件 | 关系（雇主 / 自己的公司 / 客户 / 合作方 …）、业务、关键联系人、相关项目、时间线 |
| **projects** | `long-term/projects/` | 一个项目一个文件 | 状态、目标、当前进展、下一步、里程碑、决策记录、相关会议 |
| **people** | `long-term/people/` | 一人一个文件 | 关系、所在公司、关注点、互动记录（从会议自动追加） |
| **knowledge** | `long-term/knowledge/` | 一条一个文件 | fact / lesson（从 Run 学到的经验）/ feedback（用户对 agent 的纠正与肯定）/ reference（资源位置） |

> people 和 knowledge 是在你列的 5 个领域之外补充的：会议记录离不开"人"，自我改进离不开"经验与反馈"。

领域之间用 `[[domain/slug]]` 互相链接，比如一次会议链接到参会人、公司、项目，整理任务再把互动记录回写到 people 和 projects，形成一张关系网。

## 5. 模板与实例

```
repo: templates/memory/           ← 唯一模板（随 miniclaw 发布、版本化）
          │  首次登录：复制 + 填占位符 + onboarding
          ▼
~/.miniclaw/users/<user_id>/memory/   ← 用户实例（私有）
```

### 实例化流程

1. 用户首次登录 miniclaw，创建 `user_id`
2. 复制 `templates/memory/` 到用户目录，填写实例占位符（`{{user_id}}`、`{{created_at}}`、`{{template_version}}`）
3. 进入 **onboarding 访谈**（TUI 对话）：依次问身份、角色、公司、在做的项目、工作偏好、目标，写入 profile / companies / projects，生成第一版 CORE.md；最后问"有哪些事一定要记 / 不要记"，连同根据 profile 生成的派生标准（用户确认）写入 `meta/rubric.md`（见 ⑥）
4. 可选导入（后续版本）：日历 → agenda，会议转录 → meetings
5. `meta/state.yaml > onboarding_completed: true`

### 模板升级

- `manifest.yaml` 带 `template_version`（每次改动都升）和 `schema_version`（结构或 frontmatter 不兼容时才升）
- 启动时比较实例和模板的版本：
  - **增量变更**（新领域、新可选字段、新章节）：自动补齐，不覆盖用户内容
  - **破坏性变更**：先备份实例，再执行迁移脚本
- `_template.md` 保留在实例中，agent 随时能看到条目格式

### 多用户

- 同一台机器上可以有多个 miniclaw 用户，`~/.miniclaw/config.toml > current_user` 决定当前加载哪一份
- 不同用户的记忆、任务、执行记录完全隔离，只有 skills 可以全局共享

## 6. 条目格式

每条长期记忆都是一个 Markdown 文件，带统一的 frontmatter：

```yaml
---
id: projects/miniclaw        # domain/slug，全局唯一
type: project                 # 领域类型
created: 2026-09-10T20:30
updated: 2026-09-10T20:30
sources: [user, session:abc123, run:42]   # 来源
confidence: high              # high / medium / low
sensitivity: normal           # normal / private / secret
tags: []
# …各领域自己的字段（status、relation、attendees …）
---
```

- 字段名、文件名、章节标题统一用英文（跨用户、跨语言一致）；正文用用户偏好的语言
- 被取代的事实移到条目的 `## History`，不会被悄悄删除
- 时间统一用 ISO 8601，按 `identity.md` 里的时区

## 7. 读：加载策略

| 时机 | 注入内容 |
|------|----------|
| 每个会话 / Run | `PROTOCOL.md` + `CORE.md` + `long-term/INDEX.md` + 最近 3 天的短期摘要 |
| 任务涉及某个实体 | agent 通过 INDEX 找到条目，按需读取 |
| 任务声明了记忆范围 | Task / Schedule 可以声明 `memory_scope`，预加载指定领域（例如 daily-brief 预加载 `agenda/*` 和 `projects/*` 里 active 的） |
| 用户问起过去 | 检索 `archive/`（v0.1 用文件搜索，之后可加向量检索） |

`secret` 级别的内容永远不进入 prompt。

## 8. 写：自我更新流水线

```
 会话 / Run ──capture──► short-term/inbox.md + daily log      （capture 扫描：凭证就地打码）
                               │
                  promotion（按用户 rubric 打分，见 ⑥）
                               │ promote              ask ──► 问用户 · hold ──► 留在短期层 · discard
                               ▼
                  consolidate（会话结束 + 每晚 03:00）
                               │
                               ▼
                 meta/staging/ 变更提案（changeset）
                               │
                     eval gate（逐条评估，见 ⑤）
                               │ pass                 warn / block ──► review-queue
                               │                      drop ──► 丢弃并打码
         ┌─────────────────────┼──────────────────────┐
         ▼                     ▼                      ▼
   自动应用             需要审核（review-queue）     滚出 / 归档
 add / update /        delete / 冲突 / 身份变更 /    过期 daily → weekly → archive
 merge / rollout       覆盖用户明确说过的 / private   过去的 agenda → meetings / archive
         │                     │ 用户在 TUI 确认         结束的项目 → archive
         ▼                     ▼
   long-term/  ──刷新──►  INDEX.md + CORE.md ──► post-apply 检查
         │
         └──► meta/changelog.md（每次变更，可撤销）+ meta/eval-log.md（每条评估及结果）
```

### ① Capture（记录）

- 会话和 Run 中，agent **只写短期层**：追加每日日志，把候选事实写进 `inbox.md`（带来源、目标、操作、置信度、敏感级别）
- **例外**：用户明确说"记住…"、"以后都…"、"忘掉…"时，立即 stage 为 `by: user` 的变更，只跑确定性检查，通过后马上写入长期层并记 changelog

### ② Consolidate（整理）

由 miniclaw 自己的 scheduler 触发（会话结束 + 每晚一次），使用专门的 `memory` 模型 profile 执行：

1. 读取已晋升（`[>]`）的 inbox 候选；上次整理以来的日志只作上下文，不从中直接取新事实
2. 通过 INDEX 定位目标条目，没有就从 `_template.md` 新建
3. 决定操作：`add` / `update` / `merge` / `supersede` / `archive` / `delete`
4. 冲突裁决顺序：**用户明确说的 > 更新的 > 置信度更高的 > 来源更多的**；仍有歧义就进审核队列
5. 把变更（含刷新后的 INDEX 和 CORE，CORE 在预算内重写）写到 `meta/staging/`，**不直接改长期层**；一条变更对应一个目标文件
6. memory manager 逐条过 eval gate，应用通过的变更，写 changelog、eval-log，更新 `meta/state.yaml`

### ③ Rollout（滚出与淘汰）

- 超过 14 天的 daily 日志先汇总成 weekly，再移入 archive
- 已经过去的 agenda 事项：是会议的转成 meeting log，否则归档
- 状态为 done / archived 超过 30 天的项目、超过 180 天的会议移入 archive
- inbox 中已处理超过 7 天的条目清除

### ④ Review（审核）

- `manifest.yaml > consolidation.require_review` 定义哪些变更必须用户确认
- 待审核变更写入 `meta/review-queue.md`，在 TUI 里逐条批准或拒绝
- 所有变更都记在 `meta/changelog.md`，可以按变更 ID 撤销

### ⑤ Eval（评估）

> 完整设计见 [MEMORY-EVAL.md](./MEMORY-EVAL.md)，配置在 `manifest.yaml > eval`

审核队列只按操作类型拦截，eval 层评估**内容本身**，并度量整个自我更新流程的质量：

| 层 | 何时 | 作用 |
|----|------|------|
| **E1 Gate** | 每条变更写入前 | 确定性检查（schema、来源、凭证、`secret` 泄漏、静默丢事实、改固定指令）可以 block / drop；LLM judge（有没有依据、目标 / 操作 / 冲突裁决 / 敏感度是否正确）只能把变更送去审核 |
| **E2 Health** | 每周 + `/memory health` | 统计撤销率、审核拒绝率、eval 误报 / 漏报率、重复、断链、陈旧、预算占用、inbox 积压，写 `meta/health.md`，超阈值给出调整建议 |
| **E3 Regression** | 改整理 prompt / 模型 / 协议时 | 仓库内 golden 用例对比基线，隐私违规或分数退步不得合入 |

eval 只能收紧、不能放宽：`pass` 不绕过 `require_review`，eval 自身出错按 `warn` 处理。

### ⑥ Promotion（晋升评估：短期 → 长期）

> 完整设计见 [MEMORY-PROMOTION.md](./MEMORY-PROMOTION.md)，机制配置在 `manifest.yaml > promotion`，评分规则在每个用户的 `meta/rubric.md`

整理之前的一条独立 pipeline，判断每条短期候选**值不值得**进长期层（⑤ 的 E1 判断的是**写得对不对**）：

- **Rubric 四层，优先级从高到低**：隐私底线（不可配置）> 用户规则（`always` / `never` / `boost` / `lower`，只有用户能改）> 画像派生标准（从 profile、目标、当前重点、active 项目生成，只抬高 relevance）> 7 个基础维度加权打分（durability、relevance、actionability、impact、novelty、explicitness、confidence）
- **结果**：promote（交给整理）· ask（每天问用户几条"要记住吗？"）· hold（留在短期层，下次重新打分，反复出现会加分）· discard
- **规则的来源**：onboarding 时问"一定要记 / 不要记什么"并根据 profile 生成派生标准；用户随时说"以后 X 都记下来 / 别记 Y"就变成规则；profile 变化时重建派生标准；用户多次做出同方向的判断时提出规则建议，用户同意才生效
- 打分失败一律 hold：不写错，也不漏记

## 9. 隐私与安全

- 三级敏感度：`normal`（可注入）· `private`（可注入，但不外发、不写进通知）· `secret`（只存不注入）
- **禁止存储**：密码、API key / token、银行卡号、证件号、验证码。凭证交给系统钥匙串，不进记忆
- 每个用户的记忆目录只有本人可读（文件权限 `0700`）
- 用户可以随时导出全部记忆、清空某个领域、删除整个实例
- 对外发送类操作（通知、邮件）默认不带 `private` 内容

## 10. 与 runtime 的集成

- 创建会话 / Run 时，miniclaw 把 L0 + INDEX + 短期摘要 + PROTOCOL 拼进 system prompt
- agent 通过文件工具读写记忆目录，写权限只放开到 `short-term/` 和 `meta/staging/`；长期层和 CORE 只由 memory manager 在 eval 通过后写入
- 可选：把记忆操作封装成一组 MCP 工具（`memory.search` / `memory.capture` / `memory.read`），两种 runtime 共用，比直接放开文件访问更好控
- 关闭或隔离 runtime 自带的记忆机制，避免出现两份互相矛盾的"用户画像"

## 11. 里程碑

| 版本 | 范围 |
|------|------|
| **v0.1** | 模板 + 实例化 + onboarding 访谈 · L0 / L3 注入 · capture 到 inbox · 手动触发整理 · changelog · stage → eval → 应用的写入路径 + E1 确定性检查 + eval-log · E3 首批回归用例 · 晋升评估：rubric + onboarding 建规则 + 规则预判 + 打分（ask 先按 hold 处理）|
| **v0.2** | 自动整理（会话结束 + 每晚）· 审核队列 TUI · 滚出与归档 · 模板增量迁移 · memory MCP 工具 · E1 LLM judge · E2 体检报告 · E3 接入 CI · 每日 ask 卡片 · 派生标准自动重建 · 规则建议 |
| **v0.3** | 日历 / 会议转录导入 · archive 向量检索 · 撤销 UI · 破坏性迁移脚本 · 矛盾抽样检测 · judge 校准集 · 按语义聚类生成规则建议 · 长期条目读取统计 |

## 12. 待决策问题

- [ ] 记忆读写走文件工具，还是封装成 MCP 工具（或两者都支持）
- [x] "登录"的含义——**已决定（2026-09-10）**：只做本地用户切换，不设密码、不绑定系统账户（ONBOARDING §15 D1）
- [ ] 记忆目录是否默认初始化为 git 仓库（天然的版本历史和撤销）
- [ ] archive 检索：只用全文搜索，还是引入本地向量索引
- [ ] 整理任务用哪个模型：成本和准确度怎么平衡
- [x] 命名冲突——**已决定（2026-09-10）**：不改名；TUI 里个人档案叫 "About you"（命令 `/me`），"Profile" 只指模型 profile（`/model`）。记忆目录 `long-term/profile/` 保持原名（ONBOARDING §15 D5）
- [ ] 记忆正文的语言：跟随用户偏好（当前方案），还是统一用一种语言
- [ ] eval 层相关的待决问题见 [MEMORY-EVAL.md §10](./MEMORY-EVAL.md#10-待决策问题)，晋升评估见 [MEMORY-PROMOTION.md §10](./MEMORY-PROMOTION.md#10-待决策问题)
