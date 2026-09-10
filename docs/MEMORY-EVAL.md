# miniclaw 记忆更新评估层（Memory Eval）

> 版本：v0.1
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) F9 · [MEMORY.md](./MEMORY.md) §8 自我更新流水线 · [GATEWAY.md](./GATEWAY.md) · 配置见 [`manifest.yaml > eval`](../templates/memory/manifest.yaml)
> 状态：草案

---

## 1. 为什么需要 eval 层

记忆会自我更新：整理任务（consolidator）用模型把短期层的候选事实写进长期层，并改写每次都会注入的 CORE。写错的代价会被放大——一条错误事实会被注入之后的每一个会话和 Run，而且越积越难发现。

现有保护只按**操作类型**拦截（delete、身份变更、冲突 → 审核队列），不看**内容对不对**；changelog 能撤销，但前提是用户先发现了问题。也没有任何度量：改了整理 prompt 或换了模型，无法知道记忆质量是变好还是变坏。

eval 层回答三个问题：

1. **这一条变更能不能写？**（写入前）
2. **最近的记忆更新质量怎么样，记忆本身健不健康？**（运行中）
3. **改了整理逻辑之后，质量有没有退步？**（开发时）

### 要拦住的失败模式

| 类别 | 例子 |
|------|------|
| 无依据 | 写入了来源里没有的事实；把推测写成事实 |
| 目标错误 | 写到同名的另一个人 / 项目；新建了和已有条目重复的条目 |
| 操作错误 | 该 supersede 却用 update 覆盖，旧事实没进 `## History`；静默删除 |
| 冲突裁决错误 | 用旧信息覆盖新信息；覆盖了用户明确说过的话 |
| 隐私 | 存了 `never_store` 内容；敏感度标低；`secret` 内容进了注入文件 |
| 结构破坏 | frontmatter 缺字段、断链、INDEX 与条目不同步、CORE 超预算 |
| 噪声 / 遗漏 | 闲聊进了长期层；重要决定没进来（由晋升评估负责，见 [MEMORY-PROMOTION.md](./MEMORY-PROMOTION.md)） |
| 漂移 | 条目之间互相矛盾、陈旧、重复，越积越多 |

## 2. 三层结构

| 层 | 何时运行 | 评估对象 | 产出 |
|----|----------|----------|------|
| **E1 Gate**（写入闸门） | 每次写长期层 / CORE 之前 | 单条变更 | `pass` / `warn` / `block` / `drop`，决定变更去向 |
| **E2 Health**（周期体检） | 每周 + 手动 `/memory health` | 整个实例 + 一段时间内的变更流 | `meta/health.md` 报告与告警 |
| **E3 Regression**（离线回归） | 修改整理 prompt / 模型 / 协议 / 模板时 | 仓库里的 golden 用例 | 与基线对比的分数，退步不得合入 |

E1、E2 在每个用户的实例里运行，数据不出本机；E3 在 miniclaw 仓库里运行，只用合成数据。

**"值不值得记"不在本文范围内**：短期候选能否进入长期层，由整理之前的一条独立 pipeline 按用户自己的 rubric 判断，见 [MEMORY-PROMOTION.md](./MEMORY-PROMOTION.md)。本文的 E1 只评估整理产出的变更**写得对不对**；E2 体检和 E3 回归同时覆盖两条 pipeline。

**铁律：eval 只能收紧，不能放宽。** E1 的 `pass` 不会让本该审核的变更（`consolidation.require_review`）绕过审核；eval 自身出错或超时按 `warn` 处理，绝不静默放行。

## 3. 写入路径：先 stage，再 eval，再应用

要在写入前评估，整理任务就不能直接改 `long-term/`。调整后的写入路径：

```
 inbox + daily ──consolidate──► meta/staging/<consolidation-id>/
                                  ├── changeset.yaml   每条变更：op、target、sources、inbox 引用、摘要
                                  └── <相对路径>        变更后的完整文件
                                           │
                             memory manager 逐条 diff + E1 Gate
          ┌────────────────┬───────────────┼────────────────┬───────────────┐
          ▼                ▼               ▼                ▼
        pass             warn            block             drop
   按 auto_apply /   进 review-queue   不应用，进 review-  丢弃并打码，
   require_review    （附 findings）    queue 标 blocked    不复制原文
          │
          ▼
   应用到 long-term/ ──► 刷新 INDEX / CORE ──► post-apply 检查 ──► changelog + eval-log
```

