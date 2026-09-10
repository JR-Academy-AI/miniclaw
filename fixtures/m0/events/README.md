# M0：事件、usage 与错误样本审计

> 日期：2026-09-10。范围：已有真实 SDK 捕获的离线复核；本轮没有调用 Claude，没有新增费用。

## 复现

```bash
node fixtures/m0/events/audit.mjs
node --test fixtures/m0/events/audit.test.mjs
```

`normalized-evidence.json` 保存 7 份原始捕获的路径、SHA-256、结果行号、事件计数与 usage。测试比较原始文件和归一化存档；原始 fixture 变化会导致漂移测试失败，必须人工复核后再生成。原始数据在 `fixtures/claude-code/`，没有改写。提示词与探测设置见 `fixtures/claude-code/spike/spike.mjs`。这不是生产 adapter 或完整 usage 模块。

## 已证实

| 项目 | 实际证据与边界 |
|---|---|
| 多轮与流式 | `stream-multiturn` 两次结果均为 `pong`，共享 session，第二个提示词询问上一轮回答；有 text_delta。 |
| 思考 | 默认 `thinking_delta` 可以是空字符串；`thinking` 探测开启 `showThinkingSummaries` 后有非空文本。不得将空思考当故障。 |
| 工具 | `gate` 含 Bash、Bash、Read、Write 四个 tool_use，流中有工具输入增量；权限正确性由 hooks 专项审计负责。 |
| 中止与继续 | `interrupt` 的第一轮为 `aborted_streaming`，`interrupt-hook` 为 `aborted_tools`；第二轮均在同一 session 成功返回 `still-alive`。这是 `query.interrupt()` 后复用同一个 query，不是新进程 `resume` 或 AbortController 的证明。 |
| 认证失败 | `auth-invalid-key` 真实收到 `authentication_failed` 和 `Failed to authenticate. API Error: 401 API key is invalid.`；result 同时有 `subtype: success`、`is_error: true`、`terminal_reason: api_error`。引擎合成的错误 assistant（model 为 `<synthetic>`）仍是实际捕获，不是审计人员伪造。 |
| 限额遥测 | 成功对话包含 `rate_limit_event` 的 `allowed` / `allowed_warning`。其中 overage 被拒绝不等于当前调用配额耗尽，不能把事件名称当终止错误。 |

## usage 的实际语义

1. 同一 API message 被拆成多个 assistant 内容块，`message.id` 重复。`stream-multiturn` 有 4 条 assistant，但只有 2 个 ID，必须去重。
2. 去重还不够：assistant 的 output_tokens 是初始快照（两次各 4，总共 8），`stream_event.message_delta.usage` 才更新到 45 和 44（总共 89）。按 ID 替换快照并输出差值，不能逐次相加。结束时使用该轮 result.usage 对账。
3. 该 query 的 result.usage 按轮返回（45、44），但 `total_cost_usd` 和 `modelUsage` 是会话累计。费用从 0.03648 到 0.0386745，第二轮增量是 0.0021945，不能把两条总费用相加。
4. modelUsage 的累计 outputTokens 为 100，高于前台流的 89；inputTokens 为 920，也高于前台两轮之和 20。样本不能证明差额全部来自哪一种后台调用，不得伪造 attribution。费用是引擎估算，字段 `costBasis: list`；不是订阅账单或实际扣款证明。
5. 流式中止有已输出内容和非零 usage 快照，但 result.usage 全 0。该轮必须保留 partial / unavailable 语义，不能用 0 覆盖已观测消耗或声称免费。失败 / 中止 / 无结果均不能省略 usage 状态。

## 尚未获得的真实证据

- 未登录且完全没有凭证，与「注入无效 API key」不同，仍缺独立捕获。
- `QUOTA_EXHAUSTED`、内部重试耗尽后的 `RATE_LIMITED` 和 `OVERLOADED`：当前 7 份捕获没有终止错误原文。文档映射只可作为文档依据，不可标为已实测。不得通过刷调用耗尽配额来补样本。
- AbortController / 新进程 resume 不由本样本证明；现有 query 中止后继续已验证。
- 第三方 provider 的费用口径、完整后台/subagent usage、进程被杀且没有 result 的用量属于后续阶段或待补证据。

本审计 9 项离线测试通过。不能仅凭这份报告宣称 M0 所有技术验证或可运行的 v0.1 已完成。
