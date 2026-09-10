# miniclaw TUI Design System · Reef

> 版本：v0.1（草案） · 日期：2026-09-10
> Token 唯一来源：[`design/tokens.json`](../design/tokens.json) · 终端预览：`node design/preview/index.mjs`
> 界面语言：**英文（默认）**，见 §3.1

miniclaw 的视觉语言叫 **Reef（珊瑚礁）**：名字里有 claw，吉祥物是一只像素小螃蟹，住在一片很彩色的珊瑚礁里。要彩色，但每种颜色都有它的意思，不是随手堆的彩虹。

---

## 1. 三条原则

1. **颜色即语义**：8 个色相，每个都绑定了明确的概念（状态、模块、profile）。看颜色就知道"这是谁 / 在哪 / 怎么了"。完整的彩虹渐变只在**品牌时刻**出现：logo、欢迎页、"思考中"。
2. **安静的底，热闹的点**：大约 90% 是终端默认前景色 + 中性色，10% 是彩色。彩色越克制，出现的时候越有信息量。
3. **终端原生**：不给整屏刷背景色，尊重用户的终端主题；真彩色 → 256 色 → 16 色 → 无色，逐级降级；**任何信息都不能只靠颜色传达**，必须配 glyph 或文字。

## 2. 颜色

### 2.1 Reef 色板（8 个色相）

每个色相有两个值：`dark` 用于深色终端，`light` 用于浅色终端。文字对比度都 ≥ 4.5:1（深色终端以 `#1C1B22` 为底、浅色终端以 `#FFFFFF` 为底实测）。

| Token | 名字 | Dark | Light | 16 色回退 | 用途 |
|---|---|---|---|---|---|
| `coral` | 珊瑚 | `#FF6B6B` | `#C92A2A` | brightRed | 错误 · 螃蟹吉祥物 |
| `tangerine` | 橘子 | `#FF9F43` | `#B35300` | yellow | 权限确认 · computer use · `operator` |
| `sun` | 暖阳 | `#FFD43B` | `#8A6500` | brightYellow | 警告 · 默认标记 ★ |
| `kelp` | 海藻 | `#51CF66` | `#237A36` | green | 成功 · Skills 模块 · `cheap` |
| `lagoon` | 泻湖 | `#22D3EE` | `#0B7285` | cyan | 运行中 · 对话模块 · 光标 |
| `tide` | 潮汐 | `#4DABF7` | `#1864AB` | brightBlue | 信息 · 链接 / 路径 · 任务模块 · `coder` |
| `orchid` | 兰花 | `#B197FC` | `#6741D9` | magenta | 定时 · 定时模块 · `thinker` |
| `anemone` | 海葵 | `#F783AC` | `#C2255C` | brightMagenta | 模型模块 |

### 2.2 Reef 渐变

`coral → tangerine → sun → kelp → lagoon → tide → orchid`，在 RGB 空间里做相邻色标之间的线性插值。

- **只用于**：大号 wordmark、欢迎页卡片边框、`Thinking…` 的流光文字、输入提示符 `❯`（取渐变的起点色）
- **不用于**：正文、状态、按钮、普通边框。渐变一旦到处都是，就只剩噪音
- 16 色终端下渐变会**吸附到最近的色标**，自然变成分段色块

### 2.3 中性色

中性色都带一点紫调，让界面有 Reef 的气质，不是死灰。

| Token | Dark | Light | 用途 |
|---|---|---|---|
| *(默认前景)* | 终端自己的前景色 | 同左 | 正文：不指定颜色，自动适配任何主题 |
| `muted` | `#A6A2BD` | `#6B6785` | 次要文字、字段标签、思考内容 |
| `subtle` | `#6F6A88` | `#8F8AA8` | 元信息（时间、id、token 数）、占位符、分隔符 |
| `border` | `#3B3852` | `#D6D3E3` | 未聚焦的边框、分割线 |
| `surface` | `#221F33` | `#F3F1FA` | 状态栏、代码块、选中行的底色 |
| `surfaceStrong` | `#2E2A45` | `#E7E3F5` | 按键徽章（` ⌃K `）、hover / 高亮行 |

`subtle` 和 `border` 的对比度约为 3:1，**只用于装饰和非关键信息**，不能承载必须读的内容。

### 2.4 语义映射（token 引用，不直接写 hex）

| 分组 | 映射 |
|---|---|
| **状态** `semantic.*` | success → kelp · warning → sun · error → coral · info → tide · running → lagoon · permission → tangerine · scheduled → orchid |
| **模块** `module.*` | 对话 → lagoon · 任务 → tide · 定时 → orchid · Skills → kelp · 模型 → anemone · 日志 → muted |
| **Profile** `profile.*` | thinker → orchid · coder → tide · operator → tangerine · cheap → kelp |

