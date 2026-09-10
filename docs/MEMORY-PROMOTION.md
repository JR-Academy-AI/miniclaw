# miniclaw 记忆晋升评估（Promotion Eval）：短期 → 长期

> 版本：v0.1
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) F9 · [MEMORY.md](./MEMORY.md) §8 · [MEMORY-EVAL.md](./MEMORY-EVAL.md) · 配置见 [`manifest.yaml > promotion`](../templates/memory/manifest.yaml) 和每个用户的 [`meta/rubric.md`](../templates/memory/meta/rubric.md)
> 状态：草案

---

## 1. 目标与边界

短期层（inbox、每日日志）会不断积累候选事实，其中大部分不值得长期保存。晋升评估是一条**独立的 eval pipeline**，在整理任务之前运行，对每条候选回答一个问题：**它值不值得进长期记忆？**

判断标准必须**因人而异**：同一句"周五和 Acme 开会"，对负责 Acme 的销售是关键信息，对别人只是噪声。所以评分规则（rubric）按用户构建，来源是用户的 profile 和用户自己的输入。

| | 晋升评估（本文） | 写入闸门 E1（MEMORY-EVAL §4） |
|---|---|---|
| 问题 | 值不值得记？ | 写得对不对、安不安全？ |
| 对象 | 短期层的候选事实 | 整理任务产出的具体变更 |
| 标准 | 每个用户自己的 rubric | 所有用户通用的检查 |
| 时机 | 整理之前 | 整理之后、写入之前 |

边界：

- 只决定**要不要**晋升，不决定**怎么写**（op、target 仍由整理任务决定）
- 晋升 ≠ 写入：晋升的候选照样要过 E1 和审核队列；用户规则 `always` 也只是"晋升"，不是"自动应用"
- 任何规则都不能突破隐私底线（`privacy.never_store`、`secret`）

## 2. 流水线

```
 会话 / Run ──capture──► short-term/inbox.md ◄── 候选抽取：daily 日志中的事实先转成 inbox 候选（src: daily:<date>）
                               │
                 ① 规则预判（确定性，无 LLM）
                   隐私底线 · 用户明确"记住" · 用户 always / never 规则（target / tag 匹配）· 与长期层完全重复
                               │ 未判定的
                 ② rubric 打分（LLM，批量）
                   7 个维度 × 权重 · 画像派生标准 · 语义匹配的用户规则 · 复现加分
                               │
        ┌──────────────┬───────┴───────┬───────────────┐
        ▼              ▼               ▼               ▼
     promote          ask             hold          discard
   交给整理任务    每日"要记住吗？"   留在短期层       标记为不晋升
   → stage → E1    用户一键回答      下次整理重新打分   随日志滚出归档
                        │               │ 超过 hold_max_days 仍未晋升 → 随 daily 滚出
                        └── 回答既是结果，也是标签和规则建议的来源（§4.4）
```

- 触发：与整理任务相同（会话结束 + 每晚），在它之前运行；也可以手动 `/memory promote`
- 整理任务只读取 `promote` 状态的候选；每日日志只提供上下文，里面的新事实要先经候选抽取进 inbox，保证所有事实都走同一个闸门
- 用户明确说"记住…"的事实不需要打分，预判直接 promote（仍过 E1）

## 3. Rubric：四层来源

| 层 | 来源 | 谁能改 | 作用 |
|----|------|--------|------|
| **隐私底线** | `manifest.yaml > privacy` | 没人（不可配置） | 命中即 drop，任何规则都救不回来 |
| **用户规则** User rules | 用户的明确输入、onboarding 的回答、用户接受的规则建议 | 只有用户 | `always` / `never` 直接决定结果；`boost` / `lower` 加减分 |
| **画像派生标准** Derived criteria | 由 miniclaw 从 `profile/identity`、`profile/goals`、`profile/preferences`、CORE 当前重点、active 项目、关键 people / companies 生成 | miniclaw 生成；用户可以 pin、关闭、改写 | **只抬高 relevance 维度的下限** |
| **基础维度** Base dimensions | 模板自带 7 个维度和默认权重 | 用户可以调权重和阈值 | 通用的"重要程度"分析 |

**优先级：隐私底线 > 用户规则 > 画像派生标准 > 基础打分。** 用户亲口说的，永远压过从画像推出来的。

画像派生标准只影响 relevance，是有意为之：画像说明"什么与用户有关"，但不说明"什么会长期成立"。"今天 miniclaw 的 CI 挂了"与用户的项目高度相关，却只在今天成立，不应该靠相关性被推进长期层。

### 3.1 基础维度

每个维度 0–3 分，定义写在用户的 `meta/rubric.md > Dimension guide`，用户可以改写来调整严格程度：

