# miniclaw Runtime Gateway：限流与错误控制规则

> 版本：v0.1（草案）
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) F2（runtime 适配层）· F4（scheduler 并发 / 重试）· F8（权限）· §12 风险"无人值守任务失控"
> 状态：规则已定义，技术选型未定；文中代码为 TypeScript **示意**，不代表最终语言

---

## 0. 这里的 Gateway 指什么

**不是** OpenClaw 那种把聊天渠道接到 agent 的网关（那是 miniclaw 的非目标）。

miniclaw 的 **Runtime Gateway** 是 core 通往 runtime adapter 的**唯一出口**：交互任务、定时任务、记忆整理任务，只要要启动一个 Run，都必须经过它。绕过 gateway 直接调 adapter 视为设计错误。

miniclaw 自己不调 LLM API——Claude Code / Codex runtime 才调，而且它们内部已经会对单次 API 调用做重试。所以 miniclaw 能控制、也必须控制的是四件事：

| 职责 | 回答的问题 | 模块 |
|------|-----------|------|
| 准入（Admission） | 这个 Run **现在能不能开跑**？不能就排队 / 延期 / 拒绝 | `admission` |
| 单 Run 护栏（RunGuard） | 这个 Run **最多能跑多远**？超了就中止 | `run-guard` |
| 错误归类（Classify） | 失败了，**是哪一类错误**？ | 各 adapter 的 `classify` |
| 恢复决策（Recovery） | 这类错误**接下来怎么办**？重试 / 续跑 / 延期 / 失败 / 冷却上游 | `recovery` + `pool-health` |

Gateway **不做**：换 profile / 换模型（router 的事）、决定何时触发（scheduler 的事）、权限判断（policy engine 的事）、改写 prompt、重试单次 API 调用（runtime 的事）。

## 1. 六条总原则

1. **安全优先于成功率**：宁可让任务失败并清楚地告诉用户，也不自动重放一个可能已经产生副作用的 Run（§7.1）
2. **只在一层重试**：runtime 已经对单次 API 调用重试；miniclaw 只在 Run 层重试，次数少、间隔长，避免重试放大（retry storm）
3. **上游说几点恢复，就等到几点**：有 `retryAfter` / `resetAt` 就严格遵守，不猜、不抢跑
4. **先归类，再处理**：adapter 负责把原始错误翻译成统一的 `ErrorKind`；恢复策略只看 `ErrorKind`，不认识任何具体 runtime（OCP）
5. **无人值守更严**：定时任务的默认限额更紧，且**不允许**配成"无上限"
6. **每个决定都留痕**：排队、延期、拒绝、限额告警、重试、冷却，全部写进 Run 事件日志，TUI 可见，进程重启不丢

## 2. 位置

```
 TUI（交互） / Scheduler（定时） / Memory consolidator（整理）
                    │ submit(RunRequest)
                    ▼
 task runner ──► router（选 profile → runtime + pool）
                    │
                    ▼
 ┌───────────────── Runtime Gateway ─────────────────┐
 │ admission   准入：并发槽 · 启动速率 · 日预算 · 排队     │
 │ run-guard   护栏：轮数 · token · 费用 · 时长 · 死循环  │
 │ recovery    纯函数：GatewayError + 上下文 → 决策       │
 │ pool-health 上游账号状态：healthy / cooling / paused  │
 └──────────────────────┬────────────────────────────┘
                        │ AgentRuntimeAdapter + ErrorClassifier
              ┌─────────▼──┐  ┌──────────────┐
              │ Claude Code │  │    Codex     │
              └─────────────┘  └──────────────┘
```

## 3. 核心概念：Quota Pool（上游额度池）

**Pool = 一份共享的上游额度**，按 `(user, runtime, account)` 划分。例如：

- alice 的 Claude 订阅登录态 → pool `alice/claude-code/subscription`
- alice 配的 Anthropic API key → pool `alice/claude-code/api-key`
- alice 的 ChatGPT 登录态 → pool `alice/codex/chatgpt`

规则：

- 限额挂在 **pool** 上，而不是 profile 上。`thinker` 和 `cheap` 如果用的是同一个 Claude 账号，就共享同一个 pool——上游的限额是按账号算的，分开计数必然超
- profile → pool 的映射由 profile 配置决定（`pool = "..."`），router 选出 profile 后 pool 随之确定
- pool 按本地用户隔离，不同用户之间永不共享（与 PRD"多本地用户彼此隔离"一致）
- pool 状态只有三种：`healthy` · `cooling(until)` · `paused(until | manual)`（§8）

## 4. 准入规则（Admission）

### 4.1 限流维度与默认值

| 作用域 | 规则 | 默认值 | 为什么 |
|--------|------|--------|--------|
| 全局 | `max_concurrent_runs` | 2 | 每个 runtime 子进程占几百 MB，本机资源兜底；保守起步 |
| pool | `rpm_limit` | 未知 | 上游账号每分钟请求数上限，按套餐 / 控制台填写；订阅和多数第三方不公开，留空即"未知" |
| pool | `max_concurrent` | **由 RPM 推导（§4.4）**；`rpm_limit` 未知时为 **1** | 一个 Run 会连续发很多请求，并发必须压在 RPM 以下 |
| pool | `scheduled_max_concurrent` | `max(1, max_concurrent − 1)` | **给交互任务留一个槽**；`max_concurrent = 1` 时留不出槽，交互只能在队列里优先 |
| pool | `starts_per_minute`（令牌桶） | 6，突发 3 | 整点多个定时任务 + 补跑同时触发时削峰 |
| pool | `unattended_daily_tokens` | 3,000,000 | 无人值守每日总量上限，防止一夜烧光额度 |
| pool | `unattended_daily_cost_usd` | 5.00（仅 runtime 报告费用时生效） | 同上，按钱计 |
| 能力 | computer use 并发 | **固定 1，不可配置** | 只有一块屏幕、一套键鼠，两个 agent 同时操作必然互相破坏 |
| 能力 | 同一浏览器 profile 并发 | **固定 1，不可配置** | 两个 Run 共用一份登录态和 cookie 会互相踩（HARNESS §5.2）；全局浏览器并发 `browser.max_concurrent` 默认 2 |
| 能力 | 同一 workspace 目录并发 | **固定 1，不可配置** | 两个 agent 同时改一个目录必然互相破坏；按 realpath 判断，适用于 saved / external / 对话共享的 tmp（WORKSPACE §3） |
| 任务 | 同一 task 并发 | **固定 1，不可配置** | PRD F4：同一任务不重叠 |
| 任务 | `overlap`（上一次还没跑完时） | `skip` | 可选 `queue_one`（最多再排一个），不允许无限堆积 |
| 队列 | `max_queue_length` | 20 | 满了直接拒绝（`QUEUE_FULL`），不无限堆 |
| 队列 | 交互任务最长排队 | 2 分钟 | 超时就告诉用户原因，由用户决定 |
| 队列 | 定时任务 `max_delay` | 30 分钟（任务级可改） | 超过这个延迟还没开跑，本次记为 `skipped` |

> 以上是初始默认值，没有真实数据支撑。MVP 跑两周后按每个任务的 p95 轮数 / token 校准（§13）。

### 4.2 准入判定顺序（纯函数，顺序固定）

`admit(request, gatewayState, now) → granted | queued(position) | deferred(until) | skipped(reason) | rejected(reason)`

按顺序检查，**第一条不通过的决定结果**：

| # | 检查 | 定时任务 | 交互任务 |
|---|------|---------|---------|
| 1 | pool `paused`（额度用尽 / 未登录 / runtime 不可用） | 恢复时间在 `max_delay` 内 → `deferred(resetAt)`；恢复时间未知 → `deferred`，等到 `max_delay` 仍未恢复则 `skipped`；否则 `skipped` | `rejected`，提示原因和修复方式（几点恢复 / 登录命令 / 探测结果，§14），可 `/model` 换 profile |
| 2 | pool `cooling` | `deferred(cooldownEnd)` | `queued`，TUI 显示倒计时，可取消 |
| 3 | 无人值守日预算用尽；或 pool 不计量且未声明 `allow_unmetered`（§15.5） | `rejected(DAILY_BUDGET / UNMETERED)` | 不适用（只约束无人值守 Run；交互用量照常统计，TUI 可见） |
| 4 | 同一 task 在跑 | 按 `overlap`：`skipped` 或 `queued` | `rejected`，提示已有一个在跑 |
| 5 | 并发槽（全局 / pool / 定时份额 / computer use / 浏览器 profile / workspace）已满，或 pool 实测 RPM 超水位（§4.4） | `queued` | `queued`（排在所有定时任务前面） |
| 6 | 启动速率令牌桶 | `queued` | `queued` |
| 7 | 队列已满 | `rejected(QUEUE_FULL)` | `rejected(QUEUE_FULL)` |

队列排序：**交互任务优先**，定时任务按计划触发时间 FIFO。