- 模块色只出现在**导航层**：当前 tab 的文字和下划线、聚焦面板的边框、输入框边框。你在哪个面板，界面的主色就是那个模块的颜色
- 状态色只出现在**状态 glyph 和状态文字**上。两层的颜色有复用（比如 kelp 既是成功也是 Skills），但它们不会出现在同一个位置
- **用户自定义 profile**：按名字哈希，从 `profile.customHuePool` 里取一个色相，同名永远同色
- `operator`（能操控电脑的 profile）特意用了跟"权限确认"同一个橘色：看到橘色，就意味着"这里有东西能动你的电脑"

## 3. 文字样式

终端只有一种字号，层级靠**字重、颜色、样式**来建立：

| 角色 | 样式 | 例子 |
|---|---|---|
| Wordmark | 粗体 + Reef 渐变 | `miniclaw` |
| 标题 | 粗体 + 模块色 | 面板标题 `Tasks` |
| 正文 | 默认前景色 | agent 的回复 |
| 强调 | 粗体 | 任务名 `daily-brief`、数字 |
| 次要 | `muted` | 字段标签、说明文字 |
| 元信息 | `subtle` | `20:41:07 · 1.2k tok · $0.03` |
| 思考 | 斜体 + `muted` | agent 的推理过程 |
| 路径 / 链接 | 下划线 + `tide` | `~/.miniclaw/tasks` |
| 按键 | 粗体 + `surfaceStrong` 底色 + 左右各一个空格 | ` ⌃K ` |

- 不用 `dim`（SGR 2）：各家终端渲染不一致，改用 `muted` / `subtle` 这两个明确的颜色
- 下划线只给可以点击或打开的东西（路径、URL）
- 行首 glyph 和文字之间固定一个空格

### 3.1 界面语言与文案

- **界面默认语言是英文**：miniclaw 自己输出的所有文案（tab 名、状态、提示、按钮、错误信息、欢迎页、按键提示）都用英文
- **用户内容原样显示**：用户输入、任务名、agent 回复、记忆内容可以是任何语言，不翻译。所以对齐仍然必须按显示宽度计算（§9，CJK = 2 列）
- **大小写**：标题和完整句子用 sentence case（`Approval needed`、`Created schedule daily-brief`）；状态、标签、按键提示这类短词全小写（`running`、`paused`、`3 total`、`send`）。不用全大写表示强调，强调用粗体
- **要短**：能用一个词就不用一句话；按键提示用动词（`send`、`quit`）；时间用 `2 min ago`、`tomorrow 08:00`、`Fri 17:00` 这种短格式
- **宽度预算**：compact（< 66 列）下，欢迎页的 tagline、按键提示、输入框示例也要放得下。改完文案要按 `design/AGENTS.md` 的验证命令看一遍 50 / 75 / 100 列
- **文案不散落在组件里**：正式实现时，界面文案集中放在一处（一张文案表），组件按 key 取用。同一个词（比如 `running`）只定义一次；以后如果要加中文界面，只需要新增一张表，不用改组件（是否提供中文界面见 §11）
- 文档（`docs/`）还是用中文写；文档里引用的界面文案保持英文原文，不翻译

## 4. Glyph

核心 UI **不用 emoji**（宽度不稳定，会把对齐搞乱），只用单宽 Unicode 字符。设置 `MINICLAW_ASCII=1` 或 locale 不是 UTF-8 时，自动回退到 ASCII。

| 语义 | Unicode | ASCII | | 结构 | Unicode | ASCII |
|---|---|---|---|---|---|---|
| running | `●` | `*` | | 提示符 | `❯` | `>` |
| success | `✓` | `v` | | 工具结果 | `⎿` | `` `- `` |
| error | `✗` | `x` | | 折叠 / 展开 | `▸` / `▾` | `+` / `-` |
| warning | `⚠` | `!` | | 对话线 | `│` | `\|` |
| permission | `◆` | `?` | | 默认标记 | `★` | `*` |
| scheduled | `◷` | `@` | | 点缀 | `✦` | `*` |
| paused / queued | `⏸` / `○` | `=` / `o` | | 进度条 | `▰▱` | `#.` |
| retry / cancelled | `↻` / `⊘` | `~` / `-` | | 吉祥物 | `(\/)` | `(\/)` |

## 5. 布局

### 5.1 应用骨架

