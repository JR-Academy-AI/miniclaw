# docs/ — 产品与设计文档

## 职责
存放 miniclaw 的产品需求和各子系统的设计规则，是**写代码之前的依据**。代码实现必须符合这里的文档；实现中发现文档不对，先改文档再改代码（同一次改动）。
**不负责**：代码原则（在 `rules/`）、设计 token 的具体取值（在 `design/tokens.json`）、记忆模板本体（在 `templates/memory/`）。

## 每份文档管什么（改之前先确认改的是权威来源）

| 文件 | 权威范围 | 说明 |
|------|---------|------|
| `PRD.md` | 产品定位、功能列表 F1…Fn 及优先级 P0/P1/P2、核心概念、架构、里程碑、全局待决策问题 | 总纲；子系统只写摘要并链接到专题文档 |
| `ROADMAP.md` | 开发顺序：v0.1–v0.5 各版本的工作包（M0–M12）、依赖、退出标准、并行线；专题文档旧版本标注的换算（§5） | 范围以 PRD §9 为准，本文只管顺序；不写工期；M 编号是工作包 ID，只增不改 |
| `GATEWAY.md` | Runtime Gateway：限流（含 RPM 推导并发）、单 Run 预算、错误分类、恢复策略、engine 探测、usage 口径与返回（PRD F11） | 各 engine 的错误 / 探测 / usage 细节只写在附录 A |
| `HARNESS.md` | 两层 harness 与 Domain Runtime（PRD F12）；权限模型的详细规则（PRD F8 只写摘要）：capability 词表与 effect、决策顺序、硬底线、执行点、审批、taint | effect 分类是 `GATEWAY.md` §7.1 副作用闸门的依据；`SKILLS.md` §4.2 的 `permissions` 取值用这里的 capability id |
| `SKILLS.md` | Skills：来源与发现、按 Run 选择与挂载、各 runtime 投递方式、provider 与 runtime 的对应、通用 skill 工具协议与 `mc-skills`（§14）、API engine 提案（§15）（PRD F6，涉及 F2、F5） | adapter 能力声明字段在 `GATEWAY.md` §11 追加；注入通道与 `MEMORY.md` §10 共用；`mc-skills` 与 `HARNESS.md` 的 `mc-*` 工具服务器同宿主 |
| `SKILLS-MARKETPLACE.md` | Skills marketplace 客户端：第三方来源抽象、包标识与版本、安装流程、lockfile / 更新 / 回滚、信任层级、静态扫描、隔离区、供应链安全（PRD F6） | 只管"装进来"；装进来之后的发现、挂载、投递以 `SKILLS.md` 为准；需要合并进 SKILLS §5–§7、§11 的改动列在本文 §3.2 |
| `WORKSPACE.md` | 默认工作目录、Run 临时目录、清理规则、saved / external workspace、产物落盘位置（PRD F13） | agent 看到的规则在 `templates/workspace/PROTOCOL.md`（§8 只写摘要）；"Run 工作目录"的路径由本文定义、权限由 `HARNESS.md` §6 决定 |
| `MEMORY.md` | 记忆系统设计（PRD F9） | 模板实体在 `templates/memory/`，两者须一致 |
| `MEMORY-EVAL.md` | 记忆更新评估：写入闸门、体检指标、离线回归（PRD F9） | 配置在 `manifest.yaml > eval`；`MEMORY.md` §8 ⑤ 只写摘要 |
| `MEMORY-PROMOTION.md` | 记忆晋升评估：短期候选是否进长期层，rubric 的层级、维度、打分、规则来源与演化（PRD F9） | 机制在 `manifest.yaml > promotion`，rubric 模板在 `templates/memory/meta/rubric.md`；`MEMORY.md` §8 ⑥ 只写摘要 |
| `ONBOARDING.md` | 首次启动旅程：engine 连接、默认 Profile、About you 访谈（form / guided 抽取）、review 与写入、CORE 生成、起步任务、中断恢复与重跑（PRD F9，涉及 F1、F5、F11） | 探测规则以 `GATEWAY.md` §14 为准；写入路径以 `MEMORY-EVAL.md` §3 为准；题库与字段映射只在本文 §7 定义 |
| `DESIGN.md` | TUI 设计系统 Reef 的规则与原因 | 取值以 `design/tokens.json` 为准，见 `design/AGENTS.md` |
| `README.md` | 对外介绍 | 只做摘要，不引入 PRD 里没有的内容 |

