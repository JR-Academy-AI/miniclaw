# miniclaw 开发顺序（Roadmap）

> 版本：v0.2（草案）
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) §5 功能 · §9 里程碑 · §10 待决策
> 状态：草案。**范围以 PRD §9 为准**，本文只管"先做什么、后做什么、每一步做到什么程度算完"

---

## 0. 排序原则

1. **先有一个能用的版本**（2026-09-10 决定）：v0.1 只做"打开 TUI → 连上 Claude engine → 直接对话"，做完就能每天用；profile、记忆等放到后面的版本
2. **按用户价值分版本**：v0.1 能用 → v0.2 可托付（无人值守跑任务不出事）→ v0.3 懂你（profile、记忆、领域）→ v0.4 多引擎 + 操作网页 / 电脑 → v0.5 生态（skills marketplace）
3. **按依赖排**：被依赖的先做。policy engine 的 effect 分类是 Gateway 副作用闸门的前提（HARNESS §6.2 · GATEWAY §7.1）；数据模型和事件 schema 是任务、定时、记忆的前提；Domain Runtime 契约（M5）是按 domain 路由（M7）和 `browser`（M8）的前提
4. **v0.1 的简化必须能长大，不能推倒**：权限、错误分类、engine 探测先做子集，但接口按专题文档的最终形态定，后续版本只加规则、不换接口
5. **先验证，再定稿**：文档里标"待实测"的，在对应阶段开工前用真实 SDK 抓样本存成 fixture
6. **每个阶段都有可演示的退出标准**；没达到不进下一阶段

> **M 编号是工作包 ID，不代表执行顺序**：其他文档按编号引用（如 PRD F6 → M10），所以已有编号的内容不变，新增工作包往后编号（M11、M12）。执行顺序以 §1 为准。

## 1. 总览（执行顺序）

```
v0.1 能用     M0 最小决策 + 验证 ──► M11 TUI + Claude 对话 ═══════════════════► 发布

v0.2 可托付   M1 地基 ──► M2 执行主链路 ──► M3 任务视图 ──► M4 定时 + 常驻 ═════► 发布
              数据模型     policy·Gateway    Run 列表 / 详情   无人值守
              store·用户   ·直通 Run         审批升级到 policy

v0.3 懂你     M12 profile + 多模型 ──► M6 记忆 ──► M5 Harness：Domain Runtime
                                                   coding / research / document ══► 发布

v0.4 多引擎   M7 Codex + 路由 ──► M8 browser + computer use ──► M9 记忆自动化 /
                                                             通知 / 办公格式 ═══► 发布

v0.5 生态     M10 Skills + Marketplace（S1–S4）═══════════════════════════════► 发布
```

各版本内部基本串行；可并行的地方见 §3。

## 2. 阶段明细

### v0.1 · 能用：TUI + Claude 对话

#### M0 · 决策与验证（v0.1 只定用得到的）

其余决策推迟到用到它的阶段开工前（§4）。

| 决策 | 当前建议 |
|------|---------|
| 语言 + TUI 框架 | TypeScript + Ink：Claude Agent SDK 官方有 TS 版本，设计原型已是 Node |
| engine 接入：SDK vs 驱动 CLI | Claude Agent SDK |
| 登录与配置 | **登录复用已决定（2026-09-10，ONBOARDING §15 D2）**：用用户已有的 Claude 登录。配置继承仍待定，建议**不继承**用户 `~/.claude` 里的权限规则、MCP、hooks，以免绕过 miniclaw 的审批（HARNESS §6.5） |
| 对话在哪个目录里跑 | 默认每个对话一个临时目录 `~/.miniclaw/users/<user>/workspace/tmp/<session>/`（WORKSPACE §0，不继承 shell cwd）；`miniclaw <dir>` 显式指定目录 |
| 用户 | 只有一个默认用户（系统用户名），多用户放 v0.2 |
| engine 自带 skills | 关闭，skills 在 v0.5 才接入 |

**技术验证**（Claude Agent SDK，存成 `fixtures/`）：

