# M0 登录与配置隔离验证（2026-09-10）

测试安装版本：Claude Agent SDK 0.3.267；CLI / bundled engine 2.1.267。

## 已实测

- `node fixtures/m0/auth-config/auth-status.mjs`：引擎自己的免费 `claude auth status --json` 在原配置目录返回 `loggedIn:true, authMethod:claude.ai`；只将 `CLAUDE_CONFIG_DIR` 指到新建空目录即返回 `loggedIn:false, authMethod:none`（退出码 1）。只保存白名单状态字段，不保存账号标识，不读取、复制或输出凭证，不调用 `security`。
- `node fixtures/m0/auth-config/probe.mjs`：全部使用人工 HOME / 配置 / 工作目录、假 key 和 `http://127.0.0.1:1`；真实 SDK 启动但没有任何可计费提供商调用，所有 result 的费用为 0。`maxTurns:0` **不会**阻止首次请求，不能当作零请求保障；本测试的安全边界是 loopback endpoint。
- `settingSources:[]`：人工 user/project/local 中的 SessionStart hook 均未执行；启用三个来源的正对照中三个 hook 全执行。权限 allow canary 属于相同 settings 文件，但本测试没有发起工具调用，不能声称直接验证了权限执行。
- 环境优先级：三个来源均启用时，`settings.local.json` 的 `env.MINICLAW_M0_CANARY=local` 覆盖进程值 `process`；只有 SDK flag settings 时，flag 的 `env=flag` 覆盖进程值。来源正对照及 flag hook 读取的是实际启动进程环境。
- `strictMcpConfig:true` 时无 MCP；关闭 strict 且启用来源的正对照会启动人工项目 MCP canary，记录其失败状态。它故意只写 marker 后退出，不提供真实工具。
- 人工用户 skill 在来源关闭时不出现，在来源启用且 `skills:'all'` 时出现。**`skills:[]` 和 `settings.disableBundledSkills:true` 仍留下 `doctor` 列表项及 `Skill` 工具**。显式 `tools:['Read']` 加 `disallowedTools:['Skill']` 后工具表仅 Read，但 doctor 列表项仍在；禁止工具执行与清空全部提示/发现元数据是不同结论。

## M11 可执行选择及剩余边界

复用原登录目录，启动环境仅选 HOME / PATH / USER / LOGNAME / SHELL / TMPDIR / LANG，再显式设置 retry/timeout 和 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`；使用 `settingSources:[]`、`strictMcpConfig:true`、空 MCP、`skills:[]`、`settings.disableBundledSkills:true`，显式内置工具白名单排除 Skill，PreToolUse 对每次动作作最终闸门。

这是经验证的**权限 settings / hooks / MCP 来源隔离**路线，不等于隔离整个 `~/.claude.json`、所有启动副作用或引擎状态写入。当前没有经验证且不复制凭证的“新 CLAUDE_CONFIG_DIR + 原登录复用”方案；不能将此项标通过。engine `persistSession:false` 只说明不保存会话，不保证完全不写自身配置目录。未变更用户设置文件，没有运行额外付费探测。

SDK 安装类型证据：`sdk.d.ts` 的 Options.env 文档明确环境整体替换；settingSources 文档明确空列表不加载文件设置但不排除 managed settings；skills 文档明确它是上下文过滤而不是文件沙箱。使用此安装版本验证，没有将 SDK 源码声明冒充真实运行结果。

## 产物

`isolated.json`、`sources-enabled.json`、`flag-env.json`、`explicit-tools.json` 为经字段白名单处理的真实 SDK 事件及 canary 观测；`auth-status.json` 为引擎登录检查的选择字段。脚本仅写 fixtures 本目录及自建临时目录，不修改已有 spike 或应用代码。
