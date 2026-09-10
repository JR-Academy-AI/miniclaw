# miniclaw Skills Marketplace：第三方 skill 的搜索、安装、更新与供应链安全

> 版本：v0.1（草案）
> 日期：2026-09-10
> 关联：[PRD](./PRD.md) F6（Skills）· F8（安全与权限）· [SKILLS](./SKILLS.md) §4（格式）· §5（registry）· §6（选择）· §7（挂载）· §10（安全）· §11（契约测试）· §12（里程碑）· §14（调用面）· [HARNESS](./HARNESS.md) §6（权限、硬底线、审批、taint）· [GATEWAY](./GATEWAY.md) §9.1（Run 状态）· [DESIGN](./DESIGN.md) §2.4 / §5.1 / §6（Reef）
> 状态：设计草案，**post-MVP**（skills 整体排在 MVP 之后，见 §12）；技术选型未定，文中代码为 TypeScript **示意**；§1.1 的前提是假设，待用户确认

---

## 0. 一页结论

1. **miniclaw 是 marketplace 客户端，不是市场本身**：聚合已有的第三方来源（GitHub / git、Claude plugin `marketplace.json`、skills.sh、ClawHub、本地路径、精选索引），负责搜索、审查、安装、更新、固定、回滚、卸载。不运行任何服务器；精选索引只是 git 仓库里的一个静态文件
2. **一个来源 = 一个 adapter**：来源只负责"找到并钉住"（search / list / resolve → 不可变坐标）；下载、校验、扫描、落盘只有一份实现。新增来源不改 core（`01-solid.md` OCP）
3. **版本 = commit SHA / 内容摘要，不是标签**：lock 里只记不可变坐标 + 规范化内容 hash；branch / tag 只用来"检查更新"
4. **第三方 skill = 不受信的代码 + 不受信的指令**。2026 年 ClawHub 上的 ClawHavoc 一类攻击，主要手法是在 Markdown 里写"先安装前置依赖"。所以：安装前静态扫描 + 隔离区 + 显式批准；更新从不自动；hash 变了，定时任务必须重新批准才能再用
5. **扫描 ≠ 安全，声明 ≠ 授予**：扫描只是降噪，真正的边界仍然是 policy engine + 硬底线 + engine sandbox（HARNESS §6）。安装批准不产生任何 grant
6. **engine 侧有三个"装载即生效"的口子必须堵上**：Claude Code skill 的 `allowed-tools`（真实预批准）、`!`command`` 预处理（不弹确认）、frontmatter `hooks`（整个会话持续执行）（§8.7）

---

## 1. 范围与前提

### 1.1 前提（假设，待用户确认）

| # | 假设 | 如果不成立 |
|---|------|-----------|
| A1 | miniclaw 只做**客户端**：聚合现有来源，不托管 skill 包，不提供发布、账号、评分、下载统计 | 若要托管：需要后端、账号体系、审核运营，另立专题文档，并改 PRD 非目标 |
| A2 | "精选索引"（`curated`）是一个 git 仓库里的静态 `index.json`，靠 PR 维护，没有后端 | 若要动态服务：同 A1 |
| A3 | 只安装 **skill**（`SKILL.md` 目录）。plugin 里的其他组件（hooks、MCP server、commands、agents、LSP）**不安装**，在批准卡片上列为 `ignored` | 若要装 MCP / hooks：它们是 skill 之外的代码执行面，需要单独的信任设计 |
| A4 | 安装落在 miniclaw 自己的目录，**不写** `~/.claude`、`~/.codex`、`~/.agents`（SKILLS §1.3 零侵入不变） | — |

### 1.2 目标

- 在 TUI 里搜索、查看、安装、更新、固定、回滚、卸载第三方 skill，一个流程覆盖所有来源
- 安装可复现：同一份 lock 在另一台机器上还原出**逐字节相同**的内容，否则拒绝
- 用户批准前看得到：来源、发布者、提交、申请的权限、依赖的命令、脚本清单、扫描结论
- 无人值守的定时任务**永远不会**悄悄用上一个没批准过的 skill 版本

### 1.3 非目标

- 托管市场、发布流程（`publish`）、账号、评分、评论、付费
- 默认自动更新（§7.2）
- 安装 plugin 的非 skill 组件（A3）
- 替代 engine 自己的 plugin 系统：用户照样可以在 Claude Code 里 `/plugin install`，但 miniclaw 的 Run 默认独占（SKILLS §0 第 5 条），看不到那些 plugin
- 向任何来源发送遥测（skills.sh 的 CLI 默认会上报安装事件，miniclaw 不上报）
- 把扫描当作安全边界

---

## 2. 调研：第三方 skill 现在怎么分发（截至 2026-09-10）

> 来源：官方文档、各仓库源码、本机只读检查（Claude Code 2.1.267、codex-cli 0.153.4、`~/.agents/.skill-lock.json`、`~/.claude/plugins/`）。标 **待验证** 的没有找到一手来源或未实测。

### 2.1 生态总表

| 来源 | 模型 | 标识 | 版本 / 固定 | lock | 发现 / API | 安全机制 |
|------|------|------|------------|------|-----------|---------|
| **Claude Code plugin marketplace** | git 仓库里的 `.claude-plugin/marketplace.json` 目录，指向各 plugin 来源 | `plugin@marketplace`，skill 为 `plugin:skill` | plugin `source` 可带 `ref` + 40 位 `sha`；`archive` 带 `sha256`；有 `version` 时按版本号判断更新，否则按 commit / 摘要 | 无独立 lock；`~/.claude/plugins/known_marketplaces.json` + cache | 读 `marketplace.json` | 无签名；官方目录人工收录并按 `sha` 固定；本机观察到远程下发的 `blocklist.json`（文档未提及，**待验证**） |
| **skills.sh / `npx skills`**（Vercel，npm `skills` 1.5.25，2026-09-08） | GitHub 索引 + 排行榜；CLI 从 git / URL / 本地安装 | `owner/repo[@skill]` | 默认分支 HEAD；GitHub tree SHA 判断更新 | 全局 `~/.agents/.skill-lock.json`（v3，本机实测字段：`source` `sourceType` `sourceUrl` `skillPath` `skillFolderHash`(tree SHA) `pluginName` `installedAt` `updatedAt`）；项目级 `skills-lock.json`（`computedHash` = sha256） | 旧版 `GET https://skills.sh/api/search?q=`（无认证，实测 200，限额未公开）；v1 API 需 Vercel OIDC，600 次 / 分 | 2026-02-17 起接入 Gen / Socket / Snyk 审计，CLI 从 v1.4.0 起在安装前显示风险，**但不阻止安装**；恶意 skill 从榜单隐藏 |
| **ClawHub**（OpenClaw，npm `clawhub` 0.23.3） | **托管**注册表（Convex 存文件），语义搜索 | `@owner/slug`（旧的无 owner 名字仍可用但有歧义） | semver，每个版本不可变；`latest` 等标签可移动 | `<workdir>/.clawhub/lock.json` + 每个 skill 的 `.clawhub/origin.json`；本地改过则 `update` 拒绝（除非 `--force`）；支持 `pin` | `/api/v1/search`、`/download` 等；限额**未公开** | VirusTotal（2026-02-07 起，每日重扫）；ClawScan + NVIDIA SkillSpector（2026-06-01 起，Codex agent 汇总三个扫描器给出结论）；>3 个独立举报自动隐藏；GitHub 账号年龄门槛（7 天还是 14 天，**待验证**） |
| **Codex** | `$skill-installer`（系统 skill）从 GitHub 装到 `$CODEX_HOME/skills`；2026-03 起主推 plugin | 仓库 + 路径 | 只有 `--ref`，不记录用的是什么 | **无** | GitHub Contents API 列目录；codeload zip 下载，失败回退 sparse clone | 拒绝路径穿越和指向外部的软链；无 hash、无 lock、无更新。`openai/skills` 已于 2026-06-22 标为 deprecated，改用 `openai/plugins`；`codex plugin marketplace add` 也读 `.claude-plugin/marketplace.json`（源码可见，字段兼容度**待验证**） |
| **GitHub `gh skill`**（gh 2.90.0，2026-04-16，preview） | 直接从 GitHub 仓库装 | 仓库 + `skill[@version]` | 最新 release tag，否则默认分支；`--pin <tag\|SHA>` | 把 repo / ref / tree SHA **写进被安装 SKILL.md 的 frontmatter**（改写了内容） | `search` 用 GitHub code search（必须认证） | 无；GitHub 明说 skill "not verified by GitHub" |
| **其他** | Tessl（有 Snyk 评分，高危阻止安装）· JFrog Artifactory Skills 仓库（私有托管，Xray 放行 / 阻止）· SkillsMP（GitHub 索引，匿名 API 50 次 / 天）· Smithery · skillkit · skills-npm（skill 放在 npm 包里） | | | | | 只有 Tessl、JFrog 在安装时强制安全门 |
| **Agent Skills 规范**（agentskills.io） | 只定义格式 | — | — | — | **不定义** registry、发现、打包、版本、签名 | 客户端指南建议对项目级 skill 做信任闸门 |
| **Cloudflare discovery RFC**（草案 v0.2.0，2026-03-12） | `/.well-known/agent-skills/index.json` | 站点 + `name` | 每个条目带 `sha256:` `digest` | — | 静态索引 | 无签名；agentskills.io 没有引用，`npx skills` 支持。是否会成为标准：**待验证** |

