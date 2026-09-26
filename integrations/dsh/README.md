# CaseBench DSH Integration

CaseBench Core 的原生 DSH 只读入口。`integrations/dsh/` 承载 Cordis Host、Typert Remote、Settings 与右侧栏“案件工作台”；Matter、成果和 `_practice/` 仍以 CaseBench 文件为唯一事实源。

## 开发与装载

```bash
pnpm install --ignore-scripts
pnpm run assemble:skill
pnpm test
dsh plugin --profile web add /absolute/path/to/integrations/dsh
```

`assemble:skill` 从 `skills/legal-case-bench/common/` 生成 `dist/skill/`，同时带入 CaseBench 的 vendor YAML 与检索成果引用。不要手工编辑 `dist/skill/`。安装后须重启 DSH Host，已打开的页面须硬刷新，才能看到新 Host 与 Client。

在 DSH Profile 中配置 `legal-casebench` loader 行的 `config.root`（CaseBench 工作区）与 `config.python`。Settings 页面显示当前根目录、Core 版本和已发现 Matter；右侧栏负责案件与办案经验浏览。插件不会写 `_case_state.json` 或 `_practice/`。

当前插件为修复版 `4.0.0-beta.1.2`，随包 Core 为 `4.0.0-beta.1`。CaseBench Core 仍可不依赖 DSH 独立运行；只有 DSH 可视化入口使用本包。

beta.1.1 修复同一来源 Matter 的经验行标识冲突、切换标签残留、成果按钮的 DSH tab hook 与 session 文件地址；`unknown` 程序阶段显示为“阶段待确认”。

beta.1.2 将角色、阶段、程序状态、成果类型、依据类型及核验状态统一显示为中文，并检查设置页、经验复用提示、日期和错误提示。显示层翻译不改写规范字段；原始标题、正文、文件路径和来源地址保留。

只读浏览器回归（需指定已有 Playwright Core 的入口，不自动安装依赖）：

```bash
CASEBENCH_PLAYWRIGHT=/absolute/path/to/playwright-core/index.mjs node scripts/probe-ui.mjs
```

脚本用本地真实工作区校对行数与标题，反复切换两标签，打开 Markdown 并比对正文，再打开 Word 验证原生 PDF 预览。认证链接不写日志，不修改案件内容。

中文界面回归使用同一环境：`node scripts/probe-localization.mjs`，逐个访问案件详情、定稿/法条/案例页面、经验详情和设置页。