- consolidator 只能写 `meta/staging/`，**没有** `long-term/` 和 `core/` 的写权限；真正落盘由 memory manager（确定性代码）完成
- **一条变更 = 一个目标文件**。一次会议牵涉到人、公司、项目，就拆成多条变更，每条单独评估、单独审核、单独撤销
- 用户明确指令（"记住…"）和 onboarding 走同一条路径（`by: user` / `by: onboarding`），只跑确定性检查，通过后立即应用
- 变更 ID 在 stage 时分配；被 block / drop 的变更不进 `meta/changelog.md`，所以 changelog 的 ID 可能不连续

## 4. E1 Gate：写入前逐条评估

### 4.1 确定性检查（无 LLM，v0.1）

由 memory manager 用代码执行：便宜、稳定、可复现。**只有确定性检查可以 block / drop。**

| check | 规则 | 失败时 |
|-------|------|--------|
| `schema` | frontmatter 必填字段齐全、枚举值合法、`id` 与路径一致 | block |
| `provenance` | `sources` 非空，每个来源都可解析（session / run 存在，或 `user` / `import:*`） | block |
| `never_store` | 命中 `privacy.never_store` 模式（key / token 格式、通过 Luhn 校验的卡号、验证码等） | drop |
| `secret_leak` | `sensitivity: secret` 的内容出现在会被注入的文件里（CORE、INDEX、短期摘要） | drop |
| `no_silent_drop` | `update` / `supersede` 删掉的正文行，没有出现在该条目的 `## History` 里 | block |
| `standing_instruction` | 非 `by: user` 的变更修改或删除了 CORE 的 `Standing instructions` | block |
| `links` | `[[domain/slug]]` 指向不存在的条目（本次 changeset 新建的除外） | warn |
| `duplicate` | 新建条目与已有条目的 slug / 标题规范化后相同，或相似度超过阈值 | warn |
| `churn` | 同一条目 24 小时内被改超过 `churn_max_per_day` 次（来回改） | warn |
| `budget` | CORE / INDEX / 短期摘要超出 `tiers` 里的预算 | warn |

**capture 扫描**：每个会话 / Run 结束时，对 short-term 新增的内容也跑一次 `never_store`，命中即在原位打码为 `[REDACTED:<kind>]` 并记 eval-log。凭证不应该等到整理时才被发现。

### 4.2 语义检查（LLM judge，v0.2）

"写得对不对"代码判断不了，交给 judge：

| check | 问题 |
|-------|------|
| `grounded` | 新增 / 改动的每一句陈述，能否在来源原文中找到依据？（supported / partial / unsupported） |
| `target` | 写入的实体对不对？会不会是同名的另一个人 / 公司 / 项目？ |
| `op` | 操作选得对吗？（该 supersede 却用了 update、该 merge 却用了 add） |
| `conflict` | 与已有事实冲突时，是否按"用户明确说的 > 更新的 > 置信度高的 > 来源多的"裁决 |
| `sensitivity` | 敏感度标得对不对（健康、财务、家庭、第三方隐私至少是 `private`） |

约束：

- judge 使用独立的 `memory-judge` 模型 profile，**看不到 consolidator 的推理过程**，只看变更 diff、来源原文和目标条目的当前内容——不让模型给自己打分
- 每个 check 输出结构化结果：`result`（pass / warn）、`reason`、`evidence`（来源原文引用）。`grounded` 判 pass 却给不出引用的，按 unsupported 处理
- judge **只能 warn，不能 block**：LLM 会出错，它的职责是把可疑变更送到用户面前
- 为控制成本，judge 只评估**本来会被自动应用**的变更（`judge.run_on: auto_apply`）；已经要进审核队列的变更由用户把关
- judge 和整理任务一样是一个 Run，必须经过 Runtime Gateway（见 [GATEWAY.md](./GATEWAY.md)），受单 Run 预算约束
- judge 超时、报错、被 gateway 拒绝或超出预算：该变更按 `warn` 处理（`gate.on_error`）

