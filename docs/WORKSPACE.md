# miniclaw Workspace：默认工作目录、临时目录与永久化

> 版本：v0.1（草案）
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) F13（本文）· F3（Task 的工作目录）· F12 / [HARNESS](./HARNESS.md)（Domain Runtime 的 `WorkspaceSpec`、产物登记、权限）· F11 / [GATEWAY](./GATEWAY.md)（准入、副作用闸门、续跑）· F6 / [SKILLS](./SKILLS.md)（工作区来源与信任）
> 状态：规则已定义，技术选型未定；文中代码为 TypeScript **示意**，配置用 TOML **示意**
> agent 看到的规则：[`templates/workspace/PROTOCOL.md`](../templates/workspace/PROTOCOL.md)（每个 Run 注入）
> 术语沿用 HARNESS §0：**engine** = Claude Code / Codex；**Domain Runtime** = `research` / `browser` / `document` / `coding`

---

## 0. 一页结论

1. **默认 workspace 由 miniclaw 管理**：没指定工作目录的 Run，一律跑在 `~/.miniclaw/users/<user_id>/workspace/tmp/<run_id>/`。不继承启动 TUI 时的 shell cwd，不在 `$HOME` 里乱写
2. **workspace 只有三种**：`tmp`（临时，默认）· `saved`（已保存，永久）· `external`（用户自己的目录，如一个 git 仓库）
3. **每个 Run 都拿到四个路径**：工作目录 `MINICLAW_WORKSPACE`、草稿区 `MINICLAW_RUN_TMP`、系统临时文件 `TMPDIR`、交付物 `MINICLAW_OUT`。交付物写进 Run 记录，永远不会被清理
4. **只有 `tmp/` 会被自动清理**，时机由引用它的 Run 状态决定：还能续跑的永不清理；成功的 72 小时后删；失败的 7 天后删；空目录立即删；总量超 10 GB 时提前删最早可清理的
5. **永久化只有用户能做**：写 `MINICLAW_OUT`（单次交付物）· `/workspace save`（把整个 tmp 升级为 saved）· 任务直接用 `saved:<slug>` 跑（跨次积累）。agent 不能自己把东西永久化
6. **miniclaw 永不自动删除 saved / external 里的任何东西**；删除 saved 先进回收站 7 天

## 1. 概念

**Workspace = Run 的工作目录（engine 的 cwd）**。它是 agent 放工作文件的地方，不是 miniclaw 放自己记录的地方——事件日志、截图、快照、`skills.lock.json`、`skill-mount/` 一律在 `runs/<run_id>/` 里（GATEWAY §9、SKILLS §7、HARNESS §5.3）。

HARNESS 里说的"**Run 工作目录**"（`fs.write` 默认放行范围、engine sandbox 的可写范围），指的就是下表的 `MINICLAW_WORKSPACE` + `MINICLAW_RUN_TMP` + `MINICLAW_OUT` 三处，由本文定义路径，由 HARNESS §6 决定权限。

| 种类 | 位置 | 谁创建 | 自动清理 | 典型用途 |
|------|------|--------|---------|---------|
| `tmp` | `workspace/tmp/<run_id>/` | miniclaw，每个新 Run 或新对话 | ✅ 按 §5 | 一次性任务、定时任务、随手的交互对话 |
| `saved` | `workspace/saved/<slug>/` | 用户（`/workspace save`） | ❌ 只能用户删 | 以后还要接着用的数据集、草稿、跨次积累的定时任务 |
| `external` | 用户指定的绝对路径 | 用户自己 | ❌ 永不触碰 | 改某个代码仓库、整理某个真实目录 |

每个 Run 拿到的四个路径（engine adapter 以环境变量传给 engine，同时填进注入的 PROTOCOL）：

| 变量 | 含义 | `tmp` workspace | `saved` / `external` workspace |
|------|------|-----------------|-------------------------------|
| `MINICLAW_WORKSPACE` | cwd | `workspace/tmp/<id>/` | `workspace/saved/<slug>/` 或用户路径 |
| `MINICLAW_RUN_TMP` | 本 Run 的草稿区，随时可能被清理 | 与 cwd 相同 | `workspace/tmp/<run_id>/` |
| `TMPDIR` / `TMP` / `TEMP` | 工具和子进程的临时文件 | `<MINICLAW_RUN_TMP>/.tmp/` | 同左 |
| `MINICLAW_OUT` | 交付物，永久保留 | `runs/<run_id>/artifacts/` | 同左 |