| 维度 | 问题 | 0 分 | 3 分 | 默认权重 |
|------|------|------|------|----------|
| `durability` | 能成立多久？ | 只在今天成立（心情、闲聊、一次性状态） | 几个月以上（角色、决定、关系） | 3 |
| `relevance` | 和用户有多相关？ | 与目标、重点、项目、人脉都无关 | 直接关系到当前目标、active 项目或关键人物 | 3 |
| `actionability` | 需要行动吗？ | 无 | 承诺、截止、决定、行动项 | 2 |
| `impact` | 会改变 agent 以后的做法吗？ | 不会 | 偏好、纠正、固定指令 | 2 |
| `novelty` | 是新信息吗？ | 长期层已有，或代码 / git / 文件里已记录 | 新事实，或对已知事实的真实变化 | 2 |
| `explicitness` | 是用户说的吗？ | agent 推断 | 用户直接陈述或要求记住 | 2 |
| `confidence` | 可信吗？ | 推测、单一弱来源 | 已确认、多个来源 | 1 |

### 3.2 分数与结果

```
base  = Σ(score_d / 3 × weight_d) / Σ weight_d × 100
score = clamp(base + recurrence_bonus + Σ 用户 boost / lower, 0, 100)
```

- **复现加分**：同一事实（同一 target、语义相同）在不同日期被再次捕获，每多一天 +10，最多 +20。反复出现本身就说明重要
- **默认阈值**（在 `meta/rubric.md` 里可改）：`promote ≥ 70` · `ask 55–69` · `hold 35–54` · `discard < 35`
- **durability 上限**：`durability = 0` 的候选最多 hold，除非命中用户 `always` 规则
- 分数由 miniclaw 根据维度分和权重**用代码计算**，不让模型做算术

### 3.3 规则预判（确定性）

| 条件 | 结果 | 记录的理由 |
|------|------|------------|
| 命中 `never_store`，或 `secret` 内容 | drop | `privacy` |
| `src: user` 且是明确的"记住"指令 | promote | `explicit_remember` |
| 命中用户 `never` 规则（target / tag 匹配） | discard | `rule:<id>` |
| 命中用户 `always` 规则（target / tag 匹配） | promote | `rule:<id>` |
| 与长期层现有内容规范化后完全相同 | discard | `duplicate` |

规则的 `match` 可以是 target glob（`companies/acme`、`people/*`）、tag（`#health`）或自然语言描述的主题。前两种在预判里确定性匹配；主题匹配交给打分器，打分器引用某条规则时必须写出规则 ID。

## 4. Rubric 从哪来：构建与演化

### 4.1 首次构建（onboarding）

1. onboarding 访谈照常填好 profile、公司、项目（MEMORY §5，完整流程见 [ONBOARDING.md](./ONBOARDING.md)）
2. 访谈题 3h（"一定要记 / 不要记什么"，题目以 ONBOARDING §7 为准）的回答写成用户规则（`src: onboarding`）
3. rubric builder 根据 profile 生成画像派生标准，在 TUI 里列出来，用户可以逐条取消
4. 写入 `meta/rubric.md`，`meta/state.yaml > last_rubric_built_at`

### 4.2 用户随时输入

- 用户说"以后 Acme 相关的都记下来""别记我吃了什么""会议室预订没那么重要"时，agent 把它捕获为 `op: rule` 的候选（PROTOCOL §3）
- miniclaw 把它解析成一条用户规则（`always` / `never` / `boost` / `lower` + `match`），在 TUI 里复述一遍请用户确认（"Added rule: never keep meals and food"），然后写进 rubric，并在 `meta/changelog.md` 记一条 `target: meta/rubric`、`by: user`
- `/memory rubric` 查看和编辑；也可以直接改文件
- 新增 `never` 规则时，如果长期层里已有匹配的条目，就往审核队列里放一条归档**建议**，不自动归档

### 4.3 画像变化时重建派生标准

- 触发：changelog 显示 `profile/*`、CORE 当前重点有变化，或有项目进入 / 离开 `active`
- rubric builder 重新生成 Derived criteria：`pinned` 和 `off` 的行保留不动，其余重写；每一行都要写明出处（`from: [[profile/goals]]`）
- 直接生效，在 TUI 首页提示差异（"Rubric updated from your goals: +2 −1"），可以按 changelog 撤销。派生标准只来自用户自己的数据，而且只影响 relevance，所以不需要逐条审核
- v0.1 只支持手动 `/memory rubric rebuild`；v0.2 起自动重建

### 4.4 从用户行为中学习（规则建议）

- 信号：ask 的回答、审核队列中拒绝已晋升的变更、撤销、用户后来又亲口说了一个曾被 discard 的事实
- 30 天内，对同一 target / 领域 / tag 的候选**同方向**判断达到 3 次，就往审核队列放一条规则建议（reason: `rubric_suggestion`），例如 "You declined 3 notes about meals. Stop keeping food-related notes?"
- 用户接受才会成为用户规则（`src: suggestion:#<id>`）；拒绝后 90 天内不再提同一建议
- **规则永远不会被自动加上**：用户规则只能因为用户点了"是"而改变

## 5. 打分器约束

