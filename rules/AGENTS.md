# rules/ — 代码原则规则

## 职责
存放对 miniclaw **全部代码**生效的强制规则（SOLID、DRY、KISS/YAGNI、changelog、目录级 AGENTS.md 等）。所有 AI agent（Codex、Claude Code……）和人共用同一份。
**不负责**：产品需求和子系统设计（在 `docs/`）、某个目录特有的约定（写在那个目录自己的 `AGENTS.md`）。

本文件是**维护这些规则**的说明；规则本身由根目录 `AGENTS.md` 统一加载。

## 加载机制（改动时最容易漏）

- 规则只有被根目录 `AGENTS.md` 的 `@rules/<文件名>` 行引用才会生效：Claude Code 顺着 `CLAUDE.md → @AGENTS.md → @rules/...` 自动加载，Codex 按根 `AGENTS.md` 的指示去读。**新建规则文件却不加引用 = 规则不存在**
- `@rules/...` 引用行不能放进反引号或代码块，否则 Claude Code 不会解析
- 规则必须是纯 Markdown，**禁止依赖某个工具特有的功能**（例如只有 Claude Code 支持的 `paths` frontmatter），否则其他 agent 读不到或读不懂

## 新增 / 修改规则的步骤

1. 文件名 `NN-kebab-case.md`，编号递增；标题带"（强制）"
2. 根目录 `AGENTS.md` 的 "Mandatory rules" 列表加一行 `@rules/NN-xxx.md — 一句话说明`
3. `00-overview.md` 的规则清单表加一行
4. 有可检查的条目时，加到 `05-review-checklist.md`
5. `CHANGELOG.md` 记一条（`rules:` 前缀）

**重命名或删除规则文件**：先全局搜索旧文件名（其他规则、根 `AGENTS.md`、各目录 `AGENTS.md`、`CHANGELOG.md` 都会按文件名互相引用），一并更新。

## 不变量

- **总量要克制**：所有规则在每次会话都会被完整加载。单个文件尽量 ≤ 100 行；新增规则前先看能否并入已有文件
- **规则之间不重复**：一条规则只在一个文件里完整定义，其他地方按文件名引用（`02-dry.md` 同样适用于规则本身）
- **根 `AGENTS.md` 的 "Working rules" 是摘要**：改了其中涉及的数值或做法（KISS 指标、changelog 格式、目录级 AGENTS.md 要求），要同步那段摘要
- **冲突优先级**只在 `00-overview.md` 定义；新规则必须能放进这个优先级里，不能另立一套
- **与技术栈无关**：示例用 TypeScript 写，但只是示意；与具体语言、框架绑定的规则等选型确定后再加，并在文件名里标明（如 `08-typescript.md`）

## 写作约定

- 中文；用"必须 / 禁止 / 不得"这类祈使句，不写散文
- 每条规则尽量给**可验证的标准**（数值上限、判定问题），并配 ❌ / ✅ 对比示例
- 示例结合 miniclaw 的真实模块（router、scheduler、skill registry、adapter、memory manager），不写与项目无关的通用例子
- 允许例外的规则要说明例外怎么记录（统一用 `00-overview.md` 的 `原则例外:` 注释格式）