`TMPDIR` 指进草稿区，是为了让 engine 和它启动的工具产生的临时文件也在清理范围内，而不是散落在系统临时目录里。

## 2. 目录布局

```
~/.miniclaw/users/<user_id>/          # 0700，见 PRD §7
├── workspace/
│   ├── tmp/                          # 临时区：只有 janitor 会删这里
│   │   └── <run_id>/                 # 目录名 = 创建它的 Run，创建后不改名
│   │       ├── .tmp/                 # TMPDIR
│   │       └── …                     # agent 的工作文件
│   ├── saved/                        # 永久区：只有用户操作会增删
│   │   └── <slug>/
│   └── .trash/                       # 被删除的 saved workspace，保留 7 天
│       └── <slug>@<deleted_at>/
├── runs/<run_id>/
│   ├── …                             # 事件日志、输出、skills.lock.json、skill-mount/
│   └── artifacts/                    # MINICLAW_OUT
└── state/
    ├── gateway.json                  # GATEWAY §4.3
    ├── workspaces.json               # 注册表：saved + external 的元数据（P1 起含信任标记），唯一来源
    └── janitor.jsonl                 # 每次清理 / 移入回收站的记录
```

- `tmp/`、`saved/`、`.trash/` 必须在同一文件系统（都在 `workspace/` 下），保存和删除才能用原子 `rename`
- 注册表是 saved / external 元数据的**唯一**来源；external 不能在用户目录里放元数据文件（零侵入）
- 启动时对账：`saved/` 里有目录但注册表没有 → 补登记，来源记为未知（P1 起 `trusted: false`）；注册表有但目录没了 → 标 `missing`，TUI 可见，不自动删登记

## 3. 选择 workspace

Task 的 `workspace` 字段（PRD F3 的"工作目录"；Domain Runtime 可以在 `WorkspaceSpec` 里声明默认值，HARNESS §4.1，任务级优先）：

| 值 | 含义 |
|----|------|
| 省略 / `"tmp"` | 默认。新建 `tmp/<run_id>/` |
| `"saved:<slug>"` | 在已保存的 workspace 里跑 |
| 绝对路径 | external；必须是注册表里已登记的路径 |

规则：

1. **不继承 shell cwd**：交互和定时任务的默认行为一致，都用 `tmp`。想在当前目录干活用 `/workspace use .`（最小惊讶：同一句话在 TUI 里说和设成定时任务，结果不应取决于你从哪个目录启动的 TUI）
2. **定时任务每次触发都是新 `tmp`**，保证可复现。需要跨次延续：用 `saved:<slug>`，或读上一次的 artifacts（PRD F9 已有"读自己上一次的输出"）
3. **交互对话延续同一个 workspace**：同一对话里后续的 Run 继承上一个 Run 的 workspace（包括 `tmp`）；`/new` 开新对话 = 新 `tmp`；`/workspace use <slug|path>` 切换
4. **同一 Run 的重试 / 续跑复用同一目录**（GATEWAY §7）。Run 记录里写 `workspace: { kind, path }`，一个 `tmp` 目录可以被多个 Run 引用
5. **解析在准入前完成（Fail Fast）**：slug 不存在、external 路径不存在 / 不可写 / 已失效（移走、外接盘未挂载）→ `INVALID_CONFIG`，指出是哪个 workspace。定时任务在创建时校验一次，每次触发再校验一次
6. **禁止作为 external 的路径**（按 realpath 判断）：`/`、`$HOME` 本身、`~/.miniclaw` 及其所有子目录（saved 只能用 `saved:<slug>` 引用）、其他本地用户的目录
7. **同一 workspace 目录同一时刻只允许 1 个 Run**：由 Gateway 准入执行（GATEWAY §4.1），两个 agent 同时改一个目录必然互相破坏

## 4. 临时目录（tmp）规则