- 打分是一个 Run，必须经过 Runtime Gateway（GATEWAY.md），使用 `promotion.model_profile`；每个 Run 批量处理最多 `batch_size` 条候选
- 输入：候选及其来源原文、`meta/rubric.md`、CORE、INDEX、目标条目的当前内容（用于判断 novelty）。看不到整理任务的推理，也不能改 rubric
- 输出（每条候选）：7 个维度分各附一句理由、命中的用户规则 / 派生标准 ID、复现次数。分数和结果由 miniclaw 计算
- 打分失败、超时或被 gateway 拒绝：该批候选一律 hold（`on_error: hold`）。不晋升，所以不会写错；不丢弃，所以不会漏记

## 6. 与 inbox、整理任务、eval-log 的衔接

inbox 条目用复选框状态表示晋升结果，结果附在首行末尾：

```
- [ ] 2026-09-10T14:03 | src: run#42 | op: update | target: projects/miniclaw | conf: high | sens: normal
- [>] … | promo: promote 82 (rel=3 act=2 · derived#2)
- [?] … | promo: ask 61
- [~] … | promo: hold 48 (seen 2d)
- [-] … | promo: discard 21 (rule:never#3)
- [x] … | promo: promote 82 → #0137          ← 整理完成，指向变更 ID
```

晋升决定以 `P#` ID 追加到 `meta/eval-log.md`，之后的回答和结果另起一行追加：

```
- 2026-09-10T03:00 | P#0311 | cand: 2026-09-09T14:03 | decision: promote | score: 82 | dims: dur=3 rel=3 act=2 imp=1 nov=3 exp=2 conf=2 | rules: derived#2
- 2026-09-10T03:05 | P#0311 | outcome: consolidated → #0137
```

`outcome` ∈ `answered_yes` / `answered_no` / `consolidated → #<change-id>` / `expired`（hold 过期滚出）/ `restated`（被 discard 后用户又亲口说了，记为漏晋升）。

## 7. 评估这条 pipeline 本身

周期体检（MEMORY-EVAL §6）在 `meta/health.md > Promotion` 里加上这些指标：

| 指标 | 说明 | 超阈值时的建议 |
|------|------|----------------|
| 晋升率 | promote / 全部候选 | — |
| ask 负担 | 每天问几条、回答率 | 回答率 < 30%：减少 `ask.max_per_day` |
| ask 同意率 | 用户回答"是"的比例 | 连续 2 周 > 80%：`promote` 阈值可以降 5；< 20%：ask 区间可以收窄 |
| 误晋升率 | 晋升后在审核中被拒或被撤销 | > 15%：`promote` 阈值升 5 |
| 漏晋升 | `restated` 次数 | 每周 ≥ 3：`promote` 阈值降 5，或检查画像派生标准 |
| 规则命中 | 每条用户规则 / 派生标准的命中次数 | 90 天 0 命中的派生标准：建议关闭 |
| 个性化占比 | 结果被用户规则或派生标准改变的候选比例 | — |

与 MEMORY-EVAL 一样，**只给建议，不自动改阈值**。

离线回归（MEMORY-EVAL §7）新增两类能力标签：

- `promotion`：给定 rubric 和 inbox，检查每条候选的决定
- `personalization`：**同一份 inbox 配两份不同的 profile / rubric，必须得出不同的决定**，用来验证 rubric 真的在起作用；另有用例验证 `always` 规则挡不住凭证被 drop、durability 上限生效

## 8. 数据位置

| 内容 | 位置 |
|------|------|
| pipeline 机制（触发、批量、ask 上限、复现加分、重建触发、建议阈值） | `manifest.yaml > promotion`（所有用户相同） |
| 维度定义、权重、阈值、用户规则、画像派生标准 | `meta/rubric.md`（每个用户一份，可以直接编辑；整理任务没有写权限） |
| 晋升决定和结果 | `meta/eval-log.md`（`P#` 记录） |
| 规则建议 | `meta/review-queue.md`（reason: `rubric_suggestion`） |
| 指标 | `meta/health.md > Promotion` |

## 9. 里程碑

| 版本 | 范围 |
|------|------|
| **v0.1** | rubric 模板 · onboarding 访谈题 3h + 画像派生标准确认 · 规则预判 · 打分器（ask 区间先按 hold 处理）· `op: rule` 捕获 · 手动 `/memory rubric rebuild` · eval-log `P#` 记录 · E3 `promotion` / `personalization` 用例 |
| **v0.2** | 每日 ask 卡片 · 画像变化自动重建 · 规则建议 · 体检中的晋升指标与阈值建议 |
| **v0.3** | 按语义聚类候选来生成规则建议 · 统计长期条目的读取次数（长期没人读的条目说明晋升过松） |

## 10. 待决策问题

- [ ] 打分器用什么模型：候选量大、对成本敏感，小模型加规则预判是否足够
- [ ] ask 在哪里问、每天最多几条：TUI 首页卡片，还是会话结束时顺便问
- [ ] 画像派生标准变化是否也要用户逐条确认（当前方案：直接生效 + 提示 + 可撤销）
- [ ] hold 过期前是否再问用户最后一次