- 多轮会话、流式事件、思考 / 工具调用事件、中止
- 执行点 ②（HARNESS 附录 A.1，已按官方文档核实，这里实测）：PreToolUse hook 能否逐次问 miniclaw；只下发 deny 时 `canUseTool` 能否收到 `ask`；隔离 `CLAUDE_CONFIG_DIR` 后怎么复用登录态；`allowed-tools` 会跳过 `canUseTool` 但绕不过 PreToolUse hook（SKILLS §10）
- 未登录 / 额度用尽 / 限流 / 过载时的报错原文（GATEWAY 附录 A.1）
- usage：逐条 `message.usage`、按 `message.id` 去重（状态栏显示 token / 费用）
- 登录检查方式、`settings.json` 的 `env` 与进程环境变量的优先级（GATEWAY §14）

v0.2 开工前再补：result subtype、原生限额、sandbox 配置、第三方 provider 下的费用、附录里其余"待实测"项。

**退出标准**：上表写进 PRD §10；fixture 存档。

**2026-09-10 执行记录**：最小产品决策已写入 PRD §10，三路验证见 [M0 workflow](../fixtures/m0/README.md)。完整 `CLAUDE_CONFIG_DIR` 隔离下的原登录复用、部分 Hook 组合、限流 / 过载真实终止样本尚未齐全，严格 M0 不标通过。用户后续明确要求先交付可展示的 TUI + runtime 第一阶段；其实现、实测和账户额度阻挡见[展示验收](../fixtures/v0.1/README.md)，不代表完整 v0.1 发布。

#### M11 · 最小可用对话（新增）

| 内容 | 依据 | 不做（留给后续版本） |
|------|------|---------------------|
| 脚手架、`git init`、lint / test / CI、`miniclaw` 命令可安装 | `rules/` | 打包分发（brew / 单文件） |
| **首次启动 + engine 探测**：欢迎卡片上的 `runtime` 是真实检查；Claude Code 按 L1 定位 → L2 可执行 → L3 已登录逐级探测，失败时列出试过的每一处和可照做的修复命令，每 5 秒自动复查，`p` 固定路径；可选 L4 端到端测试请求；通过后直接进入对话，不建 Profile、不做访谈 | GATEWAY §14 · 附录 A.1 · ONBOARDING §6 S0、S2 ①④ | 多 engine、Profile、About you 访谈 |
| **Claude adapter 最小版**：多轮会话、流式输出、中止；启动时显式设置重试 / 超时环境变量，不继承 shell 里的 provider 配置 | GATEWAY §11、§14、附录 A.1 | 续跑、`compile(HarnessSpec)` |
| **错误分类子集**：`AUTH` · `QUOTA_EXHAUSTED` · `RATE_LIMITED` · `OVERLOADED` · `NETWORK` · `UNKNOWN`，只用于在 TUI 里说清楚出了什么问题 | GATEWAY §6 | 自动重试、pool 冷却 |
| **权限最小版**（Claude engine 自带 Bash / Edit / Write，所以最小版也必须满足下列各条）：① **隔离用户 engine 配置**：`settingSources: []`、`strictMcpConfig: true`，不传 `allowedTools`、不下发任何 allow 规则（被自动放行的调用会跳过 `canUseTool`，用户 `~/.claude` 里一条宽松规则就能绕过 miniclaw）；② **PreToolUse hook**（matcher `.*`）是唯一的逐次闸门；③ `decide()` 最小规则集：命中硬底线直接 deny（HARNESS §6.4：`~/.ssh`、`~/.aws`、`~/.gnupg`、钥匙串、`.env*`、`~/.miniclaw/` 全部状态与策略 / 授权文件、硬删除）→ 只读工具 allow → 其余 `ask`，弹审批卡片（`once` / `session` / `deny`，默认焦点拒绝），不持久化白名单；④ `permissionMode: 'default'`，禁用 `bypassPermissions` / `acceptEdits` / `auto` / `dontAsk`；⑤ 每次调用都写 `policy.decided` 事件，审计不变量（HARNESS §6.9）从第一天成立。M2 在同一接口上换成完整 policy engine | HARNESS §6.1、§6.4、§6.6、§6.9、附录 A.1 | capability 词表、grant、taint、白名单持久化 |
| **TUI**：欢迎页（真实启动检查）· 对话视图（流式 Markdown、思考折叠、工具调用行）· 审批卡片 · 输入框（多行）· 状态栏（模型、本次 token / 费用）· `Esc` 中断 · `/help` `/clear` `/exit` · Reef tokens · 英文界面文案 | DESIGN 全文、§3.1 | 任务 / 定时 / Skills / 模型面板 |
| 对话记录落盘（JSONL 事件），方便排查 | — | 回放、导出、会话恢复 |