### 4.3 实现要点（保持简单）

- 并发：计数信号量；启动速率：令牌桶；日预算：按本地时区零点重置的计数器
- 用量是**事后**才知道的（runtime 跑完一轮才报 usage），所以日预算只在**准入时**检查，运行中超过日预算**不中断**当前 Run——当前 Run 由自己的单 Run 预算兜底，最大超出量 = 并发数 × 单 Run 上限，是有界的
- 时间（`now`）注入，不直接读系统时钟，方便测试
- 需要持久化的只有：pool 状态（冷却 / 暂停到几点）、日预算计数。存 `~/.miniclaw/users/<user_id>/state/gateway.json`。信号量和队列是进程内状态，不持久化
- 启动时发现上次进程遗留的 `running` 状态 Run → 标记为 `interrupted`，按 `RUNTIME_CRASH` 走恢复决策（§7）

### 4.4 从 RPM 保守推导并发上限

**一个 Run 不是一次请求**：agent 的每一轮（模型回复 → 调工具 → 结果回填）都是一次 API 请求，工具快的时候一轮只要几秒；subagent 会在同一个 Run 里并行发请求；runtime 还有看不见的后台调用（如小模型生成标题）；用户也可能同时在 miniclaw 之外手动用同一个账号。所以同一 pool 上 N 个并发 Run 的请求速率 ≈ N × 单 Run 峰值 RPM，按"Run 数"想当然地设并发很容易撞 RPM。

```
rpm_cap        = floor(rpm_limit × rpm_safety / per_run_peak_rpm)
max_concurrent = max(1, min(配置值, rpm_cap, max_concurrent_runs))   // 配置值缺省时取 rpm_cap
rpm_limit 未知  → max_concurrent = 1
```

| 参数 | 默认 | 为什么 |
|------|------|--------|
| `rpm_safety` | 0.5（上限 0.8） | 只用一半 RPM，另一半留给 runtime 内部重试、后台调用、用户手动使用 |
| `per_run_peak_rpm` | 20 | 按"一轮 3 秒"估的单 Run 峰值；subagent 多的任务会更高 |

| `rpm_limit` | `rpm_cap` | 实际 `max_concurrent`（全局上限 2） |
|-------------|-----------|-----------------------------------|
| 未知（订阅 / 多数第三方） | — | 1 |
| 50 | ⌊50 × 0.5 / 20⌋ = 1 | 1 |
| 200 | 5 | 2（受全局上限） |

规则：

- **配置的 `max_concurrent` 大于 `rpm_cap` → 加载时报错**，报错信息写出算式（例：`pools.anthropic-api.max_concurrent = 3 超过按 RPM 推导的上限 1 = ⌊50 × 0.5 / 20⌋`）。想提高并发，只能明确改 `rpm_limit` 或 `per_run_peak_rpm`——把"依据"写进配置，而不是直接把并发调大
- `rpm_cap < 1`（RPM 很低的账号）时仍按 1 执行，TUI 提示"该账号 RPM 过低，单个 Run 也可能被限流，依赖 runtime 内部重试"
- **运行时水位**：gateway 按 pool 统计过去 60s 的模型请求数（§15 的 `requests`，含 runtime 内部重试）。达到 `rpm_limit × rpm_safety` 时**停止准入**（新 Run 排队），降下来再放行。已在跑的 Run 不受影响——gateway 管不到 runtime 内部的单次请求。`rpm_limit` 未知时不做水位检查（并发已经是 1）
- 某个 Run 实测峰值持续高于 `per_run_peak_rpm` → 发 `pool.rpm_estimate_low` 事件，TUI 建议调高；**不自动改配置**
- 启动速率令牌桶（`starts_per_minute`）照常保留：令牌桶管"开跑有多快"，RPM 推导管"同时在跑多少"，两者不重复
- 按 TPM（每分钟 token）推导同理，P1 再做

## 5. 单 Run 护栏（RunGuard）

