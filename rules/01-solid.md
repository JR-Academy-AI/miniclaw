# SOLID（强制）

miniclaw 是编排层，核心价值就在"可替换的 runtime、可插拔的 skill、可配置的路由"。SOLID 是这个架构能成立的前提。

## S — 单一职责（Single Responsibility）

**一个模块 / 类 / 函数只有一个变化的理由。**

- 按变化原因拆分，而不是按"代码量"拆分
- 名字里出现 `And` / `Or` / `Manager` / `Helper` / `Utils` 时要警惕，通常是职责不清
- TUI 只负责展示和收集输入，**不得**包含路由、调度、skill 加载等业务逻辑
- core 模块之间职责不交叉：
  - `router` 只决定"用哪个 runtime / 模型"，不执行任务
  - `scheduler` 只决定"什么时候跑"，不关心"怎么跑"
  - `skill registry` 只负责发现 / 加载 / 卸载 skill，不执行 skill
  - `adapter` 只负责把统一接口翻译成某个 runtime 的调用，不做路由决策

```ts
// ❌ 一个类同时管调度、执行、日志持久化
class TaskRunner { scheduleCron() {} runWithClaude() {} writeLogToDisk() {} }

// ✅ 各管各的
class Scheduler { constructor(private executor: TaskExecutor) {} }
class TaskExecutor { constructor(private router: Router, private log: RunLog) {} }
```

## O — 开闭原则（Open/Closed）

**新增能力靠"加代码"，不靠"改已有代码"。**

- 新增一个 runtime（例如在 Claude Code、Codex 之外再接一个）= 新增一个 adapter 实现 + 注册，**不得**修改 router / scheduler / TUI 里的分支
- 新增一个 skill = 放入 skill 目录，registry 自动发现，**不得**改 core 代码
- 禁止在核心流程里写按类型分支的 `switch (runtime.type)` / `if (name === 'codex')`；用注册表 + 多态代替

```ts
// ❌ 每加一个 runtime 都要改这里
if (task.runtime === 'claude') { ... } else if (task.runtime === 'codex') { ... }

// ✅ 注册表 + 统一接口
const adapter = adapterRegistry.get(route.runtimeId);
await adapter.run(task);
```

## L — 里氏替换（Liskov Substitution）

**任何实现都能替换它的接口，调用方不需要知道具体是谁。**

- 所有 `AgentRuntimeAdapter` 的实现必须满足同一份契约：相同输入语义、相同错误类型、相同的取消 / 超时行为
- 某个 runtime 不支持某能力（例如不支持 computer use）时，**通过能力声明表达**（`capabilities`），而不是在方法里抛 `NotImplemented` 让调用方踩坑
- 子类 / 实现不得收紧前置条件、放松后置条件（例如接口承诺返回完整结果，实现却返回半截流）
- 每个 adapter 必须通过同一套契约测试（contract test）

## I — 接口隔离（Interface Segregation）

**不要逼调用方依赖它用不到的方法。**

- 接口按角色拆小：`Runnable`、`Streamable`、`ComputerUseCapable`、`Cancellable` 分开定义，按需组合
- 一个接口超过约 5–7 个方法时，检查是不是可以按角色拆开
- skill 可见的 API 面要最小化：skill 只能拿到它声明需要的能力，不能拿到整个 core

## D — 依赖倒置（Dependency Inversion）

**高层模块依赖抽象，不依赖具体实现；依赖由外部注入。**

- core（router / scheduler / registry）只依赖接口，**不得** import 具体 SDK（Claude Agent SDK、Codex SDK、截屏库等）
- 具体 SDK 只能出现在对应的 adapter 目录内
- 依赖通过构造函数 / 参数注入，在唯一的组装入口（composition root）里装配；禁止在业务代码里 `new` 具体依赖或使用全局单例
- 时间、文件系统、进程、网络等外部副作用也要抽象成可注入的依赖，方便测试（尤其 scheduler 的"当前时间"）

```ts
// ❌ core 直接绑死具体 SDK
import { query } from '@anthropic-ai/claude-agent-sdk';

// ✅ core 只认接口，具体实现在 adapters/claude-code/ 里
interface AgentRuntimeAdapter {
  readonly id: string;
  readonly capabilities: RuntimeCapabilities;
  run(task: Task, signal: AbortSignal): AsyncIterable<RunEvent>;
}
```

## 依赖方向（硬性约束）

```
TUI  ──►  core（接口 + 编排）  ◄──  adapters / skills / infra 实现
```

- 箭头只能指向 core 的抽象，core 不得反向依赖 TUI、adapter 或具体基础设施
- 出现循环依赖视为设计错误，必须拆解，不得用延迟 import 之类的技巧绕过