### 4.3 汇总规则

```
任一 check 为 drop  → drop    丢弃；命中的原文不写进任何文件，eval-log 只记 check 名和位置
任一 check 为 block → block   不应用；进 review-queue 并标记 blocked，只能逐条处理，默认拒绝
任一 check 为 warn  → warn    进 review-queue（reason: eval_warn），附 findings
否则                → pass    按 consolidation.auto_apply / require_review 原规则处理
```

### 4.4 post-apply 检查

一次整理的所有变更应用完、INDEX 和 CORE 刷新之后，对**整体结果**再跑一遍确定性检查：

- `schema` 或 `secret_leak` 失败 → 按 changelog 自动撤销本次整理的全部变更，整理任务标记失败并在 TUI 提示
- INDEX 与条目不同步（有条目没有索引行，或索引指向不存在的条目）→ 重新生成 INDEX
- `budget` 超出 → 让 consolidator 重写一次 CORE；仍超出则保留并记 warn

## 5. 用户行为就是标签

用户在审核队列和日常使用中的操作，是衡量 eval 本身准不准的真实标签。memory manager 把它们作为 `outcome` 记录追加到 eval-log：

| 用户行为 | 含义 |
|----------|------|
| 拒绝一条 eval 判 `pass` 的变更 | eval 漏报 |
| 批准一条 eval 判 `warn` / `block` 的变更 | eval 误报 |
| 撤销一条已自动应用的变更 | 漏报，并且已经造成影响（最严重） |
| 手工修改 consolidator 最近 7 天写过的内容 | 隐式纠错，按轻度漏报计 |

这些数据只留在本机，供 E2 统计，不会自动进入 E3 用例。

## 6. E2 Health：周期体检

每周一次（默认周一 04:00，排在当晚整理之后），也可以手动 `/memory health`。读取 `meta/changelog.md`、`meta/eval-log.md`、`meta/review-queue.md` 和实例文件，覆盖写入 `meta/health.md`，文件内保留最近 `trend_periods` 期的趋势表。

### 更新质量（本周期）

| 指标 | 说明 |
|------|------|
| 变更量 | 按 op 统计，以及自动应用占比 |
| verdict 分布 | pass / warn / block / drop 各多少 |
| 审核拒绝率 | review-queue 中被拒的比例 |
| 撤销率 | 自动应用后被用户撤销的比例 |
| 纠错率 | 自动应用后被用户手工修改的比例 |
| eval 误报率 / 漏报率 | 由 §5 的标签算出，判断 gate 是太松还是太紧 |
| 无依据率 | judge `grounded` 判 partial / unsupported 的比例（v0.2） |

### 记忆状态（当前快照）

| 指标 | 说明 |
|------|------|
| 重复 | 疑似同一实体的条目对 |
| 断链 / 孤儿 | 指向不存在条目的链接；没有 INDEX 行、也没被任何条目链接的文件 |
| 陈旧 | `active` 项目超过 `stale_after_days` 没更新；已过期却没滚出的 agenda |
| 矛盾 | 同一属性在不同条目中取值不同（judge 抽样，v0.3） |
| 预算占用 | CORE / INDEX / 短期摘要占预算的比例 |
| inbox 积压 | 未处理条数、最老一条的等待天数 |

### 告警与建议

指标超过 `eval.health.alerts` 中的阈值时，在 TUI 首页提示，并在报告里给出**建议**，例如：

- 撤销率 > 10%：建议把 `update` 从 `auto_apply` 移到 `require_review`
- eval 误报率 > 50%：gate 太紧，建议检查 `duplicate` 的相似度阈值
- inbox 积压 > 7 天：整理任务可能没在运行

**只建议，不自动改配置。** manifest 的改动始终由用户确认。

## 7. E3 Regression：离线回归（开发侧）