**退出标准（= v0.1 验收，同 PRD §9）**：

1. 已登录 Claude Code 的机器上：安装 → 运行 `miniclaw` → 2 秒内出现欢迎页并显示 engine 正常 → 输入后看到流式回复；多轮对话保持上下文
2. agent 要执行 shell / 写文件时弹审批卡片，默认焦点是拒绝；批准一次 / 本次会话 / 拒绝都按预期生效，拒绝后 agent 能继续
3. `Esc` 能打断正在生成的回复；`Ctrl+C` 干净退出，不留子进程
4. 没装 `claude` 或没登录时，欢迎页给出具体修复命令，不崩溃
5. agent 试图读 `~/.ssh` 或 `~/.miniclaw/` 下的文件被拒绝（HARNESS §12 用例 5）；用户 `~/.claude` 里的 allow 规则不会让任何调用绕过审批
6. 真彩 / 256 / 16 色 / `NO_COLOR` / ASCII、50–120 列宽度下显示正常

### v0.2 · 可托付：任务、权限、定时

目标：定时任务可以放心交给它无人值守地跑。

#### M1 · 地基

| 内容 | 依据 |
|------|------|
| 补设计：统一数据模型（Task / Schedule / Run / Grant / 事件 schema，合并 GATEWAY §9.2、HARNESS §6.9、WORKSPACE 的事件）与存储、engine adapter 契约（含提示词拼装顺序与总预算）、TUI 交互规格（视图、斜杠命令总表、新建任务流程；onboarding 已由 ONBOARDING.md 覆盖）、scheduler、用户与安装（`login` 已定为本地用户切换，ONBOARDING §15 D1） | 上次评审列出的缺口 |
| 配置加载与校验框架：未知字段报错、指出配置项（Fail Fast） | GATEWAY §10 · HARNESS §7 |
| 用户目录与用户管理：新建 / 切换 / `current_user`，目录权限 0700 | PRD §7 · MEMORY §5 |
| 领域模型、Run 事件 schema、store：Task / Run / 事件日志持久化 | 本阶段数据模型设计 |
| Workspace：三种 workspace、四个路径、janitor、删除安全规则 | WORKSPACE §13 |
| composition root；时钟、文件系统、进程作为可注入依赖 | `rules/01-solid.md` DIP |
| `miniclaw doctor` 完整版：暂停中每 5 分钟自动复查、修好即恢复 | GATEWAY §14 |

**退出标准**：两个用户目录互相隔离；配置校验和 janitor 有表驱动单测。

#### M2 · 执行主链路

按依赖顺序：

1. **policy engine**（纯函数）：capability 词表 + effect、`decide`、grant 合并、完整硬底线、taint 状态转移，替换 M11 的最小规则集 — HARNESS §6
2. **Claude adapter 补全**：续跑、`classify`、把 policy 编译进 engine 配置（执行点 ①②：只下发 deny、PreToolUse hook 逐次问 policy engine、隔离用户 engine 配置）— GATEWAY §11、附录 A.1 · HARNESS §11、附录 A.1
3. **Runtime Gateway**：errors → budget → run-guard → admission（含 RPM 推导并发）→ pool-health → recovery → gateway 编排；usage 返回 — GATEWAY §4、§5、§7、§11、§15
4. **直通 Run + 审计事件**：Task → policy 授权 → adapter → Gateway → 事件落盘。没有 Domain Runtime 层（没有 playbook、领域工具、verdict），`HarnessSpec` / `compile` 在 M5 才引入 — HARNESS §11
5. **无头入口**：`miniclaw run "<prompt>"`；无 TUI 时 `ask` 一律按拒绝处理