- **创建顺序**：先落 Run 记录，再建目录（`0700`），保证不会出现没有 Run 引用的目录
- **路径不可变**：目录创建后不改名、不移动，直到被清理或保存。原因：Claude Code 按 cwd 定位 session，路径一变续跑就失效
- **内容不保证存活**：`tmp` 里的任何东西都可能被删除，包括用户手动放进去的文件。想留下 → 写 `MINICLAW_OUT`，或保存 workspace（§6）
- **不放 miniclaw 自己的东西**：Run 记录、截图、skill 挂载都在 `runs/<run_id>/`
- **大小**：MVP 不设单 Run 上限，只受 §5 的总量配额约束；单 Run 磁盘上限随 P1 的 RunGuard 加入

## 5. 清理规则（janitor）

### 5.1 目录状态

一个 `tmp` 目录的状态由**引用它的 Run** 推导出来（纯函数），不单独存状态：

| 状态 | 条件 | 处理 |
|------|------|------|
| `active` | 任一引用 Run 处于 `queued` / `running` / `retrying` / `waiting_approval` / `deferred` | **永不清理** |
| `held` | 最近结束的引用 Run 是 `failed(needs_attention)`，或启动时被标为 `interrupted` 且还没处理 | **不清理**，也**不能保存**：它还可能续跑。用户在 TUI 处理（续跑完成 / 放弃）后转为 `ended` |
| `ended` · 成功 | 最近结束的引用 Run 为 `succeeded` | 结束后 **72 小时**删除 |
| `ended` · 非成功 | `failed` / `aborted` / `cancelled` | 结束后 **7 天**删除（留着排查） |
| `empty` | Run 结束时目录里除了 `.tmp/` 什么都没有 | **立即删除** |
| `orphan` | 没有任何 Run 记录引用 | 发现后 **24 小时**删除 |

- 计时从**最近一个**引用 Run 结束算起；有新 Run 用上它就回到 `active`，计时作废
- saved / external workspace 的 Run 也有自己的 `tmp/<run_id>/`（草稿区），适用同一套规则，通常是 `empty`
- 对话还开着但目录已被清理：下一条消息分配新的 `tmp`，TUI 提示"上一个工作目录已清理"

### 5.2 何时运行

janitor 不是 Run：不启动 engine，**不经过 Gateway**（Gateway 只管 Run）。由 scheduler 作为内部维护任务触发：

| 时机 | 做什么 |
|------|--------|
| 每个 Run 结束 | 只看该 Run 的草稿区：`empty` 立即删；否则在 Run 记录上写好预计清理时间，TUI 结束卡片显示"工作目录保留至 09-13 20:00 · `s` 保存" |
| miniclaw 启动 | 全量扫描（在 GATEWAY §4.3 把遗留 `running` 标成 `interrupted` **之后**执行，确保它们落在 `held`） |
| 常驻期间每 60 分钟 | 全量扫描 |
| `/workspace clean` | 先列出将删除的目录和大小，用户确认后执行 |

### 5.3 总量配额

- `tmp/` 总大小超过 `tmp_max_total_gb`（默认 10）时，按"本应被删除的时间"从早到晚提前删除 `ended` / `orphan` 目录，直到回到配额内
- `active` / `held` 永远不因配额被删（安全优先于磁盘）。仍然超额 → TUI 持续警告并列出占用最大的目录，不自动处理

### 5.4 删除的安全规则（不可配置）

- **只删两个地方**：`workspace/tmp/` 下的一级子目录、`workspace/.trash/` 下的一级子目录。删除前对目标取 realpath，必须以对应根目录为前缀且正好深一级，否则拒绝并记录
- **不跟随软链**：agent 在 tmp 里建了指向 `~/Documents` 的软链，删掉的只是链接本身
- **单个失败不中断**：权限不足、文件被占用 → 记录，下次扫描再试
- **每次删除都留痕**：`janitor.jsonl` 记一行（路径、大小、原因、时间）；引用它的 Run 记录更新 `workspace_state: cleaned`，TUI 回看旧 Run 时能看到"工作目录已于 X 清理"
- 自动清理**永远不碰** `saved/`、external 路径、`runs/`、`memory/`

## 6. 永久化

