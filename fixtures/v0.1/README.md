# v0.1 展示验收

日期：2026-09-10，Australia/Brisbane。范围：Reef TUI、默认 Codex adapter、可选 Claude Code adapter、流式对话、中断、slash commands、输入编辑与本地 transcript。

## 实际终端检查

- `miniclaw --doctor` 默认找到 Codex 0.153.4，并确认现有 ChatGPT 登录；检查不调用模型。
- `npm run dev` 的真实 Codex 回合使用 `openai / gpt-5.6-sol`，提示 `reply only pong` 得到 `pong`；界面显示流式内容、14,154 tokens 和 `cost unavailable`。
- 同一真实终端输入 `/helpx`，Backspace/DEL 正确删除 `x`；Enter 提交 `/help` 后显示命令及快捷键，输入框清空。
- Codex 线程实际采用 `readOnly`、`networkAccess: false` 和 `approvalPolicy: never`。M0 adapter 为 chat-only，关闭 shell、MCP、plugins、hooks、skills 与 web，意外的 server request 默认拒绝。
- `miniclaw --engine claude` 保留 Claude Code adapter。此前真实检查发现本机 Claude 2.1.267 已登录，但账户额度耗尽；脱敏事件见 `live-quota.jsonl`。

## 自动检查

最终 `npm run check`：11 个测试文件、126 项测试通过，TypeScript 检查通过；`npm run build` 通过。覆盖权限硬底线、路径检查、Codex/Claude adapter、流式、多轮、中断后继续、usage、输入控制字符、slash commands 和 Reef 终端降级。

TUI 50/80/120 列的真实 Ink 帧见 `../m0/tui/`。构建后的 `miniclaw` 命令已安装到本机，并默认运行 Codex。

## 当前限制

Codex v0.1 只提供安全文本对话，不执行工具；美元费用不可用。Codex 仍报告全局 `~/.codex/AGENTS.md` instruction source，因此不宣称完全隔离全局配置。Claude 权限闸门是应用层检查，不是完整 OS sandbox。
