# Changelog 维护（强制）

**每次做 feature，必须在同一次改动里更新项目根目录的 `CHANGELOG.md`。** 没有 changelog 条目的 feature 视为未完成，不得合入。

## 什么时候必须写

| 改动类型 | 是否必须写 | 分类 |
|----------|-----------|------|
| 新功能 / 新能力（新 runtime adapter、新 TUI 视图、新配置项……） | ✅ 必须 | `Added` |
| 已有行为的变化（默认值、交互、路由规则变了） | ✅ 必须 | `Changed` |
| 标记为即将移除 | ✅ 必须 | `Deprecated` |
| 移除功能 / 配置项 | ✅ 必须 | `Removed` |
| Bug 修复 | ✅ 必须 | `Fixed` |
| 安全相关（权限、computer use 确认、沙箱、审计） | ✅ 必须 | `Security` |
| 纯内部重构、测试、注释、格式调整（用户无感知） | ❌ 不需要 | — |

拿不准时就写，多写一条的代价远小于漏写。

## 格式

遵循 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/) + [语义化版本](https://semver.org/lang/zh-CN/)：

- 新条目一律写在最上方的 `## [Unreleased]` 下，放进对应分类（`### Added` 等）；分类不存在就新建
- 发版时把 `[Unreleased]` 的内容移到新版本标题下：`## [0.2.0] - YYYY-MM-DD`，再留一个空的 `[Unreleased]`
- 分类顺序固定：`Added` → `Changed` → `Deprecated` → `Removed` → `Fixed` → `Security`
- 日期用 `YYYY-MM-DD`

## 条目怎么写

- **一个 feature 一条**，以模块名开头：`scheduler:`、`router:`、`tui:`、`adapter/codex:`、`skills:`
- 从**使用者视角**写"能做什么了 / 哪里变了"，不写"改了哪个文件 / 哪个函数"
- 行为变化要写清**之前 → 之后**
- 破坏性变更（BREAKING）必须加 `**BREAKING**` 前缀，并附一句迁移方法
- 有 PR / issue 就附上链接

```markdown
## [Unreleased]

### Added
- scheduler: 支持 cron 表达式定义周期任务，任务结果持久化并可在 TUI `tasks` 视图查看
- adapter/codex: 新增 Codex runtime 适配器，可在路由规则中通过 `runtime: codex` 选用

### Changed
- **BREAKING** router: 路由规则配置从 `routes.json` 迁移到 `config.toml` 的 `[router]` 段；旧文件需手动迁移，启动时会给出提示

### Fixed
- tui: 修复长输出时 chat 视图不自动滚动到底部的问题
```

## 禁止

- ❌ 空泛描述：`修复 bug`、`更新代码`、`优化`、`misc changes`
- ❌ 直接粘贴 git log / commit 列表
- ❌ changelog 和代码分开提交（必须在同一次改动 / 同一个 PR 里）
- ❌ 修改已发布版本下的历史条目（写错了就在 `[Unreleased]` 里补一条更正）