**退出标准**：GATEWAY §12 场景 3（死循环）、7（崩溃恢复）、8（token 超限）；HARNESS §12 用例 5（硬底线）；Claude classifier 用 fixture 跑契约测试全部正确；审计不变量（任何 effect ≠ `read` 的动作都有对应 `allow` 决定，HARNESS §6.9）。

#### M3 · TUI 扩展：任务视图

- 任务视图（Run 列表 / 详情 / 取消、`needs_attention` 置顶）· pool 状态 · 权限时间线 · `/grants` `/audit` · 斜杠命令框架补全
- 审批卡片接到 policy engine（`t` 加入任务白名单）
- **退出标准**：每个失败 / 中止 / 取消的原因都能在 TUI 查到

#### M4 · 定时任务与常驻

- 进程模型（**本阶段开工前拍板**，见 §4）
- scheduler：cron + 自然语言、时区、错过补跑、`overlap` / `max_delay` 与 Gateway 准入衔接；定时视图 — PRD F4 · GATEWAY §4
- 自然语言新建任务；**创建时的权限清单**（无人值守只能用预授权 capability）— HARNESS §6.6
- **退出标准（= v0.2 验收）**：定时任务无人值守按时执行，结果在 TUI 可见；越出预授权 → `waiting_approval` → 超时 `CANCELLED(approval_timeout)`；GATEWAY §12 场景 1、4、9

### v0.3 · 懂你：profile、记忆、领域

#### M12 · Profile 与多模型（新增，手动选择）

- Profile = engine + provider + 模型 + 参数 + 能力标签；provider 配置（官方 / 兼容端点）；Quota Pool 映射；`/model` 切换、任务级指定、全局默认值 — PRD F5 · SKILLS §9 · GATEWAY §3
- onboarding 的模型部分：provider 预设 + 默认 Profile，`memory` / `memory-judge` 指向它 — ONBOARDING §6 S2 ②③
- 顺手修文档矛盾：Profile 的存放位置（`model-profiles/` · `profiles/*.toml` · `[profiles.*]`）；PRD §6 补 Provider / Quota Pool
- **退出标准**：同一对话里切到另一个 provider 的模型继续聊；两个 profile 共用一个账号时共享同一个 pool 的限额

#### M6 · 记忆

- 模板实例化 + 版本号 — MEMORY §5
- **完整 onboarding 旅程**：创建用户（S1）→ About you 访谈（form / guided 两种模式；抽取 Run 零 capability + 证据检查，S3）→ review（S4）→ 经 E1 写入、由代码生成 CORE、rubric 用户规则与派生标准（S5）→ 起步任务（S6）；可中断恢复 / 跳过 / 重跑，`/me`、`/onboarding [section]` — ONBOARDING §6–§9
- 注入：按 M1 定下的拼装顺序把 PROTOCOL + CORE + INDEX + 短期摘要交给 Claude adapter；`memory_scope` 作为 `memory.read` capability — MEMORY §7 · HARNESS §6.2
- capture：每日日志 + inbox + `never_store` 扫描打码 — MEMORY-EVAL §4.1
- 手动整理：stage → E1 确定性检查 → 应用 → changelog / eval-log → post-apply 检查 — MEMORY-EVAL §3–4
- 晋升评估：rubric 模板 + onboarding 建规则（访谈题 3h + 画像派生标准确认，ONBOARDING S5）+ 规则预判 + 打分（ask 先按 hold 处理）+ `op: rule` 捕获 + 手动 `/memory rubric rebuild`；整理任务只读 `[>]` 候选 — MEMORY-PROMOTION §9
- E3 首批回归用例（手动运行）— MEMORY-EVAL §7
- **退出标准**：新用户完成 onboarding 生成自己的 Core；换用户后看到的是独立的空白记忆；定时简报用上了 agenda 和进行中的项目