```
 (\/) miniclaw   Chat   Tasks   Schedules   Skills   Models   Logs     ◆ Computer use 
 ────────────────━━━━──────────────────────────────────────────────────────────────────
                  ↑ 当前 tab 用模块色的粗线（━）标出来
  … 主区域：对话流 / 列表 / 详情 …

 ╭────────────────────────────────────────────────────────────────────────────────────╮
 │ ❯ Sort my Downloads folder by file type        ← 输入框，聚焦时边框用当前模块色     │
 ╰────────────────────────────────────────────────────────────────────────────────────╯
  ● thinker ★ │ ● 1 running │ ◷ daily-brief 08:00          ⏎ send  ⌃K panel  ? help
  └──────────── 状态栏：surface 底色，左边是上下文，右边是按键提示 ───────────────────┘
```

- 左右留白 2 列（`layout.gutter`），面板内边距 1 列，消息组之间空 1 行
- 边框：卡片、输入框用圆角 `╭╮╰╯`；**需要确认的弹窗用粗线 `┏━┓`**，一眼就能看出"这个要你拍板"
- 聚焦的面板边框用模块色，没聚焦的用 `border`

### 5.2 断点（按终端列数）

| 名字 | 列数 | 行为 |
|---|---|---|
| compact | < 66 | 单栏；tab 缩成缩写；欢迎页换成一行小 wordmark `(\/)(°,,°)(\/) miniclaw` |
| regular | 66–119 | 单栏；欢迎页只显示大 logo，不显示螃蟹 |
| wide | ≥ 120 | 对话 + 右侧边栏（运行中的任务 / 下一个定时任务）；欢迎页从 ≥ 86 列起就显示螃蟹 + logo |

## 6. 组件

| 组件 | 规范 |
|---|---|
| **用户消息** | 渐变起点色 `❯` + 粗体正文 |
| **Agent 消息** | 头部：profile 圆点 + profile 名 + `subtle` 的 `· runtime · 时间`；正文左边是 profile 色的 `│` 对话线，一眼能看出是哪个 profile 在说话 |
| **思考中** | 转圈字符（lagoon）+ `Thinking…` 渐变流光；思考内容用斜体 `muted`，默认折叠成一行 |
| **工具调用** | `▸ 工具名（粗体，补齐 6 列） 参数摘要（muted）  ✓ 耗时（subtle）`；展开后结果放在 `⎿` 下面，默认最多显示 5 行 |
| **Run 行** | 状态 glyph · `#id`（subtle）· 任务名 · profile 圆点 · 备注；运行中的额外带 `▰▰▰▱▱` 进度条，失败的备注用 coral 写明原因 |
| **权限弹窗** | tangerine 粗边框，标题写 `◆ Approval needed`；第一行说明"谁要干什么"（`● operator wants to control your computer`），第二行是具体动作；按键徽章 `y allow once · s this session · n deny · d details`，对应 PRD F8 的 ask / session 两级 |
| **电脑操控徽章** | computer use 执行期间，tab 栏右侧**常驻**一个 tangerine 实底徽章 ` ◆ Computer use `，不会自动消失 |
| **Toast** | 状态栏上方单行，`✓ skill github-digest reloaded`，3 秒后淡出；错误类的 toast 需要手动关闭 |
| **按键徽章** | ` ⌃K `：`surfaceStrong` 底色 + 粗体，后面跟 `muted` 的说明文字 |
| **状态栏** | `surface` 底色撑满整行；左边是默认 profile、运行数、下一个定时任务，右边是按键提示 |

## 7. 动效

