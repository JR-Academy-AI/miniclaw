# design/ — Reef TUI design system

## 职责
定义 miniclaw TUI 的视觉语言：`tokens.json` 存所有数值，`docs/DESIGN.md` 写规则和理由，`preview/` 是零依赖的终端原型，用来在真实终端里看效果、调参数。
**不负责**：TUI 的实现，也不代表框架选型（PRD §10 仍待定）。禁止把 `preview/` 当成 TUI 代码的起点直接往上堆功能。

## 对外契约
- `tokens.json` 是颜色、glyph、边框、spinner、动效时长、断点的**唯一来源**。TUI 实现必须读它（或在构建时从它生成代码），禁止在组件里写 hex 或 glyph 字面量
- 取值冲突时 **`tokens.json` 为准**；`docs/DESIGN.md` 里的色值表是给人看的副本
- 组件按语义取色：`semantic.*` / `module.*` / `profile.*` 引用色板名，不直接引用色板，**禁止写 hex**
- 每个颜色都必须同时有 `dark`、`light`、`ansi16`（`ansi16: null` 只允许用于背景色，表示 16 色下不铺底色）；每个 glyph 都必须同时有 `unicode`、`ascii`
- `tokens.json` 的 `version` 按语义化版本升级：新增 token → minor；改值 → patch；重命名 / 删除 / 改结构 → major（所有读取方都要跟着改）
- 改任何 token：同一次改动里同步 `docs/DESIGN.md` 对应表格，并在 `CHANGELOG.md` 记一条（`design:` 前缀）

## 不变量
- 色板文字色对比度 ≥ 4.5:1（深色底 `#1C1B22`，浅色底 `#FFFFFF`）；`subtle` / `border` 只能用于装饰，不能承载必须读的信息
- Reef 渐变只用于品牌时刻（wordmark、欢迎页、Thinking 流光、提示符），禁止用于状态或正文
- 状态永远是 glyph + 颜色，不能只靠颜色；`NO_COLOR` 下信息依然完整
- glyph 的 unicode 值必须是**单宽字符**，禁止 emoji
- 欢迎页动画 ≤ `motion.welcome.maxTotalMs`，按任意键跳过，任何时候都不阻塞输入；非 TTY / `CI` / `MINICLAW_REDUCED_MOTION=1` 时只显示最后一帧
- 所有对齐按显示宽度计算（CJK = 2 列），不按字符数
- **界面文案默认英文**（规范见 `docs/DESIGN.md` §3.1）：preview 和将来的 TUI 里，miniclaw 自己输出的文字一律英文，`design/preview/*.mjs` 里不得出现中文；只有用户内容（输入、任务名、agent 回复）可以是任何语言
- 改文案要看宽度：英文通常比中文长。50 列下 tagline 和输入框示例必须放得下；按键提示用短词（`send` / `cmd` / `panel`）。已知问题：50 列下 profiles 行（53 列）和按键提示（52 列）略超，改文案时不要让它们更宽
- `profile.customHuePool` 按 profile 名哈希取色，同名永远同色；调整池子会改变已有自定义 profile 的颜色，需在 CHANGELOG 注明

## preview/ 约定
- **零依赖**，只用 Node ≥ 20 标准库；禁止引入 npm 包
- 所有取值经 `ansi.mjs` 从 `tokens.json` 读取，禁止在 preview 里硬编码 hex、glyph 或时长
- `sample-data.mjs` 是假数据，代表将来由 core 提供的数据；不要在里面写业务逻辑
- 要保持支持的环境变量：`NO_COLOR`、`FORCE_COLOR`、`COLORTERM` / `TERM`、`MINICLAW_THEME`、`MINICLAW_ASCII`、`MINICLAW_REDUCED_MOTION`、`CI`。正式 TUI 必须保持相同行为

## 容易改错的地方
- 改了色值，要重新检查深浅两种底色下的对比度，并同步更新 `docs/DESIGN.md` §2 的表格；只改一种主题的值是最常见的遗漏
- `composeWelcomeFrame(context, elapsed)` 必须是纯函数，而且每一帧的行数必须一样：动画循环是靠"光标上移 N 行"来重绘的
- 半格像素画里，16 色和无色模式下没有背景色：上下两个像素颜色不同时要退化成 `█`
- 256 色模式由 RGB 映射到 xterm 色立方体，16 色模式由 `ansi16` 字段决定，两者不会自动一致；新增颜色时两个都要看一眼
- 新加 glyph 用了双宽字符（多数 emoji、部分符号）→ 列对齐全部错位

## 验证
改完必须跑下面这些命令，肉眼检查：

```bash
node -e "JSON.parse(require('fs').readFileSync('design/tokens.json','utf8'))"   # JSON 合法
node design/preview/index.mjs welcome --static --width 100   # 以及 --width 75 / --width 50
node design/preview/index.mjs screen --static --light
node design/preview/index.mjs palette --static --depth 16
NO_COLOR=1 node design/preview/index.mjs --static --ascii
grep -nE '[一-鿿]' design/preview/*.mjs            # 必须没有输出（界面文案不得有中文）
```