每个 Run 开跑时拿到一份**解析后的预算**（任务级 > Domain Runtime 默认 > profile 级 > 全局默认，由一个 `resolveBudget()` 统一解析；Domain Runtime 见 [HARNESS §9](./HARNESS.md#9-与-gateway记忆skills-的衔接)），RunGuard 在事件流上逐条检查。

| 限额 | 交互默认 | 无人值守默认 | 触发后 |
|------|---------|-------------|--------|
| `max_turns` | 50 | 30 | `BUDGET_EXCEEDED` |
| `max_wall_time` | 30 min | 20 min | `BUDGET_EXCEEDED` |
| `max_idle`（无任何事件） | 15 min | 15 min | `STALLED` |
| `max_tokens` | 2,000,000 | 500,000 | `BUDGET_EXCEEDED` |
| `max_cost_usd` | 不限 | 1.00 | `BUDGET_EXCEEDED`（仅 runtime 报告费用时生效） |
| `max_tool_calls` | 200 | 100 | `BUDGET_EXCEEDED` |
| 死循环 | 同一工具 + 同一参数连续 5 次 | 同左 | `LOOP_DETECTED` |
| 等待审批 `max_approval_wait` | 不限 | 60 min | `CANCELLED(approval_timeout)` |

规则：

- **token 口径**：按 §15.2 归一化后的 `input + cacheWrite + output`，**不含 cacheRead**。agent 会反复读缓存，cache read 动辄上百万但很便宜，算进去会让限额失去意义。有费用数据时以 `max_cost_usd` 为准
- **超时分层：内层 < 外层**。runtime 自己处理"单次请求卡住"（Claude Code 单请求超时 `API_TIMEOUT_MS` 默认 600s，超时后自己重试并发 `api_retry` 事件）；`max_idle` 只兜底"runtime 进程本身卡死"，所以必须**大于** runtime 单请求超时，否则会误杀一个 runtime 还在正常等待的 Run。配置校验：`runtime 单请求超时 < max_idle < max_wall_time`
- **80% 软告警**：发 `budget.warning` 事件，TUI 显示；100% 硬中止
- **重试共享预算**：同一 Run 的所有 attempt 累计计入同一份预算，重试不能把花费翻倍
- **审批等待不计时**：Run 处于 `waiting_approval` 时，`max_wall_time` 和 `max_idle` 暂停计时（否则用户不在时会被误杀），改由 `max_approval_wait` 管
- **无人值守不能无上限**：定时任务的上述限额必须是有限正数，配置成 `0` / 不限 → 配置加载时直接报错
- **双保险**：runtime 原生支持的限额（如轮数、费用上限）在启动时一并传给 runtime；RunGuard 仍然独立检查，作为兜底（不同 runtime 支持的限额不同，口径也可能不同）
- **中止流程**：发 abort 信号 → 等 10s 宽限 → 强杀子进程树。保留已产生的部分输出，状态记为 `aborted`，原因写明是哪个限额、实际值多少（如 `max_tokens 500k/500k`）

## 6. 错误归类（ErrorKind）

### 6.1 统一错误结构（唯一定义，放 `core/gateway/errors`）

```ts
type ErrorKind =
  | 'RATE_LIMITED' | 'OVERLOADED' | 'NETWORK'          // 上游暂时性
  | 'QUOTA_EXHAUSTED' | 'AUTH'                         // 上游需等待 / 需人工
  | 'RUNTIME_UNAVAILABLE'                              // 本机找不到 / 跑不起来 runtime（§14）
  | 'INVALID_CONFIG' | 'CONTEXT_OVERFLOW' | 'REFUSED'  // 本次请求本身有问题
  | 'RUNTIME_CRASH' | 'STALLED'                        // 执行环境问题
  | 'BUDGET_EXCEEDED' | 'LOOP_DETECTED' | 'CANCELLED'   // miniclaw 主动中止
  | 'UNKNOWN';

interface GatewayError {
  kind: ErrorKind;
  scope: 'run' | 'pool' | 'runtime';  // 只影响这个 Run / 整个上游账号 / 这个 runtime 下所有 pool
  retryAfterMs?: number;   // 上游明确给出的等待时间
  resetAt?: string;        // 上游明确给出的额度恢复时间（ISO 8601）
  message: string;         // 可操作：哪里错了、为什么、怎么修
  raw: unknown;            // 原始错误（已脱敏），用于补充分类规则
}
```

### 6.2 分类表

| kind | scope | 典型来源 | 自动重试 | 处理 |
|------|-------|---------|---------|------|
| `RATE_LIMITED` | pool | 429，runtime 内部重试已耗尽 | ✅ 过闸门后 | pool 冷却，按 `retryAfter` 或退避 |
| `OVERLOADED` | pool | 529 / 503 服务过载 | ✅ 过闸门后 | pool 冷却 |
| `NETWORK` | pool | DNS、连接重置、TLS、流中断 | ✅ 过闸门后 | pool 冷却 |
| `QUOTA_EXHAUSTED` | pool | 订阅用量上限、余额不足、账单问题 | ❌ | pool 暂停到 `resetAt`；未知则暂停 60 min |
| `AUTH` | pool | 未登录、登录过期、key 无效、provider 的 token 环境变量缺失 | ❌ | pool 暂停；runtime 有免费登录检查时自动复查（§14.5），否则人工恢复；提示具体登录命令 |
| `RUNTIME_UNAVAILABLE` | runtime | 找不到可执行文件、依赖的 `node` 不在 PATH、版本低于 adapter 最低要求、`--version` 超时 | ❌ | 该 runtime 下所有 pool 暂停，每 5 min 自动重新探测，通过即恢复；提示探测报告（§14） |
| `INVALID_CONFIG` | run | 模型名不存在、参数非法 | ❌ | 立即失败，指出是哪个配置项 |
| `CONTEXT_OVERFLOW` | run | 压缩后仍超上下文窗口 | ❌ | 失败，提示缩小 skills / `memory_scope` |
| `REFUSED` | run | 模型拒绝、内容策略拦截 | ❌ | 失败 |
| `RUNTIME_CRASH` | run | 子进程异常退出、SDK 抛异常、miniclaw 重启导致中断 | ⚠️ 过闸门后最多 1 次 | 见 §7 |
| `STALLED` | run | RunGuard 空闲超时（常见于网络假死） | ⚠️ 过闸门后最多 1 次 | 见 §7 |
| `BUDGET_EXCEEDED` | run | RunGuard 或 runtime 原生限额 | ❌ | `aborted` |
| `LOOP_DETECTED` | run | RunGuard | ❌ | `aborted` |
| `CANCELLED` | run | 用户取消、审批超时 | ❌ | `cancelled` |
| `UNKNOWN` | run | 分类器没认出来 | ❌ | 失败，保留 `raw`，补分类规则 |

"过闸门"= 通过 §7.1 的副作用闸门。

### 6.3 分类规则

- **分类归 adapter**：每个 adapter 目录提供一个 `ErrorClassifier`（纯函数 `classify(raw) → GatewayError`），core 只认 `ErrorKind`。新增 runtime = 新增一个 classifier，recovery 一行不改
- **歧义时往"不重试"方向归**：429 但带"usage limit / resets at"字样 → `QUOTA_EXHAUSTED`，不是 `RATE_LIMITED`。对配额错误反复重试只会浪费时间、刷屏
- **认不出就是 `UNKNOWN`**，永远不猜成可重试
- **契约测试**：共享一套错误 fixture（每种 kind 至少一例），每个 adapter 的 classifier 必须全部分类正确（对应 `01-solid.md` 的 LSP 要求）
- **脱敏**：`raw` 写入日志前先过凭证脱敏（PRD F8：凭证不写进日志）

### 6.4 各 runtime 的映射

见附录 A。

## 7. 恢复决策（Recovery）

`decide(error, attempt, context) → Decision`，纯函数。

```ts
type Decision =
  | { action: 'restart'; after: Ms }     // 从头重跑（新 session）
  | { action: 'resume'; after: Ms }      // 续跑原 session
  | { action: 'defer'; until: Instant }  // 等 pool 恢复后再准入
  | { action: 'ask_user' }               // 交互任务：把选择交给人
  | { action: 'fail'; needsAttention: boolean };
```

`scope: 'pool'` 的错误还会**另外**更新 pool 状态（§8）——"这个 Run 怎么办"和"这个账号怎么办"是两个独立决定。

### 7.1 副作用闸门（最重要的一条）

agent Run **不是幂等的**：它可能已经删了文件、发了邮件、在屏幕上点了按钮。从头重跑 = 把这些动作再做一遍。

- 每个 attempt 记录 `hadSideEffects`：只要执行过任何**非只读**工具调用就为真。"是否只读"**复用 policy engine 的工具风险分类**（capability 的 effect，定义在 [HARNESS §6.2](./HARNESS.md#62-capability-词表唯一定义)：effect ≠ `read` 即为副作用），不另写一份（`02-dry.md`：安全判断出现第 2 次必须收敛）
- **允许从头重跑（restart）** 仅当：失败的 attempt `hadSideEffects = false`，**或**任务显式声明 `idempotent = true`
- 否则，adapter 声明了 `resumable` 能力 → **续跑（resume）** 原 session，并在续跑消息里说明"上次因 X 中断，先核对已完成的步骤再继续"
- 否则 → `fail(needsAttention = true)`，TUI 高亮，等人处理
- 交互任务遇到需要闸门判断的情况，一律 `ask_user`：TUI 给出 [续跑] [从头重跑] [放弃]，由人决定

### 7.2 重试参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `max_attempts` | 3（含首次） | 上限 5，配置更大直接报错 |
| 等待时间（pool 级错误） | 等该 pool 冷却结束（§8），不再叠加 Run 级退避 | 冷却时长已经包含 `retryAfter` 和指数退避，只定义一次 |
| 等待时间（run 级错误） | `min(cap, base × 2^(n-1)) × rand(0.5, 1)` | 只用于 `RUNTIME_CRASH` / `STALLED`；指数退避 + 抖动 |
| `base` | 30 s | runtime 内部已经快速重试过一轮，Run 层没必要再秒级重试 |
| `cap` | 10 min | |
| 定时任务重试窗口 | 重试开跑时间必须早于"下一次计划触发时间 − 5 min" | 赶不上就放弃本次（`retry_window_exceeded`），防止和下一次叠在一起 |

### 7.3 决策表

| 错误 | 无副作用 / 幂等 | 有副作用 + 可续跑 | 有副作用 + 不可续跑 |
|------|----------------|------------------|-------------------|
| `RATE_LIMITED` / `OVERLOADED` / `NETWORK` | restart（等 pool 冷却结束） | resume（等冷却结束） | fail + 待处理 |
| `RUNTIME_CRASH` / `STALLED` | restart（仅 1 次） | resume（仅 1 次） | fail + 待处理 |
| `QUOTA_EXHAUSTED` | defer 到 `resetAt`（定时任务受 `max_delay` 约束，超了就 fail） | 同左，恢复后 resume | fail + 待处理 |
| `AUTH` / `RUNTIME_UNAVAILABLE` | defer 到 pool 恢复（定时任务受 `max_delay` 约束，超了就 fail + 待处理） | 同左，恢复后 resume | fail + 待处理 |
| 其余（配置、上下文、拒绝、预算、死循环、取消、未知） | fail | fail | fail |

交互任务：上表里的 restart / resume 在 TUI 以倒计时形式展示（"上游过载，30s 后重试 1/2，Esc 取消"）；凡是标"待处理"的都变成 `ask_user`。

## 8. Pool 健康：冷却与暂停

一个机制覆盖熔断需求，不单独引入熔断器（KISS）：

- **冷却（cooling）**：`RATE_LIMITED` / `OVERLOADED` / `NETWORK` 触发。冷却时长 = `max(retryAfter, min(30 min, 30 s × 2^(k-1)))`，`k` 为该 pool 连续失败次数。冷却期内不准入新 Run；**已在跑的 Run 不受影响**，它们自己遇错再按规则处理
- **试探**：冷却结束后，pool 只放行 **1 个** Run 作为试探（用真实 Run，不发额外的探测请求，探测也花钱）。成功 → `healthy`、`k` 清零；失败 → 再次冷却，时长翻倍
- **上游压力信号**：runtime 在运行中上报的内部重试事件（如 Claude Code 的 `api_retry`，`error` 为 `rate_limit` / `overloaded`）**不算错误**，不触发恢复决策，但会让该 pool 进入短冷却（60s，每来一次重新计时）——已经有 Run 在被限流，就别再往这个账号上加新 Run。这些事件同样刷新 `max_idle` 计时
- **暂停（paused）**：`QUOTA_EXHAUSTED` 暂停到 `resetAt`（未知则 60 min 后试探）；`AUTH` 和 `RUNTIME_UNAVAILABLE` 暂停到探测通过——免费探测（§14.2 的 L1–L3）每 5 min 自动重跑，用户装好 / 登录好之后自动恢复；runtime 没有免费登录检查时（如 Claude Code），由用户在 TUI 按 `r` 触发一次 L4 探测来恢复
- **持久化**：pool 状态写入 `gateway.json`，重启后继续生效，不会一启动就重新撞墙
- **不自动降级**：gateway 不会因为 pool 不可用就偷偷换别的 profile / 模型——那是 router 的职责，且悄悄换模型会改变能力集（最小惊讶原则）。P1 router 可以读 gateway 暴露的只读 `PoolHealth`，在任务**显式声明** `fallback_profiles` 时换用；需要 computer use 的任务永远不自动降级

## 9. 状态与可观测性

### 9.1 Run 状态机

```
queued ──► running ──► succeeded
  │  ▲        ├──► retrying ──► running
  │  │        ├──► waiting_approval ──► running
  │  │        ├──► failed（可带 needs_attention）
  │  │        ├──► aborted（预算 / 死循环 / 卡死）
  │  │        └──► cancelled
  │  └── deferred
  ├──► skipped（定时任务：重叠 / 超 max_delay / 暂停超窗）
  └──► rejected（队列满 / 日预算 / 交互时 pool 暂停）
```

### 9.2 事件

gateway 的每个决定都作为事件写进 Run 日志（与 runtime 事件同一条流）：

`admission.granted` · `admission.queued` · `admission.deferred` · `admission.rejected` · `budget.warning` · `budget.exceeded` · `error.classified` · `recovery.decided` · `pool.cooling` · `pool.paused` · `pool.recovered` · `pool.rpm_estimate_low`（§4.4）· `probe.completed`（§14）· `usage.updated` · `usage.mismatch`（§15）

每个事件带上 pool id、原因、相关数值（排队位置、剩余预算、恢复时间……）。

### 9.3 TUI

- 模型面板：每个 pool 的状态（`healthy` / `cooling 00:42` / `paused until 14:00` / `paused · login required`）和今日无人值守用量
- 任务面板：所有非成功 Run 显示原因；`needs_attention` 置顶高亮
- **无人值守任务的任何非成功结果都必须持久化并在 TUI 可见**（`04-other-principles.md` Fail Fast），P1 起同时发系统通知

## 10. 配置

配置格式尚未决定（PRD §10），以下用 TOML 示意（与 PRD §7 的 `config.toml` 一致），结构与格式无关。

```toml
[gateway]
max_concurrent_runs = 2
max_queue_length    = 20
rpm_safety          = 0.5
per_run_peak_rpm    = 20

[gateway.retry]
max_attempts = 3
base_seconds = 30
cap_seconds  = 600

[gateway.budget.interactive]
max_turns       = 50
max_wall_minutes = 30
max_idle_minutes = 15
max_tokens      = 2_000_000
max_tool_calls  = 200

[gateway.budget.unattended]
max_turns        = 30
max_wall_minutes = 20
max_idle_minutes = 15
max_tokens       = 500_000
max_cost_usd     = 1.00
max_tool_calls   = 100
max_approval_wait_minutes = 60

[pools."claude-code/subscription"]
# rpm_limit 留空 = 未知 → max_concurrent 固定为 1（§4.4）
starts_per_minute         = 6
unattended_daily_tokens   = 3_000_000
unattended_daily_cost_usd = 5.00

[pools."claude-code/anthropic-api"]
rpm_limit      = 50         # 按控制台里该 key 的实际限额填写
# max_concurrent 不写 → 取 ⌊50 × 0.5 / 20⌋ = 1；写得比这个大会加载报错

[pools."claude-code/deepseek"]
allow_unmetered = false     # provider 不返回 usage 时，是否允许无人值守任务照跑（§15.5）

# 可选：runtime 可执行文件路径。不写则自动探测（§14.3）
[runtimes.claude-code]
path = "~/.local/bin/claude"

# 可选：第三方 provider 价目表，用于算费用（§15.4）。provider 定义本身见 SKILLS §9
[providers.deepseek.prices."<model>"]
input_per_mtok       = 0.0
cache_write_per_mtok = 0.0
cache_read_per_mtok  = 0.0
output_per_mtok      = 0.0
```

profile 指定 pool；任务可以覆盖单 Run 预算和调度相关项：

```toml
# profiles/thinker.toml
pool = "claude-code/subscription"

# tasks/daily-brief.toml
max_delay_minutes = 180     # 额度用尽时最多推迟 3 小时
overlap           = "skip"
idempotent        = true    # 只读日历 / 通知并生成简报，可安全重跑
[budget]
max_turns = 20
```

**加载时校验（Fail Fast，任何一条不满足就拒绝启动并指出配置项）**：

- pool `max_concurrent ≤ rpm_cap`（§4.4，报错写出算式）且 `≤ max_concurrent_runs`；`rpm_limit` 未知时 `max_concurrent` 只能是 1
- `scheduled_max_concurrent < max_concurrent`（`max_concurrent = 1` 时两者都是 1）
- `rpm_safety ≤ 0.8`，`per_run_peak_rpm ≥ 1`
- `runtimes.<id>.path` 写了就必须存在且可执行（不回退到自动探测，免得悄悄用了另一份安装）
- 无人值守预算每项都是有限正数
- `max_attempts ≤ 5`，`base_seconds ≥ 1`
- 超时分层：runtime 单请求超时 < `max_idle` < `max_wall_time`（§5）
- profile 引用的 pool 必须存在
- computer use 并发、同任务并发、同一 workspace 并发不是配置项，出现就报错（防止有人以为能改）
- 未知字段报错（拼错的配置不能被静默忽略）

## 11. 模块划分与接口

```
core/gateway/
  errors        # ErrorKind / GatewayError / Decision —— 唯一定义
  admission     # 纯：admit(request, state, now) → AdmissionResult
  run-guard     # 纯：check(budget, usage, event, now) → ok | warn | exceed
  recovery      # 纯：decide(error, attempt, context) → Decision
  pool-health   # 纯：transition(poolState, outcome, now) → poolState
  budget        # 纯：resolveBudget(task, domainRuntime, profile, defaults) → Budget
  rpm           # 纯：rpmCap(pool, defaults) → number；overWatermark(requestsLast60s, pool) → boolean（§4.4）
  usage         # 纯：accumulate / reconcile / priceOf —— RunUsage 的唯一实现（§15）
  gateway       # 编排：组合以上纯函数，驱动 adapter；时钟、状态存储由构造函数注入
core/runtimes/
  probe         # 编排 L1–L4 探测、按配置哈希缓存、暂停期间定时复查（§14）
adapters/<engine>/
  classify      # 原始错误 → GatewayError
  detect        # 定位 / 版本 / 登录检查 / 端到端探测（§14）
  usage         # 原始 usage → 归一化 TokenUsage（§15.2）
infra/gateway-state-store       # 读写 gateway.json
infra/shell-env                 # 捕获登录 shell 的 PATH 和声明过的变量（§14.3 / §14.4），只做这一件事
```

探测不是 gateway 的职责（`01-solid.md` 单一职责）：探测在 `core/runtimes/probe`，gateway 只通过只读接口 `RuntimeAvailability` 读取结果来决定准入。

- 纯逻辑（判定、状态转移、决策）和副作用（驱动 adapter、写文件、计时）分开；只有 `gateway` 一个文件有副作用
- core 不 import 任何 runtime SDK；`classify` 在各自 adapter 目录里
- gateway 以组合方式包在 adapter 外面，不做 `BaseAdapter` 继承（`04-other-principles.md`）

对 adapter 的额外要求（接口按角色拆开）：

```ts
interface ErrorClassifier {
  classify(raw: unknown): GatewayError;
}

interface RuntimeDetector {                          // §14
  locate(env: ShellEnv): Promise<LocateResult>;      // L1 定位 + L2 可执行
  checkAuth(pool: PoolRef): Promise<AuthStatus>;     // L3；runtime 不支持就返回 'unknown'
  probe(profile: ProfileRef): Promise<ProbeResult>;  // L4 端到端
}

interface UsageNormalizer {                          // §15.2
  normalize(raw: unknown, previous?: TokenUsage): TokenUsage;  // previous 用于处理累计型 usage
}

interface RuntimeCapabilities {
  // …已有能力声明
  resumable: boolean;                 // 能否按 session id 续跑
  reportsCost: boolean;               // 声明值；以 L4 探测实测为准（第三方 provider 可能不同）
  nativeLimits: { maxTurns: boolean; maxBudgetUsd: boolean };
}
```

adapter 输出的 `RunEvent` 必须包含 gateway 需要的最小信息：

- `usage`：每次模型请求（拿不到逐次的，就每个 turn）的归一化 token（§15.2），有费用就带费用；同时计入 `requests`（§4.4 水位）
- `tool_call`：工具名 + 参数哈希（用于死循环检测和副作用判断）
- `error`：原始错误对象，交给 `classify`
- `upstream_retry`：runtime 内部重试的信号（§8 上游压力信号），没有就不发
- 任意事件都刷新 `max_idle` 计时

adapter 启动 runtime 时必须**显式设置** runtime 的内部重试 / 超时参数（如 Claude Code 的 `CLAUDE_CODE_MAX_RETRIES`、`API_TIMEOUT_MS`），**不继承用户 shell 环境**。否则用户环境里一个 `CLAUDE_CODE_RETRY_WATCHDOG=1`（无限重试约 3 小时）就会让 miniclaw 的所有时间假设失效。这些值属于 adapter 配置，只在 adapter 里出现一次。runtime 不允许覆盖的（如 Codex 内置 provider 的重试次数），在附录 A 里写明其默认值，超时分层按默认值校验。

### 测试要求

- `admission` / `run-guard` / `recovery` / `pool-health` / `budget`：表驱动单测 + 假时钟，覆盖 §4.2、§5、§7.3 每一行
- classifier：共享 fixture 的契约测试（§6.3）
- detect：假文件系统 + 假 shell 输出的契约测试，覆盖 §14.1 每一种失败原因都给出对应的修复提示
- usage：每个 runtime 用真实输出样本做 fixture，覆盖正常结束、失败、中断、续跑、全 0 五种情况（§15）
- 场景测试：§12 每个场景一个

## 12. 场景走查

| # | 场景 | gateway 行为 |
|---|------|-------------|
| 1 | 8:00 定时简报，Claude 订阅额度已用尽，10:00 恢复；任务 `max_delay = 180` | `QUOTA_EXHAUSTED` → pool 暂停到 10:00 → Run `deferred` → 10:00 作为试探 Run 准入。若 `max_delay = 30` → 本次 `skipped`，记录原因，TUI 可见 |
| 2 | 交互改代码，途中持续 529，runtime 内部重试耗尽；已经改过文件 | `OVERLOADED` → pool 冷却；有副作用 → `ask_user`：[续跑] [从头重跑] [放弃] |
| 3 | agent 反复读同一个文件 | 第 5 次相同调用 → `LOOP_DETECTED` → `aborted`，不重试 |
| 4 | 9:00 三个定时任务 + 一个补跑同时触发，pool `rpm_limit = 200` → `max_concurrent = 2`（受全局上限）、定时份额 1 | 1 个开跑，3 个按计划时间排队；此时用户在 TUI 发起交互任务 → 占用预留槽位立即开跑 |
| 5 | 两个 computer use 任务时间重叠 | 第二个 `queued`，前一个结束才开始（硬上限 1） |
| 6 | Wi-Fi 断了 | `NETWORK` → 冷却 30s → 试探失败 → 60s → 120s …（上限 30 min）；期间定时任务 `deferred`，TUI 显示冷却倒计时 |
| 7 | miniclaw 在 Run 中途崩溃 | 重启时把遗留 `running` 标为 `interrupted`，按 `RUNTIME_CRASH` 过副作用闸门 |
| 8 | 无人值守 Run token 暴涨 | 400k 时 `budget.warning`；500k 时中止，`aborted: max_tokens 500k/500k` |
| 9 | Claude 登录过期 | `AUTH` → pool 暂停（需人工）；所有使用该 pool 的定时任务 `deferred` / `skipped`；TUI 提示登录命令，登录后按 `r` 恢复 |
| 10 | miniclaw 从 IDE / launchd 启动，`claude` 装在 nvm 下 | 进程 PATH 找不到 → 登录 shell PATH 找到（§14.3 第 3 步）→ `/doctor` 显示"经登录 shell 找到"，建议写死路径 |
| 11 | `nvm use` 换了 Node 版本，缓存路径失效 | Run 开跑前 stat 失败 → 重新定位一次 → 成功则照常开跑，失败则 `RUNTIME_UNAVAILABLE`，该 engine 所有 pool 暂停，每 5 min 复查 |
| 12 | shell 里残留 `ANTHROPIC_BASE_URL` 指向 Kimi，profile 用官方 | engine 环境里不继承这个变量（§14.4）；若 `~/.claude/settings.json` 也设了 → L1 报 `misrouted`，指出文件和键 |
| 13 | API key 的 `rpm_limit = 50`，用户配了 `max_concurrent = 3` | 加载报错：超过按 RPM 推导的上限 1 = ⌊50 × 0.5 / 20⌋（§4.4） |
| 14 | 第三方 provider 不返回 usage，定时任务要用它 | L4 标记不计量；未配 `allow_unmetered` → `rejected(UNMETERED)`；交互任务照跑并提示"不计量"（§15.5） |

## 13. 优先级与待定

**MVP（v0.1）必须有**：§4 准入全部规则（含 §4.4 RPM 推导并发与水位）· §5 RunGuard 全部限额 · §6 分类 + Claude classifier · §7 副作用闸门与重试 · §8 冷却 / 暂停与持久化 · §9 事件与 TUI 可见性 · §10 配置校验 · §14 Claude Code 的 L1–L4 探测与 `/doctor` · §15 usage 返回（Claude Code）

**P1**：Codex classifier、探测、usage 归一化（随 Codex adapter）· 按 TPM 推导并发 · 读取 runtime 上报的限额遥测（如剩余额度）做**提前**降速，而不是等撞墙 · `fallback_profiles` · 交互任务运行中临时追加预算 · 系统通知

**待定**：

- [ ] 默认值校准：MVP 跑两周后按真实数据调整 §4.1 / §5 的数字，以及 §4.4 的 `per_run_peak_rpm`（用 §15 的 `requests` 实测单 Run 峰值）
- [ ] 订阅类 pool 没有费用数据时，日预算只能按 token 算，是否需要按模型加权
- [ ] 配置格式（随 PRD §10）

## 14. Engine 探测：找不到 claude / codex / 其他 LLM

> 术语：本节的 **engine** 就是本文其他地方说的 "runtime"（Claude Code / Codex，见 HARNESS §0），不是 Domain Runtime。

实际使用中最常见的故障不是 LLM 中途报错，而是**一开始就找不到 engine，或者找到了但跑不起来、打到了错的模型**。所以探测单独做成一步：结果决定 pool 能不能准入（§4.2 第 1 行），失败时必须说清楚"试了哪些地方、为什么不行、怎么修"。

### 14.1 常见失败原因（每一条都要有对应的检测和修复提示）

| # | 现象 | 根因 | 怎么发现 | 提示用户怎么修 |
|---|------|------|---------|---------------|
| 1 | 终端里 `claude` 能用，miniclaw 说找不到 | miniclaw 从 launchd / IDE / 非交互 shell 启动，拿不到 `~/.zshrc` 里的 PATH（nvm、fnm、volta、Homebrew、`~/.local/bin`） | L1 按 §14.3 的顺序逐处尝试并记录 | 显示最终在哪找到；建议在配置里写死 `runtimes.<id>.path` |
| 2 | 找到了，但一跑就报 `env: node: No such file or directory` | npm 装的启动脚本依赖 `node`（Codex 的 npm 包是；Claude Code 旧版 npm 包也是），而 PATH 里没有 node | L2 `--version` 失败且 stderr 提到 `node` | 自动把 node 所在目录加进 engine 的 PATH（§14.4）；不行就建议改用原生安装 |
| 3 | 昨天能用，今天找不到 | nvm 切了 Node 版本或 engine 自升级，缓存的路径失效 | 每个 Run 开跑前 stat 缓存路径 | 自动重新定位；仍失败就给出 #1 的提示 |
| 4 | 行为和终端里不一样、缺参数 | 机器上有多份安装（npm、Homebrew、原生安装、ChatGPT App 自带的 `codex`），PATH 先命中了旧的 | L1 列出**所有**候选及版本；L2 版本低于 adapter 最低要求 | 显示命中的是哪一份；建议写死路径或删掉旧的 |
| 5 | 终端里的 `claude` 其实是 alias / shell 函数 | 子进程看不到 alias | L1 的 `command -v` 输出不是路径 | 提示 alias 指向什么，建议写死路径 |
| 6 | 装了但没登录 / 登录过期 | — | L3（有免费检查时）或 L4 | 给出该 engine 的登录命令 |
| 7 | 以为在用 DeepSeek / Kimi，实际打到了官方（或反过来） | provider 变量只写在 shell rc 里没传进来；或 `~/.claude/settings.json` 的 `env` 里另有一套 | L1 读 engine 配置文件里与路由相关的键并和 profile 对比；L4 核对响应里的实际模型 id | 指出冲突来源（哪个文件、哪个键） |
| 8 | 自定义 provider 报 `Missing environment variable` | provider 的 `token_env` 变量在 miniclaw 拿到的环境里不存在 | L3 在启动 engine 前检查 `token_env` 是否有值 | 指出变量名和应该在哪里设置 |
| 9 | 能连上，但 usage 全是 0 或没有 | 第三方 provider 不返回 usage | L4 有输出但 usage 为空或全 0 | 标记为不计量（§15.5） |

### 14.2 四级探测

| 级别 | 检查什么 | 成本 | 粒度 | 失败 → |
|------|---------|------|------|--------|
| L1 定位 | 按 §14.3 找到可执行文件，取 realpath，记录来源 | 免费，毫秒级 | engine | `RUNTIME_UNAVAILABLE` |
| L2 可执行 | 用 §14.4 组装的环境跑 `<bin> --version`（超时 5s），解析版本，不低于 adapter 声明的最低版本 | 免费 | engine | `RUNTIME_UNAVAILABLE` |
| L3 已登录 | engine 有免费的登录检查就用（如 `codex login status`）；没有就只检查凭证是否存在（如 `token_env` 有值），结果记为 `unknown` 而不是 `ok` | 免费 | pool | `AUTH` |
| L4 端到端 | 用 profile 的 provider + 模型发一次最小请求（单轮、不给工具、固定提示词），检查：有正常回复、实际模型 id 与 profile 一致、有没有 usage、有没有费用 | **花钱**（一次极小请求） | profile | 按 §6 分类；模型 id 不一致 → `misrouted` |

- L4 同时**实测**能力：`reportsUsage`、`reportsCost` 以 L4 结果为准，不信 adapter 的声明——同一个 engine 换个 provider 结果就不一样
- adapter 自己的最低版本不满足 → `RUNTIME_UNAVAILABLE`；Domain Runtime 要求的 engine 能力不满足 → `INVALID_CONFIG`（HARNESS 的 compile 阶段），两者不混用
- 每一级都产出结构化结果，TUI `/doctor` 原样展示：

```ts
interface ProbeResult {
  engine: string; pool?: string; profile?: string;
  level: 'ready' | 'not_found' | 'not_runnable' | 'unauthenticated' | 'unreachable' | 'misrouted';
  binary?: { path: string; foundVia: string; version: string };
  auth: 'ok' | 'missing' | 'unknown';
  reportsUsage?: boolean;
  reportsCost?: boolean;
  attempts: { step: string; outcome: string }[];  // 试过的每一处、每一步
  fix?: string;                                    // 可以直接照做的修复建议
  checkedAt: string;
  configHash: string;
}
```

### 14.3 定位顺序（第一个命中且通过 L2 的生效）

1. 配置里写死的 `runtimes.<id>.path`：写了就只用它，不存在直接报错、**不回退**（§10）
2. miniclaw 进程自己的 PATH
3. **用户登录 shell 的 PATH**：用 `$SHELL -ilc` 执行一次，用唯一分隔符包住输出（交互 shell 可能打印欢迎信息），超时 5s，进程内缓存。解决 nvm / fnm / volta 只在 `.zshrc` 里生效的问题
4. adapter 声明的常见安装位置（附录 A）

- 所有候选都记进 `attempts`；即使已经命中，也要列出"别处还有一份 x.y.z"（#4）
- 命中后缓存 realpath；每个 Run 开跑前 stat 一次，失效就重新定位
- `command -v` 返回的是 alias / 函数而不是路径 → 不执行它，提示用户（#5）

### 14.4 engine 子进程的环境

engine 子进程的环境**由 adapter 显式组装**，不整体继承 miniclaw 进程或用户 shell 的环境：

| 顺序 | 来源 | 内容 |
|------|------|------|
| 1 | 最小基础 | `HOME`、`USER`、`LANG` / `LC_*`、`TMPDIR`、`TERM` |
| 2 | 登录 shell（§14.3 同一次捕获） | `PATH`（确保 `node` 所在目录在内），以及 profile 引用到的 provider `token_env` 变量。**只取声明过的变量名**，不整体复制 |
| 3 | profile 的 provider | adapter 把 provider 定义（SKILLS §9）翻译成 engine 的变量或参数：Claude Code 用 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` 等；Codex 用 `-c model_provider=…` 命令行参数（优先级高于 `~/.codex/config.toml`） |
| 4 | adapter 固定值 | 重试 / 超时参数（§11），最后写入，优先级最高 |

- **为什么不整体继承**：①shell 里残留的 provider 变量会让 engine 悄悄打到别的 provider（#7）；②shell 里的其他凭证（云账号、各种 token）会被 agent 的 shell 工具读到，违反 HARNESS 的凭证规则。任务确实需要某个变量时，在任务里显式声明透传，视同授权，由 policy engine 决定
- engine 自己的配置文件里也可能有路由设置（Claude Code `~/.claude/settings.json` 的 `env`、Codex `~/.codex/config.toml` 的 `model_provider`）。L1 只读这些文件里**与路由相关的键**，和 profile 不一致就报 `misrouted`，指出文件和键。进程变量和配置文件谁优先：**待实测**；L4 的模型 id 核对是最后一道保险
- 只读路由相关的键，不解析 engine 的其他内部状态（HARNESS 执行原则：只用 engine 公开的配置面）

### 14.5 什么时候探测

| 时机 | 做哪几级 | 说明 |
|------|---------|------|
| miniclaw 启动 | 所有被 profile 引用的 engine / pool 做 L1–L3，并行，总超时 10s | 不阻塞 TUI 启动，模型面板先显示"探测中" |
| 每个 Run 开跑前 | stat 缓存的路径 | 毫秒级；失效就重跑一次 L1–L2 |
| 首次使用某个 profile，或 profile / provider 配置变了（配置哈希变化） | L4 | 结果按配置哈希缓存，配置不变就不重复花钱 |
| 用户执行 `/doctor` | L1–L4 全部 | 输出完整报告 |
| pool 因 `AUTH` / `RUNTIME_UNAVAILABLE` 暂停期间 | 每 5 min 自动重跑 L1–L3 | 通过即恢复（§8）；engine 没有免费登录检查时，由用户按 `r` 触发一次 L4 |
| Run 以 `RUNTIME_CRASH` 失败 | L1–L2 | 区分"engine 本身坏了"和"偶发崩溃" |

- 探测必须在**真正执行任务的那个进程 / 环境**里做。P2 注册到 launchd 后，launchd 的环境和 TUI 不同，`/doctor` 要分别报告两边的结果

### 14.6 接入其他 LLM

分两种情况，做法不同：

| 情况 | 例子 | 需要做什么 |
|------|------|-----------|
| 现有 engine 背后换 provider | DeepSeek / Kimi / GLM / 火山 ARK 走 Claude Code；OpenRouter / Ollama / Azure 走 Codex（SKILLS §9） | **不写新 adapter**。配 provider + profile + pool；L3 / L4 按 `(engine, provider)` 探测；usage 和费用按 §15；`rpm_limit` 按该 provider 的限额填 |
| 新的 agent engine | OpenCode（SKILLS 中的 P2）、其他 CLI agent | 新增 `adapters/<engine>/`，实现 `RuntimeDetector`（§11）、`ErrorClassifier`、`UsageNormalizer` 和 `run`，通过同一套契约测试；core 零改动 |
| （提案，待拍板）API engine | SKILLS §15：miniclaw 直接调模型 API 的最小 tool loop | 同上一行，只是 L1–L2 退化为"配置存在"，L3 / L4 直接打 API。它能看到每次请求的 usage 和响应头，`requests` 精确、`rpm_limit` 也可以从限流响应头读出；错误映射在提案通过后补进附录 A |

新 engine 的 `detect` 契约测试至少覆盖 §14.1 的 #1–#6。

## 15. Usage 返回

### 15.1 原则

- **每个 Run 都返回 usage**：成功、失败、中止、取消都要返回——失败的 Run 同样花了钱
- **拿不到就明确说拿不到**：标 `unavailable`，**禁止用 0 冒充**。有输出但 usage 全 0，按"不计量"处理
- **口径只有一份**：各 engine 的原始字段只在自己的 adapter 里翻译成统一结构（`02-dry.md`）；预算（§5）、日预算（§4.3）、RPM 水位（§4.4）、TUI、导出都用这一份

### 15.2 结构（唯一定义，放 `core/gateway/usage`）

```ts
interface TokenUsage {
  input: number;       // 未命中缓存的输入
  cacheWrite: number;  // 写入缓存的输入
  cacheRead: number;   // 命中缓存的输入
  output: number;      // 输出（含推理）
  reasoning?: number;  // output 中的推理部分，engine 提供才有
}

interface RunUsage {
  tokens: TokenUsage;
  byModel: Record<string, TokenUsage>;  // 一个 Run 可能用到多个模型（主模型、小模型、subagent）
  costUsd?: number;
  costSource: 'engine' | 'price_table' | 'none';
  requests: number;                     // 模型请求次数（含 engine 内部重试），用于 RPM 水位
  requestsEstimated: boolean;           // engine 不给逐次请求信息时为 true
  turns: number;
  toolCalls: number;
  wallMs: number;
  attempts: number;                     // 含重试 / 续跑（§5：重试共享预算）
  completeness: 'complete' | 'partial' | 'unavailable';
}
```

### 15.3 采集与对账

- **运行中累加**：adapter 每拿到一次 usage 就发 `usage` 事件，gateway 累加。RunGuard 和 RPM 水位靠它实时判断，TUI 靠 `usage.updated` 事件实时显示
- **累计型 usage 必须做差**：有的 engine 报的是整个会话 / thread 的累计值（Codex 就是，续跑后还包含之前的用量），adapter 减掉上一次的值再上报，gateway 只接收增量
- **结束时对账**：engine 给了权威总数（如 Claude Code 结束消息里的总数）就以它为准；和累加值相差超过 5% 时记 `usage.mismatch` 事件（通常说明漏了事件），不影响结果
- **中途被杀 / 失败**：没有结束消息 → 用累加值，`completeness = partial`。engine 失败时根本不报 usage（Codex 失败的 turn 就不带）→ 这一段记为 `unavailable`，**不读 engine 的内部日志补数**（HARNESS 执行原则：不解析 engine 内部状态）
- **重试 / 续跑**：同一个 Run 的所有 attempt 合并成一份 `RunUsage`，`attempts` 记次数

### 15.4 费用

| 情况 | `costSource` | 做法 |
|------|-------------|------|
| 官方 provider，engine 报了费用 | `engine` | 直接用；TUI 标"估算"（engine 的费用是客户端估算，不等于账单） |
| 第三方 provider | `price_table` | **不采信 engine 报的费用**（它可能按官方价目表算，待实测），按 provider 价目表（§10）× 归一化 token 计算 |
| engine 没报费用，也没配价目表 | `none` | 只显示 token；`max_cost_usd` 和 `unattended_daily_cost_usd` 不生效，由 token 限额兜底 |
| 订阅（按套餐付费，不按量） | `engine` 或 `none` | 只作参考，TUI 标"订阅，非实际扣费" |

### 15.5 不计量的 provider

L4 发现 provider 不返回 usage（或全 0）时，该 pool 标记为**不计量**：

- 交互任务照常运行，TUI 明确提示"本 Run 不计量，token 限额不生效"
- 无人值守任务：pool 必须显式配置 `allow_unmetered = true` 才准入（§4.2 第 3 行），否则 `rejected(UNMETERED)`。放行后 RunGuard 只能用轮数、工具调用次数、时长兜底
- 这类 pool 的 RPM 水位按事件数估算（`requestsEstimated = true`）

### 15.6 从哪里拿到 usage

| 出口 | 内容 |
|------|------|
| `gateway.submit()` 的最终结果 `RunResult` | `{ status, output, error?, usage: RunUsage }`，`usage` 必填 |
| `usage.updated` 事件 | 运行中的累计值，给 TUI 实时显示 |
| Run 持久化记录 | 即 PRD F3 里 Run 的"花费"，同一个结构 |
| pool 日计数（§4.3） | 无人值守 token / 费用累计 |
| TUI | 任务面板：每个 Run 的 token、费用、完整度；模型面板：每个 pool 的今日用量和实时 RPM |
| 导出 | 按天 / pool / profile / 任务汇总，CSV 或 JSON |

---

## 附录 A：各 runtime 的错误映射、探测与 usage

> 核实日期 2026-09-10。标 **待实测** 的是公开文档 / 源码里没能确认的，MVP 实现 classifier 时必须先抓真实样本存成 fixture，再写匹配规则。runtime 升级后重新跑契约测试。

### A.1 Claude Code（Agent SDK / `claude -p --output-format stream-json`）

**runtime 已有的行为（gateway 不重复做）**

- 内部重试：默认 10 次（`CLAUDE_CODE_MAX_RETRIES`，上限 15），覆盖 429、5xx、超时、流卡住；遵守 `retry-after`；只在开始流式输出前重试
- 每次内部重试在流里发 `system` / `api_retry` 事件：`attempt`、`max_retries`、`retry_delay_ms`、`error_status`、`error`（`rate_limit` / `overloaded` / …）→ 映射为 `upstream_retry`，不是错误
- 单请求超时 `API_TIMEOUT_MS` 默认 600s；`CLAUDE_CODE_RETRY_WATCHDOG=1` 会变成无限重试（约 3 小时）→ adapter 必须显式关闭
- 结束时有 result 消息，带 `total_cost_usd`（客户端估算，不等于账单）；是否有 `usage` 字段、流中每条 assistant 消息是否带 usage：**待实测**
- 续跑：`--resume <session_id>`（SDK 为 `resume` 选项）→ `resumable = true`
- 中止：`SIGTERM` 退出码 143；SDK 的 AbortController 支持：**待实测**
- 原生限额：`maxTurns`、`maxBudgetUsd`：**待实测**（确认前 `nativeLimits` 填 false，全部由 RunGuard 兜底）

**错误映射**

| 上游表现 | ErrorKind | 备注 |
|---------|-----------|------|
| 401 `authentication_error` | `AUTH` | key 无效 / 吊销 / 过期，或登录态失效 |
| 402 `billing_error` | `QUOTA_EXHAUSTED` | 付款问题，无 `resetAt` |
| 429 `rate_limit_error` + `enforced_spend_limit_reached` | `QUOTA_EXHAUSTED` | 账户消费上限，无 `retry-after`，到月底才恢复——**不能**当普通 429 重试 |
| 400 `invalid_request_error` + "reached your specified API usage limits" | `QUOTA_EXHAUSTED` | 用户自设上限；虽然是 400，但不是配置错误 |
| 429 `rate_limit_error`（其他）且内部重试耗尽 | `RATE_LIMITED` | |
| 529 `overloaded_error` / 5xx 且内部重试耗尽 | `OVERLOADED` | |
| 订阅用量上限（Pro / Max 的 "usage limit reached … resets at …"） | `QUOTA_EXHAUSTED` | 文案和恢复时间格式：**待实测**；解析不出时间就按未知处理（60 min 后试探） |
| "prompt is too long" 类 | `CONTEXT_OVERFLOW` | 自动压缩后仍失败时的表现：**待实测** |
| result 消息 `subtype` 为 `error_max_turns` 等原生限额 | `BUDGET_EXCEEDED` | 完整 subtype 列表：**待实测** |
| 子进程非 0 退出且不是上面任何一种 | `RUNTIME_CRASH` | |
| `claude` 找不到 / 跑不起来 / 版本低于最低要求 | `RUNTIME_UNAVAILABLE` | 由探测发现（§14），不等到第一个 Run |

**探测（§14）**

**2026-09-10 实测更新**：Claude 2.1.267 已提供免费的 `claude auth status --json`，展示版 L3 调用该命令并只取登录状态，不读取凭证文件或操作 Keychain；旧的“只检查凭证是否存在”建议不再用于实现。L3 成功不代表还有可用额度。环境来源与优先级证据见 [M0 登录报告](../fixtures/m0/auth-config/report.md)。

- 安装位置（L1 第 4 步的候选）：原生安装 `~/.local/bin/claude`（实体在 `~/.local/share/claude/versions/`）· Homebrew cask（`claude-code` / `claude-code@latest`）· npm 全局（在 nvm / volta / Homebrew node 各自的 bin 目录下）· Linux 包管理器 `/usr/bin/claude` · 旧版 `~/.claude/local/claude`（已被取代，命中时提示迁移）
- npm 包：按文档，新版装的是平台原生二进制；旧版是依赖 `node` 的脚本 → 不做假设，L2 失败且 stderr 提到 `node` 时给 §14.1 #2 的提示
- L3：`-p` 模式下没有已确认的免费登录检查命令（**待实测**）→ 只检查凭证是否存在：macOS 钥匙串（锁住时回退到 `~/.claude/.credentials.json`）、Linux `~/.claude/.credentials.json`、`CLAUDE_CONFIG_DIR` 会改变位置；第三方 provider 检查 `token_env`。结果记 `unknown`，真正确认靠 L4
- L4：`claude -p "<固定提示词>" --max-turns 1 --output-format stream-json --model <profile 的模型>`（`--max-turns`、`--model` 是公开参数；完整组合的行为**待实测**）
- 路由相关配置：`~/.claude/settings.json`、项目 `.claude/settings.json`、`.claude/settings.local.json` 的 `env` 块都可能设 `ANTHROPIC_BASE_URL` 等 → L1 读取比对（§14.4）；和进程环境变量谁优先：**待实测**

**usage（§15）**

**2026-09-10 实测更新**：逐条 assistant 快照需按 `message.id` 替换，`message_delta.usage` 更新最终输出；result.usage 按轮，而 `modelUsage` / `total_cost_usd` 在同一 query 内累计。中断时 result.usage 可能全 0，须保留 partial / unavailable。展示版已按这些实测语义处理，详细值与复现见 [M0 事件报告](../fixtures/m0/events/README.md)。费用是引擎估算，不能称为真实扣款。

- 权威总数：结束时的 result 消息（`total_cost_usd` 已确认；`usage`、`modelUsage`、`num_turns` 字段：**待实测**）
- 逐次请求：stream-json 中 `assistant` 消息的 `message.usage`（`input_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`、`output_tokens`）：**待实测**；一次 API 调用可能拆成多条共享同一 `message.id` 的事件，需按 id 去重（**待实测**）
- 归一化：`input = input_tokens`（本来就不含缓存）· `cacheWrite = cache_creation_input_tokens` · `cacheRead = cache_read_input_tokens` · `output = output_tokens`
- `requests` = 去重后的 `message.id` 数 + `api_retry` 事件数
- 第三方 provider（`ANTHROPIC_BASE_URL`）下，`total_cost_usd` 是否仍按 Anthropic 价目表算：**待实测** → 按 §15.4 一律不采信，走价目表
- 后台小模型调用、subagent 的 usage 是否都出现在流里：**待实测**；缺失时 §15.3 的对账会暴露差异

### A.2 Codex（`codex exec --json` / `@openai/codex-sdk`）

**runtime 已有的行为**

- 事件：`thread.started` · `turn.started` · `turn.completed {usage}` · `turn.failed {error.message}` · `item.started/updated/completed` · `error {message}`
- **顶层 `error` 事件不是致命错误**：内部重试也以它的形式出现（如 `Reconnecting... 2/5`）→ 映射为 `upstream_retry`。**只有 `turn.failed` 或进程非 0 退出才算失败**
- 退出码只有 0 / 1（致命错误、turn 失败、被中断、配置错误都是 1）→ **不能靠退出码分类，只能匹配 message 文本**
- 内部重试：HTTP 层重试 5xx 和传输错误（默认 4 次，**不重试 429**）；turn 循环重试流断开、流内限流（按"try again in Xs"等待）、5xx、超时（默认 5 次）；流空闲超时 300s。**从不重试**：用量上限、配额、上下文窗口、认证刷新、服务过载
- 内置 `openai` provider 的重试参数不可覆盖（配了会被静默忽略），要改只能用自定义 provider id → adapter 无法固定时，按上面的默认值计算超时分层
- usage 字段：`input_tokens`、`cached_input_tokens`、`cache_write_input_tokens`、`output_tokens`、`reasoning_output_tokens`（归一化见下方 usage 小节）
- 没有 max-turns / 步数上限选项（`rollout_budget` 仍在开发中、默认关闭，不依赖）。一次 exec 通常只有一个 turn，所以对 Codex 来说**有效的步数上限是 `max_tool_calls`**（按 `command_execution` / `file_change` / `mcp_tool_call` item 计数），全部由 RunGuard 执行
- 续跑：`codex exec resume <SESSION_ID>` / SDK `resumeThread(id)` → `resumable = true`
- 中止：SDK `TurnOptions.signal` 会杀掉子进程
- 结构化的额度数据（`resets_at`、primary / secondary 窗口 `used_percent`）只在 app-server 协议里有（`account/rateLimits/*`），exec JSON 不输出——P1 做"提前降速"时再考虑

**错误映射（全部基于 message 文本匹配）**

| message 特征 | ErrorKind | 备注 |
|-------------|-----------|------|
| `You’ve hit your usage limit` … `Try again at 3:15 PM.` | `QUOTA_EXHAUSTED` | 原文是弯引号 `’`，匹配时同时兼容 `'`。时间是**本地时间**，格式 `h:mm AM/PM`；跨天时为 `Mon D(st/nd/rd/th), YYYY h:mm AM/PM`。结尾是 `Try again later.` → `resetAt` 未知。另有按套餐 / 工作区额度的变体文案 |
| `Quota exceeded. Check your plan and billing details.` | `QUOTA_EXHAUSTED` | 无 `resetAt` |
| `exceeded retry limit, last status: 429` | `RATE_LIMITED` | 内部重试已耗尽 |
| 服务过载（server overloaded） | `OVERLOADED` | Codex 不会自己重试，由 gateway 冷却后处理 |
| `refresh token has expired` / `Please log out and sign in again` 及其变体（reused / revoked / account mismatch） | `AUTH` | |
| `unexpected status 401` … `auth error` | `AUTH` | 之前会先出现几次 `Reconnecting…`，属正常 |
| 完全未登录时的文案 | `AUTH` | **待实测**；L3 的 `codex login status` 通常能提前发现 |
| `Missing environment variable: \`FOO\`.` | `AUTH` | 自定义 provider 的 `env_key` 变量缺失，Codex 不重试；L3 应在启动前就发现（§14.1 #8） |
| `wire_api = "chat"` is no longer supported | `INVALID_CONFIG` | Codex 只接受 `wire_api = "responses"`（SKILLS §9） |
| 上下文窗口超限 | `CONTEXT_OVERFLOW` | 文案：**待实测** |
| 进程非 0 退出，stderr 不匹配以上任何一条 | `RUNTIME_CRASH` | SDK 抛 `Codex Exec exited with code N: <stderr>` |

Codex 的 `resetAt` 需要把本地时间字符串解析成绝对时间：解析在 classifier 里做（纯函数，时区和"现在"作为参数传入），解析失败按未知处理，不能让一个解析异常把整个分类弄成 `UNKNOWN`。

**探测（§14）**

- 安装位置（L1 第 4 步的候选）：独立安装脚本 `~/.local/bin/codex`（可被 `CODEX_INSTALL_DIR` 改）· npm 全局 `@openai/codex`（在各 node 版本管理器的 bin 目录下）· Homebrew cask `codex`（落点**待实测**）· ChatGPT 桌面 App 自带的 `/Applications/ChatGPT.app/Contents/Resources/codex`——它可能在 PATH 上且版本和用户自己装的不同，是 §14.1 #4 的典型来源
- npm 包的 `bin/codex.js` 是 `#!/usr/bin/env node` 启动脚本，**需要 PATH 里有 `node`**，再去启动可选依赖里的平台原生二进制；可选依赖缺失时报 `Missing optional dependency … Reinstall Codex`（归 `RUNTIME_UNAVAILABLE`，提示重装）
- TS SDK 不走 PATH，直接用它自己依赖的原生二进制；可以用 `new Codex({ codexPathOverride })` 指定路径——走 SDK 时 L1 的结果要传给这个参数，保证探测到的和实际用的是同一份
- L2：`codex --version` 输出 `codex-cli 0.153.4` 这种格式。adapter 最低版本以用到的特性为准（`exec --json` 约 0.42 起；`reasoning_output_tokens` 约 0.125 起；`cache_write_input_tokens` 约 0.144.5 起；`exec resume` 起始版本**待实测**）
- L3：`codex login status`，结果输出在 **stderr**；已登录退出码 0（`Logged in using ChatGPT` / `Logged in using an API key - sk-…`，后者要脱敏后再记日志），未登录或出错退出码 1（`Not logged in`）。注意：①它**不认** `CODEX_API_KEY` 环境变量，用环境变量鉴权时它照样说未登录，此时改为检查变量是否有值；②它只看有没有存凭证，不验证 token 是否仍有效（**待实测**）。凭证位置：`$CODEX_HOME/auth.json`（默认 `~/.codex`），也可能在系统钥匙串（`cli_auth_credentials_store`）
- 自定义 provider 通过 `-c model_provider=<id>` 和 `-c model_providers.<id>.*` 传入；L3 在启动前检查 `env_key` 指向的变量是否有值

**usage（§15）**

- 来源：只有 `turn.completed.usage`，**没有费用字段**（`costSource` 只能是 `price_table` 或 `none`）
- 语义（读源码得出，MVP 实现前实测确认一次）：`input_tokens` **包含** `cached_input_tokens`；`output_tokens` **包含** `reasoning_output_tokens`；值是**整个 thread 的累计值**，续跑后包含之前的用量
- 归一化：`input = input_tokens − cached_input_tokens − cache_write_input_tokens` · `cacheWrite = cache_write_input_tokens` · `cacheRead = cached_input_tokens` · `output = output_tokens` · `reasoning = reasoning_output_tokens`（`cache_write_input_tokens` 是否也包含在 `input_tokens` 里：**待实测**，确认前按包含处理，宁可 input 算少，不重复计算）
- 续跑时 adapter 用"本次累计 − 续跑前累计"得到增量（§15.3）
- `turn.failed` 不带 usage，被中断的 turn 什么事件都没有 → 失败的这一段 usage 记 `unavailable`。rollout 日志（`~/.codex/sessions/…`）里有数据，但属于 engine 内部状态，不读（§15.3）
- 自定义 provider 不返回 usage 时，Codex 报**全 0** 而不是缺字段 → 有 `agent_message` 输出但 usage 全 0，就判定为不计量（§15.5）
- `requests` 无法逐次观测，按"模型产出的 item 数"估算（`agent_message` + 工具调用类 item），`requestsEstimated = true`；并行工具调用会多算，对 RPM 水位来说多算是保守方向

### A.3 参考来源

- Claude Code 错误与重试：https://code.claude.com/docs/en/errors.md
- Claude Code headless / `api_retry` 事件：https://code.claude.com/docs/en/headless.md
- Claude API 错误：https://platform.claude.com/docs/en/api/errors
- Claude API 限流 / 消费上限：https://platform.claude.com/docs/en/api/rate-limits
- Codex 非交互模式：https://learn.chatgpt.com/docs/non-interactive-mode
- Codex 配置参考：https://learn.chatgpt.com/docs/config-file/config-reference
- Codex 源码（commit `102fc57e`）：`codex-rs/exec/src/exec_events.rs`、`codex-rs/protocol/src/error.rs`、`codex-rs/model-provider-info/src/lib.rs`、`codex-rs/login/src/auth/manager.rs`、`sdk/typescript/src/exec.ts`