### 2.2 安全事件与教训

| 日期 | 来源 | 事件 | 手法 | 对 miniclaw 的教训 |
|------|------|------|------|-------------------|
| 2026-01-28 | [Cisco](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare) | ClawHub 排名第一的 skill 用 `curl` 静默外发数据 | 伪造热度 + prompt injection | **下载量不是信任** |
| 2026-02-01 | Koi Security "ClawHavoc"（[THN](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html)） | 2,857 个 skill 里 341 个恶意，335 个投放 Atomic macOS Stealer；后续统计为约 10,700 个里 824 个 | 伪造 "Prerequisites" 段落，引导下载带密码的 zip 或粘贴站脚本；名字仿冒（`clawhubb`）；外发 `~/.clawdbot/.env` 到 webhook.site；反弹 shell 藏在正常代码里 | 扫描**所有文本**，不只脚本；仿冒名检测 |
| 2026-02-02 | [1Password](https://1password.com/blog/from-magic-to-malware-how-openclaws-agent-skills-become-an-attack-surface) | 下载量最高的 "Twitter" skill 要求安装假依赖 `openclaw-core` | 解码隐藏载荷 → 下载二进制 → 去掉 macOS quarantine 标记 | "Markdown is an installer"：正文里的安装指令就是攻击面 |
| 2026-02 | [VirusTotal](https://blog.virustotal.com/2026/02/from-automation-to-infection-part-ii.html) | 分析 3,016 个 skill，单个账号发布 314 个恶意 skill | 往 `authorized_keys` 加公钥、偷 `.env`、改 agent 的 SOUL.md / AGENTS.md 实现跨会话持久化 | 禁止 skill 改 agent 自己的配置与记忆 |
| 2026-02-05 | [Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/) | ClawHub + skills.sh 共 3,984 个 skill：13.4% 有严重问题，76 个确认恶意，其中 91% 同时用了恶意代码和 prompt injection | base64、Unicode 走私、伪造 system 消息；10.9% 的 ClawHub skill 硬编码了 secret | 解码后重扫；不可见字符直接拒绝 |
| 2026-06-23 | [Unit 42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/) | 平台上线扫描后，攻击者随即调整手法 | README 填充到 22 MB，超出扫描器的大小限制；每次运行从网络拉新指令；伪装成"自动更新"写 cron；经 Telegram bot 外发 | **超限直接拒绝**，不能截断后再扫；运行时拉取指令要标记 |
| 2026-06-01 | [HF / OpenClaw](https://huggingface.co/blog/OpenClaw/clawhub-security-signals) | 67,453 个 skill 上三个扫描器的结论两两重合度（Jaccard）≤ 0.104 | — | 扫描器之间很少一致，**不能单靠扫描器下结论** |
| 2026-07 | 学术研究（[转述](https://cybersecuritynews.com/agent-skill-malware-targets-claude-code-and-openai-codex/)，原文**待验证**） | 约 1,600 个恶意样本对 8 个扫描器的规避率达 80–90% | 改写可疑字符串、自解包 | 同上 |
| 2026-01-06 | [SentinelOne](https://www.sentinelone.com/blog/marketplace-skills-and-dependency-hijack-in-claude-code/)（PoC） | Claude Code marketplace plugin 可以悄悄把 `pip install` 指向攻击者的源 | 改包管理器配置 | 检测包源改写 |

另有论文统计：31,132 个 skill 中 26.1% 至少有一个漏洞，带脚本的 skill 出问题的概率是不带脚本的 2.12 倍（[arXiv 2601.10338](https://arxiv.org/abs/2601.10338)）。

### 2.3 结论

1. 生态里**没有签名**（Claude、skills.sh、`gh skill`、Codex 都没有），可依赖的只有"按 commit / 摘要固定"
2. 各家 lock 不通用（skills.sh 用 GitHub tree SHA，ClawHub 用 semver + 文件 hash，`gh skill` 直接改写 SKILL.md），miniclaw 需要自己的 lock 和与传输方式无关的内容 hash
3. 大多数来源最终指向 GitHub 仓库 → 以 git 传输为主，其他来源只是"发现"
4. 平台侧的扫描有用但会被绕过，结论只作为参考信号展示；本地仍要自己扫描，运行时仍要靠 policy 执法
5. Codex 自带的 `$skill-installer` 会在 Run 里直接写 `$CODEX_HOME/skills`：miniclaw 的 Run 里 **agent 不能安装 skill**（§8.5）

---

## 3. 总体架构

```
 MarketplaceSource（每个来源一个 adapter）             ArtifactFetcher（按 artifact 类型，共用）
 github · git · local · claude-marketplace ·           git · archive · local-dir
 skills-sh · clawhub · curated
        │ search / list / resolve                              │ fetch → staging（限额、穿越检查、摘要校验）
        ▼                                                      ▼
 ┌─────────────┐ ResolvedPackage ┌──────────────┐ StagedPackage ┌─────────────┐ ScanReport ┌──────────────┐
 │  installer  │ ──────────────► │    fetch     │ ────────────► │ scanPackage │ ─────────► │ planInstall  │
 │  （编排）   │                 │   + verify   │               │  （纯函数） │            │  （纯函数）  │
 └─────────────┘                 └──────────────┘               └─────────────┘            └──────┬───────┘
                                                                                                  │ InstallPlan
                                         TUI 批准卡片（approval broker，HARNESS §6.6）  ◄──────────┘
                                                        │ 用户批准
                                                        ▼
                         store/<packageHash>/ + skills/<name> 软链 + marketplace/lock.json
                                                        │
                                                        ▼
                                  SkillRegistry（SKILLS §5）照常扫描 → Catalog
```

### 3.1 模块职责

| 模块 | 职责 | 性质 |
|------|------|------|
| `core/marketplace/model` | `PackageId`、`ResolvedPackage`、`LockEntry`、`ScanReport`、`InstallPlan`，唯一定义 | 类型 |
| `core/marketplace/source` | `PackageResolver` / `PackageCatalog` 接口 + 注册表 | 接口 |
| `core/marketplace/scan` | 文件内容 → findings，规则表驱动，规则集带版本 | 纯函数 |
| `core/marketplace/plan` | 安装 / 更新计划：选中的 skill、同包依赖、冲突、权限增量、是否需要完整重新批准 | 纯函数 |
| `core/marketplace/installer` | 编排 resolve → fetch → scan → plan → 批准 → commit | 编排，副作用经端口 |
| `core/skills/hash` | 规范化目录 hash（§5.3），registry、installer、mount 共用 | 纯函数 + 读文件端口 |
| `infra/marketplace/fetch` | git / archive / local-dir 三种传输，统一限额与安全检查 | 副作用 |
| `infra/marketplace/store` | store 写入、软链原子切换、lock 读写、启动时对账 | 副作用 |
| `infra/marketplace/sources/<id>` | 各来源 adapter（多 provider 目录，父目录必须有 `AGENTS.md`，`07-nested-agents-md.md`） | 副作用 |

**关键边界**：installer 从不执行任何下载来的文件；registry 不安装、不联网；来源 adapter 不下载、不判断安全。

### 3.2 需要并入 SKILLS.md 其他章节的增量（待 SKILLS.md 维护方合入）

本文不改 SKILLS.md 的这些章节，只在这里列出增量，章节号保持不变：

| 章节 | 增量 |
|------|------|
| SKILLS §5.1 | 来源列表加两项已安装根目录（由 marketplace 管理，位置固定）：`~/.miniclaw/users/{user_id}/marketplace/skills`（排在用户手写目录之后、共享目录之前）；`~/.miniclaw/marketplace/skills`（排在共享手写目录之后、导入来源之前）。用户手写的同名 skill 永远遮蔽已安装的 |
| SKILLS §5.2 | 新增规则：已安装根目录只有 installer 能写；registry 发现某个已安装 skill 的 hash 与 lock 不符 → 标 invalid（`tampered`），不进 Catalog |
| SKILLS §5.3 | `contentHash` 从"SKILL.md 的 sha256"改为"整个 skill 目录的规范化 hash"（本文 §5.3）：脚本变了也要能发现；新增 `provenance: { kind: 'local' } \| { kind: 'installed'; packageId; commit; trust }` |
| SKILLS §6 | 新增一步（放在最后，不改前 5 步的编号）：**批准校验**，仅无人值守——每个 skill 的当前 hash 必须等于任务记录的已批准 hash，否则整个 Run 不启动（本文 §8.6） |
| SKILLS §7 | 挂载前重新计算所选 skill 的 hash，与 Catalog 快照（已安装的还要与 lock）比对，不符则拒绝挂载；`skills.lock.json` 每项增加 `packageId` / `commit`（已安装的才有） |
| SKILLS §10 / §11 | 本文 §8.7 的三个口子，以及 §11 新增的投递契约测试 |

---

## 4. 来源抽象（MarketplaceSource）

### 4.1 接口

来源分两个角色（`01-solid.md` ISP）：**resolver** 把用户给的引用钉成不可变坐标，**catalog** 提供搜索和浏览。一个来源实现其中一个或两个；注册表按角色调用，不存在"调用了不支持的方法"。

```ts
interface PackageResolver {
  readonly sourceId: string;                          // 'github' | 'claude-marketplace:<name>' | …
  canResolve(ref: PackageRef): boolean;               // 纯函数：是否认得这种引用写法
  resolve(ref: PackageRef, signal: AbortSignal): Promise<ResolvedPackage>;
}

interface PackageCatalog {
  readonly sourceId: string;
  search(query: SearchQuery, signal: AbortSignal): Promise<ListingPage>;
  list(cursor: PageCursor | undefined, signal: AbortSignal): Promise<ListingPage>;
}

interface ResolvedPackage {
  readonly id: PackageId;                             // 由 artifact 推导，与发现渠道无关（§5.1）
  readonly via: string;                               // 从哪个来源发现的，只用于审计和展示
  readonly artifact: GitArtifact | ArchiveArtifact | LocalArtifact;  // 不可变坐标
  readonly skillPaths: readonly string[];             // 包内每个 skill 目录的相对路径
  readonly publisher: string;                         // 来源声明的发布者，只展示，不作信任依据
  readonly signals: readonly ExternalSignal[];        // 来源自带的审计结论（skills.sh audit、ClawHub scan），只展示
  readonly ignoredComponents: readonly string[];      // plugin 里不安装的组件：hooks、mcpServers、commands…
}

type GitArtifact     = { kind: 'git'; url: string; trackedRef?: string; commit: string; subpath: string };
type ArchiveArtifact = { kind: 'archive'; url: string; sha256: string };
type LocalArtifact   = { kind: 'local'; path: string };   // 安装时复制进 store，不软链到原位置
```

- **`fetch` 不在来源接口里**：下载和校验按 artifact 类型由 `infra/marketplace/fetch` 统一实现。所有来源共用同一套限额和穿越检查——安全判断出现第 2 次就必须收敛（`02-dry.md`）
- **resolve 必须返回不可变坐标**：git 必须是 40 位 commit，archive 必须带 sha256。来源只给出可移动的引用（branch、tag、`latest`）时，resolve 负责把它钉住；钉不住就返回 `SOURCE_INVALID`
- **resolve 不执行任何代码**：Claude marketplace 的 `command` 类型来源一律不支持（`UNSUPPORTED_SOURCE`）
- 错误用一个小的类型化枚举：`OFFLINE` · `RATE_LIMITED{retryAfter}` · `AUTH_REQUIRED` · `NOT_FOUND` · `INTEGRITY_MISMATCH` · `LIMIT_EXCEEDED` · `UNSUPPORTED_SOURCE` · `SOURCE_INVALID`。它不是 GATEWAY 的 `ErrorKind`，因为安装不是 Run，不经过 Gateway

### 4.2 来源一览

| sourceId | 角色 | 引用写法 | resolve 结果 | 认证 | 阶段 |
|----------|------|---------|-------------|------|------|
| `local` | resolver | `./path`、`/abs/path` | local（复制进 store） | — | S2 |
| `git` | resolver | `https://…/repo.git[#ref][:subpath]`、`git@…` | git + commit | 本机 git 凭证（私有仓库） | S2 |
| `github` | resolver + catalog | `owner/repo[/path][@ref]`、GitHub `tree/<ref>/<path>` URL | git + commit；在仓库里找 `skills/*/SKILL.md` 或指定路径 | 可选 token（§10.3）；search 走 code search，**必须**有 token | S2 |
| `claude-marketplace:<name>` | resolver + catalog | `plugin@<name>`、`plugin@<name>/skill` | 按 plugin `source` 映射：相对路径 / `github` / `url` / `git-subdir` → git；`archive` → archive；`npm` → 待定；`command` → 不支持 | — | S3 |
| `skills-sh` | catalog | 搜索结果里的 `owner/repo@skill` | 交给 `github` resolver；skills.sh 审计结果作为 `signals` | —（只用无认证的旧版搜索；v1 API 需 Vercel OIDC，不用） | S3 |
| `curated` | catalog | 索引里的包 id | 索引里写死的 commit + packageHash | — | S3 |
| `clawhub` | resolver + catalog | `@owner/slug[@version]` | archive + sha256（API 细节**待验证**） | 待验证 | S3，是否接入待定（§13） |
| `well-known` | resolver | `https://site/`（读 `/.well-known/agent-skills/index.json`） | archive + digest | — | 草案未被采纳，暂不做 |

新增一个来源 = 在 `infra/marketplace/sources/<id>/` 实现角色接口 + 注册 + 通过 §11 的契约测试，core 零改动。

### 4.3 来源配置

```toml
# ~/.miniclaw/users/<user_id>/ 下的用户配置（示意）
[marketplace]
sources = [                                          # 顺序 = 搜索结果合并时的排序
  { id = "github" },
  { id = "claude-marketplace", repo = "anthropics/skills" },
  { id = "skills-sh" },
  { id = "curated", repo = "<待定>/miniclaw-skill-index", commit = "<40 位>" },  # 索引本身也按 commit 固定
]
github_token_env = "GITHUB_TOKEN"   # 只写环境变量名，值不落配置、不进日志（HARNESS §6.8）
update_check     = "manual"         # manual | daily（daily 只检查、只提示，从不下载安装）
```

- 添加来源本身要确认：一个 `marketplace.json` 就是别人维护的一份目录，TUI 显示它的仓库、owner 和条目数后再加入
- 默认启用哪些来源：见 §13

---

## 5. 包标识与版本

### 5.1 PackageId：按 artifact 定，不按发现渠道

| artifact | PackageId | 展示名 |
|----------|-----------|--------|
| git | `<host>/<owner>/<repo>/<subpath>`，例：`github.com/anthropics/skills/skills` | `anthropics/skills` |
| archive（ClawHub） | `clawhub.ai/<owner>/<slug>` | `@owner/slug` |
| local | `local:<realpath>` | 目录名 |

- 同一个 GitHub skill 不管是从 skills.sh、Claude marketplace 还是直接输入 URL 找到的，都是**同一个包**：lock 不因发现渠道变化而分裂，搜索结果按 PackageId 去重。发现渠道记在 `via` 里
- **包是获取和锁定的单位**，一个包里有 1 个或多个 skill（bundle，例如 `anthropics/skills` 的 `document-skills` 含 xlsx / docx / pptx / pdf）

### 5.2 版本

| 概念 | 定义 | 用途 |
|------|------|------|
| `trackedRef` | 安装时指定的 branch / tag；没指定就用来源声明的 ref 或默认分支 | **只**用于检查更新 |
| `commit` | 40 位 commit SHA | lock 里的真正版本；获取永远按 commit，不按 tag（tag 可以被移动） |
| `packageHash` / `skillHash` | 规范化内容 hash（§5.3），分别针对整个包和单个 skill 目录 | 判断"内容变没变"的**唯一**依据 |
| `treeSha` | git 里 subpath 对应的 tree SHA | 更新检查的廉价比对（§10.3），不作为信任依据 |
| 来源版本号 | `metadata.version`、plugin.json `version`、ClawHub semver | 只展示，不参与任何判断 |

同一个 commit 取回来的内容 hash 必须和 lock 一致，否则当作篡改：`INTEGRITY_MISMATCH`，不安装。

### 5.3 规范化内容 hash（唯一定义，放 `core/skills/hash`）

- `sha256` 作用于排序后的条目列表，每条是 `相对路径 \0 类型 \0 可执行位 \0 内容 sha256`，写作 `sha256-<hex>`
- 排除 `.git/`；不看时间戳和其他权限位
- 包内软链：只允许指向包内的相对软链，按链接目标字符串计入；指向包外或绝对路径的软链在 fetch 阶段就拒绝
- 与传输方式无关（git / archive / local 算出来一样），可以离线校验。本地手写 skill 用同一个函数（§3.2 对 SKILLS §5.3 的增量）
- 性能：registry 扫描时按 `(realpath, size, mtime)` 缓存；挂载时对本 Run 用到的 skill 重新计算，不走缓存（§7.4）

### 5.4 名字冲突

运行时看到的名字是 SKILL.md 的 `name`（= 目录名，规范要求），同一个用户视图里一个名字只能对应一个生效的 skill（SKILLS §5.2 规则 3）。

| 情况 | 处理 |
|------|------|
| 要装的 skill 与另一个**已安装**包里的 skill 同名 | 卡片上显示冲突，只能二选一：`replace`（卸载旧的那个 skill）或取消 |
| 与用户手写 / 工作区 skill 同名 | 警告"安装后会被你的本地 skill 遮蔽"，仍可安装 |
| 与 official / curated / 已安装的 skill 名字编辑距离 ≤ 2 且发布者不同 | 扫描 `name.typosquat` 警告 |
| 想用别名同时装两个 | **不支持**：改名要改写 SKILL.md（SKILLS §1.4 非目标），还会弄断 `../<name>/` 兄弟引用 |

### 5.5 依赖与兄弟引用

- 生成计划时计算包内每个 skill 的 `requires.skills` 和 `../<name>/` 引用（本机 `~/.agents/skills` 里 37 / 59 个 skill 有这种引用，SKILLS §1.1）
- **同包内**被引用的 skill 自动加入选择，卡片上标 `dependency`
- 包外的依赖只在已安装 / 本地的 skill 里找；找不到就在卡片上标 `unresolved`。**绝不按名字自动从其他来源拉取**：按名字跨来源解析就是依赖混淆（dependency confusion）
- store 按**包**存放，同一个包里的 skill 在物理上也是兄弟目录，按物理路径和按字面路径解析 `..` 都能找到；跨包的兄弟引用由 SKILLS §7 的挂载目录保证

---

## 6. 安装流程

### 6.1 步骤

| # | 步骤 | 做什么 | 失败时 |
|---|------|--------|--------|
| 1 | resolve | 引用 → `ResolvedPackage`（不可变坐标） | 类型化错误，TUI 说明原因和修复方法 |
| 2 | fetch | 下载到 `staging/<随机 id>/`；统一限额与检查（下表） | 删除 staging，报错 |
| 3 | verify | archive 校验 sha256；git 确认 commit 存在；计算 `packageHash` / `skillHash` | `INTEGRITY_MISMATCH`，删除 staging |
| 4 | parse | 每个 SKILL.md 走 `core/skills/parse`（与 registry 同一个解析器）；缺 `description` 的 skill 不可安装；`name` ≠ 目录名 → 警告 | 该 skill 不可选，其余照常 |
| 5 | scan | `scanPackage(files) → ScanReport`（§8.3） | `block` → 移入隔离区（§8.4） |
| 6 | plan | `planInstall(...)`：选中的 skill + 同包依赖、冲突、权限申请（按 HARNESS §9 映射成 capability id）、`requires.bins` / `env` 是否满足、忽略的组件、信任层级、外部信号 | — |
| 7 | 批准 | TUI 批准卡片（§8.8），默认焦点是取消 | 取消 → 删除 staging |
| 8 | commit | staging → `store/<packageHash>/`（同一文件系统，原子 rename，然后设为只读）→ 写 lock（临时文件 + fsync + rename）→ 原子替换 `skills/<name>` 软链 | 任一步失败都能由启动时对账修复：**lock 是唯一真相**，软链按 lock 重建，没有 lock 引用的 store 条目等 GC |
| 9 | 生效 | registry 生成新的 Catalog 快照；已开始的 Run 不受影响（SKILLS §5.2 规则 7） | — |

**fetch 统一限制**（不可配置，所有来源共用）：

| 项目 | 规则 |
|------|------|
| 大小 | 包 ≤ 25 MiB、文件数 ≤ 1000、单个文本文件 ≤ 1 MiB；**超限直接拒绝**，不截断后再扫（Unit 42：22 MB 的 README 就是为了撑爆扫描器） |
| 路径 | 拒绝绝对路径、`..`、指向包外的软链、设备文件 / FIFO；清除 setuid / setgid |
| git | 不递归 submodule；禁用 hooks（`core.hooksPath` 指向空目录）；禁用 LFS 和 `filter.*` / smudge；`GIT_TERMINAL_PROMPT=0`；只取 `subpath` |
| 网络 | 只允许 HTTPS / SSH；拒绝指向 localhost、内网网段、云元数据地址的 URL（与 HARNESS `net.read.private` 同一张表） |
| 执行 | **不执行任何下载来的文件**，包括所谓的安装脚本 |

### 6.2 装到哪里、谁能装

| 目标 | 路径 | 谁能安装 / 更新 / 卸载 | 谁能用 |
|------|------|----------------------|--------|
| **用户**（默认） | `~/.miniclaw/users/<user_id>/marketplace/` | 该用户 | 该用户 |
| **共享**（`--shared`） | `~/.miniclaw/marketplace/` | 全局配置 `~/.miniclaw/config.toml` 里 `[marketplace] shared_installers` 列出的用户；默认为空，即共享安装关闭 | 所有用户**可见**，但每个用户必须**自己批准一次**（记在自己的 lock 的 `sharedApprovals` 里）才会进入自己的 Catalog |

- 理由：权限和 grant 是按用户的（HARNESS §6.3），别人替你批准的代码不能直接进你的 Run；和 SKILLS §5.2 规则 6"导入来源按用户开启"是同一个原则
- 共享包更新后，每个用户的 `sharedApprovals` 按 hash 失效，需要各自重新批准
- 已安装的 skill 和手写的 skill 分开存放：卸载和更新永远不碰用户自己写的文件

### 6.3 目录布局

```
~/.miniclaw/
├── marketplace/                      # 共享安装（只有 shared_installers 可写）
│   ├── store/<packageHash>/…         # 按内容 hash 存放，写入后只读
│   ├── skills/<name> -> ../store/<packageHash>/<subpath>/<name>
│   └── lock.json
├── cache/marketplace/                # 公共数据缓存（§10），可以随时删除
└── users/<user_id>/
    ├── skills/                       # 用户手写的 skill（不变，SKILLS §5.1）
    └── marketplace/
        ├── staging/<id>/             # 下载中 / 待批准；registry 不扫描，永远不挂载
        ├── quarantine/<id>/          # 扫描 block、被撤销或 hash 不符的包 + 报告，保留 7 天
        ├── store/<packageHash>/…
        ├── skills/<name> -> ../store/<packageHash>/<subpath>/<name>
        └── lock.json                 # 已安装包的 lock（与每个 Run 的 skills.lock.json 不是一回事）
```

- **按内容 hash 存放**带来三个性质：回滚不需要网络；更新时正在跑的 Run 仍然指向旧目录，不受影响；hash 校验就是看目录名和内容是否对得上
- 硬底线增量：agent **不能写** `~/.miniclaw/**/marketplace/`，**不能读** `lock.json`、`staging/`、`quarantine/`；store 只能经本 Run 的挂载目录只读访问——**已合并进 HARNESS §6.4（2026-09-10）**

---

## 7. Lockfile、更新、固定、回滚、卸载

### 7.1 lock 条目

```json
{
  "lockVersion": 1,
  "packages": {
    "github.com/anthropics/skills/skills": {
      "via": "claude-marketplace:anthropic-agent-skills",
      "artifact": {
        "kind": "git", "url": "https://github.com/anthropics/skills.git",
        "trackedRef": "main", "commit": "<40 位>", "subpath": "skills", "treeSha": "<40 位>"
      },
      "packageHash": "sha256-…",
      "skills": { "pdf": "sha256-…", "xlsx": "sha256-…" },
      "trust": "official",
      "pinned": false,
      "scan": { "rulesVersion": "2026.09.1", "verdict": "warn", "findings": ["net.exfil pdf/scripts/fetch.py:12"] },
      "approval": { "packageHash": "sha256-…", "at": "2026-09-10T12:00:00Z", "requested": ["shell.exec:python3 *"], "overrides": [] },
      "history": [ { "commit": "<40 位>", "packageHash": "sha256-…", "at": "2026-08-01T09:00:00Z" } ],
      "installedAt": "2026-08-01T09:00:00Z",
      "updatedAt": "2026-09-10T12:00:00Z"
    }
  },
  "sharedApprovals": { "<packageId>": { "packageHash": "sha256-…", "at": "…" } }
}
```

- lock 由 installer 独占写入，agent 不可见（§6.3）
- 可复现：`/skills restore`（新机器或 store 被删后）按 lock 重新获取，每个包的 `packageHash` 必须一致，否则停下来报告

### 7.2 更新规则

| 规则 | 默认 |
|------|------|
| 检查更新 | 手动（`/skills update --check`）；可配 `update_check = "daily"`，但**只检查、只提示** |
| 自动安装更新 | **没有这个选项**。定时任务遇到 hash 变化本来就要重新批准（§8.6），自动更新对无人值守没有意义，只会扩大攻击面 |
| 更新 = 一次新的安装 | 完整走 §6.1：resolve → fetch → verify → scan → plan → 批准 |
| 差异展示 | 文件级增删改（脚本和可执行文件高亮）· SKILL.md 正文 diff · frontmatter 字段 diff · 权限申请增量 · `requires` 增量 · 扫描结论增量 · 信任层级变化 · 提交数和作者（git 可得时） |
| 需要**完整重新批准**（与首次安装同一张卡片） | 满足任一条：权限申请变多 · 新增脚本或可执行文件 · 新增 `warn` 及以上发现 · 信任层级降低 · 发布者或 artifact URL 变化 · 新增 `hooks` / `!` 预处理 / `model` 等 frontmatter |
| 其他更新 | 一屏 diff + 显式按键确认，仍然是用户操作 |
| 批量更新 | `/skills update --all` 逐个包出卡片；**不提供"全部同意"** |

### 7.3 固定、回滚、卸载

| 操作 | 规则 |
|------|------|
| 固定（`pin`） | 所有包本来就锁在 commit 上；`pin` 的含义是"检查更新和 `--all` 时跳过"。对被固定的包执行 `/skills update <name>` 时，先提示"已固定，是否解除并更新" |
| 回滚（`rollback`） | 切回 `history` 里的上一个（或指定的）版本；store 里还在就不需要网络，不在就按 commit 重新获取并校验 hash。目标 hash 曾被批准过 → 不需要重新批准安装；定时任务按任务里记录的 hash 判断（§8.6），回滚到任务批准时的版本等于自动恢复可用 |
| 保留 | 每个包保留当前版本 + 最近 2 个版本；被未结束的 Run，或仍在保留期内的 Run 的 `skills.lock.json` 引用的 store 条目不删 |
| 卸载（`remove`） | 删除软链和 lock 条目，store 条目交给 GC；先列出引用了该 skill 的任务，确认后才执行。这些任务下次运行时在 select 阶段报错（显式点名的 skill 不在 Catalog 里，与 SKILLS §6 第 4 步"显式点名的 skill 被排除即报错"同一原则），不会静默跳过 |
| GC | 由 scheduler 的内部维护任务触发（与 WORKSPACE §5.2 janitor 同一时机），不是 Run，不经过 Gateway；只删 `store/`、`quarantine/`、`staging/` 下的一级目录，删除前取 realpath 校验前缀（WORKSPACE §5.4 同一套安全规则） |

### 7.4 挂载时校验

- SKILLS §7 挂载前，对本 Run 的每个 skill 重新计算 `skillHash`：已安装的与 lock 比对，其他的与 Catalog 快照比对
- 不一致 → **拒绝启动这个 Run**，报 `SKILL_TAMPERED`；已安装的包移入隔离区并通知。这能拦住选好之后、挂载之前被改掉的情况，也能拦住绕过 installer 直接改 store 的情况

---

## 8. 信任与供应链安全

### 8.1 威胁与对策

| 威胁 | 例子 | 对策 |
|------|------|------|
| 正文诱导执行 | "Prerequisites: run `curl … \| bash`"（ClawHavoc） | 扫描 block（§8.3）· `shell.exec` 默认 ask · 硬底线 |
| 脚本窃取凭证 | 读 `~/.ssh`、`.env`、浏览器 profile、钱包 | 硬底线（HARNESS §6.4）· 扫描 |
| 装载即执行 | Claude Code `!`command`` 预处理、frontmatter `hooks` | engine 侧关闭 / 拒绝安装（§8.7） |
| 预批准工具 | Claude Code 的 `allowed-tools` 在调用 skill 的那一轮真的免确认 | PreToolUse hook 逐次决策（SKILLS §10、HARNESS 附录 A.1） |
| 触发劫持 | description 写"每个任务都要用我" | 扫描 warn · 独占投递 + 显式选择（SKILLS §6） |
| 名字仿冒 | `githhub-digest` | 扫描 warn · 同名不自动替换（§5.4） |
| 上游被接管 / 更新投毒 | 作者账号被盗后推送恶意 commit | 按 commit 固定 · 不自动更新 · 更新重新审查 · hash 变了定时任务要重新批准 |
| 可变引用 | tag 被移动 | 只信 commit / 摘要（§5.2） |
| 依赖混淆 | `requires.skills` 按名字从任意来源拉 | 只在同包和已安装里解析（§5.5） |
| 本地篡改 | agent 或其他程序改了已安装的 skill | store 只读 · 硬底线 · 挂载时校验 hash（§7.4） |
| 下架了但本地还在 | ClawHub 删了恶意 skill，用户机器上还留着 | 撤销列表 + `/skills audit` 用新规则重扫（§8.4） |
| 下载阶段攻击 | zip slip、软链逃逸、超大文件、git hook / filter | fetch 统一限制（§6.1） |
| 运行时拉取指令 | 每次运行从网络取新指令（Unit 42 "money-radar"） | 扫描 warn · 这类 Run 本来就会因读网页被 taint（HARNESS §6.7） |
| 改 agent 自身配置 | 改 AGENTS.md / CLAUDE.md / 记忆 / engine 权限设置 | 扫描 block · 硬底线 · 记忆写入只能走 staging + eval（MEMORY-EVAL） |

### 8.2 信任层级

层级由 **miniclaw 自己判定**，不采信来源的自我声明。

| 层级 | 判定 | 安装摩擦 | 运行时 | 展示 |
|------|------|---------|--------|------|
| `builtin` | 随 miniclaw 发布 | — | 正常 | `builtin` |
| `local` | 用户手写目录，或从本地路径安装 | 扫描照做，结论只提示 | 正常 | `local` |
| `official` | artifact 所在仓库的 owner 在内置名单里（默认名单见 §13） | 标准卡片 | 正常 | `official` |
| `curated` | **这个 commit** 出现在用户启用的精选索引里；同一个包的新 commit 在被重新收录前按 `community` 处理 | 标准卡片 | 正常 | `curated` |
| `community` | 其他所有 | 标准卡片；每条 `warn` 发现都要逐条确认 | 被激活（`skill.activated`，SKILLS §14.1）的 Run 标为 tainted（HARNESS §6.7），来源记为 `skill:<packageId>` | `community` |
| `quarantined` | 有未覆盖的 `block` 发现、在撤销列表里、或 hash 不符 | 不能启用 | 不进 Catalog | `✗ quarantined` |

**不变量**：层级**从不**授予权限、**从不**跳过扫描、**从不**跳过批准。它只影响摩擦大小、taint 和展示。

### 8.3 静态扫描

`scanPackage` 是纯函数，规则表驱动，规则集带版本号（`rulesVersion`）。扫描**包内所有文本文件**（SKILL.md、`references/`、脚本、README），不只看脚本；长度超过 200 的 base64 / hex 串解码后递归重扫。

| 规则 id | 级别 | 检测 | 依据 |
|---------|------|------|------|
| `exec.remote-pipe` | block | `curl` / `wget` / `iwr` 的输出直接交给 `sh` / `bash` / `python` / `iex`；`bash <(curl …)` | ClawHavoc、1Password |
| `exec.download-run` | block | 下载后 `chmod +x` 再执行；从粘贴站（glot.io、rentry、pastebin）、裸 IP、短链下载 | ClawHavoc |
| `exec.gatekeeper-bypass` | block | `xattr -d com.apple.quarantine`、`spctl --master-disable` | 1Password（AMOS） |
| `archive.encrypted` | block | 包内有带密码的压缩包，或正文要求解压带密码的包 | ClawHavoc |
| `file.binary` | block | 可执行二进制（Mach-O / ELF / PE）、`.pkg` / `.dmg` / `.app`、`.pyc` | Cisco skill-scanner 同类规则 |
| `obfuscation.encoded-exec` | block | 编码串解码后执行：`base64 -d \| sh`、`eval(atob(…))`、`exec(bytes.fromhex(…))` | Snyk ToxicSkills |
| `text.invisible` | block | 零宽字符、Unicode tag 字符（U+E0000–E007F）、bidi 控制字符 | Snyk（Unicode 走私） |
| `persist` | block | 写 crontab、launchd plist、shell rc、`authorized_keys`、git hooks；伪装成"自动更新" | VirusTotal、Unit 42 |
| `agent.config-tamper` | block | 要求修改 AGENTS.md / CLAUDE.md / SOUL.md / 记忆文件、engine 权限设置；出现 `bypassPermissions`、`--dangerously-skip-permissions`、`danger-full-access` | VirusTotal（跨会话持久化） |
| `frontmatter.hooks` | block（第三方）/ warn（`local`） | frontmatter 含 `hooks` | Claude Code：skill hooks 被调用后在整个会话里持续执行（§8.7） |
| `cred.path` | warn；与 `net.exfil` 出现在同一文件时升为 block | 引用 `~/.ssh`、`~/.aws`、`~/.gnupg`、`.env*`、钥匙串（`security find-*-password`）、浏览器 profile、钱包目录、`~/.miniclaw`、`~/.claude`、`~/.codex/auth.json` | ClawHavoc、VirusTotal |
| `net.exfil` | warn | `curl -d @file` / `--data-binary` / POST 到 webhook 类地址（webhook.site、Discord webhook、`api.telegram.org/bot`）、裸 IP、DNS 外带 | Cisco、Unit 42 |
| `frontmatter.shell-injection` | warn | 正文里有 `!`cmd`` 或 ```` ```! ```` 块（Claude Code 装载时直接执行） | Claude Code 文档 |
| `instruction.install-prereq` | warn | 正文要求先安装未在 `requires.bins` 声明的"前置依赖"，并给出 URL 或命令 | ClawHavoc |
| `remote.instructions` | warn | 运行时从网络拉取指令或脚本 | Unit 42 |
| `pkg.redirect` | warn | 改包管理器源（`--index-url`、`pip config set`、`.npmrc` 的 registry） | SentinelOne |
| `injection.override` | warn | "ignore previous instructions"、"do not tell the user"、"without asking"、伪造的 system 消息 / `<system>` 标签、HTML 注释里的祈使句 | Snyk、Cisco |
| `trigger.broad` | warn | description 要求"always use" / "use for every task" | 触发劫持 |
| `name.typosquat` | warn | 见 §5.4 | Koi、Bitdefender |
| `secret.hardcoded` | warn | 硬编码的 token / key（复用 GATEWAY §6.3 脱敏函数的模式表，不另写一份） | Snyk（10.9%） |
| `frontmatter.model` | info | `model`、`effort`、`context: fork`、`agent` | 会改变模型和费用 |

扫描器原则：

- **只能加严，不能放宽**：外部信号（skills.sh 审计、ClawHub 扫描结论）和以后可选的 LLM 审查只能把结论往严里调，不能把本地的 `block` 降级。这与 MEMORY-EVAL"eval 只会多送审，不会少送审"是同一原则
- **可选 LLM 审查（S3 之后）**：用 `cheap` profile、不给工具，skill 内容当作不可信数据；结论最多产生 `warn`
- **扫描 ≠ 安全**：扫描器之间结论很少一致（§2.2），自然语言攻击和规避手法防不住。真正的边界是 policy engine + 硬底线 + engine sandbox（HARNESS §6）。TUI 文案不能写"safe"，只能写"no known issues"
- **回归语料**：`fixtures/marketplace/malicious/`（按 §2.2 的手法构造）必须 100% 命中 `block`；`fixtures/marketplace/benign/`（主流良性 skill 的快照，如 `anthropics/skills`）的 `block` 数必须为 0（误报预算）
- 规则集升级后，`/skills audit` 用新规则重扫所有已安装的包；新出现的 `block` → 该包进入隔离区并通知

### 8.4 隔离区、覆盖与撤销

- **staging**：registry 不扫描、永远不挂载；批准或取消后立即删除
- **quarantine**：出现 `block` 的包连同扫描报告移到这里，保留 7 天供查看（`/skills info` 可以打开报告和文件），然后删除
- **覆盖**：只允许在交互界面里、按单条发现覆盖，并要求**输入包名**确认（误报时用，例如一个本来就要跑安装脚本的 skill）。覆盖记录写进 lock 的 `approval.overrides`（规则 id、文件、谁、何时）；这个包在 TUI 上常驻 `⚠ overridden`，创建任务时的权限清单上也会显示。无头模式（`miniclaw skills …`）不能覆盖
- **撤销列表**：精选索引可以带 `revoked`（`packageId` + `packageHash` + 原因）。刷新索引时撤销**自动生效**（它只会让事情更严），命中的已安装包进入隔离区并通知：
  - 正在运行的无人值守 Run 用到了它 → 取消，`CANCELLED(skill_revoked)`（取消不是重跑，不违反 GATEWAY §7.1 副作用闸门）
  - 正在运行的交互 Run → 弹卡片，建议中止
  - 以后的 Run → select 阶段报错

精选索引格式（静态文件，示意）：

```json
{
  "indexVersion": 1,
  "packages": [
    { "id": "github.com/anthropics/skills/skills", "commit": "<40 位>", "packageHash": "sha256-…",
      "skills": ["pdf", "xlsx"], "reviewedAt": "2026-09-01" }
  ],
  "revoked": [ { "id": "github.com/<owner>/<repo>/<path>", "packageHash": "sha256-…", "reason": "malware", "at": "2026-09-05" } ]
}
```

### 8.5 声明 ≠ 授予：三次批准各管各的

| 批准 | 何时 | 产生什么 | **不**产生什么 |
|------|------|---------|---------------|
| **安装批准** | 安装、需要完整重新批准的更新（§7.2） | 这个包的这个 `packageHash` 可以进入该用户的 Catalog | 任何 grant |
| **任务授权** | 创建 / 编辑任务时的权限清单（HARNESS §6.6） | 任务的 `[grants]` + **任务用到的每个 skill 的 `skillHash`**（§8.6） | — |
| **运行时审批** | Run 中越界（HARNESS §6.3 第 6 步） | once / session grant | — |

- `allowed-tools` 映射成 `engine.tool:<工具>(<模式>)` 申请，`metadata.miniclaw.permissions` 按 HARNESS §9 解析成 capability id；两者都**只是申请**
- **agent 不能安装、更新、批准 skill**：这些操作只存在于 TUI / 无头 CLI，不暴露成任何工具。agent 只能在输出里建议，用户照常走 §6。Codex 内置的 `$skill-installer` 在 tool 模式下不可见（SKILLS §8.3 关掉了 Codex 原生 skills）；即使模型自己去跑，写 `$CODEX_HOME/skills` 也是工作目录外的 `fs.write`，按 policy 拦截
- 无头安装：S2 只支持 `miniclaw skills install … --dry-run`（打印计划和扫描结论），真正安装必须在 TUI 里批准。没有 TTY 时 `ask` 一律按拒绝处理

### 8.6 hash 变化与无人值守

1. 创建 / 编辑定时任务时，TUI 把任务用到的每个 skill 的当前 `skillHash` 写进任务定义（任务定义对 agent 不可见，HARNESS §6.1 第 8 条）：

   ```toml
   # ~/.miniclaw/users/<user_id>/tasks/daily-brief.toml（示意）
   skills = ["daily-brief", "gcal-read"]
   [skills_approved]
   daily-brief = "sha256-…"
   gcal-read   = "sha256-…"
   ```

2. 每次触发时 select 做批准校验（§3.2 对 SKILLS §6 的增量）：只要有一个 skill 的当前 hash ≠ 记录的 hash → **engine 不启动**，Run 进入 `waiting_approval`，原因 `skill_changed`，并通知（F10）；超过 `max_approval_wait` 就 `CANCELLED(approval_timeout)`（GATEWAY §9.1，与其他审批同一套状态）
3. 重新批准卡片显示 diff（已安装的包可以显示内容 diff，因为旧版本还在 store 里；本地 skill 只能显示哪些文件变了，因为任务里只记了 hash）和权限增量。批准后更新任务里记录的 hash
4. 适用于除 `builtin` 以外的**所有**来源，包括用户手写和导入的。`npx skills update` 会在 miniclaw 之外悄悄改掉 `~/.agents/skills`，这正是这条规则要拦的
5. 交互 Run 不拦，但 TUI 提示"skill X 自上次批准后已修改"

### 8.7 engine 侧必须堵上的三个口子（Claude Code，2026-09-10 查证文档）

| 口子 | 文档原文要点 | 对策 | 验证 |
|------|-------------|------|------|
| `allowed-tools` | "grants permission for the listed tools during the turn that invokes the skill … without prompting" | 已有结论：PreToolUse hook 逐次问 policy engine，不把 `allowed-tools` 转成 allow 规则（SKILLS §10、HARNESS 附录 A.1） | SKILLS §11 #5 |
| `!`command`` 预处理 | "Injected commands never prompt for permission"；非 allow 就中止调用；`"disableSkillShellExecution": true` 对 user / project / plugin / additional-directory 来源都生效 | Claude adapter 默认下发 `disableSkillShellExecution: true`（miniclaw 的挂载目录就是 plugin 来源）。本 Run 的 SkillSet 全部是 `local` / `builtin` 时，任务可以显式关掉这个开关 | §11 #D1 |
| frontmatter `hooks` | "registers them when you or Claude invoke the skill and keeps running them for the rest of the session" | 第三方 skill 含 `hooks` → 扫描 `block`（§8.3）。`disableAllHooks` 能关掉 settings 里的 hooks，但会不会连带关掉 miniclaw 自己用来执法的 SDK PreToolUse hook：**待验证**；skill hook 返回 `allow` 能否压过 miniclaw hook 的 `ask` / `deny`：按官方文档，多个 PreToolUse hook 的决定按 deny > defer > ask > allow 合并，所以**不能**压过（HARNESS 附录 A.1，仍需实测） | §11 #D2 |

Codex 在 tool 模式下由 `mc-skills` 返回正文，不存在装载时执行的问题；Codex plugin 自带的 hooks 不在 miniclaw 的安装范围内（A3）。

### 8.8 批准前用户看到什么

批准卡片用 tangerine 粗边框（DESIGN §5.1：需要拍板的弹窗用 `┏━┓`；§2.4：`permission` = tangerine），标题 `◆ Install skill`。界面文案按 DESIGN §3.1 用英文；skill 的描述等属于用户内容，原样显示。

```
┏━ ◆ Install skill ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ pdf  anthropics/skills · via anthropic-agent-skills · official           ┃
┃ commit    8c80f3d  main · 2026-08-30 · into your skills (not shared)     ┃
┃ skills    pdf  + xlsx (dependency)                                       ┃
┃ requests  shell.exec:python3 *   fs.write:<run workspace>                ┃
┃ requires  python3 ✓   pdftotext ✗                                        ┃
┃ files     14 · 3 scripts · 0 binaries · 212 KB                           ┃
┃ scan      ⚠ 1 warning  net.exfil  pdf/scripts/fetch.py:12                ┃
┃ signals   skills.sh audit: 0 alerts (third-party opinion)                ┃
┃ ignored   hooks, mcpServers                                              ┃
┃ i install   v view files   d details   n cancel         default: cancel  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

| 必须显示 | 说明 |
|---------|------|
| 包、发现渠道、发布者、信任层级 | 层级用文字标签，不只靠颜色（DESIGN §1 第 3 条） |
| commit 短 SHA、提交日期、`trackedRef`、安装目标（用户 / 共享） | |
| 选中的 skill 与自动带上的依赖、`unresolved` 依赖、名字冲突 / 遮蔽 | |
| 申请的 capability（映射后的 id）、`requires.bins` / `env` 是否满足 | |
| 文件摘要：脚本数、可执行文件数、总大小；`v` 打开只读文件浏览器（SKILL.md 在最前），**从不执行** | |
| 扫描结论：按级别计数 + 前 3 条，`d` 展开全部 | `block` 时没有 `i`，只有覆盖入口（§8.4） |
| 外部信号：注明是第三方意见 | |
| 被忽略的 plugin 组件 | |

- 默认焦点是**取消**，回车不会安装（与 HARNESS §6.6 默认拒绝一致）
- `community` 层级：每条 `warn` 都要逐条确认后 `i` 才可用

### 8.9 签名与来源证明（以后）

目前没有一个来源提供 skill 签名（§2.3）。以后要加时，作为 §6.1 第 3 步 verify 之后的**可选**校验步骤：git commit 签名（`git verify-commit`、gitsign / Sigstore）、GitHub artifact attestations、精选索引的 SSH / minisign 签名。校验通过只是一个额外信号，不改变 §8.2 的不变量。现在不预留字段（YAGNI）。

---

## 9. TUI 与命令

### 9.1 Skills 面板

面板的模块色是 kelp（DESIGN §2.4，只出现在导航层）。子视图：`Installed` · `Browse` · `Updates` · `Sources`。

```
 Skills   Installed   Browse   Updates 2   Sources
 ━━━━━━
 ❯ search: pdf                          sources: github · anthropic-agent-skills · skills.sh
 ▸ pdf          anthropics/skills       official    ✓ installed  8c80f3d
   pdf-tools    someone/pdf-tools       community   ⚠ 2          12.3k installs · skills.sh
   pdf-ocr      acme/agent-skills       curated
 ⏎ details   i install   / search   ⌃K panel
```

| 视图 | 内容 |
|------|------|
| Installed | 名字（粗体）· `owner/repo`（muted）· 层级标签 · 短 SHA（subtle）· 状态：`⚠ n`（sun）、`✗ quarantined`（coral）、`pinned`、`⚠ overridden`、`needs review`（共享包未批准） |
| Browse | 多来源合并，按 PackageId 去重，标注来源；排序先按 §4.3 的来源顺序，再按相关度。安装量等外部数字用 muted 显示并注明来源，**不作为信任** |
| Updates | 可更新的包；每行标出是否需要完整重新批准（`◆ review`） |
| Sources | 已启用来源、缓存时间（`cached 3h ago`）、限流状态（`rate limited · resets 14:05`） |
| 详情 | SKILL.md 渲染、文件树、扫描报告、`history`、**被哪些任务使用** |

弹窗：

| 弹窗 | 样式 |
|------|------|
| `◆ Install skill` · `◆ Update skill` · `◆ Re-approve skill`（§8.6） | tangerine 粗边框（与权限审批同一语义） |
| `Remove skill?` · `Roll back skill?` | 粗边框 + sun `⚠`（需要拍板，但不是权限） |
| Toast | `✓ installed pdf (anthropics/skills@8c80f3d)`；撤销、隔离类的 toast 需要手动关闭（DESIGN §6） |

欢迎页的 `skills` 检查项（DESIGN §8.1）扩展为：`12 loaded · 2 updates · 1 quarantined`。

### 9.2 斜杠命令

| 命令 | 作用 |
|------|------|
| `/skills` | 打开面板 |
| `/skills search <q> [--source <id>]` | 搜索 |
| `/skills info <包\|名字>` | 详情（未安装的包也可以看：只做 resolve + fetch + scan，不安装） |
| `/skills install <包\|URL\|路径> [--ref <ref>] [--skill <名字>…] [--shared]` | 安装 |
| `/skills update [<名字>\|--all] [--check]` | 检查 / 更新，逐个出卡片 |
| `/skills remove <名字>` | 卸载 |
| `/skills pin <名字>` · `/skills unpin <名字>` | 固定 / 解除 |
| `/skills rollback <名字> [--to <commit>]` | 回滚 |
| `/skills approve <名字>` | hash 变化后重新批准（§8.6） |
| `/skills audit` | 用当前规则集重扫所有已安装的包 |
| `/skills restore` | 按 lock 重新获取（新机器、store 丢失） |
| `/skills sources [add\|remove] <spec>` | 管理来源 |

无头 CLI `miniclaw skills <同名子命令>` 提供只读和 `--dry-run` 能力，安装、更新、批准必须在 TUI 里完成（§8.5）。

---

## 10. 离线、缓存与限流

### 10.1 离线

- **已安装的 skill 完全离线可用**：Run 永远不为 skill 联网，select 和挂载只读本地 store
- 联网只发生在 search / info / install / update / 索引刷新，全部经 infra 端口（`HttpClient` / `GitClient`），可注入、可 mock（`01-solid.md` DIP）
- 离线时：搜索只查本地缓存的索引和已安装的包，结果标 `offline · cached 3h ago`；需要联网的操作报 `OFFLINE`，不排队、不自动重试

### 10.2 缓存

| 内容 | 位置 | TTL | 说明 |
|------|------|-----|------|
| 来源索引（`marketplace.json`、精选 `index.json`） | `~/.miniclaw/cache/marketplace/index/<source>/` | 24 h | 过期后仍可用，标 `stale` |
| 搜索结果 | 内存 | 10 min | 输入去抖 300 ms |
| git 镜像 | `~/.miniclaw/cache/marketplace/git/<host>/<owner>/<repo>.git`（bare、partial clone） | LRU，总量上限 1 GB | 回滚、restore 可离线完成 |
| archive | `~/.miniclaw/cache/marketplace/archive/<sha256>` | LRU | |

- 缓存在用户间共享：内容都是公开数据，而且**取用时一律校验**（commit、sha256、`packageHash`）。被污染的缓存最多导致"发现"出错，装不进错误的内容
- 缓存可以随时整个删除，只影响速度

### 10.3 限流

| 对象 | 已知限额（来源） | miniclaw 的做法 |
|------|-----------------|----------------|
| GitHub REST | 未认证 60 次 / 小时 / IP，认证 5,000 次 / 小时；二级限制 100 并发（[docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)） | 更新检查优先 `git ls-remote`（不占 REST 配额）比对 commit，变了再用 partial fetch 比对 `treeSha`；只有列目录时才用 REST |
| GitHub search | code search **必须认证**，10 次 / 分（[docs](https://docs.github.com/en/rest/search/search)） | 没有 token 时 `github` 来源的 search 返回 `AUTH_REQUIRED`，TUI 提示配置 `github_token_env` |
| GitHub Trees API | `recursive=1` 最多 10 万条 / 7 MB，超出标 `truncated` | 截断时改用 git 获取 |
| raw.githubusercontent.com / codeload | 官方未公布具体数字（2025-05-08 changelog 只说收紧了未认证限额）：**待验证** | 下载走 git 传输，不依赖这两个域名 |
| skills.sh 旧版搜索 | 未公布：**待验证** | 客户端自限 1 次 / 秒 + 10 min 缓存 |
| ClawHub | 未公布（其 spec 列为未决问题） | 接入时再定 |

- 通用规则：读 `x-ratelimit-remaining` / `x-ratelimit-reset` / `Retry-After`；剩余低于 10% 时暂停非必要请求（更新检查）；403 / 429 → `RATE_LIMITED{retryAfter}`，该来源冷却到重置时间，**不忙等重试**；每个 host 最多 4 个并发
- 这和 GATEWAY 的 Quota Pool 冷却是同一种思路，但**不经过 Gateway**（Gateway 只管 Run）
- token 可选且需要显式配置：只读 `github_token_env` 指定的环境变量；不自动读取 `gh auth token` 或 git 凭证助手里的 token，除非用户在 `/skills sources` 里明确开启（凭证规则见 HARNESS §6.8）
- 请求只带 `User-Agent: miniclaw/<version>`，不发遥测

---

## 11. 契约测试

### 11.1 来源（每个 `PackageResolver` / `PackageCatalog` 实现都必须通过同一套，`01-solid.md` LSP）

| # | 断言 | 方式 |
|---|------|------|
| M1 | resolve 永远返回不可变坐标（40 位 commit 或 sha256），不返回 branch / tag | 录制的 HTTP / git fixture |
| M2 | 上游不变时，同一输入 resolve 两次结果相同 | 同上 |
| M3 | 按 lock 重新获取，`packageHash` 与 lock 一致；篡改过的 fixture → `INTEGRITY_MISMATCH` | 本地 `file://` git 仓库 fixture |
| M4 | catalog 返回的每个条目都能被某个 resolver resolve | fixture |
| M5 | 取消（`AbortSignal`）和超时在 1 s 内生效，不留下半个 staging | 注入慢速 HttpClient |
| M6 | 限流 → `RATE_LIMITED{retryAfter}`，且之后到 `retryAfter` 前不再发请求 | 注入返回 429 / 403 的 HttpClient，断言请求计数 |
| M7 | 离线 → `OFFLINE`；catalog 退回缓存并标 `stale` | 注入断网的 HttpClient |
| M8 | resolve 不执行任何代码：Claude marketplace 的 `command` 来源 → `UNSUPPORTED_SOURCE` | fixture |
| M9 | 发现渠道不同、artifact 相同 → PackageId 相同 | 同一仓库经 `github` 和 `claude-marketplace` 两条路径 |

### 11.2 fetch 与 installer（共用实现，单测）

| # | 断言 |
|---|------|
| F1 | zip slip、绝对路径、`..`、指向包外的软链、设备文件被拒 |
| F2 | 超出大小 / 文件数限额 → `LIMIT_EXCEEDED`，**不**截断后继续 |
| F3 | fixture 仓库带 git hook、LFS filter、submodule 时，获取过程中它们都没有执行 / 递归（用标记文件断言） |
| F4 | 整个安装流程中，包内任何脚本都没有被执行（fixture 脚本会写标记文件） |
| F5 | 除 `staging/`、`store/`、`skills/`、`lock.json`、`quarantine/` 外，不写任何路径（用只读 FileSystem 端口断言） |
| F6 | 在 commit 的每一步之间模拟崩溃，重启对账后状态与 lock 一致 |
| F7 | 挂载时 hash 不符 → `SKILL_TAMPERED`，engine 未启动 |
| F8 | 定时任务的 skill hash 变化 → `waiting_approval(skill_changed)`，engine 未启动 |

### 11.3 扫描器

| # | 断言 |
|---|------|
| S1 | `fixtures/marketplace/malicious/` 100% 命中 `block`（包含 §2.2 的每种手法：伪前置依赖、带密码的 zip、quarantine 标记绕过、base64 执行、不可见字符、超大填充、cron 持久化、改 AGENTS.md） |
| S2 | `fixtures/marketplace/benign/` 的 `block` 数为 0 |
| S3 | 外部信号为"clean"时，本地 `block` 不会被降级 |

### 11.4 投递侧新增（并入 SKILLS §11，由 SKILLS.md 维护方合入）

| # | 断言 | Claude Code 验证方式 |
|---|------|---------------------|
| D1 | 挂载目录里 skill 的 `!`cmd`` 不执行（被替换为 disabled 占位） | fixture skill 的命令写标记文件，断言文件不存在 |
| D2 | skill frontmatter 的 `hooks` 不执行，且不能改变 miniclaw PreToolUse hook 的决定 | 同上；另测 skill hook 返回 `allow` 时 policy 的 `deny` 仍然生效 |

---

## 12. 里程碑（post-MVP）

MVP 不含 skills 子系统。阶段按依赖排序，**不绑定版本号**（版本以 PRD §9 为准）。S1 / S4 的完整范围见 SKILLS §12。

| 阶段 | 范围 | 依赖 | 退出标准 |
|------|------|------|---------|
| **S1** 本地 skills | parse · registry（含导入来源、realpath 去重、遮蔽诊断）· 目录级 `skillHash`（§5.3）· select（含定时任务的 hash 批准校验，§8.6）· 挂载 + 挂载时校验（§7.4）· Claude Code 原生投递 + §8.7 三个口子 · TUI Installed 视图（只读 + 启用 / 禁用） | Claude adapter、scheduler | SKILLS §11 在 Claude Code 上全部通过；本文 §11.4 D1、D2、§11.2 F7、F8 通过 |
| **S2** marketplace 核心 | `local` / `git` / `github` 来源 · fetch + 统一限制 · 扫描器 + 回归语料 · 信任层级 · 安装批准卡片 · lock · update / pin / rollback / remove / audit / restore · 用户级安装 · TUI Installed / Updates / Sources · `/skills` 命令 | S1 | 本文 §11.1–§11.3 全部通过；从 GitHub 装一个 bundle，在另一台机器上按 lock 还原出相同 hash |
| **S3** 更多来源 | `claude-marketplace` · `skills-sh` 搜索 · `curated` 精选索引 + 撤销列表 · 共享安装（§6.2）· Browse 多来源合并 · 视安全形势决定是否接 `clawhub` · 可选 LLM 审查 | S2 | 新来源只新增 `infra/marketplace/sources/<id>/`，core 零改动，通过 §11.1 |
| **S4** Codex 投递 | SKILLS §8.3 的 tool 模式 + `mc-skills` | S1 + Codex adapter | SKILLS §11 在 Codex 上全部通过 |

S4 只依赖 S1 和 Codex adapter，可以与 S2 / S3 并行。以后（不排期）：签名与来源证明（§8.9）、`well-known` 来源、npm 来源、OpenCode / Gemini CLI 投递（SKILLS §12）。

---

## 13. 待定

> 全局总表在 PRD §10；这里的问题有结论后在原处标记，并同步回 PRD §10。

- [ ] **§1.1 的前提**：miniclaw 只做客户端、精选索引只是静态文件——需要用户确认
- [ ] **默认启用哪些来源**：建议 `github` + `anthropics/skills` 的 marketplace；`skills-sh`、`curated` 由用户在 `/skills sources` 里手动加
- [ ] **是否接入 ClawHub**：它是托管注册表，2026 年上半年恶意 skill 比例高（§2.2），但在 OpenClaw 用户中覆盖面最大。建议 S3 之后再评估，接入时默认 `community` 层级
- [ ] **精选索引谁维护**：放在哪个仓库、收录标准、多久审一次、撤销的响应时间。没人维护的话，S3 只做撤销列表
- [ ] **`official` 默认名单**：建议 `github.com/anthropics`、`github.com/openai`；是否包括大厂的 skill 仓库（如 `vercel-labs`、`huggingface`）
- [ ] **`community` skill 被激活时是否 taint 整个 Run**（§8.2）：更安全，但会让依赖社区 skill 的定时任务都要写 `allowWhenTainted`。备选：只对有 `warn` 发现的包 taint。**HARNESS 维护方建议（待用户确认）**：taint，但只在激活时（`skill.activated`）而不是出现在目录里时，来源记为 `skill:<packageId>@<skillHash>`；不采用"只 taint 有 warn 的包"，因为那等于把扫描器当安全边界，而 skill 正文是模型被要求遵循的第三方文本，比网页数据风险更高。同时把 HARNESS §6.3 `allowWhenTainted` 从布尔改为 taint 来源清单（如 `["skill:foo@sha256-…"]`）：建任务时权限清单逐条显示"因 X 仍放行"，其他来源的 taint 照样收紧，hash 变了自动失效，与 §8.6 重新批准一致
- [ ] **共享安装由谁授权**：`shared_installers` 默认为空（关闭），还是 onboarding 时把第一个用户设为共享安装者
- [ ] **`disableSkillShellExecution` 能否按任务关闭**：`!` 预处理是 Claude Code skill 的常见写法，一刀切关掉会影响用户自己写的 skill
- [ ] **`disableAllHooks` 与 SDK PreToolUse hook 的关系**（§8.7）：决定能否在 engine 侧而不是扫描侧处理 skill hooks，放进 ROADMAP M0 的 Claude spike
- [ ] **`npm` 来源**：Claude marketplace 支持 `npm` 类型的 plugin 来源；可以按 archive + `dist.integrity` 处理（不跑 install 脚本），是否值得做
- [ ] **包内共享文件**：monorepo 里 skill 引用 `subpath` 之外的文件（`../../shared/`）时，是扩大 `subpath` 还是报 `unresolved`
