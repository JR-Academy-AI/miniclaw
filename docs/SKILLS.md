# miniclaw Skills 子系统：通用加载与多 runtime 投递

> 版本：v0.1（草案）
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) F6（Skills 动态加载）· F2（runtime 适配层）· F5（多模型路由）· F8（权限）· [GATEWAY](./GATEWAY.md) §11（adapter 能力声明）· [MEMORY](./MEMORY.md) §10（与 runtime 的集成）
> 状态：设计草案，技术选型未定；文中代码为 TypeScript **示意**，不代表最终语言

---

## 0. 一页结论

1. **一种格式**：skill 就是 [Agent Skills 开放规范](https://agentskills.io/specification) 的 `SKILL.md` 目录，Claude Code / Codex / OpenCode / Gemini CLI 都认。miniclaw 的扩展字段只放在 `metadata.miniclaw` 下，不发明新格式。
2. **一个权威 registry**：miniclaw 自己发现、解析、去重所有来源（包括导入 `~/.agents/skills`、`~/.claude/skills`、`~/.codex/skills`），**不依赖任何 runtime 的原生发现规则**——因为没有两个 runtime 的规则是一样的。
3. **每个 Run 冻结一个 SkillSet**：显式选择 + 依赖闭包 + 条件过滤，记录内容 hash，挂载成一个临时目录（软链，零复制、零侵入）。
4. **skills 是通用能力，谁都能调用**（§14）：`list_skills` / `activate_skill` / `read_skill_resource` 这套工具协议只定义一次，有三种接入方式：
   - **engine 原生**：Claude Code → 临时 plugin + `Skill` 工具（§8.2）
   - **`mc-skills` MCP 工具服务器**：Codex，以及任何 MCP client（§8.3、§14.2）
   - **API function calling**：miniclaw 直连模型 API 时的 API engine（§15）
5. **默认独占**：runtime 自己发现的 skills 一律屏蔽，模型只看得到 miniclaw 选的——可复现、可审计、上下文可控。
6. **Provider 与 skills 正交**：怎么投递只取决于 runtime；provider / 模型只影响"模型会不会好好用 skill"，靠契约测试逐个 profile 验证。

---

## 1. 要解决的问题

### 1.1 现状（本机实测，2026-09-10）

| 事实 | 数据 |
|------|------|
| skills 分散在 4 个目录 | `~/.agents/skills`(59) · `~/.claude/skills`(64) · `~/.codex/skills`(76) · `~/.config/opencode/skills`(44) |
| 靠手工软链同步，大量重复 | 共 243 个 `SKILL.md`，按名字去重后只有 **120** 个 skill |
| skill 之间有相对路径依赖 | `~/.agents/skills` 里 **37 / 59** 个 skill 用 `../<别的skill>/` 引用兄弟 skill（`arkcli-shared` 被引用 83 次，`hyperframes-core` 78 次） |
| frontmatter 的实际用法 | `name` / `description` 全有；`version` 98 个、`metadata` 77 个、`allowed-tools` 21 个；23 个用了 `metadata.requires.bins` |

### 1.2 各 runtime 规则互不兼容

| | Claude Code 2.1.267 | Codex 0.153.4 | OpenCode 1.15.1 | Gemini CLI 0.46.0 |
|---|---|---|---|---|
| 扫描 `~/.agents/skills` | ❌ | ✅ | ✅ | ✅ |
| 同名冲突 | 个人 > 项目 | **不去重，全列出** | — | 项目 > 用户 |
| 单次 run 追加 skill 目录 | ✅ plugin 目录 | ❌（只有 app-server 协议能加） | ✅ `skills.paths` | 未验证 |
| 单次 run 屏蔽原生 skills | ✅ SDK `skills` 白名单 | ✅ `skills.include_instructions=false` | ✅ 环境变量 | 未验证 |
| 目录预算 | 上下文 1%，单条 ≤1536 字符 | 上下文 2%，单条 ≤1024 字符 | — | — |
| 模型怎么加载 | `Skill` 工具 | 模型自己读文件 | `skill` 工具 | `activate_skill` 工具 |

详细调研见 §2。结论：**如果把"发现 skill"交给 runtime，同一个任务换个 runtime 看到的 skill 集合就不一样**，这直接违背 PRD 的 G3（按任务切 runtime）和 F3（Run 可回看、可重跑）。

### 1.3 目标

- 写一次 skill，所有 runtime、所有 provider 都能用
- 每个 Task 只看到它需要的 skills（PRD F6"按任务注入"）
- **零侵入**：不写 `~/.claude`、`~/.codex`、`~/.agents`，不写用户仓库
- 新增一个 runtime = 新增一个投递实现，不改 core（`01-solid.md` OCP）

### 1.4 非目标（v1）

- 托管 skill 市场：miniclaw 只做 marketplace **客户端**，聚合 GitHub / git、Claude plugin marketplace、skills.sh 等已有来源，搜索、安装、更新第三方 skill（post-MVP，见 §16 与 [SKILLS-MARKETPLACE](./SKILLS-MARKETPLACE.md)）；不运行服务器，不做发布、账号、评分；精选索引只是 git 仓库里的静态文件
- 为适配各 runtime 改写 skill 内容
- 给 skill 单独做沙箱——skill 里的指令和脚本由 runtime 执行，受 runtime 沙箱 + miniclaw policy 约束

---

## 2. 调研结论（各 runtime 的 skills 机制）

> 来源：官方文档 + 本机 CLI 实测 + Codex 源码（tag `rust-v0.153.4`）。标注"未验证"的需要在实现时用契约测试确认。

### 2.1 Agent Skills 开放规范

- 必填：`name`（1–64 字符，`[a-z0-9-]`，不能以 `-` 开头结尾、不能含 `--`，**必须等于目录名**）、`description`（1–1024 字符，写清"做什么 + 什么时候用"）
- 可选：`license`、`compatibility`（≤500 字符）、`metadata`（规范写的是 string→string map）、`allowed-tools`（实验性，空格分隔，如 `Bash(git:*) Read`）
- 渐进式披露：启动只加载 name + description（约 100 token）→ 激活时加载正文（建议 < 5000 token / 500 行）→ 资源按需读取
- **给没有原生支持的 agent 的集成方式**：把目录以 `<available_skills>` XML 放进系统提示词，每条含 name / description / location（SKILL.md 绝对路径），配一段固定说明让模型自己用读文件工具加载。miniclaw 的 catalog 投递直接照搬（§8.3）
- 解析建议宽松：name 不规范只警告；缺 description 才跳过

### 2.2 Claude Code / Claude Agent SDK

- 扫描：`~/.claude/skills`、项目 `.claude/skills`（从 cwd 向上到仓库根）、`--add-dir <d>/.claude/skills`、plugin 的 `skills/`、企业托管目录。**不扫描 `~/.agents/skills`**
- 专有 frontmatter：`when_to_use`、`disable-model-invocation`、`user-invocable`、`context: fork`、`model`、`hooks`、`paths` 等——miniclaw 原样透传（runtime 自己读文件）
- **单次 run 注入（已实测）**：最小 plugin = `.claude-plugin/plugin.json`（`{"name":"miniclaw"}`）+ `skills/<name>/SKILL.md`，通过 SDK `plugins: [{ type: 'local', path }]`（CLI 为 `--plugin-dir`）传入；skill 以 **`miniclaw:<name>`** 命名空间出现并可被调用
- **屏蔽**：Agent SDK（TS `0.3.267`）的 `skills?: string[] | 'all'` 是上下文白名单，设置后自动把 `Skill` 加进 `allowedTools`；更彻底的 `settingSources: []` 会连用户的 settings / MCP 一起丢掉
- SDK 没有"用代码注册 skill"的 API，skill 必须是磁盘文件

### 2.3 Codex / Codex SDK

- 扫描：`$CODEX_HOME/skills`、`~/.agents/skills`、从项目根到 cwd 每层的 `.agents/skills`、`.codex/skills`、`/etc/codex/skills`、内置 `.system`。默认开启，`codex exec` / SDK / app-server 都生效
- 同名 skill **不去重**，只按相同路径去重（本机 `video-shotcraft` 出现两次）
- **没有"追加 skill 目录"的配置项**：`skills` 表只接受 `bundled`、`include_instructions`、`max_context_tokens`、`config`；唯一能加目录的是 app-server 请求 `skills/extraRoots/set`
- 换 `CODEX_HOME` 能隔离，但 `auth.json`、MCP、会话、记忆都在里面一起被换掉
- **屏蔽（已实测）**：`-c skills.include_instructions=false` 去掉整个 skills 块；`-c 'skills.config=[{path="/abs/SKILL.md",enabled=false}]'` 屏蔽单个
- "如何使用 skills"的说明只对模型目录里声明支持的模型注入（如 gpt-5.4 / 5.5）；**第三方 provider 的模型不在目录里，只列 skill、不带说明**
- `@openai/codex-sdk` `0.154.0`：本质是启动 `codex exec --experimental-json`；`config` 对象会转成 `-c` 参数；**`env` 是整体替换而不是合并**；没有 skills 相关选项，也没有系统提示词选项
- `codex debug prompt-input` 能在不调用模型的情况下打印完整提示词——零成本的契约测试手段

### 2.4 OpenCode / Gemini CLI（候选的第三、四个 runtime）

- **OpenCode**：扫描 `.opencode|.claude|.agents/skills` 和对应的全局目录，模型通过 `skill` 工具加载。单次 run 追加目录用 `OPENCODE_CONFIG_CONTENT='{"skills":{"paths":[…]}}'`（已实测）；`OPENCODE_DISABLE_EXTERNAL_SKILLS=1` 去掉 `.claude` 和 `.agents` 来源
- **Gemini CLI**：原生支持 skills（`~/.gemini|~/.agents/skills`、工作区 `.gemini|.agents/skills`），通过 `activate_skill` 工具加载，不受信目录跳过。单次 run 注入方式未验证 → 先走 catalog

---

## 3. 总体架构

```
 skill 来源：工作区 · 用户私有 · 全局共享 · 导入(~/.agents ~/.claude ~/.codex) · builtin
        │  扫描（经 FileSystem 端口）
        ▼
 ┌────────────────┐  Catalog（不可变快照）+ 诊断   ┌─────────────┐
 │ SkillRegistry  │ ─────────────────────────────►│ TUI Skills  │
 └───────┬────────┘                                └─────────────┘
         │ Catalog
         ▼
 ┌────────────────┐ ◄── Task.skills · Profile.capabilities · 环境探测结果
 │ selectSkills   │     （纯函数）
 └───────┬────────┘
         │ SkillSet（冻结，带 hash 和被选中原因）
         ▼
 ┌────────────────┐
 │ mountSkillSet  │ ──► <run 目录>/skill-mount/skills/<name> → 真实目录
 └───────┬────────┘     + skills.lock.json
         │ MountedSkillSet（随 RunRequest 一起）
         ▼
 Runtime Gateway（GATEWAY §2，唯一出口）──► engine adapter.run(…)
         │  adapter 内部的投递策略                               激活方式
         ├─ claude-code：临时 plugin + skills 白名单              原生 Skill 工具
         ├─ codex：      目录进 developer_instructions            mc-skills（MCP）
         ├─ api：        目录进 system prompt                     skill 工具（function calling，§15）
         └─ opencode：   skills.paths + DISABLE_EXTERNAL_SKILLS   原生 skill 工具（P2）

 mc-skills（infra/tools，与 mc-research / mc-docs 同宿主）── 只服务本 Run 的 SkillSet，凭 run token
         ▲  MCP：Codex · 其他 MCP client（P2）        ▲ 进程内：API engine
```

### 模块职责（遵循 `01-solid.md` / `04-other-principles.md`）

| 模块 | 职责 | 性质 |
|------|------|------|
| `core/skills/model` | `SkillManifest`、`SkillSet`、`MountedSkillSet` 等类型，唯一定义 | 类型 |
| `core/skills/parse` | `SKILL.md` 文本 → manifest 或诊断 | 纯函数 |
| `core/skills/registry` | 按来源顺序扫描、realpath 去重、同名遮蔽、产出 Catalog | 编排，副作用经端口注入 |
| `core/skills/select` | Catalog + Task + Profile + 环境 → SkillSet | 纯函数 |
| `core/skills/catalog-prompt` | 渲染 `<available_skills>` + 使用说明，所有 catalog 投递共用 | 纯函数 |
| `core/skills/tools` | `list_skills` / `activate_skill` / `read_skill_resource` 的 schema 与处理逻辑（§14.1），MCP 和 function calling 共用 | 纯函数 + 读文件端口 |
| `infra/skills/mount` | 建软链目录、写 lock 文件 | 副作用 |
| `infra/tools/mc-skills` | 把 `core/skills/tools` 以 MCP 暴露，校验 run token | 副作用（服务进程） |
| `adapters/<runtime>/skills` | 把 `MountedSkillSet` 翻译成该 runtime 的参数 / 环境变量 / 提示词 | adapter 内部细节 |

**关键边界**：core 不知道任何 runtime 怎么加载 skill。adapter 通过能力声明告诉 core 它的目录预算（用于 §6 的预算检查），其余全在 adapter 内部——新增 runtime 不改 core 的任何分支。

---

## 4. Skill 格式

### 4.1 基础：开放规范，宽松解析

- 必填字段按规范校验；`name` 与目录名不一致 → 警告（沿用目录名）；缺 `description` → 该 skill 标为 invalid，不加载
- 所有未知字段（Claude Code 的 `when_to_use`、社区常用的 `version` 等）**保留并透传**：skill 被投递后是 runtime 自己读原文件，runtime 专有字段依然生效
- 解析是纯函数：输入文本，输出 manifest 或带"哪里错、为什么、怎么修"的诊断（`04-other-principles.md` Fail Fast）

### 4.2 miniclaw 扩展：`metadata.miniclaw`

```yaml
---
name: daily-brief
description: 汇总日历、GitHub 通知和关注的新闻，生成每日简报。当用户要求简报、日报、今日概览时使用。
allowed-tools: Bash(gh:*) Read
metadata:
  miniclaw:
    requires:
      bins: [gh]                 # 本机必须有的命令
      env: [GITHUB_TOKEN]        # 必须存在的环境变量（只检查存在，不读取值）
      skills: [gcal-read]        # 显式依赖的其他 skill
      capabilities: [shell]      # profile 必须具备的能力标签
    profiles: [thinker]          # 推荐 profile（P1 规则路由使用）
    permissions: [shell, network]  # 向 policy 申请的权限
---
```

| 字段 | 用途 | 消费方 |
|------|------|--------|
| `requires.bins` / `requires.env` | 条件过滤：不满足就不注入，并给出原因 | select |
| `requires.skills` | 显式依赖，参与依赖闭包 | select |
| `requires.capabilities` | profile 不具备（例如需要 computer use）就不注入并提示 | select |
| `profiles` | 推荐 profile | router（P1） |
| `permissions` | 权限申请，创建任务时展示给用户确认；取值用 [HARNESS §6.2](./HARNESS.md#62-capability-词表唯一定义) 的 capability id，`shell` / `network` 作为类别别名兼容 | policy |
| `allowed-tools`（规范字段） | 同样视为**权限申请而不是授予** | policy |

兼容：已有的 `metadata.requires.bins`（本机 23 个 skill 在用）按 `metadata.miniclaw.requires.bins` 解析，不需要改老 skill。

> 取舍：规范的 `metadata` 是 string→string map，嵌套对象过不了严格校验器（例如上传到 claude.ai）。本地生态已经普遍用嵌套写法，而且可读性明显更好，所以 v1 接受嵌套。是否改用扁平写法见 §13。

---

## 5. 发现与注册（SkillRegistry）

### 5.1 来源配置

```toml
# ~/.miniclaw/users/<user_id>/ 下的用户配置（示意）
[skills]
# 顺序即优先级：同名时靠前的赢
sources = [
  { path = "{workspace}/.miniclaw/skills",         scope = "workspace" },
  { path = "{workspace}/.agents/skills",           scope = "workspace" },
  { path = "~/.miniclaw/users/{user_id}/skills",   scope = "user" },    # 用户私有
  { path = "~/.miniclaw/skills",                   scope = "shared" },  # 所有用户共享（PRD §7）
  { path = "~/.agents/skills",                     scope = "import" },
  { path = "~/.claude/skills",                     scope = "import" },
  { path = "~/.codex/skills",                      scope = "import" },
  { path = "builtin",                              scope = "builtin" },
]
disabled = []   # 该用户禁用的 skill 名
always   = []   # 该用户每个 Run 都带上的 skill 名
```

> 配置格式（TOML / YAML / JSON）PRD 仍未定，这里用 TOML 只是示意。

### 5.2 规则

1. **扫描**：只看 `<root>/<name>/SKILL.md` 这一层；跳过以 `.` 开头的目录（因此不会导入 Codex 内置的 `.system`）；跟随软链
2. **realpath 去重**：同一真实路径只算一个 skill。手工软链产生的重复就此消失（本机 243 → 120）
3. **同名遮蔽**：真实路径不同但名字相同 → 取 `sources` 里靠前的，其余标记为 `shadowed`，在 TUI 里可见。优先级采用开放规范和 Gemini 的做法（工作区 > 用户），与 Claude Code 相反；因为投递是独占的（§8），runtime 自己的优先级不再起作用
4. **按 skill 粒度失败**：单个 skill 解析失败只影响它自己，标记 invalid 并附诊断，不静默丢弃，也不拖垮整个 registry
5. **工作区信任**：`workspace` 来源只在用户信任过的工作区加载，防止 clone 下来的仓库偷偷注入或覆盖 skill（Codex、Gemini 对不受信目录也会跳过）
6. **导入来源只读、按用户开启**：miniclaw 永远不写 `import` 来源的目录。这些目录属于操作系统账号而不是 miniclaw 用户，所以按用户在配置里声明（建议 onboarding 时询问），不默认给所有用户（PRD §7 按用户隔离）
7. **不可变快照**：registry 产出 Catalog 快照；P1 监听目录变化时生成新快照，已开始的 Run 不受影响

### 5.3 Catalog 条目

```ts
interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly directory: string;          // realpath
  readonly scope: 'workspace' | 'user' | 'shared' | 'import' | 'builtin';
  readonly contentHash: string;        // SKILL.md 内容的 sha256，用于审计和恢复会话时比对
  readonly requires: SkillRequirements;
  readonly referencedSkills: string[]; // 正文里 ../<name>/ 引用到的、且存在于 Catalog 的 skill
  readonly recommendedProfiles: string[];
  readonly permissionRequests: string[];
  readonly allowedTools?: string;
}
```

---

## 6. 选择（selectSkills，纯函数）

输入：Catalog、`task.skills`（显式列表）、`always`、`disabled`、profile 能力标签、环境探测结果（哪些命令 / 环境变量存在，由 infra 事先探测后传入，保证函数是纯的）、runtime 的目录预算。

1. **候选**：`task.skills ∪ always`。交互式对话没有指定时取全部已启用的 skill；**定时任务必须显式列出**——无人值守的执行要可复现（PRD F8）
2. 去掉 `disabled`
3. **依赖闭包**：递归加入 `requires.skills ∪ referencedSkills`，保证 `../arkcli-shared/` 这类引用在挂载目录里一定存在
4. **条件过滤**：`requires.bins` / `env` / `capabilities` 不满足的排除，并记录原因。**显式点名的 skill 被排除时，在创建任务时就报错**，而不是等到执行时静默缺失
5. **预算检查**：估算目录字符数，超出 runtime 预算时给出警告；显式点名的 skill 永远优先保留。运行中真的撑爆上下文，按 GATEWAY §6 的 `CONTEXT_OVERFLOW` 处理（提示缩小 skills）

输出：

```ts
interface SkillSet {
  readonly skills: ReadonlyArray<{ manifest: SkillManifest; reason: 'explicit' | 'always' | 'dependency' | 'default' }>;
  readonly excluded: ReadonlyArray<{ name: string; reason: string }>;
}
```

P1 的规则路由、P2 的模型自动挑选都是在第 1 步替换候选来源，其余步骤不变——和 PRD F5 的路由里程碑对齐。

---

## 7. 挂载（mountSkillSet）

```
~/.miniclaw/users/<user_id>/runs/<run-id>/
├── skills.lock.json        # 每个 skill 的 name / scope / realpath / hash / 被选中原因
└── skill-mount/
    └── skills/
        ├── daily-brief  -> ~/.agents/skills/daily-brief
        └── gcal-read    -> ~/.miniclaw/users/<user_id>/skills/gcal-read
```

为什么要有挂载目录，而不是直接把真实路径交给 runtime：

- **兄弟引用能解析**：依赖闭包保证 `skills/a/../b/` 按字面路径也存在，不依赖工具是按物理路径还是按字面路径解析 `..`
- **所有 runtime 看到同一个位置**：日志和提示词里的路径稳定，Run 可回放
- **零侵入、零复制**：只有软链，体积几乎为零；随 Run 目录保留，用于审计
- **恢复会话**：复用原 Run 的 lock 文件重建挂载目录；hash 变了就在 TUI 提示"skill 自上次运行后已修改"

> 待验证：Claude Code 是否跟随 plugin 目录里的软链（用户 skills 目录里的软链已确认可用，Codex 已确认跟随软链）。不跟随的话，退路是改为复制。放进契约测试。

---

## 8. 投递（每个 runtime adapter 自己实现）

### 8.1 接口

core 只多知道两件事：`RunRequest`（经 Runtime Gateway 交给 adapter，GATEWAY §2）里带着 `MountedSkillSet`，以及 adapter 的能力声明里有目录预算。两处都是在已有定义上**追加字段**，不另起接口：

```ts
interface RuntimeCapabilities {
  // …已有能力声明（GATEWAY §11）
  readonly skillCatalogBudgetChars: number;
}

interface RunRequest {
  // …已有字段
  readonly skills: MountedSkillSet; // 挂载根目录 + 冻结的 SkillSet
}
```

三种策略，由各 adapter 选定，对 core 不可见：

| 策略 | 做法 | 适用 |
|------|------|------|
| **native** | 用 runtime 自己的 skill 机制加载挂载目录，同时屏蔽它原生发现的 skill | Claude Code、OpenCode |
| **tool** | 关掉 runtime 原生 skills，注入 `<available_skills>` 目录，模型调用 §14.1 的 `activate_skill` 激活 | Codex（经 `mc-skills`）、API engine（function calling） |
| **catalog** | 同上，但让模型用自己的读文件工具读 SKILL.md | 没接 `mc-skills` 的 runtime（如 Gemini CLI，P2）；也是 tool 模式的降级 |

**注入通道只有一个**：catalog 和记忆（MEMORY §10：L0 + INDEX + 短期摘要 + PROTOCOL）都是"miniclaw 生成、每个 Run 开头注入的指令文本"。每个 adapter 只实现一次"把这段文本放进 system prompt（或最接近的位置）"，skills 和记忆共用，不各写一套（`02-dry.md`）。

### 8.2 Claude Code（native）

adapter 在挂载根目录写入 `.claude-plugin/plugin.json`（`{"name":"miniclaw"}`），然后：

```ts
query({
  prompt,
  options: {
    plugins: [{ type: 'local', path: request.skills.root }],
    skills: request.skills.names.map((name) => `miniclaw:${name}`), // 上下文里只出现选中的
    // settingSources：HARNESS §6.5 建议 []（不继承用户 engine 配置），待与 §13 一起拍板；
    // 无论取哪种，skills 白名单都保留，作为第二道过滤
  },
});
```

- 模型看到的名字是 `miniclaw:<name>`，adapter 在事件标准化时映射回原名，日志和 TUI 里只出现原名
- `skills` 白名单只过滤上下文，不是安全边界；安全边界是 policy（§10）

### 8.3 Codex（tool：目录注入 + `mc-skills` 激活）

```ts
const codex = new Codex({
  config: {
    skills: { include_instructions: false },        // 去掉 Codex 自己的 skills 目录
    developer_instructions: runInstructions,         // 共用注入通道：记忆 + playbook + skill 目录（HARNESS 附录 A.2）
    mcp_servers: {                                   // 实际由 HARNESS compile 统一生成，这里只示意 mc-skills 一项
      'mc-skills': { url: mcSkillsUrl, bearer_token_env_var: 'MINICLAW_RUN_TOKEN' },
    },
  },
  env: buildRuntimeEnvironment(profile),             // 显式构造，不继承用户 shell 环境（GATEWAY §11）
});
const thread = codex.startThread({ workingDirectory: task.workingDirectory });
await thread.runStreamed(task.prompt);
```

Codex SDK 没有系统提示词选项，但 `developer_instructions` 可以经 `-c` 追加（HARNESS 附录 A.2 已核实），共用注入通道就放在这里；是否与 SDK 版本兼容仍需契约测试确认（§13）。

`renderSkillCatalog`（`core/skills/catalog-prompt`，tool 和 catalog 两种投递共用）按规范输出：

```xml
<available_skills>
  <skill>
    <name>daily-brief</name>
    <description>汇总日历、GitHub 通知和关注的新闻，生成每日简报……</description>
    <location>/Users/me/.miniclaw/users/u1/runs/42/skill-mount/skills/daily-brief/SKILL.md</location>
  </skill>
</available_skills>
```

后面附上规范给出的说明原文：

> The following skills provide specialized instructions for specific tasks. When a task matches a skill's description, use your file-read tool to load the SKILL.md at the listed location before proceeding. When a skill references relative paths, resolve them against the skill's directory (the parent of SKILL.md) and use absolute paths in tool calls.

**为什么 Codex 不走 native**：

| 方案 | 否决原因 |
|------|----------|
| 临时 `CODEX_HOME` + 软链 | `auth.json`、MCP、会话、记忆都在里面；ChatGPT 登录的 token 刷新可能写到临时目录，把用户主配置里的凭证弄旧 |
| 往仓库写 `.agents/skills` | 侵入用户仓库 |
| app-server `skills/extraRoots/set` | 要改用 app-server 协议接入，而且只能追加、不能屏蔽其他来源；可作为 P2 再评估 |

tool 模式还有一个额外好处：Codex 对第三方模型不注入 skills 使用说明，而 miniclaw 的目录和 `activate_skill` 工具自带说明，**换 provider 行为不变**。代价是失去 `$skill-name` 显式调用语法，目录截断由 miniclaw 自己按预算处理。`mc-skills` 不可用时（宿主没起来、MCP 连接失败），降级为 catalog 模式：目录带 `<location>`，模型自己读文件。

### 8.4 OpenCode（native，P2，用来验证 OCP）

```
OPENCODE_CONFIG_CONTENT='{"skills":{"paths":["<root>/skills"]}}'
OPENCODE_DISABLE_EXTERNAL_SKILLS=1
```

OpenCode 仍会扫描 `.opencode/skills` 和 `~/.config/opencode/skills`，需要再用 `permission.skill` 白名单收口（未验证）。接入它只需新增 `adapters/opencode/`，core 零改动。

---

## 9. Provider 维度

**Profile = runtime + provider + model**。skill 怎么投递只看 runtime；provider 决定"模型是谁"。

| Provider 类型 | 走哪个 runtime | 怎么配 | skills 注意点 |
|---|---|---|---|
| Anthropic 官方 / Bedrock / Vertex / Foundry | Claude Code | `CLAUDE_CODE_USE_BEDROCK` / `VERTEX` / `FOUNDRY` | native，官方支持 |
| Anthropic 兼容端点：DeepSeek、Kimi、智谱 GLM、火山 ARK Coding Plan 等 | Claude Code | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_*_MODEL` | `Skill` 工具在客户端，照常可用；但 Anthropic 官方不保证非 Claude 模型的行为，模型会不会主动调用 skill 需要按 profile 实测 |
| OpenAI / Azure / OpenRouter / Ollama / LM Studio 等（Responses API） | Codex | `model_provider` + `[model_providers.<id>]`（经 `-c` 传入） | catalog 模式自带使用说明，行为与模型无关 |
| 只有 Chat Completions 的 provider | ⚠️ Codex 已移除 `wire_api="chat"` | 改走它的 Anthropic 兼容端点（Claude Code）、API engine（§15，待确认），或 P2 的 OpenCode | API engine 下走 tool 模式（§14） |
| 任何 provider，只要任务不需要文件 / shell | API engine（§15，待确认） | provider 原生 API（Anthropic Messages / OpenAI Responses / Chat Completions） | skill 工具走 function calling，与 provider 无关 |

```toml
# 用户配置里的 provider 定义（示意）
[providers.deepseek]
kind      = "anthropic-compatible"
base_url  = "https://api.deepseek.com/anthropic"
token_env = "DEEPSEEK_API_KEY"      # 只引用环境变量名，凭证不落配置、不进日志（F8）

# model-profiles/cheap.toml（示意）
runtime      = "claude-code"
provider     = "deepseek"
model        = "<provider 的模型名>"
capabilities = ["shell"]
```

- provider → 环境变量（Claude Code）或 `-c model_providers…`（Codex）的翻译由 adapter 负责；provider 的 schema 在 core 里只定义一次（`02-dry.md`）
- 一个 provider 账号就是 GATEWAY §3 Quota Pool 里的 account 维度，限流按它算，skills 不参与

---

## 10. 安全（与 PRD F8 的衔接）

- **skill 是不受信输入**：工作区来源要先信任（§5.2），导入来源只读
- **声明 ≠ 授予**：`allowed-tools` 和 `metadata.miniclaw.permissions` 只是申请。创建任务时展示给用户，批准后写进 Task 的 policy；无人值守的 Run 超出范围就暂停并通知
- **已核实（2026-09-10，HARNESS 附录 A.1）**：被自动放行的调用（包括激活中 skill 的 `allowed-tools`）**会**跳过 SDK 的 `canUseTool`，但**不会**跳过 PreToolUse hook。结论：Claude adapter 以 PreToolUse hook 作为逐次决策点，不把 `allowed-tools` 转成 engine 的 allow 规则（HARNESS §6.5）。仍是 Claude adapter 契约测试的必测项
- **审计**：`skills.lock.json` 记录每个 Run 用了哪些 skill 的哪个版本（hash）

---

## 11. 契约测试（每个投递实现都必须通过同一套，`01-solid.md` LSP）

| # | 断言 | Claude Code 验证方式 | Codex 验证方式 | API engine 验证方式（§15） |
|---|------|-----|-----|-----|
| 1 | 选中的 skill 出现在模型上下文 | SDK init 消息的 skills 列表 | `codex debug prompt-input`（不调用模型） | 检查发出去的请求体（`system`、`tools`），接假 provider |
| 2 | 未选中的 skill（包括用户目录里的）不出现 | 同上 | 同上 | 同上 |
| 3 | 兄弟引用 `../x/` 可读 | 读挂载路径 | `read_skill_resource` | `read_skill_resource` |
| 4 | 软链被正确跟随 | 同上 | 同上 | 同上 |
| 5 | skill 的 `allowed-tools` 不绕过 policy | 安全用例 | 不适用 | 不适用（没有内置工具） |
| 6 | 显式要求时模型确实加载了 skill | 真实模型，慢测试，按 profile 跑 | 同左 | 同左 |
| 7 | 每次激活都产生一条 `skill.activated` 事件 | `Skill` tool_use 映射 | `activate_skill` 调用 | 同左 |
| 8 | `read_skill_resource` 越界读取被拒；过期 run token 被拒 | 不适用 | `mc-skills` 单测 | 同左 |

第 6 条同时是 **provider 兼容性测试**：每新增一个 profile，跑一遍就知道这个模型会不会用 skill。

---

## 12. 里程碑映射

| 版本 | Skills 范围 |
|------|-------------|
| **v0.1** | 不含 skills（PRD F6 2026-09-10 调整）：Run 不带 skill，engine 自己发现的 skills 也关闭，保证可复现 |
| **v0.2** | 解析器 · registry（含导入来源、realpath 去重、同名遮蔽诊断）· select（显式 + always + 依赖闭包 + bins/env / engine 能力过滤）· 挂载 · Claude Code 原生投递 · **工具协议（§14.1）+ `mc-skills` + Codex 投递（tool）** · TUI skills 面板 · 目录监听热重载 · 按 skill 推荐 profile 的规则路由 |
| **v0.2+（待确认）** | API engine（§15），取决于 PRD 非目标是否收窄（§15.3） |
| **v0.3** | OpenCode / Gemini CLI 投递 · 模型自动挑选 skill · `mc-skills` 对外部 MCP client 开放 · SEP-2640 资源形式 · provider 托管 skills（§14.5）· 评估 Codex app-server 的 `extraRoots` |

> 工具协议和 `mc-skills` 必须与 Codex adapter 同批：Codex 的激活依赖它。

**Marketplace 阶段（post-MVP，按依赖排序，不绑定版本号；详见 [SKILLS-MARKETPLACE §12](./SKILLS-MARKETPLACE.md#12-里程碑post-mvp)）**：

| 阶段 | 范围 | 依赖 |
|------|------|------|
| **S1** 本地 skills | 上表 v0.2 行里 Claude 侧的部分 + 目录级 `skillHash` + 定时任务 hash 批准校验 + 挂载时校验 + 堵住 Claude Code 的三个口子（`allowed-tools` / `!` 预处理 / skill `hooks`） | Claude adapter、scheduler |
| **S2** marketplace 核心 | `local` / `git` / `github` 来源 · 扫描 + 隔离区 · 信任层级 · 安装批准 · lock · update / pin / rollback / remove | S1 |
| **S3** 更多来源 | Claude `marketplace.json` · skills.sh 搜索 · 精选索引 + 撤销列表 · 共享安装 · 视情况接 ClawHub | S2 |
| **S4** Codex 投递 | 上表 v0.2 行里 Codex 侧的部分（tool 模式 + `mc-skills`） | S1 + Codex adapter，可与 S2 / S3 并行 |

---

## 13. 待定

> 全局总表在 PRD §10；这里的问题有结论后在原处标记，并同步回 PRD §10。

- [ ] **实现语言**：属于 PRD §10 的全局选型，本设计不依赖它。给选型的输入：Claude Agent SDK 有 TS（`0.3.267`）和 Python（`0.2.152`）两个版本；Codex 官方 SDK 调研到的是 TS（`0.154.0`，本质是启动 `codex exec`），其他语言只能以子进程方式驱动 CLI
- [ ] `metadata.miniclaw` 用嵌套对象（可读，本地生态已普遍使用）还是规范要求的扁平 string→string（兼容严格校验器）
- [ ] Claude Code 是否复用用户配置：`settingSources` 保持默认（复用 permissions / MCP，只靠 `skills` 白名单过滤），还是 `[]` 完全隔离。这和 PRD §10"是否复用 Claude Code / Codex 已有的登录态和配置"、MEMORY §10"关闭或隔离 runtime 自带的记忆"是同一个决定，要一起定
- [ ] 共用注入通道在 Codex 上放哪里：首条用户消息，还是 developer instructions 类配置（需要验证 Codex 当前版本是否支持）；这个决定对记忆注入同样适用。**建议答案**：`developer_instructions`（经 `-c` 追加，HARNESS 附录 A.2 已核实存在），待契约测试确认与 SDK 版本兼容
- [ ] **API engine 是否做**（§15.3）：与 PRD §2 非目标"自研 LLM 调用层或 agent loop"冲突，需要用户拍板；已把建议文字交给 PRD 维护方，待合入 PRD §10
- [ ] `mc-skills` 是否对外部 MCP client 开放（§14.2，P2）：开放范围（哪些 SkillSet）、token 怎么发放
- [ ] API engine 的第一批 provider：只做 Anthropic Messages + OpenAI 兼容 Chat Completions（覆盖面最大），还是一开始就加 OpenAI Responses
- [ ] 交互式对话没指定 skill 时默认"全部启用"是否合适：本机 Codex 实际可见的 skill 目录约 2 万字符，上下文窗口较小的模型会超出预算（Claude Code 为上下文的 1%，Codex 为 2%），描述会被截断
- [ ] 是否需要 `inherit` 模式（保留 runtime 原生发现的 skill，miniclaw 只追加）。当前判断不需要：registry 已经导入了同样的目录，独占模式就能覆盖
- [ ] **Marketplace 前提**：miniclaw 只做客户端、不托管，精选索引只是 git 仓库里的静态文件（SKILLS-MARKETPLACE §1.1）——待用户确认
- [ ] **Marketplace 对本文的增量**（SKILLS-MARKETPLACE §3.2）：§5.1 加两个已安装根目录；§5.3 `contentHash` 改为整个目录的规范化 hash；§6 追加"定时任务 hash 批准校验"一步；§7 挂载前重新校验 hash；§11 追加 D1 / D2。待本文维护方合入
- [ ] Marketplace 其余待定项（默认来源、是否接 ClawHub、精选索引谁维护、`community` 是否 taint、共享安装授权、`disableSkillShellExecution` / `disableAllHooks`）见 [SKILLS-MARKETPLACE §13](./SKILLS-MARKETPLACE.md#13-待定)

---

## 14. 通用调用面：谁都能调用同一套 skills

> 2026-09-10 补充需求：skills 是**通用能力**，不绑定某个 engine。Claude Code、Codex、直接调用模型 API（§15），以及其他 MCP client，都能调用同一套 skills。

### 14.1 一套工具协议，唯一定义

"调用 skill"在所有接入方式下都是同三个动作，协议只在 `core/skills/tools` 定义一次（`02-dry.md`）：

| 工具 | 输入 | 返回 | 说明 |
|------|------|------|------|
| `list_skills` | 可选 `query` | 本 Run SkillSet 里每个 skill 的 `name` / `description` | 目录通常已在指令里，这个工具只是兜底 |
| `activate_skill` | `name`（enum，只能是本 SkillSet 里的名字） | `<skill_content name="…">` 包住的 SKILL.md 正文（去掉 frontmatter）+ `Skill directory: <绝对路径>` + `<skill_resources>` 资源清单（只列相对路径，**不预读**） | = **激活**，产生 `skill.activated` 事件；同一 Run 里重复激活只返回"已激活"，不重复塞正文 |
| `read_skill_resource` | `name`、`path`（相对 skill 目录） | 资源文件的文本内容；二进制只返回类型和大小 | `path` 越出 skill 目录时，只有落到本 SkillSet 里另一个 skill（兄弟引用 `../x/`）才放行，否则拒绝 |

命名和返回格式照搬开放规范的客户端实现指南（它推荐 `activate_skill`、名字用 enum 约束、返回体用 `<skill_content>` 包裹、资源只列不读）；Google ADK（`load_skill` / `load_skill_resource`）和 OpenAI Agents SDK（`load_skill`）是同一个思路，外部 agent 接 `mc-skills` 时不需要额外学习。

规则：

- **只看得到本 Run 冻结的 SkillSet**（§6），不暴露整个 Catalog；调用凭本 Run 的 run token（HARNESS §4.2），token 过期即失效
- 执行 skill 里的脚本**不在协议里**：有 shell 的 engine 用 `activate_skill` 返回的绝对路径自己跑，照常受 HARNESS §6 权限约束；没有 shell 的 engine 不能跑脚本（§14.4）
- 目录文字说明按激活方式二选一，都照搬开放规范的原文：catalog 模式用 §8.3 那段"use your file-read tool…"；tool 模式用 "The following skills provide specialized instructions for specific tasks. When a task matches a skill's description, call the activate_skill tool with the skill's name to load its full instructions."，目录里可以省掉 `<location>`（路径由 `activate_skill` 返回）

### 14.2 三种接入方式

| 接入方式 | 谁用 | 形态 | 在哪里实现 |
|----------|------|------|-----------|
| **A. engine 原生** | Claude Code（P2：OpenCode） | 挂载目录交给 engine 自己的 skill 机制（§8.2） | `adapters/<engine>/` |
| **B. `mc-skills` 工具服务器（MCP）** | Codex，以及任何 MCP client（Gemini CLI、OpenCode、用户自己的 agent） | §14.1 的三个工具，走 MCP | `infra/tools/mc-skills`，与 `mc-research` / `mc-browser` / `mc-docs` 同一个宿主（HARNESS §3 规则 3、§13） |
| **C. API function calling** | API engine（§15） | 同三个工具，按 provider 的 tool / function 格式导出 JSON Schema | `core/skills/tools` 出 schema；执行在进程内 |

- **Claude Code 为什么继续走原生**：Claude 模型针对自带的 `Skill` 工具训练过，Claude Code 还会在上下文压缩后自动重新附上已激活的 skill（§2.2）。adapter 把 `Skill` 的 tool_use 映射成同一个 `skill.activated` 事件，审计口径不变
- **Codex 从"只注入目录"改为 B**：目录仍然通过指令注入（§8.3），激活改为调用 `activate_skill`。Codex 本来就要按 Run 挂 `mc-*`（`-c mcp_servers.<id>.url`，run token 通过 `bearer_token_env_var` 传入，HARNESS 附录 A.2），`mc-skills` 不需要新机制
- **外部 MCP client**（P2，默认关）：`mc-skills` 可以对本机其他 agent 开放，只监听 localhost、必须带 token、只暴露用户指定的 SkillSet。这也是"别的程序通过 API 调用 miniclaw skills"的出口，不另做 HTTP API
- **跟进 MCP 的 skills 标准**：MCP 有一个 skills 扩展提案 SEP-2640（`io.modelcontextprotocol/skills`：每个 skill 文件是 `skill://<path>/SKILL.md` 资源，另有 `skills/list`、`skills/get`，并规定 host 必须忽略经 MCP 下发的 skill 的 `allowed-tools`）。截至 2026-09-10 它还是未合并的草案，PR 里列了 Codex、Claude Code、Gemini CLI 的原型实现。`mc-skills` v1 用工具形式（今天所有 MCP client 都支持）；提案合并、engine 正式支持后，再**追加**资源形式，工具形式保留

> 来源：开放规范客户端指南 <https://agentskills.io/client-implementation/adding-skills-support>；SEP-2640 <https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640>；ADK <https://adk.dev/skills/>

### 14.3 为什么激活要走工具，而不是都让模型自己读文件

- **没有文件系统的调用方也能用**：API engine 根本没有读文件工具
- **每次激活都有记录**：Run 日志里能看到"这个 Run 实际用了哪些 skill"，而不只是"给了哪些"。这是回放、排错和 P1 路由的依据
- **有一处执法**：`read_skill_resource` 把读取限制在 SkillSet 内，不会被 `../../` 带到别处
- **换 provider 行为一致**：激活说明写在工具描述里，与模型认不认识 skills 无关（§8.3 提到 Codex 对第三方模型不带使用说明）

### 14.4 按 engine 能力过滤 skill

§6 第 4 步的条件过滤扩展到 engine 能力（profile 的能力标签包含它所用 engine 的声明）：

| skill 的特征 | 需要的 engine 能力 | 不满足时 |
|--------------|--------------------|---------|
| 有 `scripts/` 目录，或声明了 `requires.bins` | `shell`（能在本机执行） | 不注入，排除原因写"当前 engine 不能执行脚本" |
| 声明了 `requires.capabilities` | profile 具备这些能力 | 不注入并提示 |
| 只有 SKILL.md + `references/` | 无 | 任何 engine 都可用 |

显式点名的 skill 被这条规则排除时，照样在创建任务时报错（§6）。

### 14.5 provider 托管的 skills（P2，可选）

两大模型 API 都已经原生支持开放规范的 skill，都是"上传 skill + 在 provider 的沙箱里执行"：

| provider | 上传 / 版本 | 请求里怎么用 | 限制 |
|----------|-------------|-------------|------|
| Anthropic | `/v1/skills`、`/v1/skills/{id}/versions`（已脱离 beta） | Messages API：`container.skills: [{type: "anthropic" \| "custom", skill_id, version}]` + code execution 工具 | Managed Agents 每个 agent 最多 20 个 |
| OpenAI | `/v1/skills`、`/v1/skills/{id}/versions`（zip，≤50 MB、≤500 个文件） | **只在 Responses API**：`tools: [{type: "shell", environment: {type: "container_auto", skills: [{type: "skill_reference", skill_id, version}]}}]`，也可以内联 base64 zip | 平台只把 name / description / path 放进上下文，由模型自己读 SKILL.md |

> OpenAI 的 `shell` 工具还有 `environment: {type: "local", skills: [{name, description, path}]}`：skill 留在本机，命令由调用方执行。这等于给 API engine 一个 shell，与 §15.2"不带 shell"冲突，v1 不用。

- 适用：不依赖本机的 skill（没有 `requires.bins`、不读本地文件），尤其是生成 docx / xlsx / pptx 这类需要沙箱执行的
- 限制：skill 内容会上传到 provider → 必须按 skill 显式同意（`metadata.miniclaw.hosted: allowed`，默认不允许），同步到 provider 的版本要和 lock 文件里的 hash 对得上
- 位置：只是 API engine 的一个可选能力，不改变 §14.1 的本地调用路径

---

## 15. API engine：直连模型 API 调用 skills

### 15.1 定位

在 Claude Code、Codex 之外增加第三个 engine：miniclaw 直接调用模型 API，自己跑一个**最小 tool loop**。和其他 engine 一样通过 adapter 注册、经 Runtime Gateway 启动、由 HarnessSpec 编译（HARNESS §3），core 里不出现 `if (engine === 'api')`。

| | Claude Code / Codex | API engine |
|---|---|---|
| agent loop | engine 自带 | miniclaw 的最小循环：发请求 → 执行工具调用 → 回填结果 → 直到结束或触发 RunGuard |
| 内置工具 | 文件读写、shell、补丁、网页 | **没有**。工具只有两类：§14.1 的 skill 工具，和 HarnessSpec 里声明的 `mc-*` MCP 工具 |
| provider | 受 engine 限制（§9） | Anthropic Messages、OpenAI Responses、OpenAI 兼容的 Chat Completions（DeepSeek、通义、GLM、Kimi、Ollama、vLLM 等） |
| 适合 | 改代码、改文件、要执行命令的任务 | 生成简报、摘要、改写、分类、调研报告这类只需要"读 + 写结果"的任务；engine 不支持的 provider；`cheap` 批量任务 |

### 15.2 边界

- **不做成通用 agent 引擎**：不实现文件编辑、shell、sandbox、上下文压缩、subagent。需要这些能力的任务，router 按 HARNESS §3 规则 5（engine 不满足 `engineRequirements` 就不选）自动不选它
- **权限执法不变**：API engine 自己不执行任何有副作用的动作，所有副作用都在 `mc-*` 工具服务器里，由 policy engine 决策（HARNESS §6，执行点 ③）
- **记忆、playbook、skill 目录**：API engine 完全掌握 system prompt，§8.1 的共用注入通道直接写进 system prompt
- **Gateway**：用量从 API 响应的 usage 字段读出；错误按 HTTP 状态码映射到 `ErrorKind`（需要在 GATEWAY 附录 A 补一节）
- **缓存**：目录和指令放在 system prompt 最前面并保持字节稳定，方便 provider 的 prompt caching 命中

### 15.3 与 PRD 非目标的冲突（待确认）

PRD §2 的非目标写着"自研 LLM 调用层或 agent loop"。API engine 是一个小的 agent loop，**这需要你拍板**。建议把非目标收窄为："不自研**通用** agent 引擎（文件编辑、shell、sandbox、上下文管理交给 Claude Code / Codex）；允许一个只调用 miniclaw 自有工具的最小 API engine"。确认之前，PRD 非目标不改，本节只是提案。

另一种较轻的理解是"用 API key 而不是订阅来驱动 Claude Code / Codex"。这不需要新 engine：Agent SDK 和 Codex 本来就接受 API key，§9 已覆盖。

### 15.4 契约测试

§11 增加 API engine 一列。断言 1、2 直接检查发出去的请求体（`system` 和 `tools`）；接一个假的 provider，不花钱。断言 6 按 profile 用真实模型跑。

---

## 16. Marketplace：安装第三方 skills（post-MVP）

> 详细设计见 [SKILLS-MARKETPLACE.md](./SKILLS-MARKETPLACE.md)

- **只做客户端**：聚合 GitHub / git、Claude plugin `marketplace.json`、skills.sh、精选索引（git 仓库里的静态文件）等已有来源；一个来源一个 adapter，不托管、不发布
- **装进 miniclaw 自己的目录**：默认按用户装到 `~/.miniclaw/users/<user_id>/marketplace/`（按内容 hash 存放），registry 把它当作一个普通来源扫描；共享安装需要授权，且每个用户各自批准
- **按 commit 固定 + lock**：版本 = commit SHA + 规范化内容 hash；更新从不自动，每次更新都要重新审查
- **第三方 skill 当作不受信的代码和指令**：安装前静态扫描 + 隔离区 + 显式批准；hash 变了，定时任务必须重新批准才能再用；声明 ≠ 授予，安装批准不产生任何 grant
- 对本文 §5–§7、§11 的增量列在 SKILLS-MARKETPLACE §3.2，阶段见 §12 的 S1–S4