| 名字 | 规格 |
|---|---|
| Spinner | 盲文点阵 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`，80ms 一帧，lagoon |
| Shimmer | `Thinking…` 的渐变每 60ms 偏移一次，看起来像一道光在字上流过 |
| 欢迎页 | 见 §8，最长 1.4 秒 |
| 帧率 | 最高 30fps；只重绘有变化的区域 |

**减少动效**：不是 TTY（输出被管道）、`CI` 环境、`MINICLAW_REDUCED_MOTION=1` 时，所有动画直接显示最后一帧。

## 8. 欢迎页

登录（启动）时出现，作用是在一屏里完成三件事：**有品牌感、告诉你系统状态、马上能开始输入**。

### 8.1 构成（从上往下）

1. **Hero**：左边是 16×12 像素的小螃蟹（用 `▀▄` 半格字符画出来，前景色画上半像素、背景色画下半像素，所以一行字符等于两行像素）；右边是 ANSI Shadow 字体的 `MINICLAW` 大字（61×6），走**对角线 Reef 渐变**：实心的 `█` 用全饱和色，阴影笔画 `╗║═` 往背景色混 40%，做出立体感
2. **Tagline**：`muted`，`a lightweight OpenClaw for your terminal`
3. **状态卡片**：边框也是对角线渐变。第一行是问候 + 用户名 + 版本号（`Good evening, lightman ✦ … v0.1.0`），下面是 5 项**启动检查**：
   - `runtime`：Claude Code / Codex 是否可用
   - `profiles`：可用的 profile，★ 标出默认的那个
   - `skills`：已加载 / 已禁用的数量
   - `schedule`：下一个定时任务 + 定时任务总数
   - `computer`：computer use 需要的系统权限（缺权限时用 tangerine `◆` 给出修复入口：`grant Accessibility → run /doctor`）
4. **按键提示**：` ⏎ ` send ` / ` cmd ` ⌃K ` panel ` ? ` help ` ⌃C ` quit（用短词，保证 compact 宽度下放得下）
5. **输入提示符**：`❯` + `subtle` 斜体的示例任务（`Try "brief me every weekday at 8am"`）。**输入框从第一帧起就能用**

问候语按时间变化：`Good morning`（5–11 点）/ `Good afternoon`（12–17 点）/ `Good evening`（18–23 点）/ `Still up`（0–4 点）。

### 8.2 动画时间线

| 时间 | 发生什么 |
|---|---|
| 0 → 600ms | Logo 沿对角线从左上往右下擦出（ease-out cubic） |
| 250ms、650ms | 螃蟹"咔嚓"合一下钳子，每次 120ms |
| 360 → 860ms | 一道白色高光斜着扫过 logo |
| 450ms 起 | 5 项检查每隔 90ms 依次出现：先是 `⠋ checking…`，220ms 后变成真实结果 |
| ≤ 1400ms | 定格在最后一帧 |

- **按任意键立刻跳到最后一帧**；欢迎动画**永远不阻塞输入**（PRD 要求冷启动到可交互 < 2s）
- 检查结果必须是真实的：检查慢了就一直显示 spinner，不能为了动画好看先显示 ✓
- 同一天第二次启动可以只显示 compact 版（待定，看实际使用感受）

### 8.3 各种终端下的表现

| 条件 | 表现 |
|---|---|
| ≥ 86 列 | 螃蟹 + 大 logo + 80 列宽的卡片 |
| 66–85 列 | 只有大 logo，卡片宽 61 列 |
| < 66 列 | `(\/)(°,,°)(\/) miniclaw` 一行 wordmark，检查项不加边框 |
| 256 色 | 渐变映射到 xterm 6×6×6 色立方体 |
| 16 色 | 渐变吸附到色标，变成分段色块 |
| `NO_COLOR` | 只保留粗体 / 斜体，靠 glyph 和文字传达全部信息 |

## 9. 可访问性与降级

- **颜色深度检测**：`NO_COLOR` → 无色；`COLORTERM=truecolor|24bit` → 真彩色；`TERM` 里有 `256` → 256 色；其余 → 16 色
- **深浅主题**：`MINICLAW_THEME=light|dark` 可以强制指定；否则读 `COLORFGBG`（背景值是 7 或 15 就是浅色）；都没有时默认深色。之后可以加上 OSC 11 查询终端背景色
- **不只靠颜色**：每个状态都有自己的 glyph；错误一定带 `✗` 和原因文字
- **对比度**：色板文字 ≥ 4.5:1；`subtle` / `border` 只用于装饰
- **宽字符**：所有对齐都按**显示宽度**计算（CJK = 2 列），不按字符数

## 10. 落地说明

- `design/tokens.json` 是颜色、glyph、动效、断点的**唯一来源**。不管最后选 Ink、Bubble Tea 还是 Textual，都应该读这份 JSON（或者在构建时从它生成代码），**不要把 hex 直接写进组件**
- `design/preview/` 是零依赖的 Node 原型，用来在真实终端里看效果、调参数，**不代表 TUI 框架选型**（选型仍在 PRD §10 待决策）：

```bash
node design/preview/index.mjs                    # 欢迎页（带动画，按任意键跳过）
node design/preview/index.mjs palette            # 色板
node design/preview/index.mjs screen             # 工作界面示意
node design/preview/index.mjs screen --light     # 浅色终端版本
node design/preview/index.mjs --depth 16         # 看 16 色降级（也可以 256 / none）
node design/preview/index.mjs --width 60         # 看 compact 布局
```

- 渐变、半格像素画、按显示宽度补齐这些逻辑，在 `design/preview/ansi.mjs` 里已经写过一遍，正式实现时可以直接参考

## 11. 待定

- [ ] 要不要提供其他主题（比如 `deep-sea` 冷色、`mono` 单色），还是 Reef 一套就够
- [ ] 同一天第二次启动时，欢迎页要不要缩成 compact 版
- [ ] 螃蟹的其他状态帧（报错时的"晕倒螃蟹"、定时任务跑完时的"挥钳"）要不要做
- [ ] 通过 OSC 11 自动检测终端背景色
- [ ] 是否提供中文界面（zh）及切换方式；默认英文已定（§3.1），总的待决策记录在 PRD §10