| 想保留什么 | 怎么做 | 保留多久 |
|-----------|--------|---------|
| 这次 Run 产出的文件（报告、导出的 PDF、整理好的表格） | agent 写到 `MINICLAW_OUT` → `runs/<run_id>/artifacts/`；Domain Runtime 的产物契约（`report.md`、`sources.jsonl`、`trace.jsonl`、`changes.json` …）也写在这里 | 随 Run 记录（Run 记录保留期待定，§13） |
| 整个工作目录，以后还要接着用 | `/workspace save <slug>` → `workspace/saved/<slug>/` | 永久，只能用户删除 |
| 一个定时任务跨次积累数据 | Task 设 `workspace = "saved:<slug>"` | 永久 |
| 交给 git / 其他工具管理，脱离 miniclaw | `/workspace export <slug> <dir>`（P1），导出后可以再作为 external 登记 | 用户自己管 |

**产物登记不能指向会被清理的地方**：HARNESS §4.2 finalize 按"路径 + 哈希"把产物登记到 Run。登记时，位于 `tmp/` 下的产物（例如 `browser` 下载到工作目录 `downloads/` 的文件）先由 finalize 移进 `MINICLAW_OUT` 再登记；位于 saved / external 的产物（例如 `document` 写进用户 `roots` 的文件）按原路径登记。登记的路径永远不在 `tmp/` 下。

### 6.1 保存（tmp → saved）

- **入口**：`/workspace save [<run_id>] <slug>`（默认当前对话的 workspace）；Run 结束卡片上的 `s`
- **agent 不能触发保存**：只能在输出里建议用户保存。否则 agent 可以绕过清理把任意东西永久化
- **前提**：目录不是 `active` / `held`。`held` 的先处理，因为移动后原 Run 无法再续跑（§4）
- **做法**：同一文件系统内 `rename`（原子）→ 删掉 `.tmp/` → 注册表登记 `{ slug, kind: saved, source_runs, created_at, description }` → 引用它的 Run 记录更新 `workspace_state: saved:<slug>`
- **slug**：`[a-z0-9-]`，1–64 字符，用户内唯一；重名直接报错，不覆盖、不自动加后缀
- **保存 ≠ 信任**（P1，随 skills）：内容是 agent 写的，workspace 来源的 skills（如 `.miniclaw/skills`）照样要 `/workspace trust` 后才加载（SKILLS §5.2）

### 6.2 管理 saved workspace

| 命令 | 行为 |
|------|------|
| `/workspace` | 列出当前 workspace、所有 saved / external（大小、最近使用；P1 起显示是否信任）、`tmp/` 总占用和最早的清理时间 |
| `/workspace use <slug\|path>` | 当前对话后续的 Run 使用它；首次使用的 external 路径在这里登记（P1 起同时询问是否信任） |
| `/workspace rename <slug> <new>` · `describe <slug> <text>` | 改名 / 写说明（改名同样要求没有 `active` Run） |
| `/workspace trust <slug\|path>` · `untrust`（P1） | 只影响 workspace 来源的 skills 是否加载，不放宽任何权限 |
| `/workspace rm <slug>` | saved → 需确认 → 移入 `.trash/`，7 天内 `/workspace restore` 可恢复；external → 只注销登记，**不删文件** |

## 7. External workspace

- **登记**：交互时 `/workspace use <path>` 首次使用即登记；定时任务只能引用已登记路径，创建任务时在权限确认里显示该路径（写入范围属于预授权的一部分，PRD F8）
- **miniclaw 零写入**：不建 `.miniclaw/`、不放草稿区、不写 `AGENTS.md` / `CLAUDE.md`。agent 在里面写文件照常受 policy 约束
- **清理永不触碰**；`/workspace rm` 只注销
- **信任只管 skills**（P1）：与 SKILLS §5.2 的"工作区信任"是同一个标记，存在注册表里，不另存一份

## 8. 给 agent 的规则

agent 看到的规则只写在 [`templates/workspace/PROTOCOL.md`](../templates/workspace/PROTOCOL.md)，每个 Run 由 miniclaw 填好占位符后注入（与记忆的 `PROTOCOL.md`、Domain Runtime 的 playbook 走同一注入通道，MEMORY §10），不依赖 engine 读 cwd 里的 `CLAUDE.md` / `AGENTS.md`。PROTOCOL 只是告知，真正拦住越界写入的是 policy engine 和 engine sandbox（HARNESS §6.5）。要点：