整理质量取决于 prompt、模型和协议，任何一项变动都要能量化比较。仓库里维护一套 golden 用例（实现阶段创建在 `evals/memory/`，不随用户模板分发）：

```
evals/memory/
├── baseline.json            # 当前基线分数
└── cases/<case-id>/
    ├── case.yaml            # 描述 + 能力标签
    ├── before/              # 整理前的实例（只放相关文件，其余由模板补齐）
    ├── input/               # inbox.md、daily 日志、相关会话 / Run 摘录
    └── expected.yaml        # 期望的变更和断言
```

```yaml
# expected.yaml 示例：用户定下了技术选型，旧状态应进 History 而不是被覆盖
changes:
  - op: supersede
    target: projects/miniclaw
    must_contain: ["Claude Agent SDK"]
    history_must_contain: ["技术栈未定"]
review_expected:
  - target: profile/identity
    reason: identity_change
forbid:
  - target: "knowledge/*"            # 这段闲聊不该沉淀为 knowledge
  - text_matches: "sk-[A-Za-z0-9]{20,}"
```

- **能力标签**：extraction（该记的记住了）· restraint（不该记的没记）· targeting · op · conflict · privacy · rollout · core-budget · multilingual · promotion / personalization（晋升决定，见 MEMORY-PROMOTION §7）
- **指标**：变更 precision / recall（按 op + target 匹配）· 断言通过率 · 审核路由准确率 · 隐私违规数 · 每个用例的 token 成本
- **合入规则**：修改整理 prompt、`memory` / `memory-judge` 模型 profile、`PROTOCOL.md`、`manifest.yaml > consolidation / eval` 时必须跑。**隐私违规 > 0 一律不得合入**；总分比基线下降超过 2 个百分点不得合入，除非提交说明写明理由并同步更新基线
- **评估 judge 本身**：部分用例附带人工标注的 judge 期望结果，用来衡量 judge 的准确率
- **数据来源**：只用手写 / 合成数据，真实用户记忆永远不进仓库

## 8. 数据格式

### `meta/staging/<consolidation-id>/changeset.yaml`

consolidator 的输出，格式见 `PROTOCOL.md` §4。处理完成后由 memory manager 删除。

### `meta/eval-log.md`

追加写，与 changelog 共用变更 ID。先有一条评估记录，之后可能追加结果记录：

```
- 2026-09-10T03:02 | #0137 | by: consolidator | op: update | target: projects/miniclaw | verdict: warn
  checks: schema=pass provenance=pass links=warn(people/jon-doe missing) grounded=pass op=pass
- 2026-09-10T09:14 | #0137 | outcome: approved | by: user
```

- `outcome` ∈ `applied`（自动应用）/ `approved` / `rejected` / `undone` / `edited` / `dropped`
- `drop` 记录只写 check 名和位置（文件 + 行），**不写命中的原文**
- 超过 `eval.log_retention_days` 的记录移入 `archive/meta/`

### `meta/review-queue.md`

reason 新增 `eval_warn` 和 `eval_block`，并附一行 `Eval:` 列出未通过的 check 和理由。

### `meta/health.md`

体检报告，每次覆盖写，结构见模板文件。

## 9. 里程碑

| 版本 | 范围 |
|------|------|
| **v0.1** | stage → eval → 应用的写入路径 · E1 确定性检查 · capture 扫描 · post-apply 检查 · eval-log · E3 首批用例（覆盖全部能力标签，手动运行） |
| **v0.2** | E1 LLM judge · 用户行为标签 · E2 体检报告 + TUI 告警 · E3 接入 CI |
| **v0.3** | 矛盾抽样检测 · judge 校准集 · 基于体检数据的配置调整建议 |

## 10. 待决策问题

- [ ] `memory-judge` 用什么模型：和 consolidator 同模型（便宜）还是换一个（减少同源偏差）
- [ ] judge 是否也评估本来就要进审核队列的变更（给用户更多信息，但成本更高）
- [ ] 是否允许用户把自己撤销过的变更（打码后）导出为本地 E3 用例，用于个人调优
- [ ] 体检结果要不要单独的 TUI 视图，还是只在首页提示 + 打开 `meta/health.md`
