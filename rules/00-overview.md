# 代码原则总纲（强制）

> 本目录下所有规则对 miniclaw 的**全部代码**生效（core / TUI / adapters / skills / 脚本）。
> 写代码、改代码、评审代码时都必须遵守。违反规则的改动不得合入。

## 规则清单

| 文件 | 原则 | 一句话 |
|------|------|--------|
| `01-solid.md` | SOLID | 模块职责单一、对扩展开放、依赖抽象 |
| `02-dry.md` | DRY | 每条知识在系统里只有一个权威来源 |
| `03-kiss-yagni.md` | KISS + YAGNI | 能简单就不复杂，不写"以后可能用得上"的代码 |
| `04-other-principles.md` | SoC / 组合优于继承 / 迪米特 / Fail Fast / 最小惊讶 | 补充原则 |
| `05-review-checklist.md` | 自检清单 | 提交前逐条过一遍 |
| `06-changelog.md` | Changelog | 每次做 feature 必须同步更新 `CHANGELOG.md` |
| `07-nested-agents-md.md` | 子目录 AGENTS.md | 大功能模块、component、多 provider 目录必须有 `AGENTS.md`（+ 一行 `CLAUDE.md`） |

## 原则冲突时的优先级

原则之间会打架（比如 DRY 想抽象，KISS 想别抽象）。按下面顺序取舍：

1. **正确性与安全**：computer use、无人值守任务、权限边界不能因为"简洁"而妥协
2. **可读性 / KISS**：读的人一眼能懂，比少写几行更重要
3. **SOLID 的边界约束**：模块边界（尤其 runtime adapter、router、scheduler、skill registry 之间）必须清晰
4. **DRY**：去重是手段，不是目的；抽象的代价比重复高时，保留重复
5. **性能**：没有测量数据前，不为性能牺牲上面任何一条

## 执行方式

- **写代码时**：先想清楚这段代码属于哪个模块、依赖谁、谁依赖它，再动手
- **改代码时**：顺手修复你碰到的违规（童子军规则），但不要把无关重构混进同一次改动
- **评审时**：用 `05-review-checklist.md` 逐条检查；指出违规时说明违反了哪条、怎么改
- **确需违反时**：在代码旁写注释说明原因（`// 原则例外: 违反 DRY，因为 ...`），没有注释的违规一律视为需要修改
