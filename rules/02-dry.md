# DRY — Don't Repeat Yourself（强制）

**系统里每一条"知识"都只能有一个权威来源。**

DRY 管的是**知识重复**，不是**代码长得像**。两段代码看起来一样，但变化原因不同，就不是重复，不要合并。

## 必须去重的

- **配置与常量**：模型名、runtime id、默认超时、路径、cron 表达式默认值……只定义一次，其他地方引用
- **类型 / schema**：同一个数据结构（Task、RunEvent、Skill 元数据、Schedule）只定义一份；校验逻辑从 schema 派生，不手写第二遍
- **业务规则**：路由规则、权限判断、重试策略只在一个地方实现
- **跨 adapter 的公共逻辑**：重试、超时、日志、事件标准化等横切逻辑放在共享层（装饰器 / 中间件 / 基础函数），不在每个 adapter 里复制一份
- **文档与代码**：能从代码生成的（CLI 帮助、配置说明）就生成，不手写一份会过期的副本

## 三次法则（Rule of Three）

- 第 1 次：直接写
- 第 2 次：可以容忍重复，但记下来
- 第 3 次：必须抽象

**例外**：业务规则、安全相关判断（权限、审计、computer use 的确认逻辑），**出现第 2 次就必须收敛**，因为不一致会直接造成安全问题。

## 禁止的"伪 DRY"

- ❌ 为了去重把两个不相关的概念塞进同一个函数，再用一堆 `boolean` 参数 / `mode` 参数切换行为
- ❌ 为了复用 3 行代码引入跨模块依赖，破坏模块边界
- ❌ 过早抽出"通用框架"，只有一个使用者
- ❌ 把不同 runtime 的差异硬抹平成一个巨型通用函数；差异应该留在各自的 adapter 里

判断标准：**如果将来其中一处要改，另一处是否一定要跟着改？** 是 → 合并；否 → 保留重复。

```ts
// ❌ 伪 DRY：两个无关流程被 flag 硬拼在一起
function execute(task: Task, isScheduled: boolean, isComputerUse: boolean, dryRun: boolean) { ... }

// ✅ 公共部分抽成小函数，各流程自己组合
function runScheduledTask(task: Task) { const ctx = buildRunContext(task); ... }
function runInteractiveTask(task: Task) { const ctx = buildRunContext(task); ... }
```

## 测试中的 DRY

- 测试数据用 factory / fixture 构造，不在每个用例里手写完整对象
- 但**断言要写清楚**：宁可每个测试多写两行，也不要把断言藏进难以理解的共享 helper 里（测试可读性优先于测试 DRY）
