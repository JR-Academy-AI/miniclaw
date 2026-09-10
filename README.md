# miniclaw

第一阶段：终端 TUI 默认连接 Codex agent runtime，也可显式选择 Claude Code；支持多轮流式对话、中断和本地对话记录。尚未包含定时任务、记忆或 Skills。

需要 Node.js 20.19+。当前目录已安装开发依赖；新安装使用 `npm ci`。

```bash
npm run demo          # 不调用 provider，展示 Reef TUI
npm run doctor        # 检查默认 Codex 路径、版本与登录；不调用模型
npm run dev           # 连接实际 Codex，使用已有登录
```

完成本机命令安装后，也可以在任何目录直接运行：

```bash
miniclaw --demo
miniclaw --doctor
miniclaw
```

`miniclaw` 默认使用 Codex；`miniclaw --engine claude` 可切换到 Claude Code。`--model <name>` 显式选择模型。`--codex-path` / `MINICLAW_CODEX_PATH` 和 `--claude-path` / `MINICLAW_CLAUDE_PATH` 可固定对应的引擎程序。

## 演示操作

1. 运行 `npm run demo`，发送一句话，观察流式回复。
2. 输入 `write a file`，看到审批卡片；Enter / `d` 拒绝，`a` 批准一次，`s` 在本次会话批准同样的动作。演示模式始终标注 simulated，不实际写工具文件。
3. 回复过程中按 Esc 中断，之后可以继续对话。
4. `/help` 查看快捷键，`/clear` 清空视图但保留会话上下文，`/exit` 或 Ctrl+C 退出。

输入框支持 Alt+Enter 换行；末尾输入反斜杠再 Enter 也可换行。终端支持 Kitty keyboard protocol 时可使用 Shift+Enter。`/path <path>` 可在开始对话前重新指定引擎路径。

## 工作目录与权限

默认每个对话使用 `~/.miniclaw/users/<user>/workspace/tmp/<session>/`，不会直接在启动命令的目录工作。`npm run dev -- /absolute/workspace` 可显式指定已有目录。JSONL 记录保存在相应 `runs/<session>/transcript.jsonl`；欢迎页显示完整路径。`MINICLAW_HOME` 可修改应用数据根目录。

Codex 的第一阶段 adapter 是 chat-only：以 `readOnly`、无环境、无网络、无 shell / MCP / plugin / hook / skill 的 app-server 线程运行，任何意外审批请求都拒绝；支持流式、多轮和中断，返回 token usage，美元费用显示 unavailable。Codex 当前仍会报告全局 `~/.codex/AGENTS.md` 指令来源，因此不宣称完全隔离所有全局配置。

Claude 工具调用经过 miniclaw 的 Hook 闸门：受保护路径和永久删除直接拒绝，其余写入及可识别 shell 动作需要审批；动态脚本与无法检查的 shell 用法被拒绝。会话批准只对相同工具及相同输入生效，仍重新检查硬底线。这是第一阶段的保守应用权限闸门，不是完整操作系统沙箱。

引擎复用自己的登录目录，以 `settingSources: []`、严格 MCP 配置和显式工具列表隔离用户权限设置、hooks、MCP 与 Skill 调用。**不保证引擎完全不写其自身状态目录**；全新 `CLAUDE_CONFIG_DIR` 与现有登录复用尚未同时验证通过。

## 验证与构建

```bash
npm run check
npm run build
node dist/app/cli.js --demo
```

Reef 主题支持 `MINICLAW_THEME=light`、`MINICLAW_ASCII=1`、`NO_COLOR=1` 和终端颜色降级。

[产品与设计文档](docs/README.md) · [M0 证据](fixtures/m0/README.md) · [展示验收与当前限制](fixtures/v0.1/README.md)