## 必须同步的地方（改一处必须同时改）

- **新增 / 调整功能**：PRD §5 功能条目（F 编号 + 优先级）↔ PRD §9 里程碑 ↔ `ROADMAP.md` 对应阶段 ↔ `README.md` 的"特性"和"路线图"
- **新增专题设计文档**：PRD 对应 F 条目链接过去 + `README.md`"文档"列表 + 根目录 `AGENTS.md`"Where each kind of truth lives"表 + `CHANGELOG.md`（`docs:` 前缀）
- **改记忆设计**：`MEMORY.md` ↔ `templates/memory/`（改模板结构需升 `manifest.yaml` 版本，见根 `AGENTS.md`）；涉及 eval 的还要同步 `MEMORY-EVAL.md` ↔ `manifest.yaml > eval` ↔ `PROTOCOL.md` §5；涉及晋升的同步 `MEMORY-PROMOTION.md` ↔ `manifest.yaml > promotion` ↔ `meta/rubric.md` 模板 ↔ `PROTOCOL.md` §3 / §7 ↔ `short-term/inbox.md` 状态说明
- **改设计系统**：`DESIGN.md` ↔ `design/tokens.json`
- **改 workspace 规则**：`WORKSPACE.md` ↔ `templates/workspace/PROTOCOL.md`（agent 可见部分）↔ `GATEWAY.md` §4.1（workspace 并发槽）↔ PRD §7 数据目录树
- **改权限模型**：`HARNESS.md` §6 ↔ PRD F8 摘要 ↔ `GATEWAY.md` §7.1（effect 口径）↔ `SKILLS.md` §4.2 / §10（权限申请字段）
- **新增 / 移动 / 删除仓库目录或顶层文件**：`README.md`"项目结构"目录树（完整版）↔ 根 `AGENTS.md`"Repository layout"（只列顶层）

## 不变量

- **章节编号是对外接口**：`AGENTS.md`、`rules/`、其他文档都用"PRD §9""GATEWAY §7.1"这类编号互相引用。重新编号或删章节前，先全局搜索 `§` 引用并一并更新；新增章节优先追加在末尾
- **F 编号永不复用**：功能删除后编号作废，不挪给新功能
- **待决策问题只有一个总表**：全局问题记在 PRD §10；专题文档可以有自己的"待定"节，但已决策的问题要在原处标记结论，并同步回 PRD §10
- **技术选型未定**：文档里的代码片段都是 TypeScript **示意**，不代表语言选型。选型只能写进 PRD §10 的决策结论，不能在专题文档里顺手定下

## 写作约定

- 正文用中文；领域术语保持英文并与 PRD §6 核心概念一致（Task、Run、Profile、Skill、Schedule、Quota Pool……）
- 专题文档开头固定用引用块写元信息：`版本`、`日期`（YYYY-MM-DD）、`关联`（对应 PRD F 编号）、`状态`
- 规则类内容用表格或祈使句（"必须 / 禁止"），不写散文；每条规则尽量带默认值或可验证的标准
- 注意命名冲突："Profile"指模型 / runtime profile；记忆里的 `profile/` 指用户个人资料
- 文档之间用相对链接；引用代码路径用反引号

## 容易改错的地方

- 在专题文档里改了优先级或范围，却没回写 PRD §5 / §9 → PRD 与专题文档互相矛盾
- `README.md` 写成比 PRD 更"乐观"的功能列表 → 对外承诺和实际范围不一致
- 在 `DESIGN.md` 表格里改了颜色值，没改 `tokens.json`（反过来也一样）
