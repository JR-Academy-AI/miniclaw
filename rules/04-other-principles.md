# 补充原则（强制）

## 关注点分离（Separation of Concerns）

- **纯逻辑与副作用分离**：路由决策、cron 计算、skill 元数据解析写成纯函数；文件读写、进程启动、网络请求、截屏 / 键鼠操作放在边缘层
- **展示与业务分离**：TUI 组件只接收数据、发出意图（intent / action），不直接调用 adapter 或读写存储
- **配置与代码分离**：模型、路由规则、schedule、skill 路径等放配置，不硬编码
- 分层目录建议（选型确定后可调整，但分层思想不变）：

```
core/        # 领域模型 + 接口 + 编排逻辑（纯，不依赖具体 SDK）
adapters/    # runtime 适配器：claude-code/、codex/ ……
domains/     # Domain Runtime 定义：research/、browser/、document/、coding/（playbook、verifier，纯；见 docs/HARNESS.md）
infra/       # 存储、日志、进程、系统调用等具体实现
skills/      # skill 加载相关
tui/         # 界面
app/         # composition root：唯一装配依赖的地方
```

## 组合优于继承（Composition over Inheritance）

- 默认用组合 + 接口实现复用；继承层级 ≤ 2 层
- 横切能力（重试、超时、日志、审计）用包装 / 装饰器组合到 adapter 上，而不是做一个巨型 `BaseAdapter` 让所有人继承

```ts
// ✅ 按需组合横切能力
const adapter = withAudit(withRetry(withTimeout(new CodexAdapter(config), 60_000), 3), auditLog);
```

## 迪米特法则（Law of Demeter / 最少知识）

- 只和直接依赖说话，不要穿透对象链：`task.session.runtime.client.send()` 这类写法禁止
- 需要什么就注入什么，不要注入一个大对象再从里面掏

## Fail Fast（快速失败）

- 在边界处（配置加载、skill 加载、外部输入、IPC 消息）**立即校验**，非法就明确报错，不带着坏数据往下跑
- 禁止吞异常：`catch {}` 或只打日志不处理，必须重新抛出、转换成领域错误，或有明确的降级逻辑并记录
- 错误信息要可操作：说明**哪里错了、为什么、怎么修**
- 无人值守任务（schedule）失败必须持久化记录并可在 TUI 中看到，不能静默失败

## 最小惊讶（Principle of Least Astonishment）

- 函数行为与名字一致：`getX` 不能有副作用，`validateX` 不能修改数据
- 同类 API 保持一致的参数顺序、命名、返回形态、错误处理方式
- 默认值要安全：computer use、shell 执行、文件删除等危险操作默认需要确认，不能默认放行

## 不可变优先

- 默认用不可变数据；需要修改时返回新值
- 共享状态（session、registry、schedule 表）只通过明确的接口修改，不允许外部直接改内部字段