#### M5 · Harness：Domain Runtime

- Domain Runtime 契约 + registry + 生命周期；引入 `HarnessSpec` / `compile`；`coding` 直通改为走契约 — HARNESS §4、§5.4
- MCP 工具服务器宿主；`research`：`mc-research`（search / fetch、SSRF 防护、引用 verifier、taint）— HARNESS §5.1
- `document` 基础版：`mc-docs`（md / txt / csv / json、快照、回收站、`/undo`、爆炸半径）— HARNESS §5.3
- **退出标准（= v0.3 验收）**：HARNESS §12 用例 1–4

### v0.4 · 多引擎与操作网页 / 电脑

#### M7 · 第二个 engine + 路由

- Codex adapter：run / 事件 / 续跑、classifier（附录 A.2）、`compile`（HARNESS 执行点 ①②，含"逐次审批能否做到"的结论）
- **Codex 的记忆 / playbook 注入方案**：Codex SDK 没有系统提示词选项（SKILLS §2.3），需要单独定方案
- 规则路由：按 domain、需要的 capability 选 profile；`fallback_profiles`；会话恢复；额度遥测提前降速
- API engine（**待确认**，与 PRD 非目标"不自研 agent loop"冲突，见 PRD §10 · SKILLS §15）
- onboarding S2 增加 Codex 与 OpenAI 系 provider — ONBOARDING §6
- **退出标准**：HARNESS §12 用例 7（同一任务在 Claude 和 Codex 上 `policy.decided` 序列一致）

#### M8 · 网页与电脑操作

- `browser` Domain Runtime：`mc-browser`、独立浏览器 profile + 手动登录、`allowed_origins`、submit 审批、trace — HARNESS §5.2
- computer use（F7）：先写设计（执行器选型、macOS 权限、`doctor` 检查、逐步审计 + 截图），并解决它与 HARNESS `desktop` Domain Runtime（P2）的归属矛盾；onboarding 增加 macOS computer use 授权步骤（ONBOARDING §6）
- **退出标准**：HARNESS §12 用例 6

#### M9 · 记忆自动化、通知、办公格式、授权增强

- 记忆：自动整理（每晚 + 会话结束）、审核队列 TUI、滚出归档、模板迁移、E1 judge、E2 体检、E3 接入 CI、晋升的每日 ask 卡片 / 派生标准自动重建 / 规则建议 — MEMORY §11 · MEMORY-EVAL §9 · MEMORY-PROMOTION §9
- 系统通知（F10）
- `document` 办公格式（docx / xlsx / pptx / pdf）+ `render_preview`
- 彩排授权、计划审批、secret store 代填、外发内容检查、验收修复回合 — HARNESS §11
- Workspace P1：`/workspace export`、单 Run 磁盘上限

### v0.5 · 生态：Skills + Marketplace

#### M10 · Skills + Marketplace

> 阶段 S1–S4 以 [SKILLS.md](./SKILLS.md) §12 和 [SKILLS-MARKETPLACE.md](./SKILLS-MARKETPLACE.md) §12 为准。v0.5 交付 S1 + S2 + S4，S3 在之后