- 工作文件放 `MINICLAW_WORKSPACE`，草稿放 `MINICLAW_RUN_TMP`；两者都可能被清理
- 用户要的结果必须写进 `MINICLAW_OUT`，并在最终回复里列出文件名
- 不写 workspace、草稿区和 `MINICLAW_OUT` 以外的地方，除非任务明确要求（由 policy 确认）
- 不碰其他 Run 的目录、`saved/` 里的其他 workspace、`runs/`、`state/`、记忆目录
- 不把凭证写进任何文件；跨 Run 要记住的事实写记忆的 inbox，不要把 workspace 当记忆
- 不能自己保存 / 永久化 workspace，只能建议用户 `/workspace save`

改 PROTOCOL 时同步本节；本节只是摘要，以 PROTOCOL 为准（`02-dry.md`）。

## 9. 与其他子系统的衔接

| 子系统 | 约定 |
|--------|------|
| **Gateway 准入**（GATEWAY §4.1） | 新增并发维度"同一 workspace 目录 = 1，不可配置"，与 computer use、浏览器 profile 并发同级；在 HARNESS §4.2 prepare 阶段登记，和浏览器 profile 租约一样由 Gateway 排队 |
| **Gateway 副作用闸门**（GATEWAY §7.1） | 不改规则：`tmp` 里的写入也是 `write-local`，照常算副作用（effect 是唯一风险分类，HARNESS §6.2）。所以在 `tmp` 里写过文件后崩溃的 Run 走续跑或交给人，不自动从头重跑 |
| **Gateway 续跑** | 续跑必须用原路径 → 这就是 `held` 既不清理也不能保存的原因 |
| **Policy**（HARNESS §6） | 本文只定义"Run 工作目录"是哪三处（§1），并提供纯函数 `zoneOf(path)`；allow / ask / deny 只在 policy engine 里决定。硬底线（HARNESS §6.4）覆盖 `state/workspaces.json`：agent 不能给自己信任一个 workspace，也不能改注册表 |
| **Skills**（SKILLS §5） | `{workspace}` 占位符 = `MINICLAW_WORKSPACE`；`tmp` workspace 没有 workspace 来源；saved / external 需 `trusted` |
| **Memory** | 记忆目录不在 workspace 里，也不能被选为 workspace |
| **engine adapter** | 负责设置 §1 的环境变量（Codex SDK 的 `env` 是整体替换，必须显式合并，见 SKILLS §8.3）；把"Run 工作目录"编译进 engine sandbox 的可写范围（HARNESS §6.5 执行点 ①）；满足 engine 对 cwd 的前置要求——Codex `exec` 默认要求 cwd 在 git 仓库内，`tmp` / saved 需传 `--skip-git-repo-check`（SDK `skipGitRepoCheck`），实现时用契约测试确认 |

## 10. 配置

```toml
[workspace]
tmp_ttl_succeeded_hours = 72
tmp_ttl_failed_days     = 7
tmp_orphan_hours        = 24
tmp_max_total_gb        = 10
trash_retention_days    = 7
sweep_interval_minutes  = 60
```

**加载时校验（Fail Fast）**：

- 每项都是有限正数；不存在"永不清理"的配置——想永久就保存（§6）
- `active` / `held` 保护、删除安全规则（§5.4）、workspace 并发 = 1 都不是配置项，出现就报错
- 未知字段报错

## 11. 模块划分

```
core/workspace/
  model      # WorkspaceRef、WorkspaceKind、TmpState —— 唯一定义
  resolve    # 纯：resolveWorkspace(task, registry, conversation) → WorkspacePlan | GatewayError
  zone       # 纯：zoneOf(path, plan) → run_tmp | workspace | out | outside（供 policy / gateway 使用）
  lifecycle  # 纯：classifyTmp(dir, runs, now, config) → TmpState
  cleanup    # 纯：planCleanup(dirs, usage, config, now) → Deletion[]
  janitor    # 编排：执行计划、写 janitor.jsonl、更新 Run 记录；文件系统和时钟由构造函数注入
infra/workspace-fs        # mkdir 0700、rename、不跟随软链的删除、目录大小
infra/workspace-registry  # 读写 state/workspaces.json
```