- **S1**：本地 registry + 按 Run 冻结挂载 + Claude 投递；通用 skill 工具（`list_skills` / `activate_skill` / `read_skill_resource`，经 `mc-skills` MCP 提供，SKILLS §14）；定时任务用到的 skill hash 变了须重新批准
- **S2 Marketplace**：从 GitHub / git / 本地路径搜索、安装、更新、固定、回滚、卸载；lockfile（commit SHA + 内容 hash）；安装前扫描 + 隔离区 + 信任层级 + 显式批准（SKILLS-MARKETPLACE §4–§8）
- **S4**：Codex 投递（依赖 M7）
- 开工前：把 SKILLS-MARKETPLACE §3.2 列出的改动合并进 SKILLS §5–§7、§11；HARNESS §6.4 硬底线加上 marketplace 目录（lockfile、staging、隔离区）
- TUI skills / marketplace 视图；onboarding 增加"从哪些目录导入 skills"的问题（ONBOARDING §6）
- 注：SKILLS 作者建议 skill 工具协议 + `mc-skills` 与 Codex adapter（M7）同批交付，因为 Codex 靠 `mc-skills` 激活 skills。按"skills 放最后"的决定排在 v0.5；需要提前时只把这一小块挪进 M7

### 之后（P2）

自动分派路由 · 任务链 / 条件触发 · launchd 集成（若 M4 未采用）· 更多 marketplace 来源 · 用户自定义 Domain Runtime · `desktop` Domain Runtime · 日历 / 会议导入 · 归档检索 · 可选通知渠道 · 更多 engine（OpenCode / Gemini CLI）

## 3. 并行建议

| 版本 | 可并行的工作 |
|------|-------------|
| v0.1 | M11 的 TUI 用假事件流开发，与 Claude adapter 同时进行，最后接上 |
| v0.2 | M3 任务视图可在 M1 事件 schema 定下后与 M2 并行 |
| v0.3 | M6 记忆的模板实例化 / onboarding 不依赖 M12，可以并行 |
| v0.4 | M8 browser 不依赖 M7 Codex，可以并行 |

## 4. 推迟的决策（到对应阶段开工前拍板）

| 决策 | 最晚在 | 当前建议 |
|------|--------|---------|
| 配置格式 | M1 | TOML（各文档已统一用 TOML 示意） |
| 进程模型 / scheduler 形态 | M4 | ① 单进程，TUI 开着才跑，启动时补跑；② core 常驻（launchd 托管）、TUI 作客户端。倾向 ②，G2 无人值守才名副其实 |
| MCP 工具服务器宿主（含 `mc-skills`） | M5 | HARNESS §13：进程内本地 MCP 端点 vs 每 Run 独立 stdio 进程 |
| 搜索 provider | M5 | HARNESS §13 |
| Codex 逐次审批 / 注入方式 | M7 | HARNESS §13 · SKILLS §13 |
| API engine 是否做 | M7 | 待用户确认（PRD §10） |

## 5. 专题文档里的版本标注对照

各专题文档写于重排之前，文中的"MVP / v0.1 / v0.2"指旧的版本划分。**以本文和 PRD §9 为准**：

| 文档 | 文中写法 | 现在属于 |
|------|---------|---------|
| GATEWAY §13 | MVP（v0.1） | v0.2（v0.1 只取 §14 engine 探测和 §6 错误分类的子集） |
| GATEWAY §13 | P1 | v0.4 |
| WORKSPACE §13 | MVP | v0.2（v0.1 只用"每个对话一个临时目录"） |
| WORKSPACE §13 | P1 | v0.4 |
| MEMORY §11 · MEMORY-EVAL §9 · MEMORY-PROMOTION §9 | v0.1 / v0.2 / v0.3 | v0.3 / v0.4 / 之后 |
| SKILLS §12 · SKILLS-MARKETPLACE §12 | S1–S4（post-MVP） | S1 · S2 · S4 → v0.5；S3 → 之后 |
| DESIGN | 欢迎页、对话、审批卡片、状态栏 | v0.1；其余面板随各自功能交付 |

专题文档下次修改时顺手把标注改成新版本号，然后删掉本表对应行。

## 6. 维护规则

- 调整功能范围或优先级：先改 PRD §5 / §9，再改本文对应阶段，同一次改动（`docs/AGENTS.md`"必须同步的地方"）
- M 编号只增不改；新增工作包往后编号
- 阶段完成：在本文对应阶段标题后注明完成日期，并在 `CHANGELOG.md` 记录
- 本文不写工期估算；需要时按阶段单独评估