- 判断全是纯函数，只有 `janitor` 和 infra 有副作用
- 测试：`lifecycle` / `cleanup` 表驱动 + 假时钟，覆盖 §5.1 每一行；路径守卫专项测试（软链逃逸、`..`、前缀相同的兄弟目录如 `tmp-evil/`、深度 ≠ 1）

## 12. 场景走查

| # | 场景 | 行为 |
|---|------|------|
| 1 | 交互："把桌面上 3 个 PDF 合并" | 新建 `tmp/r101/` 为 cwd；`merged.pdf` 写进 `artifacts/`；结束 72 小时后 `tmp/r101/` 被删，`merged.pdf` 保留 |
| 2 | 这次整理出的数据集以后还要用 | `/workspace save sales-q3` → `saved/sales-q3/`；之后 `/workspace use sales-q3` 继续 |
| 3 | 每天 8 点简报 | 每次新 `tmp`；简报写 `artifacts/`；草稿区为空 → Run 结束立即删 |
| 4 | 周报需要累积历史数据 | Task `workspace = "saved:weekly-report"`；每周都在同一目录里跑，从不清理 |
| 5 | 两个任务都用 `saved:weekly-report`，同时触发 | 第二个 `queued`，前一个结束才开始（§3 规则 7） |
| 6 | 在 external 仓库里改代码，途中 529 且已改过文件 | `needs_attention` → 该 Run 的草稿区进入 `held`；仓库本身 janitor 永不触碰 |
| 7 | Run 在自己的 `tmp` 里写过文件后 engine 进程崩溃 | 有副作用 → 可续跑就原路径续跑，否则 `needs_attention`；该目录 `held`，不清理（GATEWAY §7.1） |
| 8 | agent 在 `tmp` 里建了指向 `~/Documents` 的软链 | 清理时只删链接 |
| 9 | `tmp/` 涨到 12 GB | 提前删最早可清理的 `ended` 目录；`held` 不动；仍超额则 TUI 警告 |
| 10 | 误删 saved workspace | 在 `.trash/` 里，7 天内 `/workspace restore` |

## 13. 优先级与待定

**MVP（v0.1）**：§1–§5 全部（三种 workspace、四个路径、清理状态机、配额、删除安全规则）· §6.1 保存 · §6.2 管理命令（`trust` / `untrust` 除外）· §7 external 登记 · §6 产物登记规则 · §8 PROTOCOL 注入 · §9 Gateway 的 workspace 并发槽

**P1**：workspace 信任（`trusted` 标记 + `/workspace trust`）随 skills 一起做（PRD F6 已移到 v0.2，ROADMAP M10；MVP 的 Run 不带 skill，信任没有消费方，注册表里先不写这个字段）· `/workspace export` · 单 Run 磁盘上限（RunGuard）· Run 运行中标记"结束后自动保存" · 配额超限时暂缓新的无人值守 Run（需要 Gateway 准入配合）

**待定**：

- [ ] 是否提供"用启动 TUI 时的 shell cwd 作为 workspace"的快捷方式（当前：不自动继承，要 `/workspace use .`）
- [ ] Claude Code 会在 `~/.claude/projects/` 下按 cwd 为每个 `tmp` workspace 留一个 session 目录，时间长了会堆积。选项：隔离 `CLAUDE_CONFIG_DIR`（牵涉登录态复用，PRD §10、HARNESS §6.5）/ 容忍 / 由 adapter 清理（违反零侵入）
- [ ] Run 记录（含 `artifacts/`）的保留期：目前永久保留
- [ ] 默认值校准：MVP 跑两周后按真实占用调整 TTL 和配额
- [ ] saved workspace 是否默认 `git init`（与 MEMORY §12"记忆目录是否默认 git 化"同类问题）
- [ ] **提案**：写入只落在"仅被本 Run 引用的 `tmp` + 本 Run `artifacts/`"的 attempt 不计入 `hadSideEffects`，restart 前清空这两处——能让更多崩溃的 Run 自动重跑。需要 GATEWAY §7.1 / HARNESS §6.2 一起拍板，拍板前按 §9 的现行规则
